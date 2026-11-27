#!/usr/bin/env -S node --import tsx
import { createRequire } from "node:module";

const require = createRequire(new URL("../../../../apps/web/package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");

const [, , baseURL, runId] = process.argv;
const email = "verification@rakazo.test";
const password = "fixture-password";
const prompt = "Please make a short plan for the workshop.";
const reply = `done. i handled: ${prompt}`;
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

function chiefInRoster(page) {
  return page.locator("[data-roster-bot-name]").getByText("Chief", { exact: true });
}

async function submitCredentials(page, button) {
  await page.getByPlaceholder("Your email address").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: button, exact: true }).click();
}

const browser = await chromium.launch();
try {
  const signup = await browser.newPage({ baseURL });
  await signup.goto("/sign-up");
  await signup.getByPlaceholder("Your name").fill("Verification");
  await submitCredentials(signup, "Create account");
  const integrations = signup.getByRole("heading", { name: "Server integrations", exact: true });
  await expect(integrations.or(chiefInRoster(signup))).toBeVisible({ timeout: 30_000 });
  if (await integrations.isVisible()) {
    await signup.getByRole("button", { name: "Skip", exact: true }).click();
  }
  await expect(chiefInRoster(signup)).toBeVisible({ timeout: 30_000 });
  await signup.close();
  console.log("Created a test account and completed onboarding.");

  const page = await browser.newPage({
    baseURL,
    reducedMotion: "reduce",
    viewport: viewports[0],
  });
  await page.goto("/sign-in");
  await submitCredentials(page, "Sign in");
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
  await chiefInRoster(page).click();
  const composer = page.getByPlaceholder(/Message/);
  await expect(composer).toBeVisible({ timeout: 30_000 });
  console.log("Signed in through the form and opened Chief's chat.");

  await composer.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  console.log(`Sent "${prompt}"`);
  const userMessage = page.getByTestId("message-user-bubble").getByText(prompt, { exact: true });
  const botMessage = page.getByTestId("message-bot-bubble").getByText(reply, { exact: true });
  await expect(userMessage).toBeVisible();
  await expect(botMessage).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.reload();
  await expect(userMessage).toBeVisible({ timeout: 30_000 });
  await expect(botMessage).toBeVisible({ timeout: 30_000 });
  console.log(`Saw the scripted reply after reload. "${reply}"`);

  for (const { name, width, height } of viewports) {
    await page.setViewportSize({ width, height });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await expect(botMessage).toBeInViewport();
      const path = `/tmp/verify-skill-${runId}-${name}-${colorScheme}.png`;
      await page.screenshot({ path, animations: "disabled" });
      console.log(path);
    }
  }
} finally {
  await browser.close();
}
