import { BOT_MESSAGE_MAX_HOPS, botMessageContext } from "@rakazo/core";
import type { Message, PrismaClient, Run, TeamChatRunAudience, Thread } from "@rakazo/db";
import {
  mayBeChannelMessage,
  readMessageBlocks,
  runAsSystem,
  teamChatRunAudience,
} from "@rakazo/db";
import { isDelegatedRun, loadRunOrigin } from "../lifecycle/run-origin.js";

type Conversation = {
  run: Pick<Run, "id" | "spaceId" | "threadId" | "userId" | "trigger" | "sourceMessageId">;
  thread: Pick<Thread, "groupId" | "externalConversationId">;
  sourceMessage?: Pick<Message, "id" | "blocks" | "clientNonce" | "authorUserId"> | null;
  teamChatAudience?: TeamChatRunAudience;
};

export async function ownerRulesForConversation(
  prisma: PrismaClient,
  input: Conversation & { ownerId: string; nonOwnerChatRun: boolean; rules: string },
): Promise<string> {
  const { ownerId, run, rules } = input;
  if (!rules || input.nonOwnerChatRun || run.userId !== ownerId || input.thread.groupId) return "";
  const eligible = () => isPrivateOwnerConversation(prisma, ownerId, input);
  const allowed =
    run.trigger === "bot_message"
      ? await runAsSystem("verify the owner and audience of bot handoffs across Spaces", eligible)
      : await eligible();
  return allowed ? rules : "";
}

async function isPrivateOwnerConversation(
  prisma: PrismaClient,
  ownerId: string,
  first: Conversation,
): Promise<boolean> {
  let conversation: Conversation | null = first;
  const visited = new Set<string>();
  while (conversation) {
    const { run, thread } = conversation;
    if (run.userId !== ownerId || thread.groupId || visited.has(run.id)) return false;

    if (run.trigger === "messaging") {
      const source = await loadSourceMessage(prisma, conversation);
      if (!source || mayBeChannelMessage(source)) return false;
      if (!thread.externalConversationId) return source.authorUserId === ownerId;
      return (
        (conversation.teamChatAudience ??
          (await teamChatRunAudience(prisma, {
            externalConversationId: thread.externalConversationId,
            sourceClientNonce: source.clientNonce,
          }))) === "owner-direct"
      );
    }
    if (thread.externalConversationId) return false;
    if (run.trigger === "webhook") {
      // Messaging routines can be woken by other people even in a bot's main thread.
      const source = await loadSourceMessage(prisma, conversation);
      return Boolean(source && !source.clientNonce?.startsWith("messaging:"));
    }
    if (run.trigger !== "bot_message") return true;

    if (visited.size > BOT_MESSAGE_MAX_HOPS) return false;
    visited.add(run.id);
    conversation = await loadHandoffConversation(prisma, ownerId, conversation);
  }
  return false;
}

async function loadSourceMessage(prisma: PrismaClient, { run, sourceMessage }: Conversation) {
  if (sourceMessage !== undefined) return sourceMessage;
  if (!run.sourceMessageId) return null;
  return prisma.message.findUnique({
    where: { id: run.sourceMessageId, threadId: run.threadId },
    select: { id: true, blocks: true, clientNonce: true, authorUserId: true },
  });
}

async function loadHandoffConversation(
  prisma: PrismaClient,
  ownerId: string,
  conversation: Conversation,
): Promise<Conversation | null> {
  const source = await loadSourceMessage(prisma, conversation);
  if (!source) return null;
  const { blocks, intact } = readMessageBlocks(source);
  const peer = intact ? botMessageContext(blocks) : undefined;
  if (typeof peer?.fromBotId !== "string") return null;
  const outbound =
    typeof peer.returnToMessageId === "string"
      ? await prisma.message.findUnique({
          where: { id: peer.returnToMessageId, role: "bot", botId: peer.fromBotId },
          select: { runId: true, threadId: true },
        })
      : null;
  const senderRunId = outbound?.runId ?? peer.senderRunId;
  if (typeof senderRunId !== "string") return null;
  const sender = await prisma.run.findFirst({
    where: {
      id: senderRunId,
      ...(outbound ? { threadId: outbound.threadId, spaceId: conversation.run.spaceId } : {}),
      userId: ownerId,
      botId: peer.fromBotId,
      bot: { userId: ownerId },
    },
    include: {
      thread: { select: { groupId: true, externalConversationId: true } },
      sourceMessage: {
        select: { id: true, blocks: true, clientNonce: true, authorUserId: true },
      },
    },
  });
  if (!sender) return null;
  const origin = isDelegatedRun(sender.trigger) ? await loadRunOrigin(prisma, sender) : sender;
  return origin
    ? { run: origin, thread: origin.thread, sourceMessage: origin.sourceMessage }
    : null;
}
