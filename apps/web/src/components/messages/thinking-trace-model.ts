import type { ReplyTraceEntry, ThreadMessage } from "@rakazo/contracts";

type ToolEntry = Extract<ReplyTraceEntry, { kind: "tool" }>;

export type TraceCall = Omit<ToolEntry, "outcome"> & {
  outcome?: ToolEntry["outcome"];
  legacy?: { stepIndex: number; callIndex: number; count: number };
};
export type TraceEntry = Exclude<ReplyTraceEntry, ToolEntry> | TraceCall;

export type TraceRow =
  | Exclude<TraceEntry, TraceCall>
  | { kind: "calls"; id: string; calls: TraceCall[] };

export function traceRows(entries: readonly TraceEntry[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const entry of entries) {
    if (entry.kind === "thinking") {
      rows.push(entry);
      continue;
    }
    const previous = rows.at(-1);
    if (previous?.kind === "calls" && previous.calls[0]?.groupId === entry.groupId) {
      previous.calls.push(entry);
    } else {
      rows.push({ kind: "calls", id: entry.id, calls: [entry] });
    }
  }
  return rows;
}

export function messageTrace(
  message: ThreadMessage,
  liveTrace: readonly ReplyTraceEntry[] | undefined,
  showToolActivity: boolean,
  liveReasoning?: string,
): { entries: readonly TraceEntry[]; durationMs?: number } {
  const stepBlocks = message.blocks.filter((block) => block.kind === "steps");
  const recorded = liveTrace ?? stepBlocks.find((block) => block.trace)?.trace;
  const durationMs =
    stepBlocks.findLast((block) => block.durationMs !== undefined)?.durationMs ??
    message.reasoning?.durationMs;
  if (recorded?.length) {
    return {
      entries: showToolActivity ? recorded : recorded.filter((entry) => entry.kind === "thinking"),
      durationMs,
    };
  }

  const entries: TraceEntry[] = [];
  const reasoning = liveReasoning ?? message.reasoning?.text;
  if (reasoning?.trim()) entries.push({ kind: "thinking", id: "reasoning", text: reasoning });
  if (!showToolActivity) return { entries, durationMs };

  const steps = stepBlocks.flatMap((block) => block.steps);
  for (const [stepIndex, step] of steps.entries()) {
    const groupId = `legacy:${stepIndex}`;
    if (step.note) entries.push({ kind: "thinking", id: `${groupId}:note`, text: step.note });
    const outcome =
      message.id.startsWith("progress:") && stepIndex === steps.length - 1
        ? "running"
        : (["failed", "stopped", "succeeded"] as const).find(
            (status) => step.outcomes?.[status] === step.count,
          );
    for (let callIndex = 0; callIndex < step.count; callIndex += 1) {
      entries.push({
        kind: "tool",
        id: `${groupId}:${callIndex}`,
        groupId,
        label: step.label,
        outcome,
        legacy: { stepIndex, callIndex, count: step.count },
      });
    }
  }
  return { entries, durationMs };
}

export function formatWorkDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const pad = (part: number) => String(part).padStart(2, "0");
  if (hours) return `${hours}h${pad(minutes)}m${pad(seconds % 60)}s`;
  if (minutes) return `${minutes}m${pad(seconds % 60)}s`;
  return `${seconds}s`;
}

export function callDuration(durationMs: number): string {
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

export function readableName(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_.:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDetail(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return text;
  }
}

export function detailFields(text: string): { label?: string; value: string }[] {
  const data = parseDetail(text);
  const value = (item: unknown) =>
    typeof item === "string" ? item : JSON.stringify(item, null, 2);
  if (Array.isArray(data)) return data.map((item) => ({ value: value(item) }));
  if (data && typeof data === "object") {
    return Object.entries(data).map(([key, item]) => {
      const name = readableName(key);
      return { label: name.charAt(0).toUpperCase() + name.slice(1), value: value(item) };
    });
  }
  return typeof data === "string"
    ? data.split(/\r?\n/).map((line) => ({ value: line }))
    : [{ value: value(data) }];
}
