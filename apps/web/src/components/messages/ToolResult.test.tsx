// @vitest-environment jsdom

import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolResult } from "./ToolResult";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function findButton(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label && !button.closest("[hidden]"),
  );
}

async function clickButton(label: string) {
  const button = findButton(label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
  return button;
}

async function render(text: string) {
  await act(async () => root.render(<ToolResult text={text} />));
}

it("opens nested groups one level at a time", async () => {
  await render('{"inputSchema":{"properties":{"command":"example"},"required":["command"]}}');
  expect(container.textContent).not.toContain("Properties");

  const schema = await clickButton("Input schema 2 fields");
  expect(schema.getAttribute("aria-expanded")).toBe("true");
  const panelId = schema.getAttribute("aria-controls");
  expect(panelId && document.getElementById(panelId)?.hidden).toBe(false);
  expect(container.textContent).toContain("Required");
  expect(container.textContent).not.toContain("example");

  await clickButton("Properties 1 field");
  expect(container.textContent).toContain("example");
  await clickButton("Input schema 2 fields");
  expect(container.textContent).not.toContain("Properties");
});

it("lets readers expand and collapse visually overflowing text", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(80);
  await render("First\nSecond\nThird\nFourth");

  const show = await clickButton("Show more");
  expect(show.getAttribute("aria-expanded")).toBe("true");
  expect(show.textContent).toBe("Show less");

  const hide = await clickButton("Show less");
  expect(hide.getAttribute("aria-expanded")).toBe("false");
  expect(hide.textContent).toBe("Show more");
});

it("shows no text disclosure when the measured content fits", async () => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(60);
  await render("First\nSecond\nThird");
  expect(findButton("Show more")).toBeUndefined();
});

it("restores the expanded fields after showing the exact raw text", async () => {
  const text = '  {"inputSchema":{"valid":true,"optional":null,"required":false}}\n';
  await render(text);
  const schema = await clickButton("Input schema 3 fields");
  expect(container.textContent).toContain("Yes");
  expect(container.textContent).toContain("None");
  expect(container.textContent).toContain("No");

  await clickButton("Show raw");
  expect(findButton("Input schema 3 fields")).toBeUndefined();
  expect(container.querySelector("pre")?.textContent).toBe(text);

  await clickButton("Show fields");
  expect(container.querySelector("pre")).toBeNull();
  expect(findButton("Input schema 3 fields")).toBe(schema);
  expect(schema.getAttribute("aria-expanded")).toBe("true");
});

it("copies the exact retained raw text and confirms the copy", async () => {
  const text = "  First\nSecond\n  ";
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  await render(text);
  await clickButton("Show raw");
  await clickButton("Copy");

  expect(writeText).toHaveBeenCalledWith(text);
  expect(findButton("Copied")).toBeDefined();
});
