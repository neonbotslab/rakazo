import type { ConnectorTool } from "@rakazo/adapter-kit";
import {
  MAX_TOOL_RESULT_MODIFIER_NAME_LENGTH,
  MAX_TOOL_RESULT_MODIFIERS,
  ToolResultModifiersSchema,
} from "@rakazo/contracts";
import { stableJsonValue } from "@rakazo/core/node/approval-effect-key";
import type {
  PluginDefinition,
  PluginJson,
  PluginJsonObject,
  PluginToolCall,
  ServerPluginHooks,
} from "@rakazo/core/plugin-host";
import { Prisma, readJsonColumn } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import * as z from "zod";
import type { RunContext } from "../runs/assembly/run-context.js";
import { toolCompletionOutcome } from "../runs/turn/tool-completion-audit.js";
import { enabledHostPluginIds, serverPlugins } from "./server-plugins.js";

const JsonObject = z.record(z.string(), z.json());
const MAX_REPLACEMENT_CHARS = 100_000;

const resultProjection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keep") }),
  z.object({
    kind: z.literal("replace"),
    value: z.json(),
    resultModifiedBy: ToolResultModifiersSchema,
  }),
]);
type ResultProjection = z.infer<typeof resultProjection>;

function loadPluginToolHooks(ctx: RunContext) {
  const { spaceId, userId } = ctx.run;
  if (ctx.deps.loadHostPlugins) return ctx.deps.loadHostPlugins({ spaceId, userId });
  const registry = serverPlugins();
  return registry.size
    ? enabledHostPluginIds(ctx.deps.prisma, userId).then(registry.enabled)
    : Promise.resolve([]);
}

export function enabledPluginToolHooks(ctx: RunContext) {
  ctx.state.effects.pluginHooks ??= loadPluginToolHooks(ctx).then((plugins) =>
    plugins.filter(({ hooks }) => hooks.beforeToolCall || hooks.afterToolResult),
  );
  return ctx.state.effects.pluginHooks;
}

function toolContext(ctx: RunContext, name: string, executionId: string): PluginToolCall {
  const { userId, spaceId, threadId, botId, id: runId } = ctx.run;
  return { name, executionId, runId, threadId, botId, spaceId, userId, signal: ctx.context.signal };
}

export async function rewritePluginToolArguments(
  ctx: RunContext,
  tool: ConnectorTool,
  args: Record<string, unknown>,
  executionId: string,
): Promise<{ kind: "skip" } | { kind: "keep" } | { kind: "replace"; args: PluginJsonObject }> {
  const plugins = await enabledPluginToolHooks(ctx);
  if (!plugins.length) return { kind: "skip" };
  const call = toolContext(ctx, tool.name, executionId);
  let replacement: PluginJsonObject | undefined;
  for (const { manifest, hooks } of plugins) {
    if (!hooks.beforeToolCall) continue;
    const input = JsonObject.parse(replacement ?? args);
    try {
      const decision = await hooks.beforeToolCall(call, input);
      call.signal.throwIfAborted();
      if (decision.kind === "keep") continue;
      replacement = JsonObject.parse(decision.value);
      if (JSON.stringify(replacement).length > MAX_REPLACEMENT_CHARS) {
        throw new Error("Plugin arguments are too large");
      }
    } catch {
      throw new Error(`Tool arguments rejected by plugin ${manifest.name}`);
    }
  }
  return replacement ? { kind: "replace", args: replacement } : { kind: "keep" };
}

export async function transformPluginResult(
  plugins: readonly PluginDefinition<ServerPluginHooks>[],
  call: PluginToolCall,
  result: unknown,
): Promise<ResultProjection> {
  const parsed = z.json().safeParse(result);
  if (!parsed.success) return { kind: "keep" };
  let value: PluginJson = parsed.data;
  const modifiers: string[] = [];
  for (const { manifest, hooks } of plugins) {
    if (!hooks.afterToolResult) continue;
    try {
      const decision = await hooks.afterToolResult(call, structuredClone(value));
      call.signal.throwIfAborted();
      if (decision.kind === "keep") continue;
      const replacement = z.json().parse(decision.value);
      if (JSON.stringify(replacement).length > MAX_REPLACEMENT_CHARS)
        throw new Error("Plugin result is too large");
      if (stableJsonValue(replacement) === stableJsonValue(value)) continue;
      value = replacement;
      const name = manifest.name.trim().slice(0, MAX_TOOL_RESULT_MODIFIER_NAME_LENGTH);
      if (!modifiers.includes(name)) modifiers.push(name);
      if (modifiers.length === MAX_TOOL_RESULT_MODIFIERS) break;
    } catch {
      getLogger().warn("Tool result plugin failed", { pluginId: manifest.id });
    }
  }
  return modifiers.length && stableJsonValue(value) !== stableJsonValue(parsed.data)
    ? { kind: "replace", value, resultModifiedBy: modifiers }
    : { kind: "keep" };
}

export class ProjectedToolResult {
  constructor(
    readonly raw: unknown,
    readonly value: PluginJson,
    readonly resultModifiedBy: readonly string[],
  ) {}
}

export async function projectPluginToolResult(
  ctx: RunContext,
  effectId: string,
  name: string,
  executionId: string,
  raw: unknown,
): Promise<unknown> {
  if (toolCompletionOutcome({ name, executionId, durationMs: 0, result: raw }) !== "succeeded") {
    return raw;
  }
  const where = { id: effectId, runId: ctx.runId, status: "completed" };
  const read = () =>
    ctx.deps.prisma.externalEffect.findFirst({ where, select: { pluginResult: true } });
  const effect = await read();
  if (!effect) return raw;

  let saved = effect.pluginResult;
  if (saved == null) {
    const plugins = await enabledPluginToolHooks(ctx);
    const decision = await transformPluginResult(plugins, toolContext(ctx, name, executionId), raw);
    const stored =
      decision.kind === "replace"
        ? { ...decision, resultModifiedBy: [...decision.resultModifiedBy] }
        : decision;
    const written = await ctx.deps.prisma.externalEffect.updateMany({
      where: { ...where, pluginResult: { equals: Prisma.DbNull } },
      data: { pluginResult: stored },
    });
    saved = written.count === 1 ? stored : ((await read())?.pluginResult ?? null);
  }
  if (saved == null) throw new Error("Tool result projection was not saved");
  const projection = readJsonColumn(
    resultProjection,
    saved,
    { table: "external_effects", column: "pluginResult", id: effectId },
    "reject",
  );
  return projection.kind === "replace"
    ? new ProjectedToolResult(raw, projection.value, projection.resultModifiedBy)
    : raw;
}
