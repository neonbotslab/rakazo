import { truncatePlainText } from "@rakazo/core";
import type { PluginDefinition, PluginNotice, WebPluginHooks } from "@rakazo/core/plugin-host";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { reportClientError } from "../platform/monitoring";
import { hostPluginsQuery } from "../query/host-plugins";
import { useQueryUserId } from "../query/query";
import { webPlugins } from "./web-plugin-registry";

type WebPlugin = PluginDefinition<WebPluginHooks>;
const noPlugins: readonly WebPlugin[] = [];
const EnabledWebPlugins = createContext<readonly WebPlugin[] | undefined>(noPlugins);

export function WebPluginProvider({ children }: { children: ReactNode }) {
  return webPlugins.size ? <WebPluginPreferences>{children}</WebPluginPreferences> : children;
}

function WebPluginPreferences({ children }: { children: ReactNode }) {
  const userId = useQueryUserId();
  const { data, isPending } = useQuery(hostPluginsQuery(userId));
  const enabled = useMemo(
    () =>
      userId && isPending
        ? undefined
        : webPlugins.enabled(new Set(data?.filter((row) => row.enabled).map((row) => row.id))),
    [data, isPending, userId],
  );
  return <EnabledWebPlugins.Provider value={enabled}>{children}</EnabledWebPlugins.Provider>;
}

type WebNotice = PluginNotice & { readonly silent?: true };
const NOTICE_PATCH_MAX_CHARS = 180;

function applyWebNotificationHooks(notice: PluginNotice, plugins: readonly WebPlugin[]) {
  let result: WebNotice = notice;
  for (const { hooks } of plugins) {
    if (!hooks.onNotification) continue;
    try {
      const decision = hooks.onNotification(Object.freeze({ ...result }));
      if (decision.kind === "suppress") return null;
      if (decision.kind === "patch") {
        result = {
          ...result,
          title:
            decision.title === undefined
              ? result.title
              : truncatePlainText(decision.title, NOTICE_PATCH_MAX_CHARS),
          body:
            decision.body === undefined
              ? result.body
              : truncatePlainText(decision.body, NOTICE_PATCH_MAX_CHARS),
          ...(decision.silent === true ? { silent: true } : {}),
        };
      }
    } catch {
      // A hook can throw the notice text, so do not attach its thrown value to telemetry.
      reportClientError(new Error("Web notification plugin failed"), "react.render");
    }
  }
  return result;
}

/** Undefined while the signed-in account's plugin list first loads. */
export function useEnabledWebPlugins() {
  return useContext(EnabledWebPlugins);
}

export function useWebNotificationPolicy() {
  const enabled = useEnabledWebPlugins();
  return useMemo(
    () => enabled && ((notice: PluginNotice) => applyWebNotificationHooks(notice, enabled)),
    [enabled],
  );
}
