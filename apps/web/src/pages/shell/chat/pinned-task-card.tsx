import { useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { HostPluginTaskCardView } from "../../../components/messages/HostPluginTaskCard";
import { TRANSCRIPT_CONTENT_PADDING } from "../../../lib/chat/transcript-layout";
import type { ActiveTaskCard } from "../../../lib/plugin-host/active-task-cards";

export function PinnedTaskCard({ tasks }: { tasks: readonly ActiveTaskCard[] }) {
  const { t } = useLingui();
  const [selection, setSelection] = useState<{ id: string; index: number } | null>(null);
  const match = tasks.findIndex((task) => task.id === selection?.id);
  const count = tasks.length;
  const index = match < 0 ? Math.min(selection?.index ?? 0, count - 1) : match;
  const task = tasks[index];
  if (!task) return null;

  if (selection?.id !== task.id || selection.index !== index) {
    setSelection({ id: task.id, index });
  }
  const select = (nextIndex: number) => {
    const nextTask = tasks[nextIndex];
    if (nextTask) setSelection({ id: nextTask.id, index: nextIndex });
  };
  const page = index + 1;

  return (
    <div
      data-pinned-task
      className={`pointer-events-auto min-w-0 pb-3 ${TRANSCRIPT_CONTENT_PADDING}`}
    >
      <HostPluginTaskCardView task={task}>
        {count > 1 ? (
          <div className="flex shrink-0 items-center gap-1 self-center pe-2 text-label text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Previous task`}
              disabled={index === 0}
              focusableWhenDisabled
              className="aria-disabled:opacity-50"
              onClick={() => select(index - 1)}
            >
              <ChevronLeft aria-hidden="true" className="rtl:rotate-180" />
            </Button>
            <span role="status" className="whitespace-nowrap tabular-nums">
              {t`${page} of ${count}`}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Next task`}
              disabled={page === count}
              focusableWhenDisabled
              className="aria-disabled:opacity-50"
              onClick={() => select(index + 1)}
            >
              <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
            </Button>
          </div>
        ) : null}
      </HostPluginTaskCardView>
    </div>
  );
}
