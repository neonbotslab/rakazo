import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { ToolStepPreview } from "@rakazo/contracts";
import { TOOL_STEP_PREVIEW_LENGTH } from "@rakazo/contracts";
import type { ToolStep } from "@rakazo/core";
import { formatCompactDuration, truncatePlainText } from "@rakazo/core";

export function toolStepTitle(
  i18n: I18n,
  step: ToolStep,
  current: boolean,
  preview?: ToolStepPreview | null,
  runDurationMs?: number,
): string {
  const { failed, stopped, succeeded } = step.outcomes ?? {
    failed: preview?.failed,
    succeeded: preview ? step.count - (preview.failed ?? 0) : undefined,
  };
  const outcomes = [
    succeeded ? i18n._(msg`${succeeded} succeeded`) : null,
    failed ? i18n._(msg`${failed} failed`) : null,
    stopped ? i18n._(msg`${stopped} stopped`) : null,
  ].filter(Boolean);
  const status = current
    ? i18n._(msg`Running`)
    : outcomes.length > 0
      ? outcomes.join(", ")
      : i18n._(msg`Done`);
  const name = (preview?.tool || step.label).replace(/\s+/g, " ").trim();
  const tool = shorten(name, TOOL_STEP_PREVIEW_LENGTH);
  const duration = formatCompactDuration(runDurationMs);
  const input = preview?.input;
  const output = preview?.output;
  const lines = [
    step.count > 1 ? `${tool} ×${step.count}` : tool,
    status,
    duration ? `${i18n._(msg`Run duration`)}: ${duration}` : null,
    input ? `${i18n._(step.count > 1 ? msg`Last input` : msg`Input`)}: ${input}` : null,
    output ? `${i18n._(step.count > 1 ? msg`Last output` : msg`Output`)}: ${output}` : null,
  ];
  return shorten(lines.filter(Boolean).join("\n"), 500);
}

function shorten(text: string, limit: number): string {
  return text.length > limit ? `${truncatePlainText(text, limit - 1).trimEnd()}…` : text;
}
