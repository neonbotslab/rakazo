import { createHash } from "node:crypto";
import type { AgentToolCompletion } from "@rakazo/adapter-kit";
import type { MessageBlock, ReplyTraceTool } from "@rakazo/contracts";
import { humanizeToolName, redactSecrets, sliceWellFormed } from "@rakazo/core";
import { stableJsonValue } from "@rakazo/core/node/approval-effect-key";
import type { ReplyState, RunContext } from "../assembly/run-context.js";
import type { RuntimeEvent } from "./run-turn.js";
import {
  toolCompletionDurationMs,
  toolCompletionOutcome,
  toolStepId,
} from "./tool-completion-audit.js";

export function recordTraceTool(ctx: RunContext, event: RuntimeEvent<"tool">): ReplyTraceTool {
  const { reply } = ctx.state;
  reply.trace ??= [];
  const { trace } = reply;
  const id = toolStepId(event.executionId);
  const known = trace.find((entry) => entry.kind === "tool" && entry.id === id);
  if (known?.kind === "tool") return known;

  const args = JSON.stringify(event.args);
  const canonical = stableJsonValue(
    args === undefined ? [event.name] : [event.name, JSON.parse(args)],
  );
  const key = createHash("sha256").update(canonical).digest("hex");
  const previous = trace.at(-1);
  const groupId =
    previous?.kind === "tool" && reply.traceLastToolKey === key ? previous.groupId : id;
  reply.traceLastToolKey = key;

  const name = sliceWellFormed(redactSecrets(event.name, ctx.secrets), 256);
  const publicLabel = ctx.tools.connector.get(event.name)?.label || humanizeToolName(event.name);
  const label = sliceWellFormed(redactSecrets(publicLabel, ctx.secrets), 256) || "Tool";
  const early = reply.earlyCompletions?.get(event.executionId);
  const tool: ReplyTraceTool = {
    kind: "tool",
    id,
    groupId,
    label,
    ...(name && { name }),
    outcome: "running",
    ...(early && traceCompletion(early)),
  };
  trace.push(tool);
  return tool;
}

function traceCompletion(completion: AgentToolCompletion) {
  const outcome = toolCompletionOutcome(completion);
  return outcome && { outcome, durationMs: toolCompletionDurationMs(completion) };
}

export function recordTraceToolCompletion(reply: ReplyState, completion: AgentToolCompletion) {
  const finished = traceCompletion(completion);
  if (!finished || !reply.trace) return;
  const id = toolStepId(completion.executionId);
  const index = reply.trace.findIndex((entry) => entry.kind === "tool" && entry.id === id);
  const existing = reply.trace[index];
  if (existing?.kind === "tool") reply.trace[index] = { ...existing, ...finished };
}

export function withSavedReplyTrace(blocks: MessageBlock[], reply: ReplyState): MessageBlock[] {
  if (!reply.trace?.some((entry) => entry.kind === "tool")) return blocks;
  const index = blocks.findIndex((block) => block.kind === "steps");
  const block = blocks[index];
  if (block?.kind !== "steps") return blocks;
  const trace = reply.trace.map((entry) =>
    entry.kind === "tool" && entry.outcome === "running"
      ? { ...entry, outcome: "stopped" as const }
      : entry,
  );
  return blocks.map((part, i) => (i === index ? { ...block, trace } : part));
}
