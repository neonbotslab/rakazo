import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollaborationMarker } from "./CollaborationMarker";

describe("collaboration transcript markers", () => {
  it("shows a centred peer event with its avatar and full label", () => {
    const html = renderToString(
      <CollaborationMarker
        peerName="Research"
        color="#14B8A6"
        identity="research"
        label="Message from Research"
        onClick={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="peer-receipt-chip"');
    expect(html).toContain('aria-label="Message from Research"');
    expect(html).toContain('class="flex min-w-0 max-w-full justify-center"');
    expect(html).toContain('class="inline-flex max-w-full');
    expect(html).toContain("truncate font-medium");
    expect(html).toContain("rakazo-organic-avatar");
    expect(html).toContain("Message from Research");
    expect(html).not.toContain("{peer}");
    expect(html).not.toContain("peer-replies-toggle");
  });
});
