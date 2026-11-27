import * as z from "zod";
import { Id, IsoDate } from "../ids.js";

export const OWNER_RULES_MAX_LENGTH = 4_000;
export const OwnerRulesTextSchema = z.string().max(OWNER_RULES_MAX_LENGTH);
export const OwnerRulesVersionIdSchema = z.number().int().positive().max(2_147_483_647);

export const OwnerRulesVersionSchema = z.object({
  id: OwnerRulesVersionIdSchema,
  userId: Id,
  text: OwnerRulesTextSchema,
  createdAt: IsoDate,
});
export type OwnerRulesVersion = z.infer<typeof OwnerRulesVersionSchema>;

export const OwnerRulesPageSchema = z.object({
  versions: z.array(OwnerRulesVersionSchema),
  nextBefore: OwnerRulesVersionIdSchema.nullable(),
});
export type OwnerRulesPage = z.infer<typeof OwnerRulesPageSchema>;
