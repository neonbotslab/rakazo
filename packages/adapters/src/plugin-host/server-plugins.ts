import type { HostPluginId } from "@rakazo/contracts";
import { ClientError } from "@rakazo/core";
import type { PluginDefinition, ServerPluginHooks } from "@rakazo/core/plugin-host";
import { createPluginRegistry } from "@rakazo/core/plugin-host";
import type { PrismaClient } from "@rakazo/db";
import {
  wardenTasksConfigured,
  wardenTasksManifest,
} from "../providers/task-feed/warden/warden-task-config.js";

const trustedPlugins: readonly PluginDefinition<ServerPluginHooks>[] = [];
type ServerPluginRegistry = ReturnType<typeof createPluginRegistry<ServerPluginHooks>>;
let installedPlugins: ServerPluginRegistry | undefined;

export function serverPlugins(): ServerPluginRegistry {
  installedPlugins ??= createPluginRegistry(
    wardenTasksConfigured()
      ? [...trustedPlugins, { manifest: wardenTasksManifest, hooks: {} }]
      : trustedPlugins,
  );
  return installedPlugins;
}

type PluginPreferencesDb = Pick<PrismaClient, "userHostPlugin">;

export async function enabledHostPluginIds(prisma: PluginPreferencesDb, userId: string) {
  const rows = await prisma.userHostPlugin.findMany({
    where: { userId, enabled: true },
    select: { pluginId: true },
  });
  return new Set(rows.map(({ pluginId }) => pluginId));
}

export function createHostPluginSettings(prisma: PluginPreferencesDb, registry = serverPlugins()) {
  return {
    async list(userId: string) {
      if (registry.size === 0) return [];
      return registry.list(await enabledHostPluginIds(prisma, userId));
    },
    async setEnabled(userId: string, { id, enabled }: { id: HostPluginId; enabled: boolean }) {
      const plugin = registry.get(id);
      if (!plugin) throw new ClientError("NOT_FOUND", "Plugin is unavailable");
      await prisma.userHostPlugin.upsert({
        where: { userId_pluginId: { userId, pluginId: id } },
        create: { userId, pluginId: id, enabled },
        update: { enabled },
      });
      const { name, chatCards } = plugin.manifest;
      return { id, name, enabled, ...(chatCards ? { chatCards } : {}) };
    },
  };
}
