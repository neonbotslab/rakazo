import type {
  PluginComposerDraft,
  PluginDefinition,
  WebPluginHooks,
} from "@rakazo/core/plugin-host";
import { expect, it, vi } from "vitest";
import { runComposerPluginHooks } from "./composer-policy";

const draft: PluginComposerDraft = {
  draftKey: "draft",
  revision: 1,
  text: "Write the summary",
  attachmentCount: 1,
};

function plugin(
  id: PluginDefinition["manifest"]["id"],
  beforeSendMessage: NonNullable<WebPluginHooks["beforeSendMessage"]>,
): PluginDefinition<WebPluginHooks> {
  return {
    manifest: { id, name: id, version: "1", apiVersion: 1 },
    hooks: { beforeSendMessage },
  };
}

it("holds the rewritten draft then runs remaining hooks once on resume", async () => {
  const last = vi.fn((draft: PluginComposerDraft) => ({
    kind: "rewrite" as const,
    text: `${draft.text} today`,
  }));
  const held = await runComposerPluginHooks(draft, [
    plugin("test/rewrite", () => ({ kind: "rewrite", text: "Read the summary" })),
    plugin("test/hold", async () => ({ kind: "hold" })),
    plugin("test/last", last),
  ]);
  expect(held).toMatchObject({ kind: "hold", text: "Read the summary" });
  expect(last).not.toHaveBeenCalled();
  if (held.kind !== "hold") throw new Error("Expected a held draft");
  expect(await held.resume()).toEqual({ kind: "send", text: "Read the summary today" });
  expect(last).toHaveBeenCalledExactlyOnceWith({ ...draft, text: "Read the summary" });
  expect(await held.resume()).toEqual({ kind: "cancel" });
});

it("leaves the draft unsent when a plugin cancels", async () => {
  const later = vi.fn(() => ({ kind: "continue" as const }));
  expect(
    await runComposerPluginHooks(draft, [
      plugin("test/cancel", () => ({ kind: "cancel" })),
      plugin("test/later", later),
    ]),
  ).toEqual({ kind: "cancel" });
  expect(later).not.toHaveBeenCalled();
});
