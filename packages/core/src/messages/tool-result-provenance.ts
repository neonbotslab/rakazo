import type { LiveToolCall, MessageBlock } from "@rakazo/contracts";
import { MAX_TOOL_RESULT_MODIFIERS, ToolResultModifiersSchema } from "@rakazo/contracts";

export function toolResultModifiers(names: Iterable<string>): string[] {
  return [...new Set(names)].slice(0, MAX_TOOL_RESULT_MODIFIERS);
}

/** Matches tool events on execution ID and groups attribution with the existing visible steps. */
export function applyLiveToolProvenance(
  blocks: MessageBlock[],
  calls: LiveToolCall[] | undefined,
  event: { type: string; payload?: Record<string, unknown> },
) {
  let pending = calls;
  const { toolStepId, executionId: legacyId, resultModifiedBy: rawModifiers } = event.payload ?? {};
  const executionId = toolStepId ?? legacyId;
  if (typeof executionId === "string" && executionId.length > 0 && executionId.length <= 1_024) {
    const existing = pending?.find((call) => call.executionId === executionId);
    if (event.type === "agent.tool.called") {
      const index = countCalls(blocks) - 1;
      const call: LiveToolCall =
        existing?.kind === "modified"
          ? { ...existing, index }
          : { kind: "called", executionId, index };
      pending = [...(pending ?? []).filter((call) => call !== existing), call];
    } else if (event.type === "agent.tool.completed") {
      const names = ToolResultModifiersSchema.safeParse(rawModifiers);
      if (existing || names.success) {
        pending = (pending ?? []).filter((call) => call !== existing);
        if (names.success)
          pending.push({
            kind: "modified",
            executionId,
            index: existing?.index,
            resultModifiedBy: names.data,
          });
      }
    }
  }

  const matches = pending?.flatMap((call) =>
    call.kind === "modified" && call.index !== undefined ? [{ ...call, index: call.index }] : [],
  );
  if (!matches?.length) return { blocks, calls: pending?.length ? pending : undefined };

  const applied = new Set<string>();
  let end = 0;
  const annotated = blocks.map((block) => {
    if (block.kind !== "steps") return block;
    const steps = block.steps.map((step) => {
      const start = end;
      end += step.count;
      const names = matches
        .filter((call) => call.index >= start && call.index < end)
        .flatMap((call) => {
          applied.add(call.executionId);
          return call.resultModifiedBy;
        });
      return names.length
        ? {
            ...step,
            resultModifiedBy: toolResultModifiers([...(step.resultModifiedBy ?? []), ...names]),
          }
        : step;
    });
    return { ...block, steps };
  });
  const outstanding = pending?.filter((call) => !applied.has(call.executionId));
  return {
    blocks: applied.size ? annotated : blocks,
    calls: outstanding?.length ? outstanding : undefined,
  };
}

function countCalls(blocks: readonly MessageBlock[]): number {
  return blocks.reduce((count, block) => {
    if (block.kind === "steps") return block.steps.reduce((sum, step) => sum + step.count, count);
    if (block.kind === "progress") return count + (block.pendingToolNames?.length ?? 0);
    return count;
  }, 0);
}
