import type { HostPluginTaskCard } from "@rakazo/contracts";

export type ActiveTaskCard = HostPluginTaskCard & {
  status: "starting" | "running" | "waiting" | "awaitingApproval";
};

function isActiveTask(task: HostPluginTaskCard): task is ActiveTaskCard {
  return (
    task.status === "starting" ||
    task.status === "running" ||
    task.status === "waiting" ||
    task.status === "awaitingApproval"
  );
}

export function activeTaskCards(tasks: readonly HostPluginTaskCard[]) {
  return tasks
    .filter(isActiveTask)
    .sort(
      (a, b) =>
        Number(b.status === "awaitingApproval") - Number(a.status === "awaitingApproval") ||
        b.startedAt - a.startedAt ||
        a.id.localeCompare(b.id),
    );
}
