import type { Bot, HostPluginTaskCard } from "@rakazo/contracts";
import { useQuery } from "@tanstack/react-query";
import { hostPluginsQuery } from "../query/host-plugins";
import { spaceQueries } from "../query/query";

const noCards: readonly HostPluginTaskCard[] = [];

export function useHostPluginChatCards(
  meId: string | undefined,
  bot: Pick<Bot, "id" | "spaceId"> | undefined,
) {
  const userId = meId ?? null;
  const canRead = Boolean(userId && bot?.id && bot.spaceId);
  const preferences = useQuery({ ...hostPluginsQuery(userId), enabled: canRead });
  const enabled =
    canRead &&
    !preferences.isError &&
    preferences.data?.some((plugin) => plugin.chatCards && plugin.enabled) === true;
  const cards = useQuery({
    ...spaceQueries(userId, bot?.spaceId ?? null).hostPlugins.chatCards.queryOptions({
      input: { botId: bot?.id ?? "" },
    }),
    enabled,
    refetchOnWindowFocus: "always",
  });
  return enabled && !cards.isError ? (cards.data ?? noCards) : noCards;
}
