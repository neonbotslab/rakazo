import { expect, test } from "@playwright/test";

import {
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  signup,
} from "../helpers/helpers";

test.use({ actionTimeout: 10_000 });

test("bot rules autosave after typing stops", async ({ page }) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  await settings.getByRole("button", { name: "Bot rules", exact: true }).click();

  const rules = settings.getByRole("textbox");
  await rules.fill("Keep replies brief.");
  await expect(settings.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.reload();
  await expect(rules).toHaveValue("Keep replies brief.");
});

test("bot rules group saves in history and restore the exact text", async ({ page }, testInfo) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  const nav = settings.getByRole("button", { name: "Bot rules", exact: true });
  expect(await nav.evaluate((item) => item.previousElementSibling?.textContent)).toBe("Memory");
  await nav.click();

  const title = settings.getByRole("heading", { name: "Bot rules" });
  await expect(title).toBeFocused();
  await expect(nav).toHaveAttribute("aria-current", "page");
  const rules = settings.getByRole("textbox", { name: "Your rules" });
  const history = settings.getByRole("button", { name: "Version history" });
  const disclosure = settings.getByRole("button", { name: "What bots see" });
  const saved = settings.getByRole("status").getByText("Saved", { exact: true });
  const versions = settings.getByRole("listitem");
  await expect(history).toHaveCount(0);
  await disclosure.click();
  await expect(settings.getByText("Bots get nothing while this is empty.")).toBeVisible();
  await disclosure.click();

  await rules.fill("Keep replies brief.");
  await title.click();
  await expect(saved).toBeVisible();
  const original = "  Keep replies brief.\nList decisions before next steps.  ";
  await rules.fill(original.trim());
  await expect(settings.getByRole("status")).toHaveText("Saving…");
  await title.click();
  await expect(saved).toBeVisible();
  await history.click();
  await expect(versions).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute("aria-expanded", "false");

  await rules.fill(original);
  await settings.getByTestId("settings-nav-memory").click();
  await expect(settings).toHaveAttribute("data-settings-section", "memory");
  await nav.click();
  await expect(rules).toHaveValue(original);
  await rules.fill("Use short paragraphs and bulleted lists.");
  await settings.getByRole("button", { name: "Close user settings" }).click();
  await expect(settings).toBeHidden();
  await openUserSettings(page);
  await nav.click();
  await expect(rules).toHaveValue("Use short paragraphs and bulleted lists.");
  await history.click();
  await expect(versions).toHaveCount(2);
  const oldest = versions.last();
  await oldest.getByRole("button", { name: /Saved/ }).click();
  await expect(oldest.getByText(original.trim())).toBeVisible();
  await oldest.getByRole("button", { name: "Restore" }).click();
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await expect(rules).toHaveValue(original);
  await expect(saved).toBeVisible();
  await history.click();
  await expect(versions).toHaveCount(3);
  await expect(versions.first()).toContainText("Restored");
  await page.keyboard.press("Escape");

  await disclosure.click();
  const block = `Rules from the person you are working for. Every bot follows them, in every reply and task.
They outrank your own instructions, skills, and memory. Rakazo's safety and approval rules still come first, and if this conversation explicitly asks for something different, do that for that request.
<owner_rules>
${original}
</owner_rules>`;
  await expect(settings.getByTestId("owner-rules-preview")).toHaveJSProperty("textContent", block);
  await captureScreenshot(page, testInfo, "owner-rules-preview");

  await rules.fill("Keep replies brief.");
  await rules.blur();
  await expect(saved).toBeVisible();
  await history.click();
  await expect(versions).toHaveCount(4);
  await page.keyboard.press("Escape");

  const afterIdle = await page.evaluate(() => Date.now() + 5 * 60_000);
  await page.clock.setFixedTime(afterIdle);
  await rules.fill("");
  await rules.blur();
  await expect(saved).toBeVisible();
  await history.click();
  await expect(versions).toHaveCount(5);
  await page.reload();
  await expect(rules).toHaveValue("");
});

test("phone back only confirms discarding over-limit drafts", async ({ page }) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const settings = await openUserSettings(page);
  const nav = settings.getByTestId("settings-nav-bot-rules");
  await nav.click();
  const rules = settings.getByRole("textbox", { name: "Your rules" });

  await rules.fill("Keep replies brief.");
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await expect(settings.getByTestId("settings-nav")).toBeVisible();
  await nav.click();
  await expect(rules).toHaveValue("Keep replies brief.");
  const footer = settings.getByTestId("owner-rules-footer");
  await expect
    .poll(async () => {
      const box = await footer.boundingBox();
      return box && box.y + box.height;
    })
    .toBe(844);

  const overLimit = "🙂".repeat(4_001);
  await rules.fill(overLimit);
  await expect(rules).toHaveAttribute("aria-invalid", "true");
  await expect(settings.getByText("4,001 / 4,000 characters, 1 over")).toBeVisible();
  await expect(settings.getByRole("status")).toHaveText("Not saved");
  await page.keyboard.press("Escape");
  const confirmation = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
  await expect(confirmation.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await confirmation.getByRole("button", { name: "Keep editing" }).click();
  await expect(rules).toHaveValue(overLimit);
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(settings.getByTestId("settings-nav")).toBeVisible();
  await nav.click();
  await expect(rules).toHaveValue("Keep replies brief.");
});

test("a failed save on close keeps the draft available for retry", async ({ page }) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  await settings.getByTestId("settings-nav-bot-rules").click();
  await page.route(
    /\/rpc\/ownerRules\/save(\?|$)/,
    (route) =>
      route.fulfill({
        status: 500,
        json: { json: { code: "INTERNAL_SERVER_ERROR", status: 500, message: "Save failed" } },
      }),
    { times: 1 },
  );

  const rules = settings.getByRole("textbox", { name: "Your rules" });
  await rules.fill("Keep replies brief.");
  await settings.getByRole("button", { name: "Close user settings" }).click();
  await expect(settings.getByRole("alert")).toHaveText("Couldn't save. Your text is still here.");
  await expect(rules).toHaveValue("Keep replies brief.");
  await expect(rules).toBeEditable();
  await settings.getByRole("button", { name: "Try again" }).click();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect(settings.getByRole("status")).toHaveText("Saved");
});
