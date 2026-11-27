import { expect, it } from "vitest";
import { HostPluginTaskCardSchema } from "./host-plugins.js";

const card = {
  id: "task-1",
  title: "Review the draft",
  status: "running",
  startedAt: 1_700_000_000_000,
  progress: 0.25,
  href: "https://example.test/t/task-1",
};

it("accepts a task link and rejects non-HTTP URLs", () => {
  expect(HostPluginTaskCardSchema.parse(card)).toEqual(card);
  expect(HostPluginTaskCardSchema.safeParse({ ...card, href: "javascript:void(0)" }).success).toBe(
    false,
  );
});
