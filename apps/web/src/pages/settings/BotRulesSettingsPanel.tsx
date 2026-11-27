import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { OWNER_RULES_MAX_LENGTH } from "@rakazo/contracts";
import { estimateTextTokens, renderOwnerRules } from "@rakazo/core";
import {
  Button,
  Disclosure,
  Field,
  FieldGroup,
  FieldLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Textarea,
} from "@rakazo/ui-web";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useId, useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query/query";
import { errorText } from "../../lib/query/user-error";

type RulesChange = { kind: "save"; text: string } | { kind: "restore"; versionId: number };

export function BotRulesSettingsPanel() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const options = queries.ownerRules.list.infiniteOptions({
    input: (before: number | undefined) => ({ before }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    refetchOnWindowFocus: true,
  });
  const rules = useInfiniteQuery(options);
  const versions = rules.data?.pages.flatMap((page) => page.versions) ?? [];
  const savedText = versions[0]?.text ?? "";
  const text = draft ?? savedText;
  const changed = text !== savedText;
  const preview = renderOwnerRules(text);
  const tokens = preview === undefined ? 0 : estimateTextTokens(preview);
  const formatNumber = new Intl.NumberFormat(i18n.locale || "en");
  const change = useSave({
    save: (input: RulesChange, rpc) =>
      input.kind === "save"
        ? rpc.ownerRules.save({ text: input.text })
        : rpc.ownerRules.restore({ versionId: input.versionId }),
    stale: [options.queryKey],
    onSaved: (version) => {
      queryClient.setQueryData<typeof rules.data>(options.queryKey, (data) => {
        const first = data?.pages[0];
        if (!data || !first || (first.versions[0]?.id ?? 0) >= version.id) return data;
        return {
          ...data,
          pages: [{ ...first, versions: [version, ...first.versions] }, ...data.pages.slice(1)],
        };
      });
      setDraft(null);
    },
  });

  if (rules.isPending) return <Spinner aria-label={t`Loading…`} />;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (rules.data && changed) change.run({ kind: "save", text });
      }}
    >
      {rules.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-body text-destructive">
            {errorText(rules.error, t`Could not load bot rules.`)}
          </p>
          <Button type="button" variant="outline" onClick={() => void rules.refetch()}>
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : null}
      {rules.data ? (
        <>
          <FieldGroup>
            <Field>
              <div className="flex min-h-7 items-center justify-between">
                <FieldLabel htmlFor={`${id}-rules`}>
                  <Trans>Rules</Trans>
                </FieldLabel>
                {versions.length > 0 ? (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t`Version history`}
                          title={t`Version history`}
                        />
                      }
                    >
                      <History aria-hidden="true" className="text-muted-foreground" />
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      aria-label={t`Version history`}
                      className="max-h-96 overflow-y-auto"
                    >
                      <ul className="divide-y divide-border">
                        {versions.map((version) => (
                          <li key={version.id} className="py-2 first:pt-0 last:pb-0">
                            <Disclosure
                              summary={
                                <time dateTime={version.createdAt}>
                                  {new Date(version.createdAt).toLocaleString(i18n.locale || "en")}
                                </time>
                              }
                              contentClassName="mt-2 space-y-2"
                            >
                              {version.text ? (
                                <pre className="whitespace-pre-wrap wrap-anywhere text-body">
                                  {version.text}
                                </pre>
                              ) : (
                                <p className="text-body text-muted-foreground">
                                  <Trans>Empty rules</Trans>
                                </p>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                disabled={change.pending}
                                onClick={() =>
                                  change.run({ kind: "restore", versionId: version.id })
                                }
                              >
                                <Trans>Restore</Trans>
                              </Button>
                            </Disclosure>
                          </li>
                        ))}
                      </ul>
                      {rules.hasNextPage ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={rules.isFetchingNextPage}
                          onClick={() => void rules.fetchNextPage()}
                        >
                          <Trans>Load more</Trans>
                        </Button>
                      ) : null}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
              <Textarea
                id={`${id}-rules`}
                aria-describedby={`${id}-count`}
                className="min-h-32 max-h-96"
                maxLength={OWNER_RULES_MAX_LENGTH}
                value={text}
                disabled={change.pending}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft(value === savedText ? null : value);
                  change.reset();
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  id={`${id}-count`}
                  className="flex flex-wrap gap-x-3 text-body-sm tabular-nums text-muted-foreground"
                >
                  <span>
                    <Trans>
                      {formatNumber.format(text.length)} /{" "}
                      {formatNumber.format(OWNER_RULES_MAX_LENGTH)} characters
                    </Trans>
                  </span>
                  <span>
                    <Plural value={tokens} one="≈# token" other="≈# tokens" />
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!changed || change.pending}
                    onClick={() => {
                      setDraft(null);
                      change.reset();
                    }}
                  >
                    <Trans>Discard</Trans>
                  </Button>
                  <Button type="submit" disabled={!changed || change.pending}>
                    <Trans>Save</Trans>
                  </Button>
                </div>
              </div>
            </Field>
          </FieldGroup>
          {change.error ? (
            <p role="alert" className="text-body text-destructive">
              {errorText(change.error)}
            </p>
          ) : null}
          {preview ? (
            <Disclosure
              summary={t`What bots see`}
              summaryClassName="text-body font-medium"
              contentClassName="mt-2"
            >
              <pre
                data-testid="owner-rules-preview"
                className="rounded-lg border border-border p-3 text-body-sm whitespace-pre-wrap wrap-anywhere"
              >
                {preview}
              </pre>
            </Disclosure>
          ) : null}
        </>
      ) : null}
    </form>
  );
}
