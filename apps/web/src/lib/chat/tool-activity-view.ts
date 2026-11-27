import type { MessageBlock, ToolStepPreview } from "@rakazo/contracts";
import { isRetiredImportSetup, isToolActivityBlock } from "@rakazo/core";

/** Number of tool calls behind a steps block: the sum of each row's count. */
export function toolStepCount(steps: readonly { count: number }[]): number {
  return steps.reduce((total, step) => total + step.count, 0);
}

/** Retained previews have one slot per step across all the message's tool blocks. */
export function toolStepPreviewsByBlock(
  blocks: readonly MessageBlock[],
  previews: readonly (ToolStepPreview | null)[] | undefined,
) {
  if (!previews) return [];
  let next = 0;
  return blocks.map((block) => {
    if (block.kind !== "steps") return undefined;
    const start = next;
    next += block.steps.length;
    return previews.slice(start, next);
  });
}

/**
 * Only a `steps` block becomes a card, and only when the preference is on.
 * A `progress` block marked `activity: true` never renders, in either mode.
 */
export function shouldRenderToolCard(block: MessageBlock, showToolActivity: boolean): boolean {
  return showToolActivity && block.kind === "steps";
}

/** Blocks that survive into a message render. */
export function renderableMessageBlocks(
  blocks: readonly MessageBlock[],
  showToolActivity: boolean,
): MessageBlock[] {
  return blocks.filter((block) => isShown(block, showToolActivity));
}

function isShown(block: MessageBlock, showToolActivity: boolean): boolean {
  if (isRetiredImportSetup(block)) return false;
  return !isToolActivityBlock(block) || shouldRenderToolCard(block, showToolActivity);
}

/**
 * True when a bot message's only visible blocks are tool cards, such as a live run that
 * has called tools but not written anything yet. Such a message renders as slim lines
 * between messages instead of inside a chat bubble.
 */
export function isToolOnlyNarration(
  blocks: readonly MessageBlock[],
  showToolActivity: boolean,
): boolean {
  const visible = renderableMessageBlocks(blocks, showToolActivity);
  return visible.length > 0 && visible.every((block) => block.kind === "steps");
}

/** True when a message still has at least one block to show under the preference. */
export function messageHasVisibleBlocks(
  blocks: readonly MessageBlock[],
  showToolActivity: boolean,
): boolean {
  return blocks.some((block) => isShown(block, showToolActivity));
}
