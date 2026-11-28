import { randomUUID } from "node:crypto";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor, ReplyReasoning } from "@rakazo/contracts";
import {
  asSystem,
  createDb,
  createThreadEvents,
  finalizeRun,
  provisionMessagingIdentity,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import { expect, it } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

const databaseUrl = process.env.DATABASE_URL;

it.skipIf(process.env.VERIFY_DATABASE !== "1" || !databaseUrl)(
  "serves reasoning in the thread before and after sealing the completed reply",
  async () => {
    const { prisma, pool } = createDb(databaseUrl!, { encryptContent: true });
    const system = asSystem(prisma);
    const address = randomUUID();
    let actor: Actor | undefined;
    try {
      const scope = await runAsSystem("test fixture", () =>
        provisionMessagingIdentity(prisma, { provider: "test", address }),
      );
      actor = { ...scope, email: "reasoning@example.test", isDeploymentOwner: false };
      const { spaceId, userId, botId, threadId } = scope;
      const task = await system.task.create({
        data: { spaceId, userId, botId, threadId, status: "running", prompt: "Pick a date." },
      });
      const lease = { owner: "fixture-worker", fence: 1 };
      const run = await system.run.create({
        data: {
          spaceId,
          userId,
          botId,
          threadId,
          taskId: task.id,
          status: "running",
          trigger: "user",
          startedAt: new Date(),
          leaseOwner: lease.owner,
          leaseFence: lease.fence,
        },
      });
      const attempt = await system.attempt.create({
        data: { runId: run.id, fence: lease.fence, status: "running" },
      });
      const deps = { prisma, events: createThreadEvents(prisma) } as RouterDeps;
      const handler = new RPCHandler(createRouter(deps));
      const readThread = async (viewer: Actor) => {
        const { response } = await handler.handle(
          new Request("http://test.invalid/rpc/threads/get", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ json: { botId } }),
          }),
          { prefix: "/rpc", context: { actor: viewer } },
        );
        expect(response?.status).toBe(200);
        return response?.json();
      };
      const reasoning: ReplyReasoning = {
        text: "Check password=fixture-credential before continuing.",
        startedAt: "2026-11-26T10:00:00.000Z",
        endedAt: "2026-11-26T10:00:34.000Z",
        durationMs: 34_000,
      };

      await runAsTenant(actor, () =>
        deps.events.append({
          spaceId,
          botId,
          threadId,
          runId: run.id,
          lease,
          type: "thread.meta",
          payload: { reasoningChanged: true, reasoning: reasoning.text },
        }),
      );
      expect(await readThread(actor)).toMatchObject({
        json: { liveReasoning: { [run.id]: { botId, text: reasoning.text } } },
      });

      await runAsTenant(actor, () =>
        finalizeRun(prisma, {
          spaceId,
          botId,
          threadId,
          runId: run.id,
          taskId: task.id,
          attemptId: attempt.id,
          leaseOwner: lease.owner,
          leaseFence: lease.fence,
          outcome: "completed",
          blocks: [{ kind: "text", text: "Friday works." }],
          reasoning,
        }),
      );
      const { rows } = await runAsTenant(actor, () =>
        pool.query<{ reasoning: unknown }>('SELECT reasoning FROM messages WHERE "runId" = $1', [
          run.id,
        ]),
      );
      expect(rows[0]?.reasoning).toEqual({ $sealed: expect.stringMatching(/^rkz1:/) });
      const completed = await readThread(actor);
      expect(completed).toMatchObject({
        json: { messages: [expect.objectContaining({ runId: run.id, reasoning })] },
      });
      expect(completed.json).not.toHaveProperty("liveReasoning");
    } finally {
      try {
        if (actor) {
          await system.messagingIdentity.deleteMany({ where: { provider: "test", address } });
          await system.organization.deleteMany({ where: { id: actor.spaceId } });
          await system.user.deleteMany({ where: { id: actor.userId } });
        }
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    }
  },
);
