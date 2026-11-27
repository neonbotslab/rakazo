# Reasoning disclosure

Read reasoning while the bot works and reopen it after the reply.

## Sub-features

- Replace the thinking placeholder with reasoning and expand a finished reply's disclosure.

## How to get to it (user POV)

Open a conversation with a reasoning-capable bot. After the reply, click **Thought for…**.

## Driving it with Playwright

Run `verify spec e2e/chat/live-reasoning.spec.ts`. Check that reasoning replaces **Thinking…** and opens on click under the completed reply.

## Gotchas

The scripted chat smoke run has no reasoning stream. The spec drives the existing web fixture for waiting, live, and completed states.
