import { randomUUID } from "node:crypto";
import type { ServerPluginHooks } from "@rakazo/core/plugin-host";
import { createPluginRegistry } from "@rakazo/core/plugin-host";
import { deferred } from "@rakazo/core/test-async";
import {
  asSystem,
  createDb,
  LeaseHeldError,
  provisionMessagingIdentity,
  runAsTenant,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InMemoryRealtimeFanout, PostgresRealtimeFanout } from "../notifications/realtime.js";
import { GraphileJobPublisher } from "../runs/wakeups/wakeup.js";
import { dispatchRunTerminalEvent, followRunTerminalEvents } from "./run-terminal-events.js";

const url = process.env.DATABASE_URL;

describe.skipIf(process.env.VERIFY_DATABASE !== "1" || !url)("terminal run events", () => {
  const db = createDb(url!);
  const system = asSystem(db.prisma);
  const jobs = new GraphileJobPublisher(db.pool);
  const runIds: string[] = [];
  let scope: { userId: string; spaceId: string; botId: string; threadId: string };

  beforeAll(async () => {
    const { userId, spaceId, botId, threadId } = await provisionMessagingIdentity(system, {
      provider: "test",
      address: `terminal-events-${randomUUID()}`,
    });
    scope = { userId, spaceId, botId, threadId };
  });

  afterAll(async () => {
    await Promise.all(runIds.map((id) => jobs.cancel(`plugin.turn-finished:${id}`)));
    await jobs.close();
    if (scope) {
      await system.organization.deleteMany({ where: { id: scope.spaceId } });
      await system.user.deleteMany({ where: { id: scope.userId } });
    }
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function createRun(status: string) {
    const task = await system.task.create({ data: { ...scope, prompt: "Test", status } });
    const run = await system.run.create({
      data: { ...scope, taskId: task.id, status, trigger: "user" },
    });
    runIds.push(run.id);
    return run;
  }

  function events(runId: string) {
    return system.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM run_terminal_events WHERE "runId" = ${runId}`;
  }

  function backup(runId: string) {
    return db.pool.query<{ run_at: Date }>(
      "SELECT run_at FROM graphile_worker.jobs WHERE key = $1",
      [`plugin.turn-finished:${runId}`],
    );
  }

  it("records the first committed terminal outcome only, including silent changes", async () => {
    const { id } = await createRun("running");
    await expect(
      runAsTenant(scope, () =>
        db.prisma.$transaction(async (tx) => {
          await tx.run.update({ where: { id }, data: { status: "completed" } });
          throw new Error("rollback fixture");
        }),
      ),
    ).rejects.toThrow("rollback fixture");
    await runAsTenant(scope, () =>
      db.prisma.run.updateMany({ where: { id }, data: { status: "waiting_input" } }),
    );
    expect(await events(id)).toEqual([]);

    await runAsTenant(scope, () =>
      db.prisma.run.updateMany({ where: { id }, data: { status: "cancelled" } }),
    );
    await system.run.update({ where: { id }, data: { status: "failed" } });
    await system.run.delete({ where: { id } });
    expect(await events(id)).toEqual([{ status: "cancelled" }]);
  });

  it("records an inserted terminal run", async () => {
    const { id } = await createRun("completed");
    expect(await events(id)).toEqual([{ status: "completed" }]);
  });

  it("retries a failed hook with the same event while retaining other plugins' receipts", async () => {
    const first = vi.fn<NonNullable<ServerPluginHooks["onTurnFinished"]>>();
    first.mockRejectedValueOnce(new Error("temporary plugin failure"));
    const second = vi.fn<NonNullable<ServerPluginHooks["onTurnFinished"]>>();
    const disabled = vi.fn<NonNullable<ServerPluginHooks["onTurnFinished"]>>();
    const registry = createPluginRegistry<ServerPluginHooks>([
      {
        manifest: { id: "test/first", name: "First", version: "1", apiVersion: 1 },
        hooks: { onTurnFinished: first },
      },
      {
        manifest: { id: "test/second", name: "Second", version: "1", apiVersion: 1 },
        hooks: { onTurnFinished: second },
      },
      {
        manifest: { id: "test/disabled", name: "Disabled", version: "1", apiVersion: 1 },
        hooks: { onTurnFinished: disabled },
      },
    ]);
    await system.userHostPlugin.createMany({
      data: ["test/first", "test/second"].map((pluginId) => ({
        userId: scope.userId,
        pluginId,
        enabled: true,
      })),
    });
    const { id } = await createRun("failed");
    const dispatch = () => dispatchRunTerminalEvent(db.prisma, id, { registry });

    await expect(dispatch()).rejects.toThrow("temporary plugin failure");
    await dispatch();
    await dispatch();

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(disabled).not.toHaveBeenCalled();
    const event = {
      ...scope,
      eventId: id,
      runId: id,
      status: "failed",
      finishedAt: expect.any(String),
    };
    expect(first).toHaveBeenNthCalledWith(1, event);
    expect(first).toHaveBeenNthCalledWith(2, first.mock.calls[0]?.[0]);
    expect(second).toHaveBeenCalledWith(first.mock.calls[0]?.[0]);
  });

  it("dispatches from Postgres on commit and clears the backup after one delivery", async () => {
    const active = deferred();
    const finish = deferred();
    const onTurnFinished = vi.fn(async () => {
      active.resolve();
      await finish.promise;
    });
    const id = "test/live-finish";
    const registry = createPluginRegistry<ServerPluginHooks>([
      { manifest: { id, name: "Live", version: "1", apiVersion: 1 }, hooks: { onTurnFinished } },
    ]);
    await system.userHostPlugin.create({
      data: { userId: scope.userId, pluginId: id, enabled: true },
    });
    const realtime = new PostgresRealtimeFanout({ connectionString: url!, publisher: db.pool });
    const ready = deferred();
    await realtime.subscribe("plugin.turn-finished", (signal) => {
      if (!signal) ready.resolve();
    });
    const stop = await followRunTerminalEvents({ prisma: db.prisma, realtime, jobs, registry });
    try {
      await ready.promise;
      const { id: runId } = await createRun("running");
      await runAsTenant(scope, () =>
        db.prisma.$transaction(async (tx) => {
          await tx.run.update({ where: { id: runId }, data: { status: "completed" } });
          expect(onTurnFinished).not.toHaveBeenCalled();
        }),
      );
      await active.promise;
      expect((await backup(runId)).rows[0]?.run_at.getTime()).toBeGreaterThan(Date.now());
      await expect(dispatchRunTerminalEvent(db.prisma, runId, { registry })).rejects.toBeInstanceOf(
        LeaseHeldError,
      );
      finish.resolve();
      await vi.waitFor(async () => expect((await backup(runId)).rowCount).toBe(0));
      expect(onTurnFinished).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ eventId: runId }),
      );
    } finally {
      finish.resolve();
      await stop();
      await realtime.close();
    }
  });

  it("delivers a pending event when its post-commit signal was missed", async () => {
    const onTurnFinished = vi.fn<NonNullable<ServerPluginHooks["onTurnFinished"]>>();
    const id = "test/missed-finish";
    const registry = createPluginRegistry<ServerPluginHooks>([
      {
        manifest: { id, name: "Catch up", version: "1", apiVersion: 1 },
        hooks: { onTurnFinished },
      },
    ]);
    await system.userHostPlugin.create({
      data: { userId: scope.userId, pluginId: id, enabled: true },
    });
    const { id: runId } = await createRun("failed");
    const realtime = new InMemoryRealtimeFanout();
    const stop = await followRunTerminalEvents({ prisma: db.prisma, realtime, jobs, registry });
    try {
      await vi.waitFor(async () => expect((await backup(runId)).rowCount).toBe(0));
      expect(onTurnFinished).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ eventId: runId }),
      );
    } finally {
      await stop();
      await realtime.close();
    }
  });
});
