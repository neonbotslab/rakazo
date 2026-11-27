import * as z from "zod";

export type HostPluginId = `${string}/${string}`;

export const HostPluginIdSchema = z.custom<HostPluginId>(
  (value) =>
    typeof value === "string" &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
);

export const HostPluginPreferenceSchema = z.object({
  id: HostPluginIdSchema,
  name: z.string(),
  enabled: z.boolean(),
  chatCards: z.literal(true).optional(),
});

export type HostPluginPreference = z.infer<typeof HostPluginPreferenceSchema>;

export const PluginNoticeKindSchema = z.enum([
  "reply",
  "memberMessage",
  "question",
  "approval",
  "failure",
  "takeover",
  "cancelled",
  "stuck",
  "expired",
  "incomingCall",
]);

export type PluginNoticeKind = z.infer<typeof PluginNoticeKindSchema>;

export const HostPluginTaskCardSchema = z.object({
  id: z.string().min(1).max(180),
  title: z.string().trim().min(1).max(240),
  status: z.enum(["starting", "running", "waiting", "awaitingApproval", "done", "failed", "lost"]),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  box: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  progress: z.number().min(0).max(1).optional(),
  href: z.url({ protocol: /^https?$/ }).max(2_048),
});

export const HostPluginTaskCardsSchema = z.array(HostPluginTaskCardSchema).max(200);
export type HostPluginTaskCard = z.infer<typeof HostPluginTaskCardSchema>;
