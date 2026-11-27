import type { JobPublisher, RealtimeFanout } from "@rakazo/adapter-kit";
import { RetryJobLaterError } from "@rakazo/adapter-kit";
import type { PluginTurnFinished } from "@rakazo/core/plugin-host";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { assertLeaseHeld, LeaseHeldError, runAsSystem, runAsTenant, withLease } from "@rakazo/db";
import { bestEffort, getLogger } from "@rakazo/logging";
import { z } from "zod";
import { enabledHostPluginIds, serverPlugins } from "./server-plugins.js";

const topic = "plugin.turn-finished";
const status = z.enum(["completed", "failed", "cancelled"]);
const leaseMs = 60_000;
const catchUpBatchSize = 20;

/**
 * The event ID is stable across attempts. A successful hook is recorded before moving on.
 * If its side effect succeeds and the process dies before writing that receipt, the hook can
 * run again. Plugins with side effects use their plugin ID and the event ID to deduplicate.
 */
export async function dispatchRunTerminalEvent(
  prisma: PrismaClient,
  runId: string,
  {
    registry = serverPlugins,
    signal,
  }: { registry?: typeof serverPlugins; signal?: AbortSignal } = {},
): Promise<void> {
  return runAsSystem("dispatch a committed plugin terminal event", () =>
    withLease(prisma, `${topic}:${runId}`, { ttlMs: leaseMs, signal }, async (lease) => {
      const row = await prisma.runTerminalEvent.findUnique({ where: { runId } });
      if (!row || row.dispatchedAt) return;
      const event: PluginTurnFinished = Object.freeze({
        eventId: row.runId,
        runId: row.runId,
        spaceId: row.spaceId,
        userId: row.userId,
        threadId: row.threadId,
        botId: row.botId,
        status: status.parse(row.status),
        finishedAt: row.finishedAt.toISOString(),
      });
      const enabled = await runAsTenant(event, () => enabledHostPluginIds(prisma, event.userId));
      const record = (data: Prisma.RunTerminalEventUpdateManyMutationInput) =>
        prisma.$transaction(async (tx) => {
          lease.signal.throwIfAborted();
          await assertLeaseHeld(tx, lease);
          await tx.runTerminalEvent.updateMany({ where: { runId }, data });
        });
      const failures: unknown[] = [];
      for (const { manifest, hooks } of registry.enabled(enabled)) {
        lease.signal.throwIfAborted();
        const finish = hooks.onTurnFinished;
        if (!finish || row.deliveredPluginIds.includes(manifest.id)) continue;
        try {
          await runAsTenant(event, () => finish(event));
          await record({ deliveredPluginIds: { push: manifest.id } });
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw failures[0];
      await record({ dispatchedAt: new Date() });
    }),
  );
}

export async function dispatchRunTerminalEventJob(prisma: PrismaClient, runId: string) {
  try {
    await dispatchRunTerminalEvent(prisma, runId);
  } catch (error) {
    if (error instanceof LeaseHeldError) throw new RetryJobLaterError(leaseMs, { cause: error });
    throw error;
  }
}

/** The trigger's post-commit signal starts work now. The same transaction owns the backup job. */
export async function followRunTerminalEvents({
  prisma,
  realtime,
  jobs,
  registry = serverPlugins,
}: {
  prisma: PrismaClient;
  realtime: RealtimeFanout;
  jobs: Pick<JobPublisher, "cancel" | "enqueue">;
  registry?: typeof serverPlugins;
}): Promise<() => Promise<void>> {
  const stop = new AbortController();
  const deliver = async (runId: string) => {
    const key = `${topic}:${runId}`;
    try {
      await dispatchRunTerminalEvent(prisma, runId, { registry, signal: stop.signal });
    } catch (error) {
      if (stop.signal.aborted || error instanceof LeaseHeldError) return;
      getLogger().error("turn finish plugin failed", error);
      await jobs.enqueue({ name: topic, payload: { runId }, replaceKey: key });
      return;
    }
    if (!stop.signal.aborted) await jobs.cancel(key);
  };
  const deliverSafely = (runId: string) =>
    bestEffort("dispatch terminal run event", deliver(runId));
  const drain = () =>
    runAsSystem("catch up committed plugin terminal events", async () => {
      let after: string | undefined;
      while (!stop.signal.aborted) {
        const rows = await prisma.runTerminalEvent.findMany({
          where: { dispatchedAt: null, ...(after && { runId: { gt: after } }) },
          select: { runId: true },
          orderBy: { runId: "asc" },
          take: catchUpBatchSize,
        });
        await Promise.all(rows.map(({ runId }) => deliverSafely(runId)));
        if (rows.length < catchUpBatchSize) return;
        after = rows.at(-1)?.runId;
      }
    });
  let catchingUp = Promise.resolve();
  const catchUp = () => {
    catchingUp = catchingUp.then(async () => {
      await bestEffort("catch up terminal run events", drain());
    });
  };
  const unsubscribe = await realtime.subscribe(topic, (runId) => {
    if (stop.signal.aborted) return;
    if (runId) void deliverSafely(runId);
    else catchUp();
  });
  catchUp();
  return async () => {
    stop.abort();
    await unsubscribe();
    await catchingUp;
  };
}
