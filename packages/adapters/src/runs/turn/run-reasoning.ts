import type { AgentRuntimeEvent } from "@rakazo/adapter-kit";
import type { ReplyReasoning } from "@rakazo/contracts";
import { MAX_REPLY_REASONING_BYTES } from "@rakazo/contracts";
import { byteLength, createStreamingRedactor, truncateUtf8 } from "@rakazo/core";
import { RunHistoryWriteError } from "@rakazo/db";
import type { RunContext } from "../assembly/run-context.js";
import { holdsTransientProgress } from "../lifecycle/run-progress.js";

const PUBLISH_INTERVAL_MS = 1_000;
type ReasoningEvent = Extract<AgentRuntimeEvent, { type: "reasoning" }>;

function displayText(text: string, maxBytes = MAX_REPLY_REASONING_BYTES): string {
  return truncateUtf8(text, maxBytes).trim();
}

export function completedRunReasoning(ctx: RunContext): ReplyReasoning | undefined {
  const reasoning = ctx.state.reply.reasoning;
  if (!reasoning) return;
  const text = displayText(reasoning.text);
  if (text) return { ...reasoning, text };
}

export function createRunReasoning(ctx: RunContext) {
  const { deps, run, runId } = ctx;
  const { reply } = ctx.state;
  const enabled =
    !ctx.scripted &&
    !holdsTransientProgress(ctx) &&
    !ctx.groupReplyOptional &&
    !ctx.allowSilentEmptyRun &&
    run.trigger !== "bot_message";
  let phase:
    | {
        startedAt: number;
        lastUpdateAt: number;
        text: string;
        capped: boolean;
        utf16: ReturnType<typeof createStreamingRedactor>;
      }
    | undefined;
  let published: string | null = null;
  const remainingBytes = () =>
    MAX_REPLY_REASONING_BYTES - (reply.reasoning ? byteLength(reply.reasoning.text) + 2 : 0);

  const publish = async (text: string | null) => {
    if (text === published) return;
    try {
      await deps.events.append({
        spaceId: run.spaceId,
        threadId: run.threadId,
        botId: ctx.bot.id,
        runId,
        type: "thread.meta",
        lease: { owner: ctx.workerId, fence: ctx.fence },
        payload: { reasoningChanged: true, reasoning: text },
      });
      published = text;
    } catch (error) {
      if (!(error instanceof RunHistoryWriteError)) throw error;
    }
  };

  const append = (text: string) => {
    if (!phase || phase.capped || !text) return;
    const piece = truncateUtf8(text, remainingBytes() - byteLength(phase.text));
    phase.text += piece;
    phase.capped = piece.length < text.length;
  };

  const discard = async () => {
    phase = undefined;
    await publish(null);
  };

  return {
    discard,
    async consume(event: ReasoningEvent) {
      if (!enabled) return;
      if (event.phase === "start") {
        phase = {
          startedAt: event.at,
          lastUpdateAt: Number.NEGATIVE_INFINITY,
          text: "",
          capped: false,
          // The empty matcher still joins split surrogate pairs and replaces invalid UTF-16.
          utf16: createStreamingRedactor([]),
        };
        await publish(null);
      } else if (event.phase === "discard") {
        await discard();
      } else if (phase && event.phase === "delta") {
        if (!phase.capped) append(phase.utf16.push(event.text));
        const now = Date.now();
        if (phase.text && now - phase.lastUpdateAt >= PUBLISH_INTERVAL_MS) {
          const text = displayText(phase.text, remainingBytes());
          if (text && text !== published) {
            phase.lastUpdateAt = now;
            await publish(text);
          }
        }
      } else if (phase && event.phase === "end") {
        if (!phase.capped) append(phase.utf16.finish());
        const text = displayText(phase.text, remainingBytes());
        if (text) {
          const previous = reply.reasoning;
          const endedAt = Math.max(phase.startedAt, event.at);
          reply.reasoning = {
            text: previous ? `${previous.text}\n\n${text}` : text,
            startedAt: previous?.startedAt ?? new Date(phase.startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
            durationMs: (previous?.durationMs ?? 0) + endedAt - phase.startedAt,
          };
        }
        phase = undefined;
        if (text) await publish(text);
      }
    },
  };
}
