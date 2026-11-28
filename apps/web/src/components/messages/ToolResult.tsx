import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { CopyTextFallback, cn } from "@rakazo/ui-web";
import { ChevronRight } from "lucide-react";
import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCopyText } from "../../lib/copy-text";
import { useEventListener } from "../../lib/use-event-listener";
import type { ResultValue } from "./tool-result-model";
import { parseToolResult } from "./tool-result-model";

type ResultGroupValue = Extract<ResultValue, { kind: "object" | "array" }>;
type ResultScalar = Extract<ResultValue, { kind: "scalar" }>["value"];

const controlClass =
  "trace-result-control w-fit rounded-sm text-label text-link hover:bg-accent active:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

export function ToolResult({ text, raw }: { text: string; raw: boolean }) {
  const result = useMemo(() => parseToolResult(text), [text]);
  return (
    <>
      <div className="min-w-0" hidden={raw}>
        <ResultLevel value={result} />
      </div>
      {raw ? (
        <pre
          dir="auto"
          className="trace-result-raw rounded-sm bg-dialog whitespace-pre-wrap font-mono text-label"
        >
          {text}
        </pre>
      ) : null}
    </>
  );
}

export function ToolResultControls({
  text,
  raw,
  onRawChange,
}: {
  text: string;
  raw: boolean;
  onRawChange: (raw: boolean) => void;
}) {
  const { t } = useLingui();
  const [copied, copy, copyFailed, resetCopy, copyFailedText] = useCopyText();

  return (
    <>
      <button
        type="button"
        className={controlClass}
        onClick={() => {
          resetCopy();
          onRawChange(!raw);
        }}
      >
        {raw ? t`Show fields` : t`Show raw`}
      </button>
      {raw ? (
        <>
          <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-current" />
          <button type="button" className={controlClass} onClick={() => copy(text)}>
            {copied ? t`Copied` : t`Copy`}
          </button>
        </>
      ) : null}
      {raw && copyFailed ? (
        <CopyTextFallback
          open
          onOpenChange={(open) => {
            if (!open) resetCopy();
          }}
          text={copyFailedText}
          label={t`Copy text`}
        />
      ) : null}
    </>
  );
}

function ResultLevel({ value }: { value: ResultValue }) {
  switch (value.kind) {
    case "scalar":
      return <ScalarValue value={value.value} />;
    case "inline-list":
      return (
        <p dir="auto">
          {value.items.map((item, index) => (
            <Fragment key={index}>
              {index ? ", " : null}
              <InlineScalar value={item} />
            </Fragment>
          ))}
        </p>
      );
    case "object":
    case "array": {
      const rows =
        value.kind === "object"
          ? value.fields
          : value.items.map((item, index) => ({
              key: String(index),
              label: String(index + 1),
              value: item,
            }));
      if (rows.length === 0) return <EmptyGroup value={value} />;
      return (
        <dl className="grid gap-1">
          {rows.map((row) => (
            <ResultField key={row.key} label={row.label} value={row.value} />
          ))}
        </dl>
      );
    }
  }
}

function ResultField({ label, value }: { label: string; value: ResultValue }) {
  if (value.kind === "object" || value.kind === "array") {
    const count = value.kind === "object" ? value.fields.length : value.items.length;
    if (count) return <ResultGroup label={label} value={value} />;
  }
  return (
    <div className="trace-field gap-x-3">
      <dt className="text-muted-foreground" dir="auto">
        {label}
      </dt>
      <dd className="min-w-0">
        <ResultLevel value={value} />
      </dd>
    </div>
  );
}

function useGroupCount(value: ResultGroupValue) {
  const { t } = useLingui();
  if (value.kind === "object") {
    const count = value.fields.length;
    return t`${plural(count, { one: "# field", other: "# fields" })}`;
  }
  const count = value.items.length;
  return t`${plural(count, { one: "# item", other: "# items" })}`;
}

function EmptyGroup({ value }: { value: ResultGroupValue }) {
  return <p className="text-muted-foreground">{useGroupCount(value)}</p>;
}

function ResultGroup({ label, value }: { label: string; value: ResultGroupValue }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const labelId = `${id}-label`;
  const countId = `${id}-count`;
  const count = useGroupCount(value);

  return (
    <div className="trace-field gap-x-3">
      <dt id={labelId} dir="auto" className="self-center text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">
        <button
          type="button"
          className={cn(controlClass, "trace-trigger trace-result-group -ms-1 flex items-center")}
          aria-labelledby={`${labelId} ${countId}`}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <span id={countId}>{count}</span>
          <ChevronRight className="trace-chevron shrink-0" strokeWidth={1.5} aria-hidden />
        </button>
      </dd>
      <dd className="trace-result-children col-span-full" id={id} hidden={!open}>
        {open ? <ResultLevel value={value} /> : null}
      </dd>
    </div>
  );
}

function InlineScalar({ value }: { value: ResultScalar }) {
  const { t } = useLingui();
  if (value === null) return <span className="text-muted-foreground">{t`None`}</span>;
  if (typeof value === "boolean") return value ? t`Yes` : t`No`;
  return value;
}

function ScalarValue({ value }: { value: ResultScalar }) {
  if (typeof value === "string") return <ResultText text={value} />;
  return (
    <p dir="auto">
      <InlineScalar value={value} />
    </p>
  );
}

function ResultText({ text }: { text: string }) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const measure = useCallback(() => {
    const node = ref.current;
    if (!expanded && node?.clientHeight) setOverflow(node.scrollHeight > node.clientHeight);
  }, [expanded]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || expanded) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, measure, text]);
  useEventListener(typeof document === "undefined" ? null : document.fonts, "loadingdone", measure);

  return (
    <>
      <p
        ref={ref}
        id={id}
        dir="auto"
        className={cn("whitespace-pre-wrap", !expanded && "trace-result-clamp")}
      >
        {text}
      </p>
      {expanded || overflow ? (
        <button
          type="button"
          className={controlClass}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t`Show less` : t`Show more`}
        </button>
      ) : null}
    </>
  );
}
