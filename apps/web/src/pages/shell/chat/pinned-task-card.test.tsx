// @vitest-environment jsdom

import type { HostPluginTaskCard } from "@rakazo/contracts";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activeTaskCards } from "../../../lib/plugin-host/active-task-cards";
import { PinnedTaskCard } from "./pinned-task-card";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const oldest: HostPluginTaskCard = {
  id: "first",
  title: "Read the draft",
  status: "starting",
  startedAt: 1,
  href: "https://example.test/first",
};
const middle: HostPluginTaskCard = {
  ...oldest,
  id: "middle",
  title: "Check references",
  status: "waiting",
  startedAt: 2,
  href: "https://example.test/middle",
};
const newest: HostPluginTaskCard = {
  ...oldest,
  id: "latest",
  title: "Summarize notes",
  status: "running",
  startedAt: 3,
  href: "https://example.test/latest",
};

function render(...tasks: HostPluginTaskCard[]) {
  act(() => root.render(<PinnedTaskCard tasks={activeTaskCards(tasks)} />));
}

function pageTask(button: "Next task" | "Previous task") {
  const control = container.querySelector<HTMLButtonElement>(`button[aria-label="${button}"]`);
  expect(control).not.toBeNull();
  act(() => control?.click());
}

function expectTask(task: HostPluginTaskCard, page?: string) {
  const links = container.querySelectorAll("a");
  expect(links).toHaveLength(1);
  expect(links[0]?.getAttribute("href")).toBe(task.href);
  expect(links[0]?.textContent).toContain(task.title);
  expect(container.querySelector('[role="status"]')?.textContent).toBe(page);
}

it("hides the card when every task has ended", () => {
  render(
    { ...oldest, status: "done" },
    { ...middle, status: "failed" },
    { ...newest, status: "lost" },
  );
  expect(container.childElementCount).toBe(0);
});

it("shows one active task without pagination", () => {
  render(newest, { ...middle, status: "done" });
  expectTask(newest);
  expect(container.querySelector("button")).toBeNull();
});

it("pages through three active tasks with approval first", () => {
  const approval = { ...oldest, status: "awaitingApproval" } satisfies HostPluginTaskCard;
  render(middle, newest, approval);
  expectTask(approval, "1 of 3");
  expect(container.textContent).toContain("Awaiting approval");
  pageTask("Next task");
  expectTask(newest, "2 of 3");
  pageTask("Next task");
  expectTask(middle, "3 of 3");
  pageTask("Previous task");
  expectTask(newest, "2 of 3");
});

it("keeps the shown task when its position changes and clamps when it ends", () => {
  render(newest, middle, oldest);
  pageTask("Next task");
  expectTask(middle, "2 of 3");

  const approval = { ...oldest, status: "awaitingApproval" } satisfies HostPluginTaskCard;
  render(newest, middle, approval);
  expectTask(middle, "3 of 3");

  render(newest, { ...middle, status: "done" }, approval);
  expectTask(newest, "2 of 2");
  render(newest, middle, approval);
  expectTask(newest, "2 of 3");
});
