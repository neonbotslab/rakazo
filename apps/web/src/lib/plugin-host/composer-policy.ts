import { messageTextFits } from "@rakazo/contracts";
import type {
  PluginComposerDraft,
  PluginDefinition,
  WebPluginHooks,
} from "@rakazo/core/plugin-host";

export type ComposerPluginStep =
  | { kind: "send"; text: string }
  | { kind: "hold"; text: string; resume: () => Promise<ComposerPluginStep> }
  | { kind: "cancel" };

export function runComposerPluginHooks(
  draft: PluginComposerDraft,
  plugins: readonly PluginDefinition<WebPluginHooks>[],
): Promise<ComposerPluginStep> {
  const hooks = plugins.flatMap(({ hooks }) =>
    hooks.beforeSendMessage ? [hooks.beforeSendMessage] : [],
  );
  async function run(start: number, initialText: string): Promise<ComposerPluginStep> {
    let text = initialText;
    for (let i = start; i < hooks.length; i += 1) {
      const hook = hooks[i];
      if (!hook) continue;
      const decision = await hook(Object.freeze({ ...draft, text }));
      switch (decision.kind) {
        case "continue":
          break;
        case "cancel":
          return { kind: "cancel" };
        case "rewrite":
          if (!messageTextFits(decision.text))
            throw new Error("Plugin draft exceeds the message limit");
          text = decision.text;
          break;
        case "hold": {
          let available = true;
          return {
            kind: "hold",
            text,
            resume: () => {
              if (!available) return Promise.resolve({ kind: "cancel" });
              available = false;
              return run(i + 1, text);
            },
          };
        }
      }
    }
    return { kind: "send", text };
  }
  return run(0, draft.text);
}
