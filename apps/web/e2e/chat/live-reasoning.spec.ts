import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { ToolCallDetail } from "@rakazo/contracts";
import { captureScreenshot } from "../helpers/helpers";

const fixture = "/e2e/fixtures/live-reasoning.html";
const asked = JSON.stringify({
  person: "Dana Ruiz",
  range: "Mon 30 Nov to Fri 4 Dec",
  calendar: "Work",
});
const askedWednesday = JSON.stringify({ person: "Alex", range: "Wed 2 Dec", calendar: "Work" });
const details: Record<string, ToolCallDetail> = {
  dana: {
    arguments: asked,
    result: JSON.stringify({
      Mon: "Full",
      Tue: "Open 1:00–4:30 PM Central",
      Wed: "Focus 10:00 AM–3:00 PM",
      Thu: "No details kept",
      Fri: "Travel",
    }),
  },
  repeated: {
    arguments: askedWednesday,
    result: JSON.stringify({ Wed: "Open 1:00–3:00 PM Central" }),
  },
  repeat: {
    arguments: askedWednesday,
    result: "One\nTwo\nThree\nFour\nFive\nSix\nSeven",
    hasScreenshot: true,
  },
  failed: { arguments: asked, failed: true, result: "Calendar request timed out." },
  active: { arguments: asked },
};
const cases = [
  "finished-closed",
  "finished-open",
  "tool-open",
  "group-open",
  "error-open",
  "running-open",
  "long",
  "two-bot",
] as const;

async function interceptDetails(page: Page, requests: string[]) {
  await page.route(/\/rpc\/threads\/(?:liveToolCallDetail|toolCallDetail)$/, async (route) => {
    const { json } = route.request().postDataJSON();
    requests.push(json.callId);
    await route.fulfill({ json: { json: details[json.callId] ?? null } });
  });
}

test("live reasoning stays under one disclosure as the turn starts", async ({ page }) => {
  await page.goto(fixture);
  const summary = page.getByRole("button", { name: "Thinking…" });
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await page.goto(`${fixture}?state=thinking`);
  await summary.click();
  await expect(page.getByText("I should check both calendars", { exact: false })).toBeVisible();
});

test("names the calls in a repeat group and keeps several calls open", async ({ page }) => {
  const requests: string[] = [];
  await interceptDetails(page, requests);
  await page.goto(`${fixture}?state=group-open`);
  await page.getByRole("button", { name: "Worked for 6s" }).click();
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: /×2/ }).click();
  const first = page.getByRole("button", { name: "Alex · Call 1", exact: true });
  const second = page.getByRole("button", { name: "Alex · Call 2", exact: true });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(requests).toEqual(["repeated"]);
  await first.click();
  await expect(page.getByText("Open 1:00–3:00 PM Central")).toBeVisible();
  await second.click();
  await expect(page.getByText("Took a screenshot (not shown)")).toBeVisible();
  await expect(page.getByText("Seven", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByText("Seven", { exact: true })).toBeVisible();
  await expect(page.getByText("Open 1:00–3:00 PM Central")).toBeVisible();
  expect(requests).toEqual(["repeated", "repeat"]);
});

test("matches the timeline states across widths and themes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await interceptDetails(page, []);
  for (const width of [1280, 390]) {
    const height = width === 390 ? 844 : 1000;
    for (const theme of ["light", "dark"]) {
      for (const [index, state] of cases.entries()) {
        await page.setViewportSize({ width, height });
        await page.goto(`${fixture}?state=${state}&theme=${theme}`);
        const traces = page.getByTestId("thinking-trace");
        const trace = traces.first();
        const summary = trace.getByRole("button").first();
        await expect(traces).toHaveCount(state === "two-bot" ? 3 : 1);
        await expect(summary).toHaveAttribute("aria-expanded", "false");
        if (state !== "finished-closed") await summary.click();
        const names = page.getByTestId("bot-sender-name");
        if (state === "two-bot") {
          await expect(names).toHaveText(["Chief", "Atlas"]);
          const chief = page.locator('[data-message-id="chief-reply"]');
          const followUp = page.locator('[data-message-id="chief-follow-up"]');
          const chiefBubble = (await chief.getByTestId("message-bot-bubble").boundingBox())!;
          const followUpDisclosure = (await followUp
            .getByRole("button", { name: "Worked for 4s" })
            .boundingBox())!;
          expect(followUpDisclosure.y - (chiefBubble.y + chiefBubble.height)).toBe(8);

          for (const [id, previousId, bubbleTestId] of [
            ["chief-reply", "question", "message-user-bubble"],
            ["atlas-reply", "chief-follow-up", "message-bot-bubble"],
          ] as const) {
            const previousBubble = page
              .locator(`[data-message-id="${previousId}"]`)
              .getByTestId(bubbleTestId);
            const previousBox = (await previousBubble.boundingBox())!;
            const row = page.locator(`[data-message-id="${id}"]`);
            const name = row.getByTestId("bot-sender-name");
            const disclosure = row.getByTestId("thinking-trace").getByRole("button").first();
            const nameBox = (await name.boundingBox())!;
            expect
              .soft(
                nameBox.y - (previousBox.y + previousBox.height),
                `${width} ${theme} spacing above ${id}`,
              )
              .toBe(32);
            const disclosureBox = (await disclosure.boundingBox())!;
            const chevronBox = (await disclosure.locator("svg").boundingBox())!;
            expect(Math.abs(nameBox.x - (chevronBox.x + chevronBox.width / 2))).toBeLessThan(1);
            expect(disclosureBox.y - (nameBox.y + nameBox.height)).toBe(4);
          }
        } else {
          await expect(names).toHaveCount(0);
        }
        if (state === "long") {
          await expect(trace.getByText("Checked Alex’s calendar", { exact: true })).toBeVisible();
          await expect(
            trace.getByText("Checked Alex’s calendar for Wednesday ×2", { exact: true }),
          ).toBeVisible();
        }
        if (state === "tool-open") {
          const alex = trace.getByRole("button", { name: /^Checked Alex’s calendar/ });
          const dana = trace.getByRole("button", { name: /^Checked Dana/ });
          expect((await dana.boundingBox())!.y - (await alex.boundingBox())!.y).toBe(56);
          await dana.click();
          await expect(trace.getByText("Open 1:00–4:30 PM Central")).toBeVisible();
        } else if (state === "group-open") {
          await trace.getByRole("button", { name: /×2/ }).click();
          await trace.getByRole("button", { name: "Alex · Call 1", exact: true }).click();
          await expect(trace.getByText("Open 1:00–3:00 PM Central")).toBeVisible();
        } else if (state === "error-open") {
          await trace.getByRole("button", { name: /Couldn’t reach Dana/ }).click();
          await expect(trace.getByText("Calendar request timed out.")).toBeVisible();
        } else if (state === "running-open") {
          await trace.getByRole("button", { name: /Checking calendars.*Running/ }).click();
          await expect(trace.getByText("Waiting for the result…")).toBeVisible();
          await expect(trace.getByText("Dana Ruiz")).toBeVisible();
        }
        const transcript = page.getByTestId("transcript");
        const extraHeight = await transcript.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        );
        if (extraHeight > 0) await page.setViewportSize({ width, height: height + extraHeight });
        await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
        await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
        const reply = page.getByTestId("message-bot-bubble").first();
        if (state !== "running-open") {
          const chevron = summary.locator("svg");
          const chevronBox = (await chevron.boundingBox())!;
          const replyBox = (await reply.boundingBox())!;
          expect(Math.abs(chevronBox.x + chevronBox.width / 2 - replyBox.x)).toBeLessThan(1);
          if (state !== "finished-closed") {
            const railX = await trace
              .getByTestId("thinking-trace-rail")
              .locator("li")
              .first()
              .evaluate((node) => {
                const offset = Number.parseFloat(
                  getComputedStyle(node, "::before").insetInlineStart,
                );
                return node.getBoundingClientRect().left + offset;
              });
            expect(Math.abs(railX - replyBox.x)).toBeLessThan(1);
          }
        }
        await page.mouse.move(width - 1, 0);
        await captureScreenshot(
          page,
          testInfo,
          `${width}-${theme}-${String(index + 1).padStart(2, "0")}-${state}`,
        );
      }
    }
  }
});
