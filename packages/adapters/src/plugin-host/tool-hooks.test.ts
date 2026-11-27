import type { PluginDefinition, PluginToolCall, ServerPluginHooks } from "@rakazo/core/plugin-host";
import { expect, it } from "vitest";
import { transformPluginResult } from "./tool-hooks.js";

const call: PluginToolCall = {
  name: "sample_read",
  executionId: "tool-1",
  runId: "run-1",
  threadId: "thread-1",
  botId: "bot-1",
  userId: "user-1",
  spaceId: "space-1",
  signal: new AbortController().signal,
};

function plugin(name: string, hooks: ServerPluginHooks): PluginDefinition<ServerPluginHooks> {
  return {
    manifest: { id: `test/${name}`, name, version: "1", apiVersion: 1 },
    hooks,
  };
}

it("replaces model data while leaving the original result available to the ledger", async () => {
  const raw = { text: "provider data" };
  const projection = await transformPluginResult(
    [plugin("sample", { afterToolResult: () => ({ kind: "replace", value: { text: "edited" } }) })],
    call,
    raw,
  );
  expect(projection).toEqual({
    kind: "replace",
    value: { text: "edited" },
    resultModifiedBy: ["sample"],
  });
  expect(raw).toEqual({ text: "provider data" });
});

it("records no modification when the plugin returns the same data", async () => {
  const result = { text: "provider data" };
  expect(
    await transformPluginResult(
      [plugin("sample", { afterToolResult: (_call, value) => ({ kind: "replace", value }) })],
      call,
      result,
    ),
  ).toEqual({ kind: "keep" });
});
