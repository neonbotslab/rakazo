import { createHash } from "node:crypto";
import type { PluginManifest } from "@rakazo/core/plugin-host";
import { z } from "zod";
import type { TaskFeedBinding } from "../../../plugin-host/task-feed.js";

export const wardenTasksManifest = {
  id: "rakazo/warden-tasks",
  name: "Warden Tasks",
  version: "1.0.0",
  apiVersion: 1,
  chatCards: true,
} satisfies PluginManifest;

const bindingsSchema = z
  .array(
    z
      .object({
        botId: z.string().min(1).max(180),
        requestedBy: z.string().min(1).max(180),
      })
      .strict(),
  )
  .min(1)
  .max(500);

export function wardenTasksConfigured(source: Record<string, string | undefined> = process.env) {
  return Boolean(
    source.WARDEN_TASKS_BASE_URL &&
      source.WARDEN_TASKS_TOKEN?.trim() &&
      source.WARDEN_TASKS_BINDINGS,
  );
}

export function readWardenTaskConfig(source: Record<string, string | undefined>) {
  const {
    WARDEN_TASKS_BASE_URL: url,
    WARDEN_TASKS_TOKEN: token,
    WARDEN_TASKS_BINDINGS: raw,
  } = source;
  if (!url && !token && !raw) return undefined;
  const parsed = url && url.length <= 1400 ? URL.parse(url) : null;
  if (
    parsed?.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.href.includes("?") ||
    parsed.href.includes("#")
  ) {
    throw new Error(
      "WARDEN_TASKS_BASE_URL must be an HTTPS URL without credentials, query, or fragment",
    );
  }
  if (!token?.trim() || token !== token.trim() || token.includes("\r") || token.includes("\n")) {
    throw new Error("WARDEN_TASKS_TOKEN must be a nonempty single line");
  }
  let input: unknown;
  try {
    input = JSON.parse(raw ?? "");
  } catch {
    throw new Error("WARDEN_TASKS_BINDINGS must be a JSON array of bot and requester bindings");
  }
  const decoded = bindingsSchema.safeParse(input);
  if (!decoded.success) throw new Error("WARDEN_TASKS_BINDINGS contains an invalid binding");
  let end = parsed.href.length;
  while (parsed.href[end - 1] === "/") end--;
  const baseUrl = parsed.href.slice(0, end);
  const bindings = new Map<string, TaskFeedBinding>();
  const requesters = new Set<string>();
  for (const { botId, requestedBy } of decoded.data) {
    if (bindings.has(botId) || requesters.has(requestedBy)) {
      throw new Error("WARDEN_TASKS_BINDINGS must assign each bot and requester only once");
    }
    bindings.set(botId, {
      requestedBy,
      key: createHash("sha256")
        .update(JSON.stringify([baseUrl, requestedBy, token]))
        .digest("hex"),
    });
    requesters.add(requestedBy);
  }
  return { baseUrl, token, bindings };
}
