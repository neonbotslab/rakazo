import type { HostPluginTaskCard } from "@rakazo/contracts";
import { HostPluginTaskCardSchema } from "@rakazo/contracts";
import {
  cancelResponseBody,
  deadlineSignal,
  readBoundedJsonResponse,
  sanitizeUtf16ForJson,
} from "@rakazo/core";
import { z } from "zod";
import type { HostTaskFeed, TaskFeedResult } from "../../../plugin-host/task-feed.js";
import { readWardenTaskConfig, wardenTasksManifest } from "./warden-task-config.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 10_000;
const envelope = z.object({ tasks: z.array(z.unknown()) });
const wireTask = z.object({
  id: z.union([z.string(), z.number()]),
  requested_by: z.union([z.string(), z.object({ id: z.string() })]),
  state: z.string(),
  attention: z.unknown().optional(),
  turn_done: z.unknown().optional(),
  exit_code: z.unknown().optional(),
  title: z.unknown().optional(),
  project: z.unknown().optional(),
  box: z.unknown().optional(),
  agent: z.unknown().optional(),
  model: z.unknown().optional(),
  progress: z.unknown().optional(),
  started_at: z.unknown().optional(),
  created_at: z.unknown().optional(),
  ended_at: z.unknown().optional(),
  last_activity: z.unknown().optional(),
});

function timestamp(value: unknown): number | undefined {
  const n =
    typeof value === "number" || (typeof value === "string" && value.trim())
      ? Number(value)
      : Number.NaN;
  const millis = Number.isFinite(n)
    ? n < 1_000_000_000_000
      ? n * 1000
      : n
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  if (millis > 0 && millis <= 8.64e15) return Math.trunc(millis);
}

function taskStatus(data: z.infer<typeof wireTask>): HostPluginTaskCard["status"] | undefined {
  switch (data.state) {
    case "awaiting_approval":
      return "awaitingApproval";
    case "starting":
      return data.attention ? "waiting" : "starting";
    case "running":
      return data.attention ? "waiting" : data.turn_done === true ? "done" : "running";
    case "waiting":
      return "waiting";
    case "exited":
      return data.exit_code ? "failed" : "done";
    case "closed":
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "lost":
      return "lost";
  }
}

function optionalText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
}

function toTask(input: unknown, baseUrl: string) {
  const parsed = wireTask.safeParse(input);
  if (!parsed.success) return;
  const data = parsed.data;
  const id = String(data.id);
  if (
    !id.trim() ||
    id.length > 180 ||
    sanitizeUtf16ForJson(id) !== id ||
    id === "." ||
    id === ".." ||
    [...id].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return;
  const status = taskStatus(data);
  const startedAt = timestamp(data.started_at) ?? timestamp(data.created_at);
  if (!status || startedAt === undefined) return;
  const terminal = status === "done" || status === "failed" || status === "lost";
  const endedAt = terminal
    ? (timestamp(data.ended_at) ?? timestamp(data.last_activity))
    : undefined;
  const requestedBy =
    typeof data.requested_by === "string" ? data.requested_by : data.requested_by.id;
  const card = HostPluginTaskCardSchema.safeParse({
    id,
    title: optionalText(data.title, 240) ?? optionalText(data.project, 240) ?? "Task",
    status,
    startedAt,
    endedAt,
    box: optionalText(data.box, 120) ?? optionalText(data.agent, 120),
    model: optionalText(data.model, 160),
    progress:
      typeof data.progress === "number" && data.progress >= 0 && data.progress <= 1
        ? data.progress
        : undefined,
    href: `${baseUrl}/t/${encodeURIComponent(id)}`,
  });
  if (card.success) return { requestedBy, card: card.data };
}

export function createWardenTaskFeed(
  source: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): HostTaskFeed | undefined {
  const config = readWardenTaskConfig(source);
  if (!config) return undefined;
  const { baseUrl, token, bindings } = config;
  return {
    pluginId: wardenTasksManifest.id,
    botIds: [...bindings.keys()],
    bindingFor: (botId) => bindings.get(botId),
    async list(parent): Promise<TaskFeedResult> {
      const signal = deadlineSignal(DEADLINE_MS, parent);
      try {
        const response = await request(`${baseUrl}/api/tasks?include_ended=true`, {
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          redirect: "error",
          cache: "no-store",
          signal,
        });
        if (!response.ok) {
          cancelResponseBody(response);
          return {
            kind: response.status === 401 || response.status === 403 ? "forbidden" : "offline",
          };
        }
        const decoded = envelope.parse(
          await readBoundedJsonResponse<unknown>(response, MAX_RESPONSE_BYTES, signal),
        );
        return {
          kind: "ready",
          tasks: decoded.tasks.flatMap((input) => toTask(input, baseUrl) ?? []),
        };
      } catch {
        parent?.throwIfAborted();
        return { kind: "offline" };
      }
    },
  };
}
