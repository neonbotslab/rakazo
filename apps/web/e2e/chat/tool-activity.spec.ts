import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "../helpers/helpers";

const fixture = "/e2e/fixtures/tool-activity.html";
const REPLY_TEXT = "Tuesday at 2 pm is free.";
const NOTE_TEXT = "Anna is free all Tuesday afternoon.";
const STORAGE_KEY = "rakazo.showToolActivity";

async function openThread(page: Page, phase: "live" | "done") {
  await page.goto(`${fixture}?view=thread&phase=${phase}`);
  await expect(page.getByTestId("message-user-bubble")).toBeVisible();
}

async function setToggle(page: Page, on: boolean) {
  await page.goto(`${fixture}?view=settings`);
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();
  const toggle = settings.getByTestId("tool-activity-toggle");
  await expect(toggle).toBeVisible();
  if (on) await expect(toggle).not.toBeChecked();
  else await expect(toggle).toBeChecked();
  await toggle.click();
  if (on) await expect(toggle).toBeChecked();
  else await expect(toggle).not.toBeChecked();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBe(on ? "on" : "off");
  await toggle.scrollIntoViewIfNeeded();
}

test("saved step-only records and notes still appear in one timeline", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "on"), STORAGE_KEY);
  await openThread(page, "live");
  const live = page.getByTestId("thinking-trace");
  await live.getByRole("button", { name: "Check conflicts…" }).click();
  await expect(live.getByTestId("thinking-trace-rail")).toContainText("Open calendar");
  await expect(page.getByTestId("message-bot-bubble")).toHaveCount(0);

  await openThread(page, "done");
  const done = page.getByTestId("thinking-trace");
  const summary = done.getByRole("button", { name: "Worked for 12s" });
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.click();
  await expect(done.getByTestId("thinking-trace-rail")).toContainText(NOTE_TEXT);
  await expect(page.getByTestId("message-bot-bubble")).toContainText(REPLY_TEXT);
});

test("the settings toggle hides and restores tool activity", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // Nothing saved leaves the switch off and the cards hidden.
  await page.goto(`${fixture}?view=settings`);
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();
  const initialToggle = settings.getByTestId("tool-activity-toggle");
  await expect(initialToggle).toBeVisible();
  await expect(initialToggle).not.toBeChecked();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))
    .toBeNull();
  await initialToggle.scrollIntoViewIfNeeded();
  await captureScreenshot(page, testInfo, "settings-tool-activity-off");

  await openThread(page, "done");
  await expect(page.getByTestId("message-bot-bubble")).toHaveText(REPLY_TEXT);
  await expect(page.getByTestId("thinking-trace")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "off-done");

  await openThread(page, "live");
  await expect(
    page.getByTestId("thinking-trace").getByRole("button", { name: "Thinking…" }),
  ).toBeVisible();
  await expect(page.getByTestId("message-bot-bubble")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "off-live");

  await setToggle(page, true);
  await captureScreenshot(page, testInfo, "settings-tool-activity-on");

  await openThread(page, "done");
  await expect(page.getByTestId("thinking-trace")).toHaveCount(1);
  await expect(page.getByTestId("thinking-trace").locator("button[aria-expanded]")).toContainText(
    "Worked for 12s",
  );
  await captureScreenshot(page, testInfo, "on-again-done");
});
