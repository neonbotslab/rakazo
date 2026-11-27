import type { Actor, HostPluginTaskCard } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { appHandler, handle } from "../router-test-support.js";

const owner: Actor = {
  spaceId: "space-1",
  userId: "owner",
  email: "owner@example.test",
  isDeploymentOwner: false,
};

const card: HostPluginTaskCard = {
  id: "task-1",
  title: "Run the checks",
  status: "running",
  startedAt: 1700000000000,
  href: "https://tasks.example.test/task-1",
};

function fixture(enabled = true) {
  const bot = { id: "bot-1", userId: owner.userId, thread: { id: "thread-1" } };
  const findFirst = vi.fn(async ({ where }: { where: { spaceId: string; id: string } }) =>
    where.spaceId === owner.spaceId && where.id === bot.id ? bot : null,
  );
  const read = vi.fn(async () => [card]);
  const readSettings = vi.fn(async () => (enabled ? [{ pluginId: "test/task-cards" }] : []));
  const handler = appHandler({
    prisma: { bot: { findFirst }, userHostPlugin: { findMany: readSettings } },
    hostPluginTaskCards: { pluginId: "test/task-cards", read },
  } as unknown as RouterDeps);
  const request = (actor: Actor) =>
    handle(
      handler,
      new Request("http://127.0.0.1/rpc/hostPlugins/chatCards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: bot.id } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
  return { request, read, readSettings };
}

describe("hostPlugins.chatCards", () => {
  it("returns the owner's task cards for the authorized bot and Space", async () => {
    const { request, read } = fixture();
    const response = await request(owner);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: [card] });
    expect(read).toHaveBeenCalledExactlyOnceWith({
      spaceId: owner.spaceId,
      userId: owner.userId,
      botId: "bot-1",
    });
  });

  it("keeps cards private from a Space member who can see the bot", async () => {
    const { request, read, readSettings } = fixture();
    const response = await request({ ...owner, userId: "peer" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: [] });
    expect(readSettings).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("conceals the bot from another Space before reading the task source", async () => {
    const { request, read, readSettings } = fixture();
    const response = await request({ ...owner, spaceId: "other-space" });

    expect(response.status).toBe(404);
    expect(readSettings).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read the task source when the owner disabled the plugin", async () => {
    const { request, read } = fixture(false);
    const response = await request(owner);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: [] });
    expect(read).not.toHaveBeenCalled();
  });
});
