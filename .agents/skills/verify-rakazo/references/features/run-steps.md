# Run steps and tool tooltips

Expand a run to see its tool steps and inspect a step's detail.

## Sub-features

- Read live activity, expand a completed run, and inspect a tool label.

## How to get to it (user POV)

Enable **Show tool activity** under **Settings → General**. In a chat with tool activity, expand the completed run and hover a step label.

## Driving it with Playwright

Run `verify spec e2e/chat/tool-activity.spec.ts`. The fixture shows live and completed runs. Check the expanded `tool-rows` for **Check conflicts** and its note. For tooltip work, inspect the row label's native `title` and compare it with the step's public detail.

## Gotchas

The fixture seeds the tool activity preference. Native title tooltips are browser chrome. Assert the `title` text separately from the page screenshot.
