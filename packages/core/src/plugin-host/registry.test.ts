import { describe, expect, it } from "vitest";
import type { PluginDefinition } from "./registry.js";
import { createPluginRegistry } from "./registry.js";

function plugin(id: PluginDefinition["manifest"]["id"], name: string) {
  return {
    manifest: { id, name, version: "1.0.0", apiVersion: 1 },
    hooks: { format: (text: string) => `${name}: ${text}` },
  } satisfies PluginDefinition;
}

const first = plugin("test/first", "First");
const second = plugin("test/second", "Second");

describe("trusted plugin registry", () => {
  it("lists installed plugins in stable order and exposes hooks only for enabled plugins", () => {
    const registry = createPluginRegistry([second, first]);
    expect(registry.list(new Set([second.manifest.id, "test/missing"]))).toEqual([
      { id: first.manifest.id, name: "First", enabled: false },
      { id: second.manifest.id, name: "Second", enabled: true },
    ]);
    expect(
      registry.enabled(new Set([second.manifest.id])).map(({ hooks }) => hooks.format("Hi")),
    ).toEqual(["Second: Hi"]);
  });

  it("refuses conflicting installations", () => {
    expect(() => createPluginRegistry([first, plugin(first.manifest.id, "Duplicate")])).toThrow(
      first.manifest.id,
    );
  });
});
