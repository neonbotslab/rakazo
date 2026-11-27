import { useTimeout } from "@rakazo/chat-ui/hooks";
import type {
  OwnerRulesRestoreInput,
  OwnerRulesSaveInput,
  OwnerRulesVersion,
  OwnerRulesVersionRef,
} from "@rakazo/contracts";
import { OWNER_RULES_CONFLICT, OWNER_RULES_MAX_LENGTH, ownerRulesLength } from "@rakazo/contracts";
import { newClientId } from "@rakazo/core";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSave, useSpaceQueries } from "../../lib/query/query";
import { errorCode } from "../../lib/query/user-error";

const debounceMs = 1_000;
const sessionIdleMs = 5 * 60_000;
const savedStatusMs = 1_800;

type Draft = OwnerRulesSaveInput & { editedAt: number };
type Change = { kind: "edit"; draft: Draft } | { kind: "restore"; input: OwnerRulesRestoreInput };
type Departure = { kind: "confirm" | "saving"; next: () => void };

function versionRef(version: OwnerRulesVersion | undefined): OwnerRulesVersionRef | null {
  return version ? { id: version.id, revision: version.revision } : null;
}

export function useOwnerRulesEditor() {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.ownerRules.list.infiniteOptions({
    input: (before: number | undefined) => ({ before }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    refetchOnWindowFocus: true,
  });
  const rules = useInfiniteQuery(options);
  const versions = rules.data?.pages.flatMap((page) => page.versions) ?? [];
  const latest = versions[0];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [departure, setDeparture] = useState<Departure | null>(null);
  const [saved, setSaved] = useState<OwnerRulesVersion | null>(null);
  const session = useRef<{ id: string; editedAt: number; head: OwnerRulesVersionRef | null }>(null);
  const flushOnSettle = useRef(false);

  const change = useSave({
    save: (input: Change, rpc) => {
      if (input.kind === "restore") return rpc.ownerRules.restore(input.input);
      const { text, expected, sessionId } = input.draft;
      return rpc.ownerRules.save({ text, expected, sessionId });
    },
    stale: [options.queryKey],
    keepErrorWhilePending: true,
    onSaved: (version, input) => {
      queryClient.setQueryData<typeof rules.data>(options.queryKey, (data) => {
        const page = data?.pages[0];
        const newest = page?.versions[0];
        if (!data || !page || (newest && newest.id > version.id)) return data;
        if (newest?.id === version.id && newest.revision >= version.revision) return data;
        return {
          ...data,
          pages: [
            {
              ...page,
              versions: [version, ...page.versions.filter((row) => row.id !== version.id)],
            },
            ...data.pages.slice(1),
          ],
        };
      });

      if (input.kind === "restore") {
        session.current = null;
        setDraft(null);
      } else {
        const head = versionRef(version);
        if (session.current) session.current.head = head;
        setDraft((current) =>
          current &&
          (current.text !== input.draft.text || current.sessionId !== input.draft.sessionId)
            ? { ...current, expected: head }
            : null,
        );
      }
      setSaved(version);
    },
  });

  const text = draft?.text ?? latest?.text ?? "";
  const count = ownerRulesLength(text);
  const overLimit = count > OWNER_RULES_MAX_LENGTH;
  const conflict = errorCode(change.error) === OWNER_RULES_CONFLICT;
  const failedDraft = Boolean(
    change.error && change.input?.kind === "edit" && change.input.draft === draft,
  );
  const ready = draft !== null && !overLimit && !conflict && !failedDraft;

  function saveDraft() {
    if (!ready) return;
    if (change.pending) {
      flushOnSettle.current = true;
      return;
    }
    flushOnSettle.current = false;
    change.run({ kind: "edit", draft });
  }

  useTimeout(
    saveDraft,
    ready && !change.pending && !departure
      ? Math.max(0, (flushOnSettle.current ? 0 : draft.editedAt + debounceMs) - Date.now())
      : null,
    draft,
  );
  useTimeout(
    () => {
      if (departure?.kind !== "saving") return;
      if (overLimit) setDeparture({ ...departure, kind: "confirm" });
      else if (ready) saveDraft();
      else if (change.error) setDeparture(null);
      else departure.next();
    },
    departure?.kind === "saving" && !change.pending ? 0 : null,
    draft,
  );
  useTimeout(() => setSaved(null), saved ? savedStatusMs : null, saved);

  function edit(text: string) {
    const now = Date.now();
    const last = session.current;
    const expected = draft ? draft.expected : versionRef(latest);
    const sameHead = last?.head?.id === expected?.id && last?.head?.revision === expected?.revision;
    const sessionId =
      last && sameHead && now - last.editedAt < sessionIdleMs ? last.id : newClientId();
    session.current = { id: sessionId, editedAt: now, head: expected };
    flushOnSettle.current = false;
    setSaved(null);
    setDraft({
      text,
      expected,
      sessionId,
      editedAt: now,
    });
  }

  function leave(next: () => void) {
    if (departure) return;
    if (overLimit) {
      setDeparture({ kind: "confirm", next });
    } else if (ready || change.pending) {
      setDeparture({ kind: "saving", next });
      saveDraft();
    } else {
      next();
    }
  }

  function discardAndLeave() {
    setDraft(null);
    departure?.next();
    setDeparture(null);
  }

  function restore(versionId: number) {
    if (conflict || change.pending) return;
    change.run({
      kind: "restore",
      input: { versionId, expected: draft ? draft.expected : versionRef(latest) },
    });
  }

  function retry() {
    if (overLimit || conflict || change.pending || !change.input) return;
    if (draft && change.input.kind === "edit") change.run({ kind: "edit", draft });
    else change.run(change.input);
  }

  async function reload() {
    const result = await rules.refetch({ cancelRefetch: false });
    if (!result.isSuccess) return;
    session.current = null;
    setDraft(null);
    setSaved(null);
    change.reset();
  }

  const saving = ready || change.pending;
  const status =
    overLimit || conflict || (!saving && change.error)
      ? "not-saved"
      : saving
        ? "saving"
        : saved
          ? "saved"
          : null;

  return {
    rules,
    versions,
    text,
    count,
    status,
    saved,
    overLimit,
    conflict,
    error: change.error,
    pending: change.pending,
    readOnly: departure?.kind === "saving" || (change.pending && change.input?.kind === "restore"),
    confirmingDeparture: departure?.kind === "confirm",
    edit,
    saveDraft,
    leave,
    discardAndLeave,
    keepEditing: () => setDeparture(null),
    restore,
    retry,
    reload,
  };
}
