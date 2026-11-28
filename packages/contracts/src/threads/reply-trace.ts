import * as z from "zod";

export const MAX_REPLY_REASONING_BYTES = 16 * 1024;
export const ReasoningTextSchema = z
  .string()
  .min(1)
  .max(MAX_REPLY_REASONING_BYTES)
  .refine((text) => new TextEncoder().encode(text).byteLength <= MAX_REPLY_REASONING_BYTES);

const TraceEntryId = z.string().min(1).max(128);

export const ReplyTraceToolSchema = z.object({
  kind: z.literal("tool"),
  id: TraceEntryId,
  groupId: TraceEntryId,
  label: z.string().min(1).max(256),
  name: z.string().min(1).max(256).optional(),
  outcome: z.enum(["running", "succeeded", "failed", "stopped"]),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ReplyTraceTool = z.infer<typeof ReplyTraceToolSchema>;

export const ReplyTraceEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thinking"), id: TraceEntryId, text: ReasoningTextSchema }),
  ReplyTraceToolSchema,
]);
export type ReplyTraceEntry = z.infer<typeof ReplyTraceEntrySchema>;

export const TraceThinkingPayloadSchema = z.strictObject({
  traceReasoningChanged: z.literal(true),
  phaseId: TraceEntryId,
  text: ReasoningTextSchema.nullable(),
});

export const TraceToolCompletionSchema = z.object({
  outcome: z.enum(["succeeded", "failed"]),
  durationMs: z.number().int().nonnegative(),
});
export type TraceToolCompletion = z.infer<typeof TraceToolCompletionSchema>;
