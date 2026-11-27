import type { HostPluginTaskCard, ThreadMessage } from "@rakazo/contracts";
import type { ThreadItem } from "@rakazo/core";

type TaskRow = { kind: "hostPluginTask"; task: HostPluginTaskCard };

/** Add task starts to the loaded window without changing the order of chat rows. */
export function joinTranscriptTasks(
  items: ThreadItem<ThreadMessage>[],
  tasks: readonly HostPluginTaskCard[],
  loadedSince: string | undefined,
) {
  if (tasks.length === 0) return items;
  const earliest = loadedSince ? Date.parse(loadedSince) : Number.NEGATIVE_INFINITY;
  const deduped = new Map(tasks.map((task) => [task.id, task]));
  const pending = [...deduped.values()]
    .filter((task) => task.startedAt >= earliest)
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const rows: (ThreadItem<ThreadMessage> | TaskRow)[] = [];
  let index = 0;
  for (const item of items) {
    const head = item.kind === "message" ? item.message : item.messages[0];
    const startsAt = Date.parse(head?.createdAt ?? "");
    while (pending[index] && pending[index]!.startedAt < startsAt) {
      rows.push({ kind: "hostPluginTask", task: pending[index++]! });
    }
    rows.push(item);
  }
  for (const task of pending.slice(index)) rows.push({ kind: "hostPluginTask", task });
  return rows;
}
