import type { ReplyTraceEntry, ThreadSnapshot, TraceToolCompletion } from "@rakazo/contracts";
import {
  ReplyTraceToolSchema,
  TraceThinkingPayloadSchema,
  TraceToolCompletionSchema,
} from "@rakazo/contracts";

export type LiveReplyTrace = Pick<ThreadSnapshot, "liveTrace" | "liveTracePending">;

export function applyLiveReplyTrace(
  current: LiveReplyTrace,
  event: { type: string; runId?: string | null; payload?: Record<string, unknown> },
  settled: boolean,
): LiveReplyTrace {
  const { runId, type, payload } = event;
  if (type === "thread.cleared") return { liveTrace: undefined, liveTracePending: undefined };
  if (!runId) return current;
  if (settled || type === "run.started" || type === "run.checkpointed") {
    return {
      liveTrace: replaceRun(current.liveTrace, runId, undefined),
      liveTracePending: replaceRun(current.liveTracePending, runId, undefined),
    };
  }
  const entries = runValue(current.liveTrace, runId) ?? [];
  const pending = runValue(current.liveTracePending, runId);
  if (type === "thread.meta" && payload?.traceReasoningChanged === true) {
    const parsed = TraceThinkingPayloadSchema.safeParse(payload);
    if (!parsed.success) return current;
    const { phaseId, text } = parsed.data;
    const next = text ? { kind: "thinking" as const, id: phaseId, text } : undefined;
    return {
      ...current,
      liveTrace: replaceRun(current.liveTrace, runId, upsert(entries, phaseId, next)),
    };
  }
  if (type === "agent.tool.called") {
    const parsed = ReplyTraceToolSchema.safeParse(payload?.traceTool);
    if (!parsed.success) return current;
    const { id } = parsed.data;
    const existing = entries.find((entry) => entry.kind === "tool" && entry.id === id);
    const completion = runValue(pending, id);
    return {
      liveTrace: replaceRun(
        current.liveTrace,
        runId,
        upsert(entries, id, existing ?? { ...parsed.data, ...completion }),
      ),
      liveTracePending: replaceRun(
        current.liveTracePending,
        runId,
        replaceRun(pending, id, undefined),
      ),
    };
  }
  if (type === "agent.tool.completed" && payload?.traceCall === true) {
    const id = payload.toolStepId;
    if (typeof id !== "string" || id.length > 128 || !id.length) return current;
    const parsed = TraceToolCompletionSchema.safeParse({
      outcome: payload.outcome === "error" ? "failed" : payload.outcome,
      durationMs: payload.durationMs,
    });
    if (!parsed.success) return current;
    const completion: TraceToolCompletion = parsed.data;
    const existing = entries.find((entry) => entry.kind === "tool" && entry.id === id);
    return existing
      ? {
          ...current,
          liveTrace: replaceRun(
            current.liveTrace,
            runId,
            upsert(entries, id, { ...existing, ...completion }),
          ),
        }
      : {
          ...current,
          liveTracePending: replaceRun(current.liveTracePending, runId, {
            ...pending,
            [id]: completion,
          }),
        };
  }
  return current;
}

function runValue<T>(runs: Record<string, T> | undefined, runId: string): T | undefined {
  return runs && Object.hasOwn(runs, runId) ? runs[runId] : undefined;
}

function replaceRun<T>(runs: Record<string, T> | undefined, runId: string, value: T | undefined) {
  if (value !== undefined) return { ...runs, [runId]: value };
  if (!runs || !Object.hasOwn(runs, runId)) return runs;
  const { [runId]: _ended, ...remaining } = runs;
  return Object.keys(remaining).length ? remaining : undefined;
}

function upsert(entries: ReplyTraceEntry[], id: string, next: ReplyTraceEntry | undefined) {
  if (next === undefined) {
    const remaining = entries.filter((entry) => entry.id !== id);
    return remaining.length ? remaining : undefined;
  }
  return entries.some((entry) => entry.id === id)
    ? entries.map((entry) => (entry.id === id ? next : entry))
    : [...entries, next];
}
