import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";

export function withPiThinkingActivity(
  stream: AssistantMessageEventStream,
  setThinking: (active: boolean) => void,
  onReasoning?: (event: Extract<AgentRuntimeEvent, { type: "reasoning" }>) => void,
): AssistantMessageEventStream {
  class ThinkingStream extends AssistantMessageEventStream {
    override async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
      let reasoningIndex: number | undefined;
      const finish = (discard: boolean) => {
        if (reasoningIndex === undefined) return;
        reasoningIndex = undefined;
        onReasoning?.(
          discard
            ? { type: "reasoning", phase: "discard" }
            : { type: "reasoning", phase: "end", at: Date.now() },
        );
      };
      try {
        for await (const event of stream) {
          if (event.type === "thinking_start") setThinking(true);
          else if (event.type !== "thinking_delta") setThinking(false);

          if (onReasoning) {
            if (event.type === "thinking_start") {
              finish(false);
              reasoningIndex = event.contentIndex;
              onReasoning({ type: "reasoning", phase: "start", at: Date.now() });
            } else if (event.type === "thinking_delta") {
              if (reasoningIndex === event.contentIndex) {
                const block = event.partial.content[event.contentIndex];
                if (block?.type === "thinking" && !block.redacted && event.delta) {
                  onReasoning({ type: "reasoning", phase: "delta", text: event.delta });
                }
              }
            } else {
              finish(event.type === "error");
            }
          }
          yield event;
        }
      } finally {
        setThinking(false);
        finish(true);
      }
    }
    override result(): Promise<AssistantMessage> {
      return stream.result();
    }
  }
  return new ThinkingStream();
}
