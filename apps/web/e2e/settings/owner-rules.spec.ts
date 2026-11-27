import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  openUserSettings,
  signup,
} from "../helpers/helpers";

test("bot rules can be previewed, saved, discarded, and restored", async ({ page }, testInfo) => {
  await signup(page, `bot-rules-${Date.now()}@rakazo.test`, "password12", "Rules editor");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  const rulesNav = settings.getByRole("button", { name: "Bot rules", exact: true });
  await expect(rulesNav).toHaveAttribute("data-testid", "settings-nav-bot-rules");
  expect(await rulesNav.evaluate((item) => item.previousElementSibling?.textContent)).toBe(
    "Memory",
  );
  await rulesNav.click();
  await expect(page).toHaveURL(/settings=bot-rules/);

  const rules = settings.getByRole("textbox", { name: "Rules", exact: true });
  const preview = settings.getByTestId("owner-rules-preview");
  const showPreview = settings.getByRole("button", { name: "What bots see" });
  const save = settings.getByRole("button", { name: "Save", exact: true });
  await expect(rules).toHaveAttribute("maxlength", "4000");
  await expect(showPreview).toHaveCount(0);
  await expect(save).toBeDisabled();

  const original = "  Keep replies brief.\nList decisions before next steps.  ";
  const block = `Rules from the person you are working for. Every bot follows them, in every reply and task.
They outrank your own instructions, skills, and memory. Rakazo's safety and approval rules still come first, and if this conversation explicitly asks for something different, do that for that request.
<owner_rules>
${original}
</owner_rules>`;
  await rules.fill(original);
  await expect(settings.getByText(`${original.length} / 4,000 characters`)).toBeVisible();
  await expect(settings.getByText(/≈[1-9]\d* tokens/)).toBeVisible();
  await showPreview.click();
  await expect(preview).toHaveJSProperty("textContent", block);
  await save.click();
  await expect(rules).toBeEditable();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(rules).toHaveValue(original);

  await rules.fill("Discard this draft.");
  await settings.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(rules).toHaveValue(original);

  await rules.fill("Use short paragraphs.");
  await save.click();
  await expect(rules).toBeEditable();
  await expect(save).toBeDisabled();
  const historyButton = settings.getByRole("button", { name: "Version history" });
  await historyButton.click();
  const history = page.getByRole("dialog", { name: "Version history" });
  const versions = history.getByRole("listitem");
  await expect(versions).toHaveCount(2);
  const oldest = versions.last();
  await oldest.getByRole("button").click();
  await expect(oldest.locator("pre")).toHaveJSProperty("textContent", original);
  await oldest.getByRole("button", { name: "Restore" }).click();
  await expect(versions).toHaveCount(3);
  await oldest.getByRole("button", { name: "Restore" }).focus();
  await page.keyboard.press("Escape");
  await expect(history).toBeHidden();
  await expect(rules).toHaveValue(original);
  await showPreview.click();
  await expect(preview).toHaveJSProperty("textContent", block);
  await expect(preview).toBeInViewport({ ratio: 1 });

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await captureScreenshot(page, testInfo, `owner-rules-${colorScheme}`);
  }
});
