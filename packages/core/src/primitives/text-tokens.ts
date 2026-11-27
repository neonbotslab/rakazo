/**
 * Provider-neutral token estimate for text, without a tokenizer. The weights were calibrated
 * across tokenizers for prose, code, JSON, IDs and non-Latin scripts:
 * about 3.3 ASCII characters per token (English prose is nearer 4.5), one token per digit and
 * per camelCase or letter-digit boundary (IDs, hashes, base64), 0.6 per accented Latin, Greek
 * or Cyrillic letter, and 1.25 per UTF-16 unit of other scripts and emoji. Byte-level
 * tokenizers never exceed one token per UTF-8 byte, so that bounds the estimate.
 */
export function estimateTextTokens(text: string): number {
  let total = 0;
  let previous = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    // 1 lowercase, 2 uppercase, 3 digit, 0 anything else.
    const kind =
      code >= 97 && code <= 122
        ? 1
        : code >= 65 && code <= 90
          ? 2
          : code >= 48 && code <= 57
            ? 3
            : 0;
    if (code >= 128) total += code < 0x0590 ? 0.6 : 1.25;
    else if (kind === 3) total += 1;
    else if (kind === 0 && code > 32 && code < 127) total += 0.4;
    else total += 0.3;
    if (
      (previous === 1 && kind === 2) ||
      (previous === 3 && (kind === 1 || kind === 2)) ||
      ((previous === 1 || previous === 2) && kind === 3)
    )
      total += 1;
    previous = kind;
  }
  const estimate = Math.ceil(total);
  return estimate <= text.length
    ? estimate
    : Math.min(estimate, new TextEncoder().encode(text).length);
}
