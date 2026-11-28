import { randomUUID } from "node:crypto";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import type { Actor, MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import {
  appendEvent,
  appendEventInTransaction,
  asSystem,
  createDb,
  createThreadEvents,
  finalizeRun,
  loadRunHistoryMessages,
  provisionMessagingIdentity,
  runAsSystem,
  runAsTenant,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";
import { handleRpcError } from "../rpc-errors.js";
import { loadMessagePage } from "./thread-message-pages.js";
import { threadSnapshot } from "./thread-snapshot.js";
import { resolveThreadTarget } from "./thread-target.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe : describe.skip;

const PRIVATE = "PRIVATE-TOOL-OUTPUT";
const PRIVATE_RESULT = `${PRIVATE}\n${"x".repeat(200)}`;

describePostgres("a reply's kept tool calls (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let actor: Actor;
  let member: Actor;
  let botId: string;
  let threadId: string;
  let runId: string;
  let messageId: string;
  let call: (viewer: Actor, path: string, input: Record<string, unknown>) => Promise<Response>;
  const address = `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;

  async function createRun() {
    const { spaceId, userId } = actor;
    const task = await system.task.create({
      data: { spaceId, botId, threadId, userId, prompt: "check the notes", status: "running" },
    });
    return system.run.create({
      data: {
        spaceId,
        botId,
        threadId,
        taskId: task.id,
        userId,
        status: "running",
        trigger: "user",
        startedAt: new Date(),
        leaseOwner: "worker-1",
        leaseFence: 1,
      },
    });
  }

  beforeAll(async () => {
    const db = createDb(databaseUrl!, { encryptContent: true });
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      try {
        await db.prisma.$disconnect();
      } finally {
        await db.pool.end();
      }
    };
    const identity = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(prisma, { provider: "sendblue", address }),
    );
    ({ botId, threadId } = identity);
    actor = { ...identity, email: "fixture@example.test", isDeploymentOwner: false };
    const { spaceId } = actor;
    const memberId = randomUUID();
    const email = `${memberId}@example.test`;
    member = { ...actor, userId: memberId, email };
    await system.user.create({ data: { id: memberId, name: "Other", email } });
    const membership = {
      id: memberId,
      organizationId: spaceId,
      userId: memberId,
      role: "member",
      createdAt: new Date(),
    };
    await system.member.create({ data: membership });
    const run = await createRun();
    runId = run.id;
    const attempt = await system.attempt.create({
      data: { runId: run.id, fence: 1, status: "running" },
    });
    // As a run assembles its reply: the step carries its tool and what each call returned.
    const blocks = [
      {
        kind: "steps",
        steps: [
          {
            label: "Shell",
            tool: "shell",
            count: 1,
            calls: [
              {
                callId: "retained-call",
                arguments: '{"command":"cat notes.txt"}',
                result: PRIVATE_RESULT,
                image: { artifactId: "screenshot-1" },
              },
            ],
            outcomes: { succeeded: 1 },
          },
        ],
      },
      { kind: "text", text: "Done." },
      { kind: "steps", steps: [{ label: "Search", count: 1, outcomes: { stopped: 1 } }] },
    ] as MessageBlock[];
    await runAsTenant(actor, () =>
      finalizeRun(prisma, {
        spaceId,
        threadId,
        botId,
        runId: run.id,
        taskId: run.taskId,
        attemptId: attempt.id,
        leaseOwner: "worker-1",
        leaseFence: 1,
        outcome: "completed",
        blocks,
      }),
    );
    ({ id: messageId } = await system.message.findFirstOrThrow({ where: { runId } }));
    const deps = {
      prisma,
      events: createThreadEvents(prisma),
      env: { agentRuntime: "scripted" },
    } as RouterDeps;
    const handler = new RPCHandler(createRouter(deps), {
      clientInterceptors: [onError((error, { path }) => handleRpcError(error, path))],
    });
    call = async (viewer, path, input) => {
      const { response } = await handler.handle(
        new Request(`http://test.invalid/rpc/threads/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor: viewer } },
      );
      return response ?? new Response(null, { status: 404 });
    };
  });

  afterAll(async () => {
    try {
      if (actor) {
        await system.messagingIdentity.deleteMany({ where: { provider: "sendblue", address } });
        await system.organization.deleteMany({ where: { id: actor.spaceId } });
        await system.user.deleteMany({
          where: { id: { in: [actor.userId, member?.userId].filter(Boolean) } },
        });
      }
    } finally {
      await close?.();
    }
  });

  it("reach the bot's later runs, never a snapshot, a message page, a live event or a plain read", async () => {
    const { userId } = actor;
    const leaks = (value: unknown) => {
      const json = JSON.stringify(value);
      return [PRIVATE, "cat notes.txt", "screenshot-1", '"calls"', '"tool"', "toolHistory"].filter(
        (marker) => json.includes(marker),
      );
    };

    await runAsTenant(actor, async () => {
      const event = await prisma.event.findFirstOrThrow({
        where: { threadId, runId, type: "thread.message.created" },
      });
      expect(leaks(event.payload)).toEqual([]);
      const target = await resolveThreadTarget(prisma, actor, { botId });
      const snapshot = await threadSnapshot({ prisma }, target, userId);
      expect(snapshot.messages.some((message) => message.runId === runId)).toBe(true);
      expect(leaks(snapshot)).toEqual([]);
      expect(leaks(await loadMessagePage(prisma, threadId, undefined, 50))).toEqual([]);
      // An ordinary read leaves the column out; only a read that asks for it gets it.
      const row = await prisma.message.findFirstOrThrow({ where: { runId } });
      expect(row).not.toHaveProperty("toolHistory");
      expect(leaks(row)).toEqual([]);
      // The steps block keeps what the UI shows.
      expect((row.blocks as MessageBlock[])[0]).toEqual({
        kind: "steps",
        steps: [{ label: "Shell", count: 1, outcomes: { succeeded: 1 } }],
      });
    });

    // The bot's next run reads the calls back.
    const history = await runAsTenant(actor, () =>
      loadRunHistoryMessages(prisma, { id: "next-run", threadId, botId, userId }, 50),
    );
    // Another member's run of the same bot sees the reply as everyone does, not its tool calls.
    const theirs = await runAsTenant(actor, () =>
      loadRunHistoryMessages(
        prisma,
        { id: "member-run", threadId, botId, userId: "another-member" },
        50,
      ),
    );
    expect(theirs.find((message) => message.runId === runId)?.toolHistory).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain(PRIVATE);
    const reply = history.find((message) => message.runId === runId);
    expect(JSON.parse(reply!.toolHistory!)).toEqual({
      steps: [
        {
          tool: "shell",
          calls: [
            {
              callId: "retained-call",
              arguments: '{"command":"cat notes.txt"}',
              result: PRIVATE_RESULT,
              image: { artifactId: "screenshot-1" },
            },
          ],
        },
        null,
      ],
    });
  });

  it("returns a bounded text preview to the run starter and advertises access in chat", async () => {
    const response = await call(actor, "toolStepPreviews", { botId, messageId });
    expect(response.status).toBe(200);
    const { json } = await response.json();
    expect(json.steps[0]).toEqual({
      tool: "shell",
      input: '{"command":"cat notes.txt"}',
      output: `${PRIVATE} ${"x".repeat(149 - PRIVATE.length - 1)}…`,
    });
    const page = await call(actor, "messages", { botId });
    const inspectable = expect.objectContaining({ id: messageId, canInspectToolSteps: true });
    expect(await page.json()).toMatchObject({
      json: { messages: expect.arrayContaining([inspectable]) },
    });
    const snapshot = await call(actor, "get", { botId });
    expect(await snapshot.json()).toMatchObject({
      json: { messages: expect.arrayContaining([inspectable]) },
    });
  });

  it("refuses another Space member who can read the reply", async () => {
    const page = await call(member, "messages", { botId });
    expect(page.status).toBe(200);
    const { json } = await page.json();
    const reply = json.messages.find((message: { id: string }) => message.id === messageId);
    expect(reply).toBeDefined();
    expect(reply).not.toHaveProperty("canInspectToolSteps");
    const response = await call(member, "toolStepPreviews", { botId, messageId });
    expect(response.status).toBe(403);
  });

  it("returns a null slot for a step without retained calls", async () => {
    const response = await call(actor, "toolStepPreviews", { botId, messageId });
    expect(response.status).toBe(200);
    const { json } = await response.json();
    expect(json.steps[1]).toBeNull();
  });

  it("returns the full retained call only to the run starter", async () => {
    const input = { botId, messageId, stepIndex: 0, callIndex: 0 };
    const response = await call(actor, "toolCallDetail", input);
    expect(response.status).toBe(200);
    expect((await response.json()).json).toEqual({
      arguments: '{"command":"cat notes.txt"}',
      result: PRIVATE_RESULT,
      hasScreenshot: true,
    });
    expect((await call(member, "toolCallDetail", input)).status).toBe(403);
  });

  it("selects a saved call by its stable ID", async () => {
    const input = { botId, messageId, callId: "retained-call" };
    const response = await call(actor, "toolCallDetail", input);
    expect((await response.json()).json).toEqual({
      arguments: '{"command":"cat notes.txt"}',
      result: PRIVATE_RESULT,
      hasScreenshot: true,
    });
    const missing = await call(actor, "toolCallDetail", { ...input, callId: "unknown" });
    expect((await missing.json()).json).toBeNull();
  });

  it("returns the selected live call only to its run starter", async () => {
    const run = await createRun();
    const input = { botId, runId: run.id, callId: "live-call" };
    const scope = { botId, runId: run.id, threadId, spaceId: actor.spaceId };
    const asked = { arguments: '{"command":"cat notes.txt"}' };
    const started = await runAsTenant(actor, () =>
      appendEvent(prisma, {
        ...scope,
        type: "agent.tool.called",
        payload: { name: "shell", toolStepId: input.callId },
        toolCallDetail: asked,
      }),
    );
    const running = await call(actor, "liveToolCallDetail", input);
    expect(running.status).toBe(200);
    expect((await running.json()).json).toEqual(asked);

    await runAsTenant(actor, () =>
      prisma.$transaction(async (tx) => {
        await appendEventInTransaction(tx, {
          ...scope,
          type: "agent.tool.completed",
          payload: { name: "shell", toolStepId: input.callId },
          toolCallDetail: { result: PRIVATE_RESULT, hasScreenshot: true },
        });
        await appendEventInTransaction(tx, {
          ...scope,
          type: "agent.tool.completed",
          payload: { name: "shell", toolStepId: "different-call" },
          toolCallDetail: { result: "different result" },
        });
      }),
    );
    const completed = await call(actor, "liveToolCallDetail", input);
    expect(completed.status).toBe(200);
    expect((await completed.json()).json).toEqual({
      ...asked,
      result: PRIVATE_RESULT,
      hasScreenshot: true,
    });
    const missing = await call(actor, "liveToolCallDetail", { ...input, callId: "unknown" });
    expect((await missing.json()).json).toBeNull();
    expect((await call(member, "liveToolCallDetail", input)).status).toBe(403);

    expect(started).not.toHaveProperty("toolCallDetail");
    const events = await system.event.findMany({ where: { runId: run.id } });
    expect(events).toHaveLength(3);
    expect(events.every((event) => !("toolCallDetail" in event))).toBe(true);
    const raw = await system.$queryRaw<Array<{ detail: string }>>`
      SELECT "toolCallDetail"::text AS detail FROM events WHERE "runId" = ${run.id}
    `;
    expect(raw).toHaveLength(3);
    for (const { detail } of raw) expect(detail).toContain('"$sealed"');
    expect(JSON.stringify(raw)).not.toContain("cat notes.txt");
    expect(JSON.stringify(raw)).not.toContain(PRIVATE);

    await runAsTenant(actor, async () => {
      await prisma.run.update({ where: { id: run.id }, data: { status: "completed" } });
      await appendEvent(prisma, {
        ...scope,
        type: "agent.tool.completed",
        payload: { name: "shell", toolStepId: input.callId },
        toolCallDetail: { result: "late result" },
      });
    });
    const finished = await call(actor, "liveToolCallDetail", input);
    expect((await finished.json()).json).toBeNull();
    const remaining = await system.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM events WHERE "runId" = ${run.id} AND "toolCallDetail" IS NOT NULL
    `;
    expect(remaining).toEqual([{ count: 0n }]);
  });
});
