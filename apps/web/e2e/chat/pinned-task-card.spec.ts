import { expect, test } from "@playwright/test";
import type { HostPluginTaskCard, ThreadSnapshot } from "@rakazo/contracts";
import {
  activeBotId,
  captureScreenshot,
  completeOnboarding,
  refocus,
  rpc,
  signup,
} from "../helpers/helpers";

const conversation = [
  "Can you review the launch checklist?",
  "I'll check the rollout steps and flag anything that still needs a decision.",
  "Start with the release notes and the rollback plan.",
  "The release notes are drafted. The rollback plan needs an owner for each step.",
  "How does the staged rollout look?",
  "The first stage is ready. I'll verify the checks we need before widening the rollout.",
  "Please include the support handoff.",
  "I added the handoff and checked the links in the playbook.",
  "Can you also check the owner for the final sign-off?",
  "The owner is listed in the checklist. I prepared the summary for review.",
  "Keep the summary short. I'll review it here before we send it.",
  "The launch checklist is ready. The summary is waiting for your approval.",
];

test("pins the active task above the composer in a direct chat", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("rakazo.uiAppearance", "system"));
  await signup(page, `task-cards-${Date.now()}@example.test`, "password12", "Demo User");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  const member = await rpc<{ id: string }>(page, "bots/create", {
    name: "Researcher",
    description: "",
    notifyOnFinish: true,
    computerMode: "team",
  });
  const group = await rpc<{ id: string }>(page, "groups/create", {
    name: "Launch team",
    botIds: [botId, member.id],
  });

  const now = Date.now();
  const approval: HostPluginTaskCard = {
    id: "summary",
    title: "Review the launch summary",
    status: "awaitingApproval",
    startedAt: now - 140_000,
    href: "https://example.test/tasks/summary",
  };
  const running: HostPluginTaskCard = {
    id: "rollout",
    title: "Check the rollout steps",
    status: "running",
    startedAt: now - 75_000,
    href: "https://example.test/tasks/rollout",
    progress: 0.65,
  };
  let tasks: HostPluginTaskCard[] = [];
  await page.route("**/rpc/hostPlugins/list", (route) =>
    route.fulfill({
      json: { json: [{ id: "test/tasks", name: "Tasks", enabled: true, chatCards: true }] },
    }),
  );
  await page.route("**/rpc/hostPlugins/chatCards", (route) =>
    route.fulfill({ json: { json: tasks } }),
  );
  await page.route(/\/rpc\/(bootstrap|threads\/get)$/, async (route) => {
    const response = await route.fetch();
    const body: { json: ThreadSnapshot | { thread?: ThreadSnapshot } } = await response.json();
    const thread = "threadId" in body.json ? body.json : body.json.thread;
    if (thread?.botId === botId) {
      thread.messages = conversation.map((text, index) => ({
        id: `fixture-message-${index}`,
        threadId: thread.threadId,
        seq: index + 1,
        role: index % 2 === 0 ? "user" : "bot",
        botId,
        blocks: [{ kind: "text", text }],
        createdAt: new Date(now - (conversation.length - index) * 60_000).toISOString(),
      }));
      thread.cursor = conversation.length;
    }
    await route.fulfill({ response, json: body });
  });

  const initialCards = page.waitForResponse("**/rpc/hostPlugins/chatCards");
  await page.reload();
  await initialCards;
  const transcript = page.getByTestId("transcript");
  const latest = transcript.getByText(conversation.at(-1)!, { exact: true });
  const composer = page.getByRole("combobox", { name: "Message Chief" });
  const approvalLink = page.getByRole("link", { name: /Review the launch summary/ });
  const card = page.locator('[data-slot="card"]').filter({ has: approvalLink });
  const distanceFromEnd = () =>
    transcript.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop));
  await expect(latest).toBeInViewport();
  await expect.poll(distanceFromEnd).toBeLessThan(1);
  await expect(approvalLink).toHaveCount(0);

  tasks = [running, approval];
  await refocus(page);
  await expect(card).toBeVisible();
  await expect.poll(distanceFromEnd).toBeLessThan(1);
  await expect(transcript.getByRole("link", { name: /Review the launch summary/ })).toHaveCount(0);

  const next = page.getByRole("button", { name: "Next task" });
  await next.focus();
  await next.press("Enter");
  await expect(next).toBeFocused();
  await expect(page.getByRole("link", { name: /Check the rollout steps/ })).toBeVisible();
  await page.getByRole("button", { name: "Previous task" }).press("Enter");
  await expect(card).toBeVisible();
  await page.mouse.click(4, 4);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect.poll(distanceFromEnd).toBeLessThan(1);
      const latestBox = await latest.boundingBox();
      const cardBox = await card.boundingBox();
      const composerBox = await composer.boundingBox();
      expect(latestBox!.y + latestBox!.height).toBeLessThan(cardBox!.y);
      expect(cardBox!.y + cardBox!.height).toBeLessThan(composerBox!.y);
      await captureScreenshot(page, testInfo, `pinned-task-card-${viewport.width}-${theme}`);
    }
  }

  await transcript.evaluate((el) => el.scrollTo(0, 0));
  await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
  await next.click();
  await expect(page.getByRole("link", { name: /Check the rollout steps/ })).toBeVisible();
  await expect.poll(distanceFromEnd).toBeGreaterThan(80);

  await page.goto(`/app/g/${group.id}`);
  await expect(page.getByRole("combobox", { name: "Message Launch team" })).toBeVisible();
  await expect(next).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
});
