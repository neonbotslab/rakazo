---
name: verify-rakazo
description: Drive Rakazo's web UI against a disposable local database, API, and worker. Use for chat runs, tool steps, reasoning, settings, tickets, or screenshots without paid inference.
---

# Verify Rakazo

Run from the checkout root. Install workspace dependencies with `pnpm install --frozen-lockfile`. The runner uses local Postgres from `pg_config --bindir` and the web package's Playwright Chromium. If Chromium is missing, run `pnpm --filter @rakazo/web exec playwright install chromium`.

## Launch and drive

```sh
.agents/skills/verify-rakazo/scripts/verify chat
```

The runner clears inherited service settings, checks for local dotenv files, runs `pnpm db:generate`, and migrates a fresh Postgres cluster. It starts the API, worker, and Vite on loopback with the repo's scripted runtime and fake sandbox. Use an env-free checkout.

The chat driver registers a test account through the form, signs in from a fresh browser context, and sends a message to Chief. It checks that the finished reply survives reload and writes four `/tmp/verify-skill-*.png` screenshots at desktop and phone widths in light and dark. Browser runs take the box lock and wait for active browsers and Playwright processes.

For another feature, choose an existing spec from the [feature map](references/features/README.md) and pass its path relative to `apps/web`. The runner prints the spec's artifact directory.

```sh
.agents/skills/verify-rakazo/scripts/verify spec e2e/chat/live-reasoning.spec.ts
```

For manual work, use `verify serve` in a managed background process. Open the printed web URL and create a test account with any unused `@rakazo.test` address. Coordinate the box browser slot before opening a browser.

## Doctor

```sh
.agents/skills/verify-rakazo/scripts/verify doctor "$run_dir"
```

Set `run_dir` to the printed run directory. The runner checks service processes, worker startup, API database readiness, the sign-in page, and the auth proxy before driving a page. It prints log tails on failure.

## Evidence and cleanup

Report the command and exit code, the action, the observed result, and the screenshot paths. Verify changes that persist by reopening the screen. Report missing fixture prerequisites and any paths you could not reach.

The runner stops its services and removes its database when chat or a spec exits. Stop a `serve` process with SIGTERM or Ctrl+C. Screenshots survive cleanup. The standalone worker uses the repo's shared local health file, so use the runner's own worker log for readiness.
