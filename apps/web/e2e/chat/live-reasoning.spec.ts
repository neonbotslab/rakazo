import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { ToolCallDetail } from "@rakazo/contracts";
import { procStartResult } from "../fixtures/tool-load-result";
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
    result: "One\nTwo\nThree\nFour\nFive\nSix\nSeven\n[image not kept]",
    hasScreenshot: true,
  },
  "process-tool": { arguments: '{"name":"proc_start"}', result: procStartResult },
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

async function expectTraceAligned(page: Page, trace: Locator) {
  const reply = (await page.getByTestId("message-bot-bubble").first().boundingBox())!;
  const chevron = (await trace.getByRole("button").first().locator("svg").boundingBox())!;
  expect(Math.abs(chevron.x + chevron.width / 2 - reply.x)).toBeLessThan(1);
  const rail = trace.getByTestId("thinking-trace-rail");
  if (await rail.isVisible()) {
    const railX = await rail
      .locator("li")
      .first()
      .evaluate((node) => {
        const offset = Number.parseFloat(getComputedStyle(node, "::before").insetInlineStart);
        return node.getBoundingClientRect().left + offset;
      });
    expect(Math.abs(railX - reply.x)).toBeLessThan(1);
  }
}

async function openProcessToolResult(page: Page, theme: string) {
  await page.goto(`${fixture}?state=result-open&theme=${theme}`);
  const trace = page.getByTestId("thinking-trace");
  await expect(trace).toBeVisible();
  const transcript = page.getByTestId("transcript");
  const closedScrollWidth = await transcript.evaluate((element) => element.scrollWidth);
  await trace.getByRole("button", { name: "Worked for 42s" }).click();
  await trace.getByRole("button", { name: /^Looked up a tool's settings/ }).click();
  await expect(trace.getByText("Read only", { exact: true })).toBeVisible();
  await expect(trace.getByText("No", { exact: true })).toBeVisible();
  return { trace, transcript, closedScrollWidth };
}

async function expectResultGroupLayout(
  group: Locator,
  label: Locator,
  siblingValue: Locator,
  stacked: boolean,
) {
  const count = (await group.getByText("4 fields", { exact: true }).boundingBox())!;
  const labelBox = (await label.boundingBox())!;
  const valueBox = (await siblingValue.boundingBox())!;
  const chevron = (await group.locator("svg").boundingBox())!;
  const button = (await group.boundingBox())!;
  expect(count.x).toBe(valueBox.x);
  if (stacked) {
    expect(count.x).toBe(labelBox.x);
    expect(count.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height);
  } else {
    expect(count.x).toBeGreaterThan(labelBox.x + labelBox.width);
    expect(count.y + count.height / 2).toBeCloseTo(labelBox.y + labelBox.height / 2, 0);
  }
  expect(chevron.width).toBe(12);
  expect(chevron.x - (count.x + count.width)).toBeCloseTo(4, 0);
  expect(button.x + button.width - (chevron.x + chevron.width)).toBeCloseTo(4, 0);
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
  const text = page.getByText("One Two Three Four Five Six Seven", { exact: true });
  const textHeight = () =>
    text.evaluate((node) => ({
      visible: node.clientHeight,
      full: node.scrollHeight,
      line: Number.parseFloat(getComputedStyle(node).lineHeight),
    }));
  const collapsed = await textHeight();
  expect(collapsed.visible).toBeCloseTo(collapsed.line * 3, 0);
  expect(collapsed.full).toBeGreaterThan(collapsed.visible);
  await page.getByRole("button", { name: "Show more" }).click();
  const expanded = await textHeight();
  expect(expanded.visible).toBe(expanded.full);
  await page.getByRole("button", { name: "Show raw" }).last().click();
  expect(await page.locator("pre").textContent()).toBe("One\nTwo\nThree\nFour\nFive\nSix\nSeven");
  await expect(page.getByText("Took a screenshot (not shown)")).toBeVisible();
  await expect(page.getByText("Open 1:00–3:00 PM Central")).toBeVisible();
  expect(requests).toEqual(["repeated", "repeat"]);
});

test("fits three consecutive calls on the rail at mouse and touch sizes", async ({
  browser,
}, testInfo) => {
  for (const width of [1280, 390]) {
    for (const hasTouch of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch });
      try {
        const page = await context.newPage();
        const pointer = hasTouch ? "coarse" : "fine";
        expect(
          await page.evaluate((value) => matchMedia(`(pointer: ${value})`).matches, pointer),
        ).toBe(true);
        for (const theme of ["light", "dark"]) {
          await page.goto(`${fixture}?state=tools-only&theme=${theme}`);
          const trace = page.getByTestId("thinking-trace");
          await trace.getByRole("button", { name: "Worked for 42s" }).click();
          const rail = trace.getByTestId("thinking-trace-rail");
          const calls = rail.getByRole("button");
          await expect(calls).toHaveCount(3);
          const row = await calls.evaluateAll((buttons) =>
            buttons.map((button) => {
              const { top, height } = button.getBoundingClientRect();
              return { top, height };
            }),
          );
          const height = hasTouch ? 48 : 32;
          expect(row.map((call) => call.height)).toEqual([height, height, height]);
          expect(row.map((call) => call.top - row[0]!.top)).toEqual([0, height, height * 2]);
          const summary = (await trace.getByRole("button").first().boundingBox())!;
          const reply = (await page.getByTestId("message-bot-bubble").boundingBox())!;
          expect(row[0]!.top - (summary.y + summary.height)).toBe(4);
          expect(reply.y - (row[2]!.top + height)).toBe(16);
          await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
          await expectTraceAligned(page, trace);
          await page.mouse.move(width - 1, 0);
          await captureScreenshot(page, testInfo, `tools-only-${pointer}-${width}-${theme}`);
        }
      } finally {
        await context.close();
      }
    }
  }
});

test("reads a tool result as fields, one schema level, or raw text", async ({ page }, testInfo) => {
  await interceptDetails(page, []);
  for (const width of [1280, 390]) {
    const height = width === 390 ? 844 : 1000;
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      const { trace, transcript, closedScrollWidth } = await openProcessToolResult(page, theme);
      const schema = trace.getByRole("button", { name: "Input schema 4 fields" });
      await expect(schema).toHaveAttribute("aria-expanded", "false");
      await expect(trace.getByText("Properties", { exact: true })).toHaveCount(0);
      await expectResultGroupLayout(
        schema,
        trace.getByText("Input schema", { exact: true }),
        trace.getByText("warden.proc_start", { exact: true }),
        width === 390,
      );
      const footer = trace.locator("footer");
      const showRaw = footer.getByRole("button", { name: "Show raw" });
      const status = (await footer.getByText("Succeeded", { exact: true }).boundingBox())!;
      await expect(footer.getByText("Took 1.2s", { exact: true })).toBeVisible();
      const showRawBox = (await showRaw.boundingBox())!;
      expect(showRawBox.height).toBe(32);
      expect(showRawBox.x).toBeGreaterThan(status.x + status.width);
      expect(showRawBox.y + showRawBox.height / 2).toBe(status.y + status.height / 2);

      const capture = async (mode: string) => {
        const extraHeight = await transcript.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        );
        if (extraHeight > 0) {
          const viewport = page.viewportSize()!;
          await page.setViewportSize({ width, height: viewport.height + extraHeight });
        }
        await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
        await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
        await expect(transcript).toHaveJSProperty("scrollWidth", closedScrollWidth);
        expect(await trace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(
          0,
        );
        await expectTraceAligned(page, trace);
        await page.mouse.move(width - 1, 0);
        await captureScreenshot(page, testInfo, `result-${mode}-${width}-${theme}`);
      };

      await capture("fields");
      await schema.click();
      const properties = trace.getByRole("button", { name: "Properties 4 fields" });
      await expect(properties).toHaveAttribute("aria-expanded", "false");
      await expectResultGroupLayout(
        properties,
        trace.getByText("Properties", { exact: true }),
        trace.getByText("object", { exact: true }),
        width === 390,
      );
      await expect(trace.getByText("agent, command", { exact: true })).toBeVisible();
      await expect(trace.getByText("Command to start.", { exact: true })).toHaveCount(0);
      const typeLabel = (await trace.getByText("Type", { exact: true }).boundingBox())!;
      const typeValue = (await trace.getByText("object", { exact: true }).boundingBox())!;
      if (width === 390) {
        expect(typeValue.y).toBeGreaterThanOrEqual(typeLabel.y + typeLabel.height);
      } else {
        expect(typeValue.y).toBe(typeLabel.y);
      }
      await capture("schema");

      await showRaw.click();
      await expect(footer.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
      const raw = trace.locator("pre");
      await expect(raw).toBeVisible();
      expect(await raw.textContent()).toBe(procStartResult);
      expect(await raw.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(
        0,
      );
      expect((await raw.boundingBox())!.height).toBe(256);
      await expect(schema).toBeHidden();
      await capture("raw");
      await footer.getByRole("button", { name: "Show fields" }).click();
      await expect(schema).toHaveAttribute("aria-expanded", "true");
    }
  }
});

test("keeps result controls tappable on a phone", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await interceptDetails(page, []);
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      const { trace, transcript, closedScrollWidth } = await openProcessToolResult(page, theme);
      const controls = [
        trace.getByRole("button", { name: "Show more" }),
        trace.getByRole("button", { name: "Input schema 4 fields" }),
        trace.locator("footer").getByRole("button", { name: "Show raw" }),
      ];
      for (const control of controls) {
        await expect(control).toBeVisible();
        expect((await control.boundingBox())!.height).toBe(48);
      }
      const extraHeight = await transcript.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      );
      if (extraHeight > 0) await page.setViewportSize({ width: 390, height: 844 + extraHeight });
      await expect(transcript).toHaveJSProperty("scrollWidth", closedScrollWidth);
      await expectTraceAligned(page, trace);
      await captureScreenshot(page, testInfo, `result-fields-390-${theme}-coarse`);
    }
  } finally {
    await context.close();
  }
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
        if (state === "finished-open") {
          const rail = trace.getByTestId("thinking-trace-rail");
          const gaps = await rail
            .locator(":scope > li > :is(p, button)")
            .evaluateAll((entries) =>
              entries
                .slice(1)
                .map(
                  (entry, index) =>
                    entry.getBoundingClientRect().top -
                    entries[index]!.getBoundingClientRect().bottom,
                ),
            );
          expect(gaps).toEqual([8, 0, 8, 8, 8]);
        } else if (state === "tool-open") {
          const alex = trace.getByRole("button", { name: /^Checked Alex’s calendar/ });
          const dana = trace.getByRole("button", { name: /^Checked Dana/ });
          expect((await dana.boundingBox())!.y - (await alex.boundingBox())!.y).toBe(32);
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
        if (state !== "running-open") {
          await expectTraceAligned(page, trace);
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
