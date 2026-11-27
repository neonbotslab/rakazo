import { randomUUID } from "node:crypto";
import type { HostPluginTaskCard } from "@rakazo/contracts";
import { deferred } from "@rakazo/core/test-async";
import { asSystem, createDb, provisionMessagingIdentity, runAsTenant } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HostTaskFeed, TaskFeedResult } from "./task-feed.js";
import { createHostPluginTaskCards } from "./task-snapshots.js";

const url = process.env.DATABASE_URL;

describe.skipIf(process.env.VERIFY_DATABASE !== "1" || !url)("host plugin task snapshots", () => {
  const db = createDb(url!, { encryptContent: true });
  const system = asSystem(db.prisma);
  let scope: { userId: string; spaceId: string; botId: string };
  const pluginId = "test/task-feed";
  const now = Date.parse("2027-01-01T00:00:00Z");

  beforeAll(async () => {
    const { userId, spaceId, botId } = await provisionMessagingIdentity(system, {
      provider: "test",
      address: `task-snapshots-${randomUUID()}`,
    });
    scope = { userId, spaceId, botId };
    await system.userHostPlugin.create({ data: { userId, pluginId, enabled: true } });
  });

  afterAll(async () => {
    if (scope) {
      await system.organization.deleteMany({ where: { id: scope.spaceId } });
      await system.user.deleteMany({ where: { id: scope.userId } });
    }
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  function card(id: string, status: HostPluginTaskCard["status"] = "running"): HostPluginTaskCard {
    return {
      id,
      status,
      startedAt: now - 1000,
      title: `Fixture ${id}`,
      href: `https://tasks.example.test/t/${id}`,
    };
  }

  it("fetches on first demand, projects only owned tasks, and reuses the snapshot across instances", async () => {
    let clock = now;
    const running = card("owned-running");
    const finished = { ...card("owned-done", "done"), endedAt: now - 500 };
    const foreign = card("someone-else");
    const expired = {
      ...card("expired", "done"),
      startedAt: now - 90_000_000,
      endedAt: now - 87_000_000,
    };
    const list = vi.fn<HostTaskFeed["list"]>().mockResolvedValue({
      kind: "ready",
      tasks: [
        { requestedBy: "owner", card: running },
        { requestedBy: "owner", card: finished },
        { requestedBy: "OWNER", card: foreign },
        { requestedBy: "owner", card: expired },
      ],
    });
    const events = { publishSpaceChange: vi.fn(async () => undefined) };
    const feed: HostTaskFeed = {
      pluginId,
      botIds: [scope.botId],
      bindingFor: () => ({ key: "binding-1", requestedBy: "owner" }),
      list,
    };
    const service = () =>
      createHostPluginTaskCards({ prisma: db.prisma, feed, events, now: () => clock });

    expect(await service().read({ ...scope, userId: "another-user" })).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(await service().read(scope)).toEqual([running, finished]);
    expect(await service().read(scope)).toEqual([running, finished]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(events.publishSpaceChange).toHaveBeenCalledExactlyOnceWith(
      `preferences:${scope.userId}`,
      "pluginCards",
    );
    const [stored] = await system.$queryRaw<Array<{ cards: string }>>`
      SELECT cards::text AS cards FROM host_plugin_task_snapshots WHERE "botId" = ${scope.botId}`;
    expect(stored?.cards).toBeDefined();
    expect(stored?.cards).not.toContain("Fixture owned");
    if (process.env.DATABASE_MIGRATION_URL) {
      const hidden = await runAsTenant(
        { ...scope, userId: "another-user" },
        () => db.prisma.$queryRaw<unknown[]>`
        SELECT id FROM host_plugin_task_snapshots WHERE "botId" = ${scope.botId}`,
      );
      expect(hidden).toEqual([]);
    }

    list.mockResolvedValueOnce({ kind: "offline" } satisfies TaskFeedResult);
    clock += 30_001;
    await service().reconcile();
    expect(await service().read(scope)).toEqual([finished]);

    list.mockResolvedValueOnce({ kind: "forbidden" } satisfies TaskFeedResult);
    clock += 30_001;
    await service().reconcile();
    expect(await service().read(scope)).toEqual([]);
  });

  it("refreshes on a stale read while another replica hides stale active cards", async () => {
    await system.hostPluginTaskSnapshot.deleteMany({ where: { ...scope, pluginId } });
    let clock = now;
    const running = card("updating");
    const pending = deferred<TaskFeedResult>();
    const refreshStarted = deferred();
    const list = vi
      .fn<HostTaskFeed["list"]>()
      .mockResolvedValueOnce({ kind: "ready", tasks: [{ requestedBy: "owner", card: running }] })
      .mockImplementationOnce(() => {
        refreshStarted.resolve();
        return pending.promise;
      });
    const feed: HostTaskFeed = {
      pluginId,
      botIds: [scope.botId],
      bindingFor: () => ({ key: "binding-1", requestedBy: "owner" }),
      list,
    };
    const events = { publishSpaceChange: vi.fn(async () => undefined) };
    const service = () =>
      createHostPluginTaskCards({ prisma: db.prisma, feed, events, now: () => clock });
    expect(await service().read(scope)).toEqual([running]);
    clock += 30_001;

    const refreshing = service().read(scope);
    try {
      await refreshStarted.promise;
      expect(await service().read(scope)).toEqual([]);
    } finally {
      pending.resolve({ kind: "ready", tasks: [{ requestedBy: "owner", card: running }] });
    }
    expect(await refreshing).toEqual([running]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(events.publishSpaceChange).toHaveBeenCalledTimes(2);
  });
});
