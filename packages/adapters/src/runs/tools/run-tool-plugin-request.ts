import type { ConnectorCall, ConnectorTool } from "@rakazo/adapter-kit";
import { stableJsonValue } from "@rakazo/core/node/approval-effect-key";
import type { BoundApprovalRoute } from "../../approvals/approval-effect.js";
import {
  approvalRoutesMatch,
  boundDirectApprovalDetails,
  boundDirectApprovalRequest,
  catalogApprovalDetails,
  catalogApprovalInnerArgs,
  catalogApprovalRequest,
} from "../../approvals/approval-effect.js";
import { sanitizeConnectorError } from "../../integrations/connector-safety.js";
import { rewritePluginToolArguments } from "../../plugin-host/tool-hooks.js";
import { parseConnectorToolArgs } from "../../tools/lazy-tool-catalog.js";
import type { RunContext } from "../assembly/run-context.js";
import type { findPluginEffect } from "../lifecycle/run-effects.js";
import { CATALOG_APPROVAL_TOOL } from "../lifecycle/run-effects.js";
import { refusal } from "../turn/tool-refusal.js";
import { BUILTIN_AGENT_TOOL_NAMES } from "./run-tool-selection.js";

export type PluginEffect = NonNullable<Awaited<ReturnType<typeof findPluginEffect>>>;

export async function preparePluginToolRequest(
  ctx: RunContext,
  input: {
    tool: ConnectorTool | undefined;
    args: Record<string, unknown>;
    executionId: string;
    invocationId: string | undefined;
    route: BoundApprovalRoute | undefined;
    wrapper: ConnectorCall | undefined;
    saved: PluginEffect | undefined;
  },
) {
  const { tool, args, executionId, invocationId, route, wrapper, saved } = input;
  try {
    if (saved) {
      const catalog = catalogApprovalDetails(saved.request, CATALOG_APPROVAL_TOOL);
      const direct = boundDirectApprovalDetails(saved.request, CATALOG_APPROVAL_TOOL);
      const storedArgs = catalog ? catalogApprovalInnerArgs(catalog) : direct?.args;
      if (!tool || !storedArgs || !approvalRoutesMatch(catalog?.route ?? direct?.route, route)) {
        return refusal(
          "plugin_tool_route_changed",
          "The stored tool request is no longer available on the original connector.",
        );
      }
      const parsed = parseConnectorToolArgs(tool.inputSchema, storedArgs);
      if (stableJsonValue(parsed) !== stableJsonValue(storedArgs))
        return refusal("plugin_tool_schema_changed", "The connector changed its tool arguments.");
      return { args: storedArgs, effectRequest: saved.request, invocationId: undefined };
    }

    if (
      !invocationId ||
      !tool ||
      !route ||
      BUILTIN_AGENT_TOOL_NAMES.has(tool.name) ||
      ctx.state.effects.restoredPending?.executionId === executionId
    )
      return undefined;

    const rewrite = await rewritePluginToolArguments(ctx, tool, args, executionId);
    if (rewrite.kind === "skip") return undefined;
    const parsed = parseConnectorToolArgs(
      tool.inputSchema,
      rewrite.kind === "replace" ? rewrite.args : args,
    );
    const effectRequest = wrapper
      ? catalogApprovalRequest(
          wrapper.tool,
          { ...wrapper.args, arguments: parsed },
          CATALOG_APPROVAL_TOOL,
          route,
        )
      : boundDirectApprovalRequest(route, parsed, CATALOG_APPROVAL_TOOL);
    return { args: parsed, effectRequest, invocationId };
  } catch (error) {
    ctx.context.signal.throwIfAborted();
    return { error: sanitizeConnectorError(error) };
  }
}
