import { createPluginRegistry } from "@rakazo/core/plugin-host";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { wardenTasksManifest } from "../providers/task-feed/warden/warden-task-config.js";
import { createHostPluginSettings } from "./server-plugins.js";

describe("server plugin availability", () => {
  const configuredBindings = JSON.stringify([{ botId: "bot-1", requestedBy: "owner-1" }]);

  it.each([
    ["complete", configuredBindings, "fixture-token", true],
    ["missing bindings", undefined, "fixture-token", false],
    ["missing token", configuredBindings, undefined, false],
  ] as const)(
    "reads %s task feed settings after its module is loaded",
    async (_, bindings, token, present) => {
      vi.resetModules();
      const { serverPlugins } = await import("./server-plugins.js");
      vi.stubEnv("WARDEN_TASKS_BASE_URL", "https://tasks.example.test");
      vi.stubEnv("WARDEN_TASKS_BINDINGS", bindings);
      vi.stubEnv("WARDEN_TASKS_TOKEN", token);
      try {
        const plugin = serverPlugins().get(wardenTasksManifest.id);
        expect(Boolean(plugin)).toBe(present);
        if (present) expect(plugin?.manifest.chatCards).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("returns the card capability when a preference changes", async () => {
    const upsert = vi.fn();
    const registry = createPluginRegistry([
      {
        manifest: {
          id: "test/task-cards",
          name: "Task cards",
          version: "1",
          apiVersion: 1,
          chatCards: true,
        },
        hooks: {},
      },
    ]);
    const settings = createHostPluginSettings(
      { userHostPlugin: { upsert } } as unknown as Pick<PrismaClient, "userHostPlugin">,
      registry,
    );
    await expect(
      settings.setEnabled("user-1", { id: "test/task-cards", enabled: true }),
    ).resolves.toEqual({
      id: "test/task-cards",
      name: "Task cards",
      enabled: true,
      chatCards: true,
    });
  });
});
