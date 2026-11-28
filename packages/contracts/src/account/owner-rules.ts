import * as z from "zod";
import { Id, IsoDate } from "../ids.js";

export const OWNER_RULES_MAX_LENGTH = 4_000;
export const OWNER_RULES_CONFLICT = "OWNER_RULES_CONFLICT";

export function ownerRulesLength(text: string): number {
  return Array.from(text).length;
}

export const OwnerRulesTextSchema = z
  .string()
  .refine((text) => ownerRulesLength(text) <= OWNER_RULES_MAX_LENGTH, {
    error: `Bot rules can contain up to ${OWNER_RULES_MAX_LENGTH} characters.`,
  });
export const OwnerRulesVersionIdSchema = z.number().int().positive().max(2_147_483_647);

const OwnerRulesVersionRefSchema = z.object({
  id: OwnerRulesVersionIdSchema,
  revision: z.number().int().positive().max(2_147_483_647),
});
export type OwnerRulesVersionRef = z.infer<typeof OwnerRulesVersionRefSchema>;

export const OwnerRulesVersionSchema = OwnerRulesVersionRefSchema.extend({
  userId: Id,
  text: OwnerRulesTextSchema,
  createdAt: IsoDate,
  reason: z.enum(["saved", "restored"]),
});
export type OwnerRulesVersion = z.infer<typeof OwnerRulesVersionSchema>;

export const OwnerRulesSaveInputSchema = z.object({
  text: OwnerRulesTextSchema,
  sessionId: z.uuid().toLowerCase(),
  expected: OwnerRulesVersionRefSchema.nullable(),
});
export type OwnerRulesSaveInput = z.infer<typeof OwnerRulesSaveInputSchema>;

export const OwnerRulesRestoreInputSchema = z.object({
  versionId: OwnerRulesVersionIdSchema,
  expected: OwnerRulesVersionRefSchema.nullable(),
});
export type OwnerRulesRestoreInput = z.infer<typeof OwnerRulesRestoreInputSchema>;

export const OwnerRulesPageSchema = z.object({
  versions: z.array(OwnerRulesVersionSchema),
  nextBefore: OwnerRulesVersionIdSchema.nullable(),
});
export type OwnerRulesPage = z.infer<typeof OwnerRulesPageSchema>;
