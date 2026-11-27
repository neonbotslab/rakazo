import * as z from "zod";
import { Id } from "../ids.js";
import { MessageBlock, MessageRole } from "./message-blocks.js";

export const MAX_REPLY_REASONING_BYTES = 16 * 1024;
export const ReasoningTextSchema = z
  .string()
  .min(1)
  .max(MAX_REPLY_REASONING_BYTES)
  .refine((text) => new TextEncoder().encode(text).byteLength <= MAX_REPLY_REASONING_BYTES);
export const ReplyReasoningSchema = z.strictObject({
  text: ReasoningTextSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type ReplyReasoning = z.infer<typeof ReplyReasoningSchema>;

/** The person who wrote a user message, when known. */
export const MessageAuthorSchema = z.object({ id: Id, name: z.string() });
export type MessageAuthor = z.infer<typeof MessageAuthorSchema>;

export const ReplyPreviewSchema = z.object({
  role: MessageRole,
  /** The parent is a page card. */
  page: z.literal(true).optional(),
  botId: Id.optional(),
  author: MessageAuthorSchema.optional(),
  text: z.string(),
  attachment: z
    .object({
      kind: z.enum(["image", "file"]),
      artifactId: Id,
      mimeType: z.string(),
      name: z.string(),
    })
    .optional(),
});
export type ReplyPreview = z.infer<typeof ReplyPreviewSchema>;

export const ThreadMessageSchema = z.object({
  id: Id,
  threadId: Id,
  seq: z.number().int().nonnegative(),
  role: MessageRole,
  blocks: z.array(MessageBlock),
  botId: Id.optional(),
  author: MessageAuthorSchema.optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().optional(),
  replyPreview: ReplyPreviewSchema.nullable().optional(),
  runId: Id.optional(),
  reasoning: ReplyReasoningSchema.optional(),
  /** The viewer started this saved reply's run and may ask for its tool details. */
  canInspectToolSteps: z.literal(true).optional(),
  /** Set when the message was sent from a live voice call; groups one call's transcript. */
  callId: z.string().optional(),
  createdAt: z.string(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export function canReactToThreadMessage(message: Pick<ThreadMessage, "id" | "blocks">): boolean {
  return (
    !message.id.startsWith("progress:") &&
    !message.id.startsWith("subagent:") &&
    !message.blocks.some((block) => block.kind === "channel_message")
  );
}
