import type { WebPluginHooks } from "@rakazo/core/plugin-host";
import { createPluginRegistry } from "@rakazo/core/plugin-host";

export const webPlugins = createPluginRegistry<WebPluginHooks>([]);
