import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { OwnerRulesVersion } from "@rakazo/contracts";
import { OWNER_RULES_MAX_LENGTH, ownerRulesLength } from "@rakazo/contracts";
import { renderOwnerRules } from "@rakazo/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Disclosure,
  Field,
  FieldGroup,
  FieldLabel,
  Spinner,
  Textarea,
} from "@rakazo/ui-web";
import { Check, ChevronRight, CircleAlert, Code, History } from "lucide-react";
import type { Ref } from "react";
import { useId, useImperativeHandle, useRef, useState } from "react";
import { SETTINGS_CONTENT_WIDTH } from "../../components/settings/SettingsRows";
import { errorText } from "../../lib/query/user-error";
import { useEventListener } from "../../lib/use-event-listener";
import { useOwnerRulesEditor } from "./use-owner-rules-editor";

export type BotRulesNavigation = {
  leave: (next: () => void) => void;
  closeHistory: () => boolean;
};

export function BotRulesSettingsPanel({
  navigation,
  timezone,
}: {
  navigation: Ref<BotRulesNavigation>;
  timezone: string | null;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const editor = useOwnerRulesEditor();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyArea = useRef<HTMLDivElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const preview = renderOwnerRules(editor.text);
  const tokens = preview ? Math.ceil(ownerRulesLength(preview) / 4) : 0;
  const formatNumber = new Intl.NumberFormat(i18n.locale || "en");
  const count = formatNumber.format(editor.count);
  const limit = formatNumber.format(OWNER_RULES_MAX_LENGTH);
  const excess = formatNumber.format(editor.count - OWNER_RULES_MAX_LENGTH);

  function closeHistory() {
    if (!historyOpen) return false;
    setHistoryOpen(false);
    historyButton.current?.focus();
    return true;
  }

  useImperativeHandle(navigation, () => ({ leave: editor.leave, closeHistory }));
  useEventListener(historyOpen ? document : null, "click", (event) => {
    if (event.target instanceof Node && !historyArea.current?.contains(event.target))
      closeHistory();
  });

  if (editor.rules.isPending) return <Spinner aria-label={t`Loading`} />;

  if (!editor.rules.data) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-body text-destructive">
          {errorText(editor.rules.error, t`Could not load bot rules.`)}
        </p>
        <Button
          size="xl"
          variant="ghost"
          className="text-body"
          onClick={() => void editor.rules.refetch()}
        >
          <Trans>Try again</Trans>
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex min-h-full flex-col gap-3 ${SETTINGS_CONTENT_WIDTH}`}>
      <FieldGroup>
        <Field className="gap-0">
          <div ref={historyArea}>
            <div className="flex min-h-12 items-center justify-between">
              <FieldLabel className="text-label" htmlFor={`${id}-rules`}>
                <Trans>Your rules</Trans>
              </FieldLabel>
              {editor.versions.length > 0 ? (
                <Button
                  ref={historyButton}
                  variant="ghost"
                  size="icon-xl"
                  aria-label={t`Version history`}
                  title={t`Version history`}
                  aria-expanded={historyOpen}
                  aria-controls={`${id}-history`}
                  onClick={() => {
                    if (!closeHistory()) setHistoryOpen(true);
                  }}
                >
                  <History aria-hidden="true" className="text-muted-foreground" />
                </Button>
              ) : null}
            </div>
            <div id={`${id}-history`} hidden={!historyOpen}>
              {historyOpen ? (
                <VersionHistory
                  versions={editor.versions}
                  timezone={timezone}
                  canRestore={!editor.conflict && !editor.pending}
                  restore={(versionId) => {
                    editor.restore(versionId);
                    closeHistory();
                  }}
                  loadMore={
                    editor.rules.hasNextPage ? () => void editor.rules.fetchNextPage() : undefined
                  }
                  loadingMore={editor.rules.isFetchingNextPage}
                />
              ) : null}
            </div>
          </div>
          <Textarea
            ref={textarea}
            id={`${id}-rules`}
            aria-describedby={`${id}-count`}
            aria-invalid={editor.overLimit || undefined}
            className="min-h-32 resize-none"
            placeholder={t`One rule per line.`}
            value={editor.text}
            readOnly={editor.readOnly}
            onBlur={editor.saveDraft}
            onChange={(event) => editor.edit(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <div
        data-testid="owner-rules-footer"
        className="max-md:sticky max-md:bottom-0 max-md:z-10 max-md:order-last max-md:-mx-6 max-md:mt-auto max-md:border-t max-md:border-border max-md:bg-dialog max-md:px-6 max-md:pt-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted-foreground">
          <p
            id={`${id}-count`}
            className={editor.overLimit ? "tabular-nums text-destructive" : "tabular-nums"}
          >
            {editor.overLimit ? (
              <Trans>
                {count} / {limit} characters, {excess} over
              </Trans>
            ) : (
              <>
                <Trans>
                  {count} / {limit} characters
                </Trans>
                {tokens > 0 ? (
                  <>
                    <span aria-hidden="true"> &#183; </span>
                    <span>
                      <Plural value={tokens} one="about # token" other="about # tokens" />
                    </span>
                  </>
                ) : null}
              </>
            )}
          </p>
          <span role="status">
            {editor.status === "saving" ? <Trans>Saving…</Trans> : null}
            {editor.status === "not-saved" ? (
              <span className="inline-flex items-center gap-1.5 align-middle">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
                <Trans>Not saved</Trans>
              </span>
            ) : null}
            {editor.status === "saved" ? (
              <span
                key={`${editor.saved?.id}-${editor.saved?.revision}`}
                className="inline-flex items-center gap-1 align-middle motion-safe:animate-out motion-safe:fade-out-0 motion-safe:duration-150 motion-safe:fill-mode-forwards motion-safe:[animation-delay:1650ms]"
              >
                <Check aria-hidden="true" className="size-3.5" />
                <Trans>Saved</Trans>
              </span>
            ) : null}
          </span>
        </div>
        {editor.error ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 rounded-lg bg-destructive/10 ps-3 pe-1 text-body text-destructive">
            <p role="alert" className="flex min-w-0 flex-1 items-center gap-2 py-2">
              <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
              {editor.conflict ? (
                <Trans>These rules changed in another window.</Trans>
              ) : (
                <Trans>Couldn't save. Your text is still here.</Trans>
              )}
            </p>
            {editor.conflict ? (
              <Button
                size="xl"
                variant="ghost"
                className="text-body"
                disabled={editor.rules.isFetching}
                onClick={() => void editor.reload()}
              >
                <Trans>Reload</Trans>
              </Button>
            ) : (
              <Button
                size="xl"
                variant="ghost"
                className="text-body"
                disabled={editor.overLimit || editor.pending}
                onClick={editor.retry}
              >
                <Trans>Try again</Trans>
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <Disclosure
        summary={
          <>
            <Code aria-hidden="true" className="size-4 text-muted-foreground" />
            <Trans>What bots see</Trans>
          </>
        }
        summaryClassName="min-h-12 text-body font-medium hover:bg-muted/50 active:bg-muted"
        contentClassName="mt-1"
      >
        {preview ? (
          <pre
            data-testid="owner-rules-preview"
            className="whitespace-pre-wrap wrap-anywhere rounded-lg border border-border bg-muted/50 p-3 text-label"
          >
            {preview}
          </pre>
        ) : (
          <p className="text-body text-muted-foreground">
            <Trans>Bots get nothing while this is empty.</Trans>
          </p>
        )}
      </Disclosure>
      <AlertDialog
        open={editor.confirmingDeparture}
        onOpenChange={(open) => {
          if (!open) editor.keepEditing();
        }}
      >
        <AlertDialogContent initialFocus={keepEditingButton} finalFocus={textarea}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Discard unsaved changes?</Trans>
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              ref={keepEditingButton}
              variant="ghost"
              size="xl"
              className="text-body"
            >
              <Trans>Keep editing</Trans>
            </AlertDialogCancel>
            <AlertDialogAction size="xl" className="text-body" onClick={editor.discardAndLeave}>
              <Trans>Discard</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function VersionHistory({
  versions,
  timezone,
  canRestore,
  restore,
  loadMore,
  loadingMore,
}: {
  versions: OwnerRulesVersion[];
  timezone: string | null;
  canRestore: boolean;
  restore: (id: number) => void;
  loadMore?: () => void;
  loadingMore: boolean;
}) {
  const { i18n } = useLingui();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const dateFormat = new Intl.DateTimeFormat(i18n.locale || "en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone ?? undefined,
  });
  return (
    <div className="mb-3 rounded-lg border border-border p-1">
      <ul className="divide-y divide-border">
        {versions.map((version) => (
          <li key={version.id}>
            <Collapsible
              className="group/version"
              open={expandedId === version.id}
              onOpenChange={(open) => setExpandedId(open ? version.id : null)}
            >
              <CollapsibleTrigger
                render={<Button variant="ghost" size="xl" />}
                className="w-full justify-start gap-2 px-2 text-body hover:bg-muted/50"
              >
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground transition-transform duration-150 group-data-open/version:rotate-90 motion-reduce:transition-none rtl:-rotate-180 rtl:group-data-open/version:-rotate-270"
                />
                <time className="min-w-0 truncate" dateTime={version.createdAt}>
                  {dateFormat.format(new Date(version.createdAt))}
                </time>
                <span className="ms-auto text-label text-muted-foreground">
                  {version.reason === "restored" ? <Trans>Restored</Trans> : <Trans>Saved</Trans>}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 px-3 pb-3">
                  {version.text ? (
                    <p className="whitespace-pre-wrap wrap-anywhere text-body">{version.text}</p>
                  ) : (
                    <p className="text-body text-muted-foreground">
                      <Trans>Empty rules</Trans>
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    size="xl"
                    className="text-body"
                    disabled={!canRestore}
                    onClick={() => restore(version.id)}
                  >
                    <Trans>Restore</Trans>
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
      {loadMore ? (
        <Button
          variant="ghost"
          size="xl"
          className="text-body"
          disabled={loadingMore}
          onClick={loadMore}
        >
          <Trans>Load more</Trans>
        </Button>
      ) : null}
    </div>
  );
}
