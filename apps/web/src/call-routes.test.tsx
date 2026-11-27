// @vitest-environment jsdom

import type { IncomingBotCall } from "@rakazo/contracts";
import type * as CoreModule from "@rakazo/core";
import type { WebPluginHooks } from "@rakazo/core/plugin-host";
import type { Deferred } from "@rakazo/core/test-async";
import { deferred, flush } from "@rakazo/core/test-async";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  subscribeCalls: vi.fn(),
  plugins: vi.fn(),
  voiceStatus: vi.fn(),
  endCall: vi.fn(),
  declineIncomingCall: vi.fn(),
}));

vi.mock("@lingui/core/macro", () => ({ t: (parts: TemplateStringsArray) => parts.join("") }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (parts: TemplateStringsArray | { message: string }, ...values: unknown[]) =>
      "message" in parts ? parts.message : String.raw(parts, ...values),
  }),
}));
vi.mock("@rakazo/ui-web", () => ({
  BotAvatar: () => null,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  defaultBotAvatarValue: () => "",
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@rakazo/core", async (importOriginal) => ({
  ...(await importOriginal<typeof CoreModule>()),
  runThreadSubscription: vi.fn(async () => undefined),
}));
vi.mock("./lib/calls/call-pickup.js", () => ({ pickUp: () => new Promise(() => undefined) }));
vi.mock("./lib/calls/dictation.js", () => ({
  dictation: { listen: vi.fn(), stop: vi.fn(), subscribe: () => () => undefined },
  usesServerDictation: () => false,
}));
vi.mock("./lib/calls/tts.js", () => ({
  speaker: {
    speak: vi.fn(),
    stop: vi.fn(),
    unlock: vi.fn(),
    isSpeaking: () => false,
    subscribe: () => () => {},
  },
}));
vi.mock("./lib/auth/auth", () => ({
  authClient: {
    useSession: () => ({
      isPending: false,
      data: { user: { id: "user-1" } },
      error: null,
      refetch: vi.fn(),
    }),
  },
}));
vi.mock("./lib/bootstrap", () => ({
  getLabs: () => [],
  subscribeLabs: () => () => {},
}));
vi.mock("./lib/plugin-host/web-plugin-registry", async () => {
  const { createPluginRegistry } = await import("@rakazo/core/plugin-host");
  return {
    webPlugins: createPluginRegistry<WebPluginHooks>([
      {
        manifest: { id: "test/sample", name: "Suppress calls", version: "1.0.0", apiVersion: 1 },
        hooks: { onNotification: () => ({ kind: "suppress" }) },
      },
    ]),
  };
});
vi.mock("./lib/query/rpc", () => {
  const client = {
    me: mocks.me,
    hostPlugins: { list: mocks.plugins },
    voice: { status: mocks.voiceStatus },
  };
  return {
    clearSpaceSelection: vi.fn(),
    createSpaceRpc: () => client,
    recheckSessionOnUnauthorized: vi.fn(),
    rpc: {
      ...client,
      analytics: { screen: vi.fn(async () => ({ ok: true })) },
      threads: { endCall: mocks.endCall },
      notifications: {
        declineIncomingCall: mocks.declineIncomingCall,
        subscribeCalls: mocks.subscribeCalls,
      },
    },
    rpcForSpace: () => client,
    selectedSpaceId: () => null,
  };
});
vi.mock("./lib/platform/performance", () => ({ markOnce: () => {}, markAfterPaint: () => {} }));
vi.mock("./components/billing/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/messages/markdown-link-prompt", () => ({
  MarkdownLinkPrompt: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./pages/Shell", () => ({
  ShellPage: () => <Link to="/app/artifacts">Artifacts</Link>,
}));
vi.mock("./pages/space/Artifacts", () => ({ ArtifactsPage: () => <div>Artifacts page</div> }));

import { App } from "./App";
import { endCall, startCall } from "./lib/calls/call-session";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function find(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function button(name: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

async function settle() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await act(async () => {
      await flush();
    });
  }
}

/** The server's call stream: each push replaces the ringing calls, as its frames do. */
let pushCalls: (calls: IncomingBotCall[]) => void = () => {};
let changePreferences: () => void = () => {};
function callStream(signal: AbortSignal) {
  type Frame =
    | { type: "incoming.calls"; payload: { calls: IncomingBotCall[] } }
    | { type: "preferences" };
  const frames: Frame[] = [];
  let wake: Deferred | undefined;
  pushCalls = (calls) => {
    frames.push({ type: "incoming.calls", payload: { calls } });
    wake?.resolve();
  };
  changePreferences = () => {
    frames.push({ type: "preferences" });
    wake?.resolve();
  };
  signal.addEventListener("abort", () => wake?.resolve());
  return (async function* () {
    while (!signal.aborted) {
      const frame = frames.shift();
      if (frame) yield frame;
      else {
        wake = deferred();
        await wake.promise;
      }
    }
  })();
}

async function render(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.clearAllMocks();
  mocks.me.mockImplementation(async () => ({ phoneCallsEnabled: true, spaceId: "space-1" }));
  mocks.plugins.mockImplementation(async () => []);
  mocks.subscribeCalls.mockImplementation(async (_input, { signal }) => callStream(signal));
  mocks.voiceStatus.mockImplementation(async () => ({ ready: true, transcribe: false }));
  mocks.endCall.mockResolvedValue(undefined);
  mocks.declineIncomingCall.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  endCall();
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps an ongoing call in reach after leaving the shell", async () => {
  startCall({ botId: "bot-1", botName: "Test bot" });
  await render("/app/bot-1");
  await act(async () => find('a[href="/app/artifacts"]')?.click());
  await settle();
  expect(container.textContent).toContain("Artifacts page");
  expect(find('[data-testid="call-view"]')).not.toBeNull();
  expect(button("Mute")).not.toBeNull();

  await act(async () => button("Minimize call")?.click());
  expect(find('[data-testid="call-view"]')).toBeNull();
  await act(async () => find('[data-testid="call-return-bar"]')?.click());
  expect(find('[data-testid="call-view"]')).not.toBeNull();

  await act(async () => button("Hang up")?.click());
  await settle();
  expect(find('[data-testid="call-view"]')).toBeNull();
  expect(mocks.endCall).toHaveBeenCalledOnce();
});

const ringing = (callId: string, spaceId = "space-1") =>
  ({
    id: "bot-1",
    spaceId,
    name: "Test bot",
    incomingCall: {
      callId,
      reason: "Review",
      opening: "Ready?",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  }) as IncomingBotCall;

it("rings for an incoming call on a page outside the shell", async () => {
  await render("/app/artifacts");
  expect(container.textContent).toContain("Artifacts page");
  expect(find('[data-testid="incoming-call"]')).toBeNull();
  await act(async () => pushCalls([ringing("call-1")]));
  await settle();
  expect(find('[data-testid="incoming-call"]')?.getAttribute("aria-label")).toBe(
    "Test bot is calling you",
  );

  const decline = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Decline",
  );
  await act(async () => decline?.click());
  await settle();
  expect(mocks.declineIncomingCall).toHaveBeenCalledWith({ callId: "call-1" });
  expect(find('[data-testid="incoming-call"]')).toBeNull();
});

it("reads synced plugin preferences for incoming calls outside the shell", async () => {
  let enabled = false;
  const initialRead = deferred();
  mocks.plugins.mockImplementation(async () => {
    await initialRead.promise;
    return [{ id: "test/sample", name: "Suppress calls", enabled }];
  });
  const ring = vi.fn();
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        ring();
        throw new Error("Audio is unavailable in the test browser");
      }
    },
  );
  const notify = vi.fn();
  vi.stubGlobal(
    "Notification",
    class {
      static permission = "granted";
      close() {}
      constructor(title: string) {
        notify(title);
      }
    },
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await render("/app/artifacts");
  await act(async () => pushCalls([ringing("call-1")]));
  await settle();
  expect(find('[data-testid="incoming-call"]')).not.toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect(ring).not.toHaveBeenCalled();
  await act(async () => initialRead.resolve());
  await settle();
  expect(notify).toHaveBeenCalledOnce();
  expect(ring).toHaveBeenCalledOnce();

  await act(async () => pushCalls([]));
  enabled = true;
  await act(async () => changePreferences());
  await settle();
  await act(async () => pushCalls([ringing("call-2")]));
  await settle();
  expect(find('[data-testid="incoming-call"]')).not.toBeNull();
  expect(notify).toHaveBeenCalledOnce();
  expect(ring).toHaveBeenCalledOnce();
});

it("stops ringing when the call stream says the call ended, and ignores other Spaces", async () => {
  await render("/app/artifacts");
  await act(async () => pushCalls([ringing("call-1", "space-2")]));
  await settle();
  expect(find('[data-testid="incoming-call"]')).toBeNull();
  await act(async () => pushCalls([ringing("call-2")]));
  await settle();
  expect(find('[data-testid="incoming-call"]')).not.toBeNull();
  await act(async () => pushCalls([]));
  await settle();
  expect(find('[data-testid="incoming-call"]')).toBeNull();
  expect(mocks.subscribeCalls).toHaveBeenCalledOnce();
});
