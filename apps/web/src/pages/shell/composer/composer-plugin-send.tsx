import { useLingui } from "@lingui/react/macro";
import type { ComposerMentionBinding } from "@rakazo/core";
import {
  composerMentionsForPrompt,
  serializeComposerPrompt,
  updateComposerMentionBindings,
} from "@rakazo/core";
import type { PluginComposerDraft } from "@rakazo/core/plugin-host";
import { Button } from "@rakazo/ui-web";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  beginComposerDraftSubmission,
  writeComposerDraft,
} from "../../../lib/composer/composer-draft";
import type { ComposerPluginStep } from "../../../lib/plugin-host/composer-policy";
import { runComposerPluginHooks } from "../../../lib/plugin-host/composer-policy";
import { useEnabledWebPlugins } from "../../../lib/plugin-host/web-plugins";

type SendDraft = (text: string) => Promise<void>;
type Attempt = {
  scope: readonly unknown[];
  send: SendDraft;
  resume?: () => Promise<ComposerPluginStep>;
};

export function beginComposerSend(
  draftKey: string,
  original: { text: string; bindings: ComposerMentionBinding[] },
  rewritten: string,
  skill: { name: string } | null,
) {
  const submitted =
    rewritten === original.text
      ? original
      : {
          text: rewritten,
          bindings: updateComposerMentionBindings(original.text, rewritten, original.bindings),
        };
  // A retry recovered without its answer must use the submitted text and bindings with its nonce.
  if (submitted !== original)
    writeComposerDraft(draftKey, submitted.text, undefined, submitted.bindings);
  return {
    submitted,
    text: serializeComposerPrompt(submitted.text, skill),
    mentions: composerMentionsForPrompt(submitted.text, skill, submitted.bindings),
    submission: beginComposerDraftSubmission(draftKey, submitted.text),
  };
}

/** One review or held send for the current draft. Editing invalidates its continuation. */
export function useComposerPluginSend(identity: readonly unknown[]) {
  const plugins = useEnabledWebPlugins();
  const scope = [plugins, ...identity];
  const attempt = useRef<Attempt | null>(null);
  const [phase, setPhase] = useState<"idle" | "checking" | "held" | "failed">("idle");

  function cancel() {
    attempt.current = null;
    setPhase("idle");
  }

  useLayoutEffect(() => {
    const current = attempt.current;
    if (
      current &&
      (current.scope.length !== scope.length ||
        current.scope.some((value, i) => !Object.is(value, scope[i])))
    )
      cancel();
    if (!current && (phase === "checking" || phase === "held")) setPhase("idle");
  });
  useLayoutEffect(
    () => () => {
      attempt.current = null;
    },
    [],
  );

  async function check(current: Attempt, run: () => Promise<ComposerPluginStep>) {
    attempt.current = current;
    setPhase("checking");
    let next: ComposerPluginStep;
    try {
      next = await run();
    } catch {
      if (attempt.current === current) {
        attempt.current = null;
        setPhase("failed");
      }
      return;
    }
    if (attempt.current !== current) return;
    if (next.kind === "hold") {
      attempt.current = { ...current, resume: next.resume };
      setPhase("held");
      return;
    }
    cancel();
    if (next.kind === "send") await current.send(next.text);
  }

  return {
    ready: plugins !== undefined,
    blocked: phase === "checking" || phase === "held",
    held: phase === "held",
    failed: phase === "failed",
    cancel,
    start(draft: PluginComposerDraft, retry: boolean, send: SendDraft) {
      if (attempt.current) return;
      if (retry || (plugins && !plugins.some((plugin) => plugin.hooks.beforeSendMessage))) {
        return send(draft.text);
      }
      if (plugins) return check({ scope, send }, () => runComposerPluginHooks(draft, plugins));
    },
    resume() {
      const current = attempt.current;
      if (current?.resume) void check({ scope: current.scope, send: current.send }, current.resume);
    },
  };
}

export function ComposerHeldSend({
  gate,
  textarea,
}: {
  gate: ReturnType<typeof useComposerPluginSend>;
  textarea: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useLingui();
  if (!gate.held) return null;
  const returnFocus = (action: () => void) => {
    action();
    textarea.current?.focus();
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 px-1">
      <p
        aria-hidden="true"
        className="me-auto text-body-sm text-muted-foreground"
      >{t`Message held`}</p>
      <Button
        size="sm"
        aria-label={t`Resume send`}
        onClick={() => returnFocus(gate.resume)}
      >{t`Resume`}</Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={t`Cancel send`}
        onClick={() => returnFocus(gate.cancel)}
      >{t`Cancel`}</Button>
    </div>
  );
}
