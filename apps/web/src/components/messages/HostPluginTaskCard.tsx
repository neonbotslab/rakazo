import { useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import { useExternalLinkOpener } from "@rakazo/chat-ui/web";
import type { HostPluginTaskCard } from "@rakazo/contracts";
import { formatCompactDuration } from "@rakazo/core";
import { Card, CardContent, CardTitle } from "@rakazo/ui-web/components/ui/card";
import { Progress } from "@rakazo/ui-web/components/ui/progress";
import { ArrowUpRight } from "lucide-react";
import type { MouseEvent } from "react";
import { memo } from "react";

const statusDot: Record<HostPluginTaskCard["status"], string> = {
  starting: "bg-muted-foreground",
  running: "bg-success",
  waiting: "bg-warning",
  awaitingApproval: "bg-warning",
  done: "bg-success",
  failed: "bg-destructive",
  lost: "bg-destructive",
};

export const HostPluginTaskCardView = memo(function HostPluginTaskCardView({
  task,
}: {
  task: HostPluginTaskCard;
}) {
  const { t } = useLingui();
  const active = task.status !== "done" && task.status !== "failed" && task.status !== "lost";
  const now = useNow(active ? 1000 : null);
  const end = active ? now : task.endedAt;
  const elapsed =
    end === undefined ? null : formatCompactDuration(Math.max(0, end - task.startedAt));
  const labels = {
    starting: t`Starting`,
    running: t`Running`,
    waiting: t`Waiting`,
    awaitingApproval: t`Awaiting approval`,
    done: t`Done`,
    failed: t`Failed`,
    lost: t`Lost`,
  };
  const { open, dialog } = useExternalLinkOpener();
  const openTask = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    open(task.href);
  };
  return (
    <>
      <a
        href={task.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={openTask}
        onAuxClick={openTask}
        className="group/task block w-96 max-w-full rounded-xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card size="sm" className="group-hover/task:ring-foreground/25">
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <CardTitle className="min-w-0 flex-1 wrap-anywhere" dir="auto">
                {task.title}
              </CardTitle>
              <span className="flex items-center gap-1.5 whitespace-nowrap text-body-sm text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${statusDot[task.status]}`}
                />
                {labels[task.status]}
                <ArrowUpRight aria-hidden="true" size={13} />
              </span>
            </div>
            {task.box || task.model || elapsed ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
                {task.box ? (
                  <span className="wrap-anywhere" dir="auto">
                    {task.box}
                  </span>
                ) : null}
                {task.model ? (
                  <span className="wrap-anywhere" dir="auto">
                    {task.model}
                  </span>
                ) : null}
                {elapsed ? <span dir="auto">{elapsed}</span> : null}
              </div>
            ) : null}
            {task.status === "running" ? (
              <Progress
                aria-label={t`Task progress`}
                value={task.progress === undefined ? null : task.progress * 100}
                className={`[&_[data-slot=progress-track]]:bg-border ${task.progress === undefined ? "motion-safe:animate-pulse" : ""}`}
              />
            ) : null}
          </CardContent>
        </Card>
      </a>
      {dialog}
    </>
  );
});
