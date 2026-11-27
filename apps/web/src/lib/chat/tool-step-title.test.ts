import { setupI18n } from "@lingui/core";
import { expect, it } from "vitest";
import { toolStepTitle } from "./tool-step-title";

const i18n = setupI18n({ locale: "en" });

it("puts the tool, outcomes, run duration and last call previews on separate lines", () => {
  const title = toolStepTitle(
    i18n,
    { label: "Read notes", count: 3, outcomes: { succeeded: 1, failed: 1, stopped: 1 } },
    false,
    { tool: "read_file", input: "notes.txt", output: "File missing" },
    1_250,
  );
  expect(title).toBe(
    "read_file ×3\n1 succeeded, 1 failed, 1 stopped\nRun duration: 1.3s\nLast input: notes.txt\nLast output: File missing",
  );
});

it("uses the existing label and running status before details are available", () => {
  expect(toolStepTitle(i18n, { label: "Read notes", count: 1 }, true)).toBe("Read notes\nRunning");
});

it("caps a long tooltip and keeps both previews visible", () => {
  const title = toolStepTitle(
    i18n,
    {
      label: "Read notes",
      count: 3,
      outcomes: { succeeded: 1, failed: 1, stopped: 1 },
    },
    false,
    { tool: "t".repeat(150), input: "i".repeat(150), output: "o".repeat(150) },
    1_250,
  );
  expect(title.length).toBe(500);
  expect(title).toContain("\nLast input: iii");
  expect(title).toContain("\nLast output: ooo");
  expect(title.endsWith("…")).toBe(true);
});
