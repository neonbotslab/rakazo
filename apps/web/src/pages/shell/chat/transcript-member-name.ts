import { t } from "@lingui/core/macro";
import type { ThreadMessage } from "@rakazo/contracts";
import type { ThreadItem } from "@rakazo/core";
import { botDisplayName, isPeerReceiptBlocks } from "@rakazo/core";

type NamedBot = {
  id: string;
  name: string;
};

/** Resolve a group speaker, including archived and deleted bots. */
export function resolveTranscriptMemberName({
  botId,
  members,
  bots,
  archivedBots,
}: {
  botId: string | undefined;
  members: readonly { botId: string; name: string }[] | undefined;
  bots: readonly NamedBot[];
  archivedBots: readonly NamedBot[];
}): string | undefined {
  if (members === undefined) return undefined;
  const current = botDisplayName(members, bots, botId);
  if (current !== undefined) return current;
  if (!botId) return undefined;
  return nameOf(archivedBots, botId) ?? t`Deleted bot`;
}

function nameOf(bots: readonly NamedBot[], botId: string): string | undefined {
  return bots.find((bot) => bot.id === botId)?.name;
}

export function botTurnHeaderIds(items: readonly ThreadItem<ThreadMessage>[]): Set<string> {
  const replyingBots = new Set<string>();
  const turnStarts = new Set<string>();
  let previousBotId: string | undefined;
  for (const item of items) {
    if (item.kind !== "message") continue;
    const { id, role, botId, blocks } = item.message;
    if (role === "user") previousBotId = undefined;
    if (
      role !== "bot" ||
      !botId ||
      id.startsWith("subagent:") ||
      isPeerReceiptBlocks(blocks) ||
      blocks.some((block) => block.kind === "handoff")
    ) {
      continue;
    }
    if (!id.startsWith("progress:")) replyingBots.add(botId);
    if (botId !== previousBotId) turnStarts.add(id);
    previousBotId = botId;
  }
  if (replyingBots.size < 2) turnStarts.clear();
  return turnStarts;
}
