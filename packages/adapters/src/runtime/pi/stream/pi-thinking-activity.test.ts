import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { describe, expect, it, vi } from "vitest";
import { withPiThinkingActivity } from "./pi-thinking-activity.js";

const message: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "openai-completions",
  provider: "fake",
  model: "fake",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
};
const start: AssistantMessageEvent = { type: "thinking_start", contentIndex: 0, partial: message };
function events(items: AssistantMessageEvent[]) {
  const stream = new AssistantMessageEventStream();
  for (const item of items) stream.push(item);
  stream.end(message);
  return stream;
}

describe("provider thinking lifecycle boundary", () => {
  it("emits booleans without inspecting or exposing private thinking content", async () => {
    const change = vi.fn();
    const stream = withPiThinkingActivity(
      events([
        start,
        {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "private fixture reasoning",
          partial: message,
        },
        {
          type: "thinking_end",
          contentIndex: 0,
          content: "private fixture reasoning",
          partial: message,
        },
      ]),
      change,
    );
    const received = [];
    for await (const item of stream) received.push(item);
    expect(received).toHaveLength(3); // Provider context is unchanged inside the adapter.
    expect(change.mock.calls).toEqual([[true], [false], [false]]);
    expect(JSON.stringify(change.mock.calls)).not.toContain("private fixture reasoning");
    expect(await stream.result()).toBe(message);
  });
  it.each<AssistantMessageEvent>([
    { type: "text_start", contentIndex: 1, partial: message },
    { type: "toolcall_start", contentIndex: 1, partial: message },
    { type: "done", reason: "stop", message },
    { type: "error", reason: "error", error: { ...message, stopReason: "error" } },
  ])("ends on $type even without a thinking_end", async (terminal) => {
    const change = vi.fn();
    for await (const _ of withPiThinkingActivity(events([start, terminal]), change)) {
      /* drain */
    }
    expect(change.mock.calls[0]).toEqual([true]);
    expect(change.mock.calls[1]).toEqual([false]);
  });
  it("ends on truncated iterator return or thrown transport failure", async () => {
    const change = vi.fn();
    for await (const _ of withPiThinkingActivity(events([start]), change)) break;
    expect(change.mock.calls).toEqual([[true], [false]]);
    const failed = new AssistantMessageEventStream();
    failed[Symbol.asyncIterator] = async function* () {
      yield start;
      throw new Error("fake transport");
    };
    const failureChange = vi.fn();
    await expect(async () => {
      for await (const _ of withPiThinkingActivity(failed, failureChange)) {
        /* drain */
      }
    }).rejects.toThrow("fake transport");
    expect(failureChange.mock.calls).toEqual([[true], [false]]);
  });
  it("never starts on generic stream start, silence, text or a thinking delta without a boundary", async () => {
    const change = vi.fn();
    for await (const _ of withPiThinkingActivity(
      events([
        { type: "start", partial: message },
        { type: "thinking_delta", contentIndex: 0, delta: "opaque", partial: message },
        { type: "text_start", contentIndex: 1, partial: message },
      ]),
      change,
    )) {
      /* drain */
    }
    expect(change.mock.calls.every(([active]) => active === false)).toBe(true);
  });

  it("does not emit text from a provider-redacted block", async () => {
    const onReasoning = vi.fn();
    const partial: AssistantMessage = {
      ...message,
      content: [
        {
          type: "thinking",
          thinking: "redacted placeholder",
          redacted: true,
          thinkingSignature: "opaque",
        },
      ],
    };
    for await (const _ of withPiThinkingActivity(
      events([
        { ...start, partial },
        { type: "thinking_delta", contentIndex: 0, delta: "redacted placeholder", partial },
        { type: "thinking_end", contentIndex: 0, content: "redacted placeholder", partial },
      ]),
      () => {},
      onReasoning,
    )) {
      /* drain */
    }
    expect(onReasoning.mock.calls.flat()).not.toContainEqual(
      expect.objectContaining({ phase: "delta" }),
    );
    expect(JSON.stringify(onReasoning.mock.calls)).not.toContain("opaque");
  });

  it.each(["", "Compare ", "\n\n"])(
    "publishes the unstreamed part of a completed summary (%j)",
    async (prefix) => {
      const onReasoning = vi.fn();
      const summary = "Compare both schedules.";
      const partial: AssistantMessage = {
        ...message,
        content: [{ type: "thinking", thinking: summary }],
      };
      const stream = withPiThinkingActivity(
        events([
          { ...start, partial },
          { type: "thinking_delta", contentIndex: 0, delta: prefix, partial },
          { type: "thinking_end", contentIndex: 0, content: summary, partial },
        ]),
        () => {},
        onReasoning,
      );
      for await (const item of stream) {
        if (item.type === "thinking_end") {
          const received = onReasoning.mock.calls.flat().filter((event) => event.phase === "delta");
          expect(
            received
              .map((event) => event.text)
              .join("")
              .trim(),
          ).toBe(summary);
        }
      }
    },
  );
});
