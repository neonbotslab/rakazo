import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioConnector, FakeComposioClient, FakeSandboxProvider } from "@rakazo/adapters";
import type { AppHandles, createApp as CreateApp } from "@rakazo/api/app";
import { deferred } from "@rakazo/core/test-async";
import { storedMessageBlocks } from "@rakazo/db";
import { createLogger, createTestSink, getLogger, installLogger } from "@rakazo/logging";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { discardBotIntroRun } from "../discard-bot-intro.js";
import { sessionCookieHeader } from "../index.js";
import type { ModelEmulatorStep } from "../model-emulator.js";
import { startModelEmulator } from "../model-emulator.js";
import { asSystem } from "../system-db.js";

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const fixtureOrigin = "http://127.0.0.1:5173";
const fixtureKey = "offline-computer-approval-key";

describe.skipIf(!databaseAvailable)("offline Pi computer approval", () => {
  beforeEach(() => {
    // Use the existing compatible-endpoint capability declaration so the real
    // executor exposes computer tools without mocking its model vision gate.
    vi.stubEnv("RAKAZO_OPENAI_COMPATIBLE_VISION_MODELS", "offline-fixture");
  });

  it.each(["allow", "deny"] as const)(
    "%s enforces the persisted computer action before any sandbox effect",
    async (answer) => {
      let sandbox: FakeSandboxProvider;
      const approvedArgs = {
        actions: [{ kind: "type", text: "approved clipboard content" }],
        observe: false,
        settle_ms: 0,
      };
      const resultStep =
        (id: string): ModelEmulatorStep["expect"] =>
        (request) => {
          const result = request.messages.findLast((message) => message.role === "tool");
          expect(result?.tool_call_id).toBe(id);
          const body = JSON.parse(String(result?.content));
          if (answer === "allow") expect(body).toMatchObject({ ok: true, completed: 1 });
          else expect(JSON.stringify(body)).toMatch(/denied/i);
          // Inspect the provider state while the run still owns its screen;
          // completed runs release that screen and discard its placeholder state.
          const screens = [...sandbox.boxes.values()].flatMap((box) => [...box.screens.values()]);
          expect(screens).not.toContain("unapproved replacement");
          if (answer === "allow") expect(screens).toContain("approved clipboard content");
          else expect(screens).not.toContain("approved clipboard content");
        };
      const model = await startModelEmulator({
        apiKey: fixtureKey,
        steps: [
          {
            expect(request) {
              expect(request.tools).toContainEqual(
                expect.objectContaining({
                  function: expect.objectContaining({ name: "computer_act" }),
                }),
              );
            },
            response: {
              type: "tool",
              id: "pending-action",
              name: "computer_act",
              arguments: approvedArgs,
            },
          },
          {
            // Restore the original pending call before another model choice.
            expect: resultStep("pending-action"),
            response: { type: "text", text: "Finished the approval fixture." },
          },
        ],
      });
      const dataDir = await mkdtemp(path.join(tmpdir(), "rakazo-computer-approval-"));
      let stop: (() => Promise<void>) | undefined;
      try {
        const handles = await createApprovalApp(dataDir);
        stop = handles.stop;
        const { db, bot, cookie } = await configureApprovalBot(handles, model);
        if (!(handles.sandbox instanceof FakeSandboxProvider))
          throw new Error("Expected a fake sandbox");
        sandbox = handles.sandbox;
        const act = vi.spyOn(sandbox, "act");
        const sent = await rpc<{ runId: string }>(handles.app, cookie, "threads/send", {
          botId: bot.id,
          text: "Put approved clipboard content on the computer clipboard.",
        });
        const waitForRun = async (status: string) => {
          await expect
            .poll(
              async () => {
                const run = await db.run.findUniqueOrThrow({
                  where: { id: sent.runId },
                });
                if (run.status === "failed") model.assertComplete();
                return run.status;
              },
              { timeout: 15_000, interval: 100 },
            )
            .toBe(status);
        };
        await waitForRun("waiting_input");
        expect(model.requests).toHaveLength(1);
        expect(act).not.toHaveBeenCalled();
        const effects = await db.externalEffect.findMany({
          where: { runId: sent.runId },
        });
        expect(effects).toHaveLength(2);
        expect(effects.find((effect) => effect.kind === "runtime_checkpoint")).toMatchObject({
          status: "runtime_checkpoint",
          request: {},
        });
        const actionEffect = effects.find((effect) => effect.kind === "computer_act")!;
        expect(actionEffect).toMatchObject({
          kind: "computer_act",
          status: "intended",
          request: approvedArgs,
        });
        const card = await db.message.findFirstOrThrow({
          where: { runId: sent.runId, role: "bot" },
          orderBy: { seq: "desc" },
        });
        expect(card.blocks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "ask", approvalEffectId: actionEffect.id }),
          ]),
        );
        await rpc(handles.app, cookie, "threads/answer", {
          botId: bot.id,
          runId: sent.runId,
          messageId: card.id,
          answer,
        });
        await waitForRun("completed");
        model.assertComplete();
        expect(act).toHaveBeenCalledTimes(answer === "allow" ? 1 : 0);
        if (answer === "allow") {
          expect(act.mock.calls[0]![1]).toEqual({
            actions: [{ kind: "clipboard", text: "approved clipboard content" }],
            observe: false,
            settleMs: 0,
          });
        }
        const settledEffects = await db.externalEffect.findMany({
          where: { runId: sent.runId },
        });
        expect(settledEffects).toHaveLength(1);
        expect(settledEffects[0]).toMatchObject({
          id: actionEffect.id,
          status: answer === "allow" ? "completed" : "denied",
          request: approvedArgs,
        });
      } finally {
        try {
          await stop?.();
        } finally {
          await model.close();
          await rm(dataDir, { recursive: true, force: true });
        }
      }
    },
    45_000,
  );

  it("keeps each approval pending when another webhook arrives during the turn", async () => {
    const approvals = ["first", "second"].map((name) => {
      const requested = deferred();
      const release = deferred();
      const step: ModelEmulatorStep = {
        async expect() {
          requested.resolve();
          await release.promise;
        },
        response: {
          type: "tool",
          id: `approval-${name}`,
          name: "computer_act",
          arguments: {
            actions: [{ kind: "type", text: `Clipboard ${name}` }],
            observe: false,
            settle_ms: 0,
          },
        },
      };
      return { requested, release, step };
    });
    const followup: ModelEmulatorStep = {
      expect() {},
      response: { type: "text", text: "Handled the other webhook." },
    };
    const model = await startModelEmulator({
      apiKey: fixtureKey,
      steps: [
        ...approvals.flatMap(({ step }) => [step, followup]),
        { expect() {}, response: { type: "text", text: "Finished both approvals." } },
      ],
    });
    const dataDir = await mkdtemp(path.join(tmpdir(), "rakazo-webhook-approval-"));
    const previousLogger = getLogger();
    const sink = createTestSink();
    let stop: AppHandles["stop"] | undefined;
    try {
      const handles = await createApprovalApp(dataDir, {
        wakeupDriver: "graphile",
        logger: createLogger({ service: "approval-test", level: "info", sinks: [sink] }),
      });
      stop = handles.stop;
      const { db, bot, cookie } = await configureApprovalBot(handles, model);
      if (!(handles.sandbox instanceof FakeSandboxProvider))
        throw new Error("Expected a fake sandbox");
      const act = vi.spyOn(handles.sandbox, "act");
      await db.routine.create({
        data: {
          botId: bot.id,
          spaceId: bot.spaceId,
          userId: bot.userId,
          name: "Webhook fixture",
          prompt: "Handle the webhook.",
          crons: [],
          active: true,
          webhookEnabled: true,
        },
      });
      const webhook = await rpc<{ secret: string; path: string }>(
        handles.app,
        cookie,
        "bots/rotateWebhookSecret",
        { botId: bot.id },
      );
      const deliver = async (event: string) => {
        const response = await handles.app.request(webhook.path, {
          method: "POST",
          headers: {
            authorization: `Bearer ${webhook.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ event }),
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<{ runId: string; messageId: string }>;
      };
      const { runId } = await deliver("original");
      const completedJobs = (id: string) =>
        sink.events.filter(
          (event) =>
            event.message === "job.completed" &&
            event["job.type"] === "run.continue" &&
            event["run.id"] === id,
        ).length;
      for (const [index, { requested, release }] of approvals.entries()) {
        await requested.promise;
        const held = await deliver(`held-${index}`);
        expect(held.runId).toBe(runId);
        release.resolve();
        await vi.waitFor(
          async () => {
            const followupRun = await db.run.findFirst({
              where: { sourceMessageId: held.messageId, trigger: "webhook" },
            });
            expect(followupRun?.status).toBe("completed");
            expect(completedJobs(followupRun!.id)).toBeGreaterThan(0);
            expect(completedJobs(runId)).toBeGreaterThan(index);
          },
          { timeout: 10_000 },
        );
        const cards = (
          await db.message.findMany({
            where: { runId, role: "bot" },
            orderBy: { seq: "asc" },
          })
        ).flatMap((message) =>
          storedMessageBlocks(message).flatMap((block) =>
            block.kind === "ask" && block.approvalEffectId
              ? [{ messageId: message.id, status: block.status }]
              : [],
          ),
        );
        expect
          .soft(cards.map((card) => card.status))
          .toEqual(index === 0 ? ["pending"] : ["answered", "pending"]);
        expect.soft(completedJobs(runId)).toBe(index + 1);
        expect.soft(await db.attempt.count({ where: { runId } })).toBe(index + 1);
        const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
        expect(run).toMatchObject({
          status: "waiting_input",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        expect(act).toHaveBeenCalledTimes(index);
        await rpc(handles.app, cookie, "threads/answer", {
          botId: bot.id,
          runId,
          messageId: cards.at(-1)!.messageId,
          answer: "allow",
        });
      }
      await vi.waitFor(
        async () => {
          expect((await db.run.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
            "completed",
          );
          expect(completedJobs(runId)).toBeGreaterThanOrEqual(3);
        },
        { timeout: 10_000 },
      );
      expect.soft(completedJobs(runId)).toBe(3);
      expect(act).toHaveBeenCalledTimes(2);
      model.assertComplete();
    } finally {
      for (const { release } of approvals) release.resolve();
      try {
        await stop?.();
      } finally {
        installLogger(previousLogger);
        await model.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  }, 45_000);
});

async function createApprovalApp(
  dataDir: string,
  options: Pick<NonNullable<Parameters<typeof CreateApp>[0]>, "wakeupDriver" | "logger"> = {},
) {
  const { createApp } = await import("@rakazo/api/app");
  return createApp({
    databaseUrl: process.env.DATABASE_URL!,
    realtimeDatabaseUrl: process.env.DATABASE_URL!,
    authUrl: fixtureOrigin,
    webOrigin: fixtureOrigin,
    dataDir,
    sandboxProvider: "fake",
    agentRuntime: "pi",
    wakeupDriver: "memory",
    signupsEnabled: "true",
    composio: new ComposioConnector({ client: new FakeComposioClient() }),
    encryptionKey: "offline-computer-fixture-encryption-key",
    ...options,
  });
}

async function configureApprovalBot(
  handles: AppHandles,
  model: Awaited<ReturnType<typeof startModelEmulator>>,
) {
  const db = asSystem(handles.prisma);
  const signup = await handles.app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: fixtureOrigin },
    body: JSON.stringify({
      email: `computer-approval-${randomUUID()}@rakazo.test`,
      password: "password12",
      name: "Computer approval fixture",
    }),
  });
  expect(signup.status).toBeLessThan(400);
  const cookie = sessionCookieHeader(signup);
  await rpc(handles.app, cookie, "models/connect", {
    provider: model.model.provider,
    modelId: model.model.id,
    baseUrl: model.baseUrl,
    apiKey: fixtureKey,
    contextWindow: 160_000,
    maxTokens: 4096,
  });
  const { id } = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
    name: "Computer fixture",
    title: "",
    description: "",
    instructions: "Complete the computer task.",
    notifyOnFinish: false,
  });
  await discardBotIntroRun(handles, cookie, id);
  await rpc(handles.app, cookie, "bots/update", {
    botId: id,
    modelProvider: model.model.provider,
    modelId: model.model.id,
  });
  const bot = await db.bot.findUniqueOrThrow({ where: { id } });
  await db.userActionApprovalRule.create({
    data: {
      userId: bot.userId,
      effect: "require_approval",
      matchKind: "tool",
      matchValue: "computer_act",
    },
  });
  return { db, bot, cookie };
}

async function rpc<T>(
  app: App,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<T> {
  const response = await app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: fixtureOrigin },
    body: JSON.stringify({ json: input }),
  });
  const body = (await response.json()) as { json?: T; error?: { message?: string } };
  if (response.status >= 400 || body.error)
    throw new Error(`${procedure}: ${body.error?.message ?? response.status}`);
  return body.json as T;
}
