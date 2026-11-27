import { I18nProvider } from "@lingui/react";
import type { ProductEvent, ReplyReasoning } from "@rakazo/contracts";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/locale/i18n";
import "../../src/styles.css";
import { FixtureTranscript, reduceThreadEvents } from "./thread-fixture";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
const phase = params.get("phase");
const reasoning: ReplyReasoning = {
  text: "Compare the two calendars for Tuesday and Thursday. Tuesday is clear for both people. Thursday overlaps with a project review.",
  startedAt: "2026-11-26T10:00:00.000Z",
  endedAt: "2026-11-26T10:02:05.000Z",
  durationMs: 125_000,
};
const events: Partial<ProductEvent>[] = [
  {
    type: "thread.message.created",
    payload: {
      messageId: "question",
      role: "user",
      blocks: [{ kind: "text", text: "When can we meet this week?" }],
    },
  },
  { type: "run.started", payload: { trigger: "user" } },
];
if (phase !== "waiting") {
  events.push({
    type: "thread.meta",
    payload: { reasoningChanged: true, reasoning: reasoning.text },
  });
}
if (phase === "collapsed") {
  events.push(
    {
      type: "thread.message.created",
      payload: {
        messageId: "reply",
        role: "bot",
        blocks: [
          {
            kind: "steps",
            steps: [{ label: "Check calendars", count: 2, outcomes: { succeeded: 2 } }],
            durationMs: 126_000,
          },
          { kind: "text", text: "Tuesday afternoon works for both of you." },
        ],
        reasoning,
      },
    },
    { type: "run.completed" },
  );
}
const snapshot = reduceThreadEvents(events);

void bootstrapI18n("en").then(() => {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider i18n={i18n}>
      <FixtureTranscript
        messages={snapshot.messages}
        running={snapshot.run?.status === "running"}
        liveReasoning={snapshot.liveReasoning}
        showToolActivity
      />
    </I18nProvider>,
  );
});
