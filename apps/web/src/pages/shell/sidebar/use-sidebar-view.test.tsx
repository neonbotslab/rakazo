// @vitest-environment jsdom
import type { Space } from "@rakazo/contracts";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSidebarView } from "./use-sidebar-view";

let root: ReturnType<typeof createRoot>;

function Sidebar({ unreadCount }: { unreadCount: number }) {
  const space: Space = {
    id: "fixture-space",
    name: "Personal",
    isDefault: true,
    hasContent: true,
    bots: [],
    groups: Array.from({ length: 3 }, (_, index) => ({
      id: `fixture-chat-${index}`,
      spaceId: "fixture-space",
      name: `Chat ${index}`,
      pinned: false,
      sectionId: null,
      members: [],
      preview: "",
      unread: index < unreadCount,
      updatedAt: "2026-01-01T00:00:00.000Z",
    })),
    externalConversations: [],
    botSections: [],
  };
  useSidebarView({
    userId: "fixture-user",
    isMobile: false,
    bootstrapMe: undefined,
    spaces: [space],
    bots: [],
    groups: [],
    botSections: [],
    searchQuery: "",
    now: 0,
  });
  return null;
}

function render(unreadCount: number) {
  act(() =>
    root.render(
      <StrictMode>
        <Sidebar unreadCount={unreadCount} />
      </StrictMode>,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.title = "Rakazo";
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
});

it("updates the browser title as chats become unread and read", () => {
  render(0);
  expect(document.title).toBe("Rakazo");
  render(1);
  expect(document.title).toBe("(1) Rakazo");
  render(3);
  expect(document.title).toBe("(3) Rakazo");
  render(0);
  expect(document.title).toBe("Rakazo");
});

it("prefixes an existing page title and restores it when leaving the sidebar", () => {
  document.title = "(2026) Field notes";
  render(3);
  expect(document.title).toBe("(3) (2026) Field notes");
  act(() => root.render(null));
  expect(document.title).toBe("(2026) Field notes");
});
