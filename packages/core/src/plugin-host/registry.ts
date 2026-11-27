import type { HostPluginId, HostPluginPreference } from "@rakazo/contracts";
import { HostPluginIdSchema } from "@rakazo/contracts";

export interface PluginManifest {
  readonly id: HostPluginId;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: 1;
}

export interface PluginDefinition<Hooks extends object = object> {
  readonly manifest: PluginManifest;
  readonly hooks: Readonly<Hooks>;
}

export interface PluginScope {
  readonly userId: string;
  readonly spaceId: string;
}

export function createPluginRegistry<Hooks extends object>(
  definitions: readonly PluginDefinition<Hooks>[],
) {
  const ordered = [...definitions].sort((a, b) =>
    a.manifest.id < b.manifest.id ? -1 : Number(a.manifest.id > b.manifest.id),
  );
  const installed = new Map<HostPluginId, PluginDefinition<Hooks>>();
  for (const definition of ordered) {
    const { id, name, version, apiVersion } = definition.manifest;
    if (
      !HostPluginIdSchema.safeParse(id).success ||
      !name.trim() ||
      !version.trim() ||
      apiVersion !== 1
    ) {
      throw new Error(`Invalid host plugin manifest: ${id}`);
    }
    if (installed.has(id)) throw new Error(`Duplicate host plugin: ${id}`);
    installed.set(id, definition);
  }

  return {
    get size() {
      return installed.size;
    },
    get(id: HostPluginId) {
      return installed.get(id);
    },
    list(enabled: ReadonlySet<string>): HostPluginPreference[] {
      return ordered.map(({ manifest: { id, name } }) => ({ id, name, enabled: enabled.has(id) }));
    },
    enabled(enabled: ReadonlySet<string>): readonly PluginDefinition<Hooks>[] {
      return ordered.filter(({ manifest }) => enabled.has(manifest.id));
    },
  };
}

export type PluginJson = null | boolean | number | string | PluginJson[] | PluginJsonObject;
export interface PluginJsonObject {
  [key: string]: PluginJson;
}

export type PluginRewrite<T> = { kind: "keep" } | { kind: "replace"; value: T };
type PluginDecision<T> = T | Promise<T>;

export interface PluginToolCall extends PluginScope {
  readonly runId: string;
  readonly threadId: string;
  readonly botId: string;
  readonly name: string;
  readonly executionId: string;
  readonly signal: AbortSignal;
}

export interface ServerPluginHooks {
  beforeToolCall?(
    call: PluginToolCall,
    args: PluginJsonObject,
  ): PluginDecision<PluginRewrite<PluginJsonObject>>;
  afterToolResult?(
    call: PluginToolCall,
    result: PluginJson,
  ): PluginDecision<PluginRewrite<PluginJson>>;
}
