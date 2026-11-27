// @vitest-environment jsdom

import { flush } from "@rakazo/core/test-async";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { spaceChanged } from "../query/space-changes";
import { useHostPluginChatCards } from "./chat-cards";

const rpc = vi.hoisted(() => ({ list: vi.fn(), cards: vi.fn() }));
vi.mock("../query/rpc", () => {
  const client = (spaceId: string | null) => ({
    hostPlugins: {
      list: rpc.list,
      chatCards: (input: { botId: string }) => rpc.cards(spaceId, input.botId),
    },
  });
  return { rpc: client(null), createSpaceRpc: client, rpcForSpace: client };
});

function Cards({ spaceId }: { spaceId: string }) {
  const cards = useHostPluginChatCards("user-1", { id: "bot-1", spaceId });
  return <div>{cards.map((card) => card.title).join(", ")}</div>;
}

it("reads cards only for a supported, enabled plugin and keeps each Space's rows scoped", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let enabled = false;
  rpc.list.mockImplementation(async () => [{ id: "test/tasks", chatCards: true, enabled }]);
  rpc.cards.mockImplementation(async (spaceId: string) => [
    { id: "task-1", title: `Task in ${spaceId}` },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (spaceId: string) =>
    act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Cards spaceId={spaceId} />
        </QueryClientProvider>,
      );
    });
  const refreshPreferences = () =>
    act(async () => {
      await spaceChanged("preferences", client);
      await flush();
    });
  const showing = (text: string) =>
    vi.waitFor(async () => {
      await act(flush);
      expect(container.textContent).toBe(text);
    });

  try {
    await render("space-1");
    expect(container.textContent).toBe("");
    expect(rpc.cards).not.toHaveBeenCalled();

    enabled = true;
    await refreshPreferences();
    await showing("Task in space-1");
    await render("space-2");
    await showing("Task in space-2");
    expect(rpc.cards).toHaveBeenNthCalledWith(1, "space-1", "bot-1");
    expect(rpc.cards).toHaveBeenNthCalledWith(2, "space-2", "bot-1");

    enabled = false;
    await refreshPreferences();
    expect(container.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});
