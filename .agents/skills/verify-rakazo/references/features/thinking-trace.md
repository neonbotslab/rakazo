# Thinking and tool calls

Open a bot turn's work summary to read its thinking and tool calls. Expand a call to see its arguments and result if you started the run. Expand a repeated group, then choose an individual call.

## How to get to it

Open a conversation with a bot. Enable **Show tool activity** under **Settings → General** to include tool calls. Open **Thinking…** while the bot is working or **Worked for…** after the reply.

## Driving it with Playwright

Run `verify spec e2e/chat/live-reasoning.spec.ts`. Check that the finished timeline starts closed, thinking and calls share a rail, and opening a group requests details only when you open an individual call. The spec captures the seven timeline states in light and dark at desktop and phone widths.

Run `verify spec e2e/chat/tool-activity.spec.ts` for the preference and for saved steps that predate per-call traces.

## Gotchas

The scripted chat smoke run has no reasoning stream. The timeline spec uses the production transcript and query code with fixture events and tool detail responses. PostgreSQL coverage in `apps/api/src/threads/tool-history-privacy.postgres.test.ts` exercises the saved and live routes with the run starter and another Space member.
