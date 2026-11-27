import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { OwnerRulesVersion } from "@rakazo/contracts";
import { deferred } from "@rakazo/core/test-async";

import {
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  rpc,
  signup,
} from "../helpers/helpers";

test.use({ actionTimeout: 10_000, timezoneId: "America/Chicago" });

test("bot rules autosave after typing stops", async ({ page }) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  await settings.getByRole("button", { name: "Bot rules", exact: true }).click();

  const rules = settings.getByRole("textbox");
  await rules.fill("Keep replies brief.");
  await expect(settings.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });

  const history = settings.getByRole("button", { name: "Version history" });
  const saving = deferred<void>();
  const release = deferred<void>();
  await page.route(
    /\/rpc\/ownerRules\/save(\?|$)/,
    async (route) => {
      saving.resolve();
      await release.promise;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await rules.fill("Keep replies brief and lead with the answer.");
    await expect(history).toBeVisible();
    await saving.promise;
    await expect(settings.getByRole("status")).toHaveText("Saving…");
    await expect(history).toBeVisible();
  } finally {
    release.resolve();
  }
  await expect(settings.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.reload();
  await expect(rules).toHaveValue("Keep replies brief and lead with the answer.");
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
  const emptyPreview = settings.getByText("Bots get nothing while this is empty.");
  await expect(emptyPreview).toBeVisible();
  await disclosure.click();
  await expect(emptyPreview).toHaveCount(0);

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

test("bot rules history uses the browser time zone", async ({ page }) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  await rpc(page, "preferences/update", { timezone: "UTC" });
  const version = await rpc<OwnerRulesVersion>(page, "ownerRules/save", {
    text: "Keep replies brief.",
    expected: null,
    sessionId: randomUUID(),
  });
  await page.reload();
  await page.getByTestId("timezone-prompt").getByRole("button", { name: "Keep" }).click();
  const settings = await openUserSettings(page);
  await settings.getByTestId("settings-nav-bot-rules").click();
  await settings.getByRole("button", { name: "Version history" }).click();

  const chicago = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  });
  await expect(settings.getByRole("time")).toHaveText(chicago.format(new Date(version.createdAt)));
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
  const keepEditing = confirmation.getByRole("button", { name: "Keep editing" });
  const discard = confirmation.getByRole("button", { name: "Discard", exact: true });
  await expect(keepEditing).toBeFocused();
  const overlay = page.locator('[data-slot="alert-dialog-overlay"]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS("backdrop-filter", "blur(4px)");
  await expect
    .poll(() => overlay.evaluate((element) => document.elementFromPoint(8, 8) === element))
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect(discard).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keepEditing).toBeFocused();
  await keepEditing.click();
  await expect(rules).toHaveValue(overLimit);
  await settings.getByRole("button", { name: "Back", exact: true }).click();
  await discard.click();
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
