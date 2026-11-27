import type { HostPluginId, HostPluginTaskCard } from "@rakazo/contracts";

export type TaskFeedBinding = { key: string; requestedBy: string };

export type TaskFeedResult =
  | { kind: "ready"; tasks: { requestedBy: string; card: HostPluginTaskCard }[] }
  | { kind: "forbidden" | "offline" };

export interface HostTaskFeed {
  readonly pluginId: HostPluginId;
  readonly botIds: readonly string[];
  bindingFor(botId: string): TaskFeedBinding | undefined;
  list(signal?: AbortSignal): Promise<TaskFeedResult>;
}
