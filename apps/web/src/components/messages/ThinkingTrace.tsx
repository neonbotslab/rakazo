import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { ToolCallDetail } from "@rakazo/contracts";
import { cn } from "@rakazo/ui-web";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Clock } from "lucide-react";
import { useId, useState } from "react";
import type { ArtifactTarget } from "../../lib/pages/artifact-open";
import { useSpaceQueries } from "../../lib/query/query";
import { Shimmer } from "../ai/primitives";
import { ToolResult } from "./ToolResult";
import type { TraceCall, TraceEntry } from "./thinking-trace-model";
import {
  callDuration,
  detailFields,
  formatWorkDuration,
  parseDetail,
  readableName,
  traceRows,
} from "./thinking-trace-model";
import { retainedToolResult } from "./tool-result-model";
import "./thinking-trace.css";

type DetailSource = {
  target: ArtifactTarget;
  canInspect?: boolean;
} & ({ runId: string } | { messageId: string });

type Outcome = NonNullable<TraceCall["outcome"]>;
const outcomeLabels = {
  succeeded: msg`Succeeded`,
  failed: msg`Failed`,
  running: msg`Running`,
  stopped: msg`Stopped`,
} satisfies Record<Outcome, unknown>;

const actions = {
  list_calendar_events: [
    msg`Checking calendars`,
    msg`Checked calendar`,
    msg`Couldn't check calendar`,
  ],
  list_calendars: [msg`Finding calendars`, msg`Found calendars`, msg`Couldn't find calendars`],
  create_calendar_event: [
    msg`Scheduling an event`,
    msg`Scheduled an event`,
    msg`Couldn't schedule the event`,
  ],
  web_search: [msg`Searching the web`, msg`Searched the web`, msg`Couldn't search the web`],
  web_fetch: [msg`Opening a page`, msg`Opened a page`, msg`Couldn't open the page`],
  read_file: [msg`Reading a file`, msg`Read a file`, msg`Couldn't read the file`],
  shell: [msg`Running a command`, msg`Ran a command`, msg`Couldn't run the command`],
  service_search: [
    msg`Finding an app action`,
    msg`Found an app action`,
    msg`Couldn't find an app action`,
  ],
  service_call: [msg`Using an app`, msg`Used an app`, msg`Couldn't use the app`],
  ask_user: [msg`Waiting for an answer`, msg`Asked a question`, msg`Couldn't ask the question`],
} as const;
type ActionName = keyof typeof actions;

function personFrom(detail?: ToolCallDetail | null): string | undefined {
  const value = detail?.arguments && parseDetail(detail.arguments);
  if (!value || typeof value !== "object" || !("person" in value)) return undefined;
  const person = value.person;
  return typeof person === "string" && person.length <= 64 && !/\s{2}|[\r\n]/.test(person)
    ? person.split(" ")[0]
    : undefined;
}

function useToolLabel(call: TraceCall, subject?: string) {
  const { i18n, t } = useLingui();
  const { outcome } = call;
  const action = call.name?.toLowerCase().replaceAll(" ", "_");
  const known =
    action && Object.hasOwn(actions, action) ? actions[action as ActionName] : undefined;
  if (action === "list_calendar_events" && subject) {
    if (outcome === "running") return t`Checking ${subject}’s calendar`;
    if (outcome === "failed") return t`Couldn't reach ${subject}’s calendar`;
    if (outcome === "stopped") return t`Stopped checking ${subject}’s calendar`;
    return t`Checked ${subject}’s calendar`;
  }
  const name = readableName(call.label);
  if (outcome === "stopped") return t`Stopped ${name}`;
  if (known) return i18n._(known[outcome === "running" ? 0 : outcome === "failed" ? 2 : 1]);
  if (!call.name) return name;
  const readable = name.toLowerCase();
  if (outcome === "running") return t`Using ${readable}`;
  if (outcome === "failed") return t`Couldn't use ${readable}`;
  return t`Used ${readable}`;
}

const triggerClass =
  "trace-trigger w-full min-w-0 items-center gap-2 rounded-sm text-start hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

export function ThinkingTrace({
  entries,
  durationMs,
  live = false,
  label,
  source,
}: {
  entries: readonly TraceEntry[];
  durationMs?: number;
  live?: boolean;
  label?: string;
  source?: DetailSource;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = entries.at(-1);
  const duration = durationMs === undefined ? undefined : formatWorkDuration(durationMs);
  if (!live && entries.length === 0) return null;

  return (
    <section
      className="thinking-trace text-body-sm text-muted-foreground"
      data-testid="thinking-trace"
    >
      <button
        type="button"
        className={cn(triggerClass, "flex")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className="trace-chevron shrink-0" strokeWidth={1.5} aria-hidden />
        {live ? (
          <Shimmer>
            {current?.kind === "tool" && current.outcome === "running" ? (
              <CurrentTool call={current} />
            ) : (
              (label ?? t`Thinking…`)
            )}
          </Shimmer>
        ) : duration === undefined ? (
          t`Work details`
        ) : (
          t`Worked for ${duration}`
        )}
      </button>
      <ol id={id} className="list-none py-1" data-testid="thinking-trace-rail" hidden={!open}>
        {open
          ? traceRows(entries).map((entry) =>
              entry.kind === "thinking" ? (
                <li
                  key={entry.id}
                  className="trace-node trace-thought flex items-start gap-2 pb-2 last:pb-0"
                >
                  <span className="trace-marker mt-0.5 shrink-0" aria-hidden>
                    <span className="size-2 rounded-full border border-muted-foreground" />
                  </span>
                  <p dir="auto" className="min-w-0 wrap-anywhere whitespace-pre-wrap">
                    {entry.text}
                  </p>
                </li>
              ) : (
                <ToolRow key={entry.id} calls={entry.calls} source={source} />
              ),
            )
          : null}
      </ol>
    </section>
  );
}

function CurrentTool({ call }: { call: TraceCall }) {
  const { t } = useLingui();
  const label = useToolLabel(call);
  return <>{t`${label}…`}</>;
}

function ToolMarker({ outcome }: { outcome?: Outcome }) {
  return (
    <span className="trace-marker" aria-hidden>
      {outcome === "succeeded" ? (
        <Check className="text-success" strokeWidth={1.8} />
      ) : outcome === "running" ? (
        <Clock className="text-warning motion-safe:animate-pulse" strokeWidth={1.6} />
      ) : (
        <span
          className={cn(
            "size-2 rounded-full",
            outcome === "failed" ? "bg-destructive" : "bg-muted-foreground",
          )}
        />
      )}
    </span>
  );
}

function useCallDetail(call: TraceCall, source: DetailSource | undefined, open: boolean) {
  const queries = useSpaceQueries();
  const target = source?.target ?? { botId: "" };
  const live = source && "runId" in source;
  const savedId = source && "messageId" in source ? source.messageId : "";
  const legacy = call.legacy;
  const allowed = source?.canInspect === true && !(live && legacy);
  const enabled = open && allowed;
  const options = live
    ? queries.threads.liveToolCallDetail.queryOptions({
        input: { ...target, runId: source.runId, callId: call.id },
      })
    : queries.threads.toolCallDetail.queryOptions({
        input: legacy
          ? {
              ...target,
              messageId: savedId,
              stepIndex: legacy.stepIndex,
              callIndex: legacy.callIndex,
            }
          : { ...target, messageId: savedId, callId: call.id },
      });
  const { data, isError, isFetching } = useQuery({
    ...options,
    queryKey: live ? [...options.queryKey, call.outcome] : options.queryKey,
    placeholderData: live ? keepPreviousData : undefined,
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  const previewEligible = enabled && Boolean(legacy && legacy.callIndex === legacy.count - 1);
  const { data: previews, isFetching: fetchingPreview } = useQuery({
    ...queries.threads.toolStepPreviews.queryOptions({ input: { ...target, messageId: savedId } }),
    enabled: previewEligible && (data === null || isError),
    staleTime: Infinity,
    retry: false,
  });
  const preview = legacy && previewEligible ? previews?.steps[legacy.stepIndex] : undefined;
  return {
    detail: allowed
      ? (data ?? (preview ? { arguments: preview.input, result: preview.output } : undefined))
      : undefined,
    pending: enabled && (isFetching || fetchingPreview),
    error: enabled && isError && !preview,
  };
}

function ToolRow({ calls, source }: { calls: TraceCall[]; source?: DetailSource }) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const id = useId();
  const first = calls[0]!;
  const single = calls.length === 1;
  const rowSource = single || !first.legacy ? source : undefined;
  const { detail, pending, error } = useCallDetail(first, rowSource, open);
  const outcome = calls.some((call) => call.outcome === "running")
    ? "running"
    : detail?.failed || calls.some((call) => call.outcome === "failed")
      ? "failed"
      : (calls.find((call) => call.outcome === "stopped")?.outcome ?? first.outcome);
  const person = personFrom(detail);
  const label = useToolLabel({ ...first, outcome }, person);
  const sum = calls.every((call) => call.durationMs === undefined)
    ? undefined
    : calls.reduce((total, call) => total + (call.durationMs ?? 0), 0);
  return (
    <li className="trace-node trace-tool-node pb-2 last:pb-0">
      <button
        type="button"
        className={cn(triggerClass, "trace-tool-trigger pe-2")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ToolMarker outcome={outcome} />
        <span
          dir="auto"
          className={cn(
            "min-w-0 truncate",
            outcome === "running" && "text-foreground",
            outcome === "failed" && "text-destructive",
          )}
        >
          {label}
          {single ? null : <span className="whitespace-nowrap"> ×{calls.length}</span>}
        </span>
        <span className="whitespace-nowrap text-label tabular-nums">
          {outcome === "running"
            ? i18n._(outcomeLabels.running)
            : sum === undefined
              ? null
              : callDuration(sum)}
        </span>
        <ChevronRight className="trace-chevron shrink-0" strokeWidth={1.5} aria-hidden />
      </button>
      <div
        id={id}
        hidden={!open}
        className="trace-detail mt-1 min-w-0 rounded-xl bg-muted p-3 text-foreground"
      >
        {open &&
          (single ? (
            <CallDetails call={first} detail={detail} pending={pending} error={error} />
          ) : (
            <ul className="list-none">
              {calls.map((call, index) => (
                <Subcall
                  key={call.id}
                  call={call}
                  number={index + 1}
                  source={source}
                  groupPerson={person}
                />
              ))}
            </ul>
          ))}
      </div>
    </li>
  );
}

function Subcall({
  call,
  number,
  source,
  groupPerson,
}: {
  call: TraceCall;
  number: number;
  source?: DetailSource;
  groupPerson?: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const id = useId();
  const labelId = `${id}-label`;
  const { detail, pending, error } = useCallDetail(call, source, open);
  const person = personFrom(detail) || groupPerson;
  const label = t`Call ${number}`;
  return (
    <li className="border-border [&+li]:border-t">
      <button
        type="button"
        className={cn(triggerClass, "trace-sub-trigger hover:bg-background/55")}
        aria-expanded={open}
        aria-controls={id}
        aria-labelledby={labelId}
        onClick={() => setOpen(!open)}
      >
        <span id={labelId} dir="auto" className="min-w-0 wrap-anywhere">
          {person ? (
            <>
              {person}
              <span className="text-muted-foreground"> · {label}</span>
            </>
          ) : (
            label
          )}
        </span>
        <span className="text-label text-muted-foreground tabular-nums">
          {call.durationMs === undefined ? null : callDuration(call.durationMs)}
        </span>
        <ChevronRight className="trace-chevron shrink-0" strokeWidth={1.5} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="pb-3">
        {open ? <CallDetails call={call} detail={detail} pending={pending} error={error} /> : null}
      </div>
    </li>
  );
}

function CallDetails({
  call,
  detail,
  pending,
  error,
}: {
  call: TraceCall;
  detail?: ToolCallDetail | null;
  pending: boolean;
  error: boolean;
}) {
  const { i18n, t } = useLingui();
  const outcome = detail?.failed ? "failed" : call.outcome;
  const duration = call.durationMs === undefined ? undefined : callDuration(call.durationMs);
  const { text: result, image } = retainedToolResult(detail?.result, detail?.hasScreenshot);
  const args = detail?.arguments ? detailFields(detail.arguments) : [];
  const empty = pending
    ? t`Loading details…`
    : error
      ? t`Details couldn’t be loaded.`
      : t`No details kept`;
  return (
    <div className="grid min-w-0 gap-3 wrap-anywhere">
      <section className="grid gap-1">
        <h3 className="text-label font-semibold text-muted-foreground">{t`Asked`}</h3>
        {args.length ? (
          <DetailFields rows={args} />
        ) : (
          <p className="text-muted-foreground">{empty}</p>
        )}
      </section>
      <section className="grid gap-1">
        <h3 className="text-label font-semibold text-muted-foreground">
          {outcome === "failed" ? t`What went wrong` : t`Got back`}
        </h3>
        {outcome === "failed" ? (
          <>
            <p>
              {result && /\b(?:timeout|timed out)\b/i.test(result)
                ? t`The request took too long.`
                : t`The tool couldn’t complete the request.`}
            </p>
            {result ? (
              <p
                dir="auto"
                className="whitespace-pre-wrap font-mono text-label text-muted-foreground"
              >
                {result}
              </p>
            ) : null}
          </>
        ) : outcome === "running" && !result && !image ? (
          <p className="text-muted-foreground">{t`Waiting for the result…`}</p>
        ) : result ? (
          <ToolResult text={result} />
        ) : (
          !image && <p className="text-muted-foreground">{empty}</p>
        )}
        {image ? (
          <p>{image === "screenshot" ? t`Took a screenshot (not shown)` : t`Image not shown`}</p>
        ) : null}
      </section>
      {duration || outcome ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border border-t pt-2 text-label text-muted-foreground">
          {duration ? <span className="whitespace-nowrap">{t`Took ${duration}`}</span> : null}
          {outcome ? (
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  outcome === "succeeded" && "bg-success",
                  outcome === "running" && "bg-warning",
                  outcome === "failed" && "bg-destructive",
                  outcome === "stopped" && "bg-muted-foreground",
                )}
              />
              {i18n._(outcomeLabels[outcome])}
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

function DetailFields({ rows }: { rows: ReturnType<typeof detailFields> }) {
  const { t } = useLingui();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 6);
  return (
    <>
      {visible.some((row) => row.label !== undefined) ? (
        <dl className="grid gap-2">
          {visible.map(({ label, value }, index) => (
            <div className="trace-field gap-x-3" key={`${index}:${label}`}>
              <dt className="text-muted-foreground" dir="auto">
                {label}
              </dt>
              <dd className="min-w-0 whitespace-pre-wrap" dir="auto">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="grid gap-1">
          {visible.map(({ value }, index) => (
            <p dir="auto" className="min-h-4 whitespace-pre-wrap" key={`${index}:${value}`}>
              {value}
            </p>
          ))}
        </div>
      )}
      {rows.length > 6 ? (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
          className="w-fit rounded-sm py-1 text-label text-muted-foreground underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {showAll ? t`Show less` : t`Show all`}
        </button>
      ) : null}
    </>
  );
}
