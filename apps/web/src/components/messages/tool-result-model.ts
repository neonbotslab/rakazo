import { parseDetail, readableName } from "./thinking-trace-model";

type ResultScalar = string | number | boolean | null;

export type ResultValue =
  | { kind: "scalar"; value: ResultScalar }
  | { kind: "inline-list"; items: ResultScalar[] }
  | { kind: "object"; fields: { key: string; label: string; value: ResultValue }[] }
  | { kind: "array"; items: ResultValue[] };

const imageMarker = "[image not kept]";

export function retainedToolResult(result?: string, hasScreenshot?: true) {
  const hasImageMarker = result?.includes(imageMarker);
  return {
    text: hasImageMarker ? result?.replaceAll(imageMarker, "").trim() : result,
    image: hasScreenshot ? "screenshot" : hasImageMarker ? "image" : undefined,
  };
}

function fieldLabel(key: string): string {
  const words = readableName(key.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")).toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function isScalar(item: unknown): item is ResultScalar {
  return (
    item === null ||
    typeof item === "boolean" ||
    typeof item === "number" ||
    typeof item === "string"
  );
}

function formatValue(value: unknown): ResultValue {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    if (items.length && items.every(isScalar)) {
      const joined = items.map(String).join(", ");
      if (joined.length <= 80 && !/[\r\n\u2028\u2029]/.test(joined)) {
        return { kind: "inline-list", items };
      }
    }
    return { kind: "array", items: items.map(formatValue) };
  }
  if (value && typeof value === "object") {
    return {
      kind: "object",
      fields: Object.entries(value).map(([key, item]) => ({
        key,
        label: fieldLabel(key),
        value: formatValue(item),
      })),
    };
  }
  return { kind: "scalar", value: isScalar(value) ? value : String(value) };
}

export function parseToolResult(text: string): ResultValue {
  const value = parseDetail(text);
  return formatValue(typeof value === "string" && value !== text ? parseDetail(value) : value);
}
