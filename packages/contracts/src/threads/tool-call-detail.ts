import * as z from "zod";
import { Id } from "../ids.js";
import { ToolStepCallSchema } from "./message-blocks.js";

export const ToolCallDetailSchema = ToolStepCallSchema.pick({
  arguments: true,
  result: true,
  failed: true,
}).extend({
  hasScreenshot: z.literal(true).optional(),
});
export type ToolCallDetail = z.infer<typeof ToolCallDetailSchema>;

export const SavedToolCallSelector = z.union([
  z.object({ callId: Id }),
  z.object({
    stepIndex: z.number().int().nonnegative(),
    callIndex: z.number().int().nonnegative(),
  }),
]);
export type SavedToolCallSelector = z.infer<typeof SavedToolCallSelector>;
