# Chat thread

Send a message to a bot and revisit the conversation.

## Sub-features

- Open a bot chat, send a message, and read the reply.

## How to get to it (user POV)

Sign in with email. Open **Chats** and choose **Chief**.

## Driving it with Playwright

Run `verify chat`. Look for the sent text and scripted reply after reload. Open the four screenshot paths it prints.

## Gotchas

Onboarding creates Chief. Complete onboarding before testing the composer. The scripted reply proves execution and persistence.
