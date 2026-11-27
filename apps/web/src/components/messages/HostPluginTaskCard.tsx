import { useLingui } from "@lingui/react/macro";
import { useNow } from "@rakazo/chat-ui/hooks";
import { useExternalLinkOpener } from "@rakazo/chat-ui/web";
import { formatCompactDuration } from "@rakazo/core";
import { cn } from "@rakazo/ui-web";
import { Card, CardContent, CardTitle } from "@rakazo/ui-web/components/ui/card";
import { Progress } from "@rakazo/ui-web/components/ui/progress";
import { ArrowUpRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { memo } from "react";
import type { ActiveTaskCard } from "../../lib/plugin-host/active-task-cards";

const statusDot: Record<ActiveTaskCard["status"], string> = {
  starting: "bg-muted-foreground",
  running: "bg-success",
  waiting: "bg-warning",
  awaitingApproval: "bg-warning",
};

export const HostPluginTaskCardView = memo(function HostPluginTaskCardView({
  task,
  children,
}: {
  task: ActiveTaskCard;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const elapsed = formatCompactDuration(Math.max(0, useNow(1000) - task.startedAt));
  const needsApproval = task.status === "awaitingApproval";
  const labels = {
    starting: t`Starting`,
    running: t`Running`,
    waiting: t`Waiting`,
    awaitingApproval: t`Awaiting approval`,
  };
  const { open, dialog } = useExternalLinkOpener();
  const openTask = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    open(task.href);
  };
  return (
    <>
      <Card
        size="sm"
        className={cn(
          "max-h-[min(7.5rem,25dvh)] max-w-xl flex-row items-start gap-0 overflow-y-auto py-0",
          needsApproval && "ring-warning/40",
        )}
      >
        <a
          href={task.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openTask}
          onAuxClick={openTask}
          className="group/task block min-w-0 flex-1 rounded-xl py-2 no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <CardContent className="flex flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <CardTitle
                className="truncate group-hover/task:underline"
                dir="auto"
                title={task.title}
              >
                {task.title}
              </CardTitle>
              <ArrowUpRight
                aria-hidden="true"
                size={13}
                className="shrink-0 text-muted-foreground"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 text-body-sm text-muted-foreground">
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${statusDot[task.status]}`}
                />
                {labels[task.status]}
              </span>
              <span className="shrink-0" dir="auto">
                {elapsed}
              </span>
              {task.box ? (
                <span className="truncate" dir="auto">
                  {task.box}
                </span>
              ) : null}
              {task.model ? (
                <span className="truncate" dir="auto">
                  {task.model}
                </span>
              ) : null}
            </div>
            {task.status === "running" ? (
              <Progress
                aria-label={t`Task progress`}
                value={task.progress === undefined ? null : task.progress * 100}
                className={`[&_[data-slot=progress-track]]:bg-border ${task.progress === undefined ? "motion-safe:animate-pulse" : ""}`}
              />
            ) : null}
          </CardContent>
        </a>
        {children}
      </Card>
      {dialog}
    </>
  );
});
