# Trusted host plugins

Host plugins are TypeScript modules that run inside Rakazo. Install a plugin by adding its entry to the fork's trusted registry and rebuilding. Only install code you trust with the process's access.

A definition has a manifest and a typed `hooks` object. Give it a stable `namespace/name` ID, a display name, a version, and `apiVersion: 1`. The host orders plugins by ID and rejects duplicate IDs. Server and Web entries for the same plugin share the manifest ID.

Users enable installed plugins from **Settings → Plugins**. The choice is stored per account and defaults to off. Rakazo broadcasts account preference changes over its existing live stream. Keep deployment configuration and credentials on the server.

`beforeToolCall(call, args)` receives a resolved connector tool and JSON arguments. Return `{ kind: "keep" }` or `{ kind: "replace", value: args }`. Rakazo validates the replacement and saves the request under the invocation ID before approval or dispatch. Resuming an approval uses that request and any edits the approver made on the card.

`afterToolResult(call, result)` uses the same decision for successful connector results. The model receives the replacement. The effect ledger and audit keep the real outcome, and Web tool steps show which plugin changed the result. Use transformations without side effects. Rakazo may retry preparing a call or projecting a result after interruption.

`onTurnFinished(event)` is a server hook for a committed completed, failed, or cancelled run. Rakazo records one event per run. A retry carries the same `eventId`. Use it as the idempotency key for external work the hook performs.

`onNotification(notice)` is a Web hook. Return `keep`, `suppress`, or `patch` with replacement text or `silent: true`. Rakazo decides eligibility and click targets before calling the hook.

`beforeSendMessage(draft)` runs in Web before a fresh send. Return `continue`, rewrite the text with `rewrite`, leave the draft unsent with `cancel`, or pause with `hold`. **Resume** continues with the next hook. Editing the held draft invalidates the hold.
