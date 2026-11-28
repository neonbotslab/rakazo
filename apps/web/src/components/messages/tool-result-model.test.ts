import { expect, it } from "vitest";
import { procStartResult } from "../../../e2e/fixtures/tool-load-result";
import { parseToolResult, retainedToolResult } from "./tool-result-model";

it("decodes JSON sent as a string", () => {
  expect(parseToolResult(JSON.stringify('{"input_schema":{"isOptional":false}}'))).toEqual({
    kind: "object",
    fields: [
      {
        key: "input_schema",
        label: "Input schema",
        value: {
          kind: "object",
          fields: [
            {
              key: "isOptional",
              label: "Is optional",
              value: { kind: "scalar", value: false },
            },
          ],
        },
      },
    ],
  });
});

it("decodes a JSON boolean sent as a string", () => {
  expect(parseToolResult('"false"')).toEqual({ kind: "scalar", value: false });
});

it("keeps decoded plain text and its line breaks", () => {
  expect(parseToolResult('"one\\ntwo"')).toEqual({ kind: "scalar", value: "one\ntwo" });
});

it("keeps short lists inline and preserves typed scalars", () => {
  expect(parseToolResult('["agent","command",2,true,null]')).toEqual({
    kind: "inline-list",
    items: ["agent", "command", 2, true, null],
  });
});

it("keeps arrays of objects nested", () => {
  expect(parseToolResult('[{"HTTPStatus":200}]')).toEqual({
    kind: "array",
    items: [
      {
        kind: "object",
        fields: [
          { key: "HTTPStatus", label: "Http status", value: { kind: "scalar", value: 200 } },
        ],
      },
    ],
  });
});

it("keeps invalid JSON verbatim as plain text", () => {
  const text = '  {"truncated":\n';
  expect(parseToolResult(text)).toEqual({ kind: "scalar", value: text });
});

it("formats the tool-load result as fields with a nested input schema", () => {
  const result = parseToolResult(procStartResult);
  expect(result).toMatchObject({
    kind: "object",
    fields: [
      { label: "Id", value: { kind: "scalar", value: "warden.proc_start" } },
      { label: "Name", value: { kind: "scalar", value: "proc_start" } },
      { label: "Description", value: { kind: "scalar" } },
      {
        label: "Input schema",
        value: {
          fields: [
            { label: "Type", value: { kind: "scalar", value: "object" } },
            { label: "Properties", value: { kind: "object" } },
            { label: "Required", value: { kind: "inline-list", items: ["agent", "command"] } },
            { label: "Additional properties", value: { kind: "scalar", value: false } },
          ],
        },
      },
    ],
  });
});

it("preserves the exact retained text when it has no image marker", () => {
  const text = "  Example\n  ";
  expect(retainedToolResult(text)).toEqual({ text, image: undefined });
});

it("omits the marker but retains text alongside a screenshot", () => {
  expect(retainedToolResult("Observed\n[image not kept]", true)).toEqual({
    text: "Observed",
    image: "screenshot",
  });
});

it("leaves a legacy image-only result with only its notice", () => {
  expect(retainedToolResult("[image not kept]")).toEqual({ text: "", image: "image" });
});
