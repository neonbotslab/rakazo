import { I18nProvider } from "@lingui/react";
import type { ProductEvent, ReplyTraceEntry, ReplyTraceTool } from "@rakazo/contracts";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/locale/i18n";
import "../../src/styles.css";
import { BOT, FixtureTranscript, reduceThreadEvents } from "./thread-fixture";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const state = params.get("state");
const atlas = { ...BOT, botId: "bot-2", name: "Atlas" };
const thought = (id: string, text: string): ReplyTraceEntry => ({ kind: "thinking", id, text });
const tool = (
  id: string,
  label: string,
  durationMs?: number,
  patch: Partial<ReplyTraceTool> = {},
): ReplyTraceTool => ({
  kind: "tool",
  id,
  groupId: id,
  label,
  durationMs,
  outcome: "succeeded",
  ...patch,
});
const before = thought(
  "first",
  "I should check both calendars for the whole workweek. I’ll compare the open times in Central time and make sure tentative meetings count as busy.",
);
const between = thought(
  "second",
  "Monday is full. Both calendars are open Tuesday afternoon. I’ll check Wednesday too in case Tuesday doesn't work.",
);
const after = thought(
  "third",
  "I’ll suggest Tuesday at 2:30 PM and offer Wednesday as a fallback.",
);
const long = thought(
  "long",
  [
    "The request covers both calendars, so I need dates and a shared time zone before comparing.",
    "The calendars may mark travel as an all-day event. I’ll check whether the entries actually block time. If one busy block is tentative, I’ll explain that condition before recommending the slot.",
    "There is a recurring focus block on Wednesday. It might be movable, but I should keep the firm Tuesday slot first. The Wednesday option works only if Dana can move that block.",
    "Thursday overlaps with a project review. Friday morning is open on one calendar while the other calendar shows travel. Tuesday gives both of them time before and after the meeting.",
    "I should give one time and one fallback. Asking whether to send the invitation gives the reader a clear next step.",
  ].join("\n\n"),
);

const mine = tool("primary", "Checked Alex’s calendar", 1_400);
const dana = tool("dana", "Checked Dana’s calendar", 1_200);
const wednesday = tool("wednesday", "Checked Dana’s calendar for Wednesday", 900);
const repeated = tool("repeated", "Checked Alex’s calendar for Wednesday", 800);
const repeat = tool("repeat", repeated.label, 700, { groupId: repeated.id });
const failed = tool("failed", "Couldn’t reach Dana’s calendar", 5_000, { outcome: "failed" });
const working = tool("active", "Checking Dana’s calendar", undefined, {
  name: "list_calendar_events",
  outcome: "running",
});
const traces: Record<string, ReplyTraceEntry[]> = {
  "finished-closed": [before, mine, dana, between, wednesday, after],
  "finished-open": [before, mine, dana, between, wednesday, after],
  "tool-open": [mine, dana],
  "tools-only": [mine, dana, wednesday],
  "result-open": [tool("process-tool", "Loaded process tool", 1_200)],
  "group-open": [wednesday, repeated, repeat],
  "error-open": [failed, dana],
  long: [long, mine, dana, between, wednesday, repeated, repeat, after],
};
const events: Partial<ProductEvent>[] = [
  {
    type: "thread.message.created",
    payload: {
      messageId: "question",
      role: "user",
      blocks: [
        {
          kind: "text",
          text:
            state === "result-open"
              ? "What inputs do I need to start a background process?"
              : "When can Dana and I meet this week?",
        },
      ],
    },
  },
  { type: "run.started", payload: { trigger: "user", userId: "reader" } },
];
if (state === "two-bot") {
  const replies = [
    {
      id: "chief-reply",
      botId: BOT.botId,
      trace: [before, mine],
      durationMs: 8_000,
      text: "Alex is free Tuesday afternoon.",
    },
    {
      id: "chief-follow-up",
      botId: BOT.botId,
      trace: [wednesday],
      durationMs: 4_000,
      text: "Wednesday could also work if Dana moves her focus block.",
    },
    {
      id: "atlas-reply",
      botId: atlas.botId,
      trace: [dana, after],
      durationMs: 12_000,
      text: "Dana is free Tuesday from 1:00 to 4:30 PM Central. I’d suggest 2:30.",
    },
  ];
  for (const { id, botId, trace, durationMs, text } of replies) {
    events.push({
      type: "thread.message.created",
      botId,
      payload: {
        messageId: id,
        role: "bot",
        blocks: [
          { kind: "steps", steps: [], trace, durationMs },
          { kind: "text", text },
        ],
      },
    });
  }
  events.push({ type: "run.completed" });
} else if (state === "running-open") {
  events.push({ type: "agent.tool.called", payload: { traceTool: working } });
} else if (state === "thinking") {
  events.push({
    type: "thread.meta",
    payload: {
      traceReasoningChanged: true,
      phaseId: before.id,
      text: before.kind === "thinking" && before.text,
    },
  });
} else if (state && traces[state]) {
  events.push(
    {
      type: "thread.message.created",
      payload: {
        messageId: "reply",
        role: "bot",
        blocks: [
          {
            kind: "steps",
            steps: [],
            trace: traces[state],
            durationMs: state === "tool-open" || state === "group-open" ? 6_000 : 42_000,
          },
          {
            kind: "text",
            text:
              state === "result-open"
                ? "Choose an agent and provide a command. You can also set a working directory and environment variables."
                : "Tuesday at 2:30 PM Central works for both of you. The afternoon is open from 1:00 to 4:30. If that doesn't suit, Wednesday could work if Dana moves her focus block. Want me to send the invite?",
          },
        ],
      },
    },
    { type: "run.completed" },
  );
}
const snapshot = reduceThreadEvents(events);
const messages = snapshot.messages.map((message) =>
  message.id === "reply" ? { ...message, canInspectToolSteps: true as const } : message,
);

void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <FixtureTranscript
        bots={state === "two-bot" ? [BOT, atlas] : undefined}
        messages={messages}
        running={snapshot.run?.status === "running"}
        liveTrace={snapshot.liveTrace}
        workingTraceRuns={[{ id: "run-1", userId: "reader" }]}
        meId="reader"
        showToolActivity
      />
    </I18nProvider>,
  );
});
