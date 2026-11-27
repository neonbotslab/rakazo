import { useLingui } from "@lingui/react/macro";
import { writeSaved } from "@rakazo/core/query";
import { Label, Switch } from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { SettingsGroup, SettingsRow } from "../../components/settings/SettingsRows";
import { hostPluginsQuery } from "../../lib/query/host-plugins";
import { useQueryUserId, useSave } from "../../lib/query/query";
import type { RpcClient } from "../../lib/query/rpc";
import { SpaceRpcProvider } from "../../lib/query/space-rpc";
import { errorText } from "../../lib/query/user-error";

type InstalledPlugins = Awaited<ReturnType<RpcClient["hostPlugins"]["list"]>>;

export function PluginSettingsPanel({ plugins }: { plugins: InstalledPlugins }) {
  return (
    <SpaceRpcProvider spaceId={null}>
      <PluginSettingsRows plugins={plugins} />
    </SpaceRpcProvider>
  );
}

function PluginSettingsRows({ plugins }: { plugins: InstalledPlugins }) {
  const { t } = useLingui();
  const id = useId();
  const queryClient = useQueryClient();
  const queryKey = hostPluginsQuery(useQueryUserId()).queryKey;
  const change = useSave({
    save: async (input: Parameters<RpcClient["hostPlugins"]["setEnabled"]>[0], client) => {
      const updated = await client.hostPlugins.setEnabled(input);
      await writeSaved(queryClient, queryKey, (current) =>
        current?.map((plugin) => (plugin.id === updated.id ? updated : plugin)),
      );
    },
    stale: [queryKey],
  });

  return (
    <SettingsGroup>
      {plugins.map((plugin) => (
        <SettingsRow
          key={plugin.id}
          label={
            <Label htmlFor={`${id}-${plugin.id}`} className="text-body font-normal text-foreground">
              {plugin.name}
            </Label>
          }
          control={
            <Switch
              id={`${id}-${plugin.id}`}
              checked={plugin.enabled}
              disabled={change.pending}
              onCheckedChange={(enabled) => change.run({ id: plugin.id, enabled })}
            />
          }
        />
      ))}
      {change.error ? (
        <p role="alert" className="px-4 py-3 text-body-sm text-destructive">
          {errorText(change.error, t`Couldn't update the plugin`)}
        </p>
      ) : null}
    </SettingsGroup>
  );
}
