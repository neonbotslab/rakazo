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
      let reasoning: { index: number; streamed: string } | undefined;
      const finish = (discard: boolean) => {
        if (!reasoning) return;
        reasoning = undefined;
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
              reasoning = { index: event.contentIndex, streamed: "" };
              onReasoning({ type: "reasoning", phase: "start", at: Date.now() });
            } else if (event.type === "thinking_delta" || event.type === "thinking_end") {
              if (reasoning?.index === event.contentIndex) {
                const block = event.partial.content[event.contentIndex];
                const readable = block?.type === "thinking" && !block.redacted;
                if (readable) {
                  let text = "";
                  if (event.type === "thinking_delta") text = event.delta;
                  else if (event.content.startsWith(reasoning.streamed))
                    text = event.content.slice(reasoning.streamed.length);
                  else if (!reasoning.streamed.trim()) text = event.content;
                  if (text) {
                    reasoning.streamed += text;
                    onReasoning({ type: "reasoning", phase: "delta", text });
                  }
                }
                if (event.type === "thinking_end") finish(!readable);
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
