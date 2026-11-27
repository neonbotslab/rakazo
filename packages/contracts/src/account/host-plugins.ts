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
