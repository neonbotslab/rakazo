import { expect, test } from "@playwright/test";
import { captureScreenshot } from "../helpers/helpers";

const fixture = "/e2e/fixtures/live-reasoning.html";
const text = "Compare the two calendars for Tuesday and Thursday.";

test("reasoning replaces Thinking and can be reopened above Done in the reply", async ({
  page,
}, testInfo) => {
  await page.goto(`${fixture}?phase=waiting`);
  await expect(page.getByText("Thinking…", { exact: true })).toBeVisible();

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "390px", width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"]) {
      await page.goto(`${fixture}?phase=live&theme=${theme}`);
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
      await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
      await captureScreenshot(page, testInfo, `live-${viewport.name}-${theme}`);

      await page.goto(`${fixture}?phase=collapsed&theme=${theme}`);
      const reply = page.locator('[data-message-id="reply"]');
      await expect(reply.getByText("Tuesday afternoon works for both of you.")).toBeVisible();
      const card = reply.getByTestId("message-bot-bubble");
      const disclosure = card.getByRole("button", { name: "Thought for 2m05s" });
      const summary = card.getByRole("button", { name: /Done.*2 tools/ });
      await expect(summary).toBeVisible();
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await expect(reply.getByText(text)).toBeHidden();
      await captureScreenshot(page, testInfo, `collapsed-${viewport.name}-${theme}`);

      await disclosure.click();
      await expect(reply.getByText(text)).toBeVisible();
      expect((await disclosure.boundingBox())!.y).toBeLessThan((await summary.boundingBox())!.y);
      await captureScreenshot(page, testInfo, `expanded-${viewport.name}-${theme}`);
    }
  }
});
