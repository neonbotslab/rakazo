import { isDeepStrictEqual } from "node:util";
import type { HostPluginId, HostPluginTaskCard } from "@rakazo/contracts";
import { HostPluginTaskCardsSchema } from "@rakazo/contracts";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import {
  accountPreferencesChangesScope,
  assertLeaseHeld,
  JsonColumnMismatchError,
  LeaseHeldError,
  loadSpaceContentKeys,
  readJsonColumn,
  reportJsonColumnOnce,
  runAsSystem,
  runAsTenant,
  withLease,
} from "@rakazo/db";
import { bestEffort } from "@rakazo/logging";
import type { HostTaskFeed, TaskFeedBinding, TaskFeedResult } from "./task-feed.js";

type Scope = { spaceId: string; userId: string; botId: string };

export interface HostPluginTaskCards {
  readonly pluginId: HostPluginId;
  read(scope: Scope): Promise<HostPluginTaskCard[]>;
  reconcile(): Promise<void>;
}

const REFRESH_MS = 30_000;
const ENDED_RETENTION_MS = 24 * 60 * 60_000;
const MAX_SNAPSHOT_CARDS = 200;

type Snapshot = { id: string; bindingKey: string; cards: unknown; checkedAt: Date };

function savedCards(row: Snapshot | null, binding: TaskFeedBinding) {
  if (!row || row.bindingKey !== binding.key) return;
  try {
    return readJsonColumn(
      HostPluginTaskCardsSchema,
      row.cards,
      {
        table: "host_plugin_task_snapshots",
        column: "cards",
        id: row.id,
      },
      "reject",
    );
  } catch (error) {
    if (!(error instanceof JsonColumnMismatchError)) throw error;
    reportJsonColumnOnce("Skipped malformed plugin task snapshot", error.row);
  }
}

function isEnded({ status }: HostPluginTaskCard) {
  return status === "done" || status === "failed" || status === "lost";
}

function recentCards(cards: readonly HostPluginTaskCard[], at: number, includeActive = true) {
  const cutoff = at - ENDED_RETENTION_MS;
  return cards.filter((card) =>
    isEnded(card) ? (card.endedAt ?? card.startedAt) >= cutoff : includeActive,
  );
}

function scopedCards(
  tasks: Extract<TaskFeedResult, { kind: "ready" }>["tasks"],
  requester: string,
  at: number,
) {
  const cards = recentCards(
    tasks.filter(({ requestedBy }) => requestedBy === requester).map(({ card }) => card),
    at,
  );
  const unique = new Map<string, HostPluginTaskCard>();
  for (const card of cards) if (!unique.has(card.id)) unique.set(card.id, card);
  return [...unique.values()]
    .sort(
      (a, b) =>
        Number(isEnded(a)) - Number(isEnded(b)) ||
        b.startedAt - a.startedAt ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_SNAPSHOT_CARDS);
}

export function createHostPluginTaskCards({
  prisma,
  events,
  feed,
  now = Date.now,
}: {
  prisma: PrismaClient;
  events: Pick<ThreadEvents, "publishSpaceChange">;
  feed: HostTaskFeed;
  now?: () => number;
}): HostPluginTaskCards {
  const { pluginId } = feed;
  const key = (scope: Scope) => ({ pluginId_spaceId_userId_botId: { pluginId, ...scope } });
  const readRow = (scope: Scope) => prisma.hostPluginTaskSnapshot.findUnique({ where: key(scope) });
  const allowed = async (
    scope: Scope,
    db: Pick<PrismaClient, "bot" | "userHostPlugin"> = prisma,
  ) => {
    const [bot, preference] = await Promise.all([
      db.bot.findFirst({
        where: {
          id: scope.botId,
          spaceId: scope.spaceId,
          userId: scope.userId,
          archivedAt: null,
          space: { memberships: { some: { userId: scope.userId } } },
        },
        select: { id: true },
      }),
      db.userHostPlugin.findUnique({
        where: { userId_pluginId: { userId: scope.userId, pluginId } },
        select: { enabled: true },
      }),
    ]);
    return Boolean(bot && preference?.enabled);
  };
  let fetching: Promise<TaskFeedResult> | undefined;
  const list = () => {
    fetching ??= feed.list().finally(() => {
      fetching = undefined;
    });
    return fetching;
  };

  async function refresh(
    scope: Scope,
    binding: TaskFeedBinding,
    load: () => Promise<TaskFeedResult>,
  ) {
    const leaseKey = `plugin-tasks:${JSON.stringify([pluginId, scope.spaceId, scope.userId, scope.botId])}`;
    try {
      return await withLease(prisma, leaseKey, { ttlMs: 20_000 }, async (lease) => {
        const previous = await readRow(scope);
        const cards = savedCards(previous, binding);
        if (previous && cards && now() - previous.checkedAt.getTime() < REFRESH_MS) return cards;
        const result = await load();
        const at = now();
        const next =
          result.kind === "ready"
            ? scopedCards(result.tasks, binding.requestedBy, at)
            : result.kind === "offline"
              ? recentCards(cards ?? [], at, false)
              : [];
        const data = { bindingKey: binding.key, cards: next, checkedAt: new Date(at) };
        await loadSpaceContentKeys(prisma, scope.spaceId);
        const committed = await prisma.$transaction(async (tx) => {
          await assertLeaseHeld(tx, lease);
          if (!(await allowed(scope, tx))) return false;
          if (previous)
            await tx.hostPluginTaskSnapshot.update({ where: { id: previous.id }, data });
          else await tx.hostPluginTaskSnapshot.create({ data: { pluginId, ...scope, ...data } });
          return true;
        });
        if (!committed) return [];
        // A read that saw a stale active snapshot while this lease was held omitted those cards.
        const restoredView = previous && (!cards || next.some((card) => !isEnded(card)));
        if (restoredView || !isDeepStrictEqual(cards ?? [], next)) {
          await events.publishSpaceChange?.(
            accountPreferencesChangesScope(scope.userId),
            "pluginCards",
          );
        }
        return next;
      });
    } catch (error) {
      if (!(error instanceof LeaseHeldError)) throw error;
      if (!(await allowed(scope))) return [];
      const row = await readRow(scope);
      const at = now();
      const fresh = row !== null && at - row.checkedAt.getTime() < REFRESH_MS;
      return recentCards(savedCards(row, binding) ?? [], at, fresh);
    }
  }

  return {
    pluginId,
    read: (scope) =>
      runAsTenant(scope, async () => {
        const binding = feed.bindingFor(scope.botId);
        if (!binding || !(await allowed(scope))) return [];
        const row = await readRow(scope);
        const cards = savedCards(row, binding);
        const at = now();
        return row && cards && at - row.checkedAt.getTime() < REFRESH_MS
          ? recentCards(cards, at)
          : refresh(scope, binding, list);
      }),
    async reconcile() {
      const due = await runAsSystem("find due plugin task snapshots", () =>
        prisma.hostPluginTaskSnapshot.findMany({
          where: {
            pluginId,
            botId: { in: [...feed.botIds] },
            checkedAt: { lte: new Date(now() - REFRESH_MS) },
            user: { hostPlugins: { some: { pluginId, enabled: true } } },
            bot: { archivedAt: null },
          },
          select: { spaceId: true, userId: true, botId: true },
          orderBy: [{ checkedAt: "asc" }, { id: "asc" }],
          take: feed.botIds.length,
        }),
      );
      let listing: Promise<TaskFeedResult> | undefined;
      for (const scope of due) {
        const binding = feed.bindingFor(scope.botId);
        if (!binding) continue;
        await bestEffort(
          "refresh plugin task snapshot",
          runAsTenant(scope, async () => {
            if (await allowed(scope)) await refresh(scope, binding, () => (listing ??= list()));
            else await prisma.hostPluginTaskSnapshot.deleteMany({ where: { pluginId, ...scope } });
          }),
        );
      }
    },
  };
}
