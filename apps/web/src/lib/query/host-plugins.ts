import { spaceQueries } from "./query";

export function hostPluginsQuery(userId: string | null) {
  return {
    ...spaceQueries(userId, null).hostPlugins.list.queryOptions(),
    enabled: userId !== null,
    refetchOnWindowFocus: "always" as const,
  };
}
