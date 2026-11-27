import { useLingui } from "@lingui/react/macro";
import type { ReplyReasoning } from "@rakazo/contracts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@rakazo/ui-web";
import { ChevronRight } from "lucide-react";

function formatReasoningDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const pad = (part: number) => String(part).padStart(2, "0");
  if (hours) return `${hours}h${pad(minutes)}m${pad(seconds % 60)}s`;
  if (minutes) return `${minutes}m${pad(seconds % 60)}s`;
  return `${seconds}s`;
}

export function ReasoningDisclosure({ reasoning }: { reasoning: ReplyReasoning }) {
  const { t } = useLingui();
  if (!reasoning.text.trim()) return null;
  const duration = formatReasoningDuration(reasoning.durationMs);
  return (
    <Collapsible className="mt-1 min-w-0 text-muted-foreground">
      <CollapsibleTrigger className="group/reasoning inline-flex items-center gap-1 rounded-sm py-1 text-body-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight className="size-3.5 group-data-panel-open/reasoning:rotate-90" aria-hidden />
        {t`Thought for ${duration}`}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p
          dir="auto"
          className="mt-1 max-w-prose wrap-anywhere whitespace-pre-wrap pb-1 text-body-sm"
        >
          {reasoning.text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
