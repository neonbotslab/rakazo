// @vitest-environment jsdom
import type { ThreadMessage } from "@rakazo/contracts";
import { foldPeerReplies } from "@rakazo/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode, RefObject } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rpc } from "../../../lib/query/rpc";
import { Transcript } from "./transcript";
import { resolveTranscriptMemberName } from "./transcript-member-name";

const stableT = (strings: TemplateStringsArray, ...values: unknown[]) =>
  String.raw(strings, ...values);

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: stableT }),
}));

const G1 = "bot-g1";
const G2 = "bot-g2";
const ARCHIVED = "bot-archived";
const DELETED = "bot-deleted";

type Roster = {
  members: readonly { botId: string; name: string }[] | undefined;
  bots: readonly { id: string; name: string }[];
  archivedBots: readonly { id: string; name: string }[];
};

let container: HTMLDivElement;
let root: Root;
let scrollRef: RefObject<HTMLDivElement | null>;
let queries: QueryClient;
let seq = 0;

beforeEach(() => {
  seq = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queries = new QueryClient();
  scrollRef = { current: container };
});

afterEach(() => {
  act(() => root.unmount());
  queries.clear();
  container.remove();
  vi.unstubAllGlobals();
});

function message(
  id: string,
  botId: string | undefined,
  blocks: ThreadMessage["blocks"],
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  seq += 1;
  return {
    id,
    threadId: "thread",
    seq,
    role: "bot",
    ...(botId ? { botId } : {}),
    createdAt: "2026-11-11T12:00:00.000Z",
    blocks,
    ...extra,
  };
}

function renderTranscript(messages: ThreadMessage[], roster: Roster) {
  const memberName = (botId: string | undefined) =>
    resolveTranscriptMemberName({ botId, ...roster });
  const peerBot: ComponentProps<typeof Transcript>["peerBot"] = (botId) => {
    const bot = roster.bots.find((candidate) => candidate.id === botId);
    if (bot) return { name: bot.name, color: "blue" };
    const member = roster.members?.find((candidate) => candidate.botId === botId);
    return member ? { name: member.name, color: "blue" } : undefined;
  };
  const props: ComponentProps<typeof Transcript> = {
    scrollRef,
    scrollRequest: null,
    onScrollRequestHandled: vi.fn(),
    followRequest: 0,
    callHoldsSpeaker: false,
    artifactTarget: roster.members ? { groupId: "group" } : { botId: G1 },
    meId: "viewer",
    transcript: foldPeerReplies(messages, { includePeerReceipts: true }),
    showToolActivity: false,
    olderCursor: null,
    unreadAfterSeq: null,
    loadingOlder: false,
    answerableAskIds: new Set<string>(),
    dismissableAskIds: new Set<string>(),
    running: false,
    onLoadOlder: vi.fn(),
    onOpenBot: vi.fn(),
    onAnswer: vi.fn(),
    onReply: vi.fn(),
    onMarkUnread: vi.fn(),
    onQuote: vi.fn(),
    onReact: vi.fn(),
    onJumpToMessage: vi.fn(),
    onOpenPeerMessages: vi.fn(),
    memberName,
    peerBot,
    onRefresh: vi.fn(),
    onBotChanged: vi.fn(),
    onAddRoutine: vi.fn(),
    voiceReady: false,
    speakingMessageId: null,
    onSpeak: vi.fn(),
    onOpenComputer: vi.fn(),
    onReleaseComputer: vi.fn(),
    rpc,
  };
  act(() =>
    root.render(
      <QueryClientProvider client={queries}>
        <Transcript {...props} />
      </QueryClientProvider>,
    ),
  );
}

function header(messageId: string): string | null {
  const row = container.querySelector(`[data-message-id="${messageId}"]`);
  const name = row?.querySelector(".font-semibold.tracking-tight");
  const text = name?.textContent?.replace(/\s+/g, " ").trim();
  return text || null;
}

function handoffLine(messageId: string): string {
  const row = container.querySelector(`[data-message-id="${messageId}"]`);
  const line = [...(row?.querySelectorAll("span") ?? [])].find((span) =>
    span.textContent?.includes("↪"),
  );
  return line?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function replyLine(messageId: string): string {
  return (
    container
      .querySelector(`[data-message-id="${messageId}"] [data-testid="reply-parent-preview"]`)
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

it("keeps handoff and reply attribution in context without adding bot headers", () => {
  renderTranscript(
    [
      message("g1", G1, [{ kind: "text", text: "Hello" }]),
      message("hand", G1, [{ kind: "handoff", fromBotId: G1, toBotId: G2, text: "Your turn" }]),
      message("g2", G2, [{ kind: "text", text: "Au" }]),
      message("gone", DELETED, [{ kind: "text", text: "Gone" }]),
      message("reply", G1, [{ kind: "text", text: "Seen" }], {
        replyToMessageId: "gone",
        replyPreview: { role: "bot", botId: DELETED, text: "Gone" },
      }),
      message("plain", undefined, [{ kind: "text", text: "Notice" }]),
    ],
    {
      members: [{ botId: G1, name: "G1" }],
      bots: [
        { id: G1, name: "G1" },
        { id: G2, name: "G2" },
      ],
      archivedBots: [],
    },
  );

  expect({
    g1: header("g1"),
    handoff: handoffLine("hand"),
    g2: header("g2"),
    gone: header("gone"),
    reply: replyLine("reply"),
    plain: header("plain"),
  }).toEqual({
    g1: null,
    handoff: "↪ G2 ← G1",
    g2: null,
    gone: null,
    reply: expect.stringContaining("Deleted bot: Gone"),
    plain: null,
  });
  expect(container.querySelector(`[data-message-id="plain"]`)?.textContent).not.toContain(
    "Deleted bot",
  );
});

it("keeps an archived bot’s name in a quoted reply", () => {
  renderTranscript(
    [
      message("old", ARCHIVED, [{ kind: "text", text: "Note" }]),
      message("reply", G1, [{ kind: "text", text: "Got it" }], {
        replyToMessageId: "old",
        replyPreview: { role: "bot", botId: ARCHIVED, text: "Note" },
      }),
    ],
    {
      members: [{ botId: G1, name: "G1" }],
      bots: [{ id: G1, name: "G1" }],
      archivedBots: [{ id: ARCHIVED, name: "G4" }],
    },
  );

  expect(replyLine("reply")).toContain("G4: Note");
});

it("labels consecutive messages from a person once, without naming bot turns", () => {
  const text = [{ kind: "text", text: "A message" }] as const;
  const member = { id: "member", name: "A member" };
  renderTranscript(
    [
      message("first", G1, [...text]),
      message("follow-up", G1, [...text]),
      message("other-bot", G2, [...text]),
      message("back", G1, [...text]),
      message("later", G1, [...text], { createdAt: "2026-11-12T12:00:00.000Z" }),
      message("member", undefined, [...text], { role: "user", author: member }),
      message("member-follow-up", undefined, [...text], { role: "user", author: member }),
    ],
    {
      members: [
        { botId: G1, name: "G1" },
        { botId: G2, name: "G2" },
      ],
      bots: [],
      archivedBots: [],
    },
  );

  expect(
    ["first", "follow-up", "other-bot", "back", "later", "member", "member-follow-up"].map(header),
  ).toEqual([null, null, null, null, null, "A member", null]);
});
