/** The signed-in user's watchlist with optimistic add/remove. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addToWatchlist, fetchWatchlist, queryKeys, removeFromWatchlist, type WatchlistItem } from "../lib/api";
import { useAuthStore } from "../store/authStore";

/** Keyed by user, so a different account on the same device never sees it. */
function useWatchlistKey() {
  const userId = useAuthStore((s) => s.user?.id);
  return { userId, key: queryKeys.watchlist(userId ?? "signed-out") };
}

export function useWatchlist() {
  const { userId, key } = useWatchlistKey();
  return useQuery({ queryKey: key, queryFn: fetchWatchlist, enabled: !!userId });
}

export function useWatchlistEntry(companyId: string | undefined): WatchlistItem | undefined {
  const { data } = useWatchlist();
  return companyId ? data?.find((item) => item.company?.id === companyId) : undefined;
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => addToWatchlist(companyId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.watchlists }),
  });
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();
  const { key } = useWatchlistKey();
  return useMutation({
    mutationFn: (item: WatchlistItem) => removeFromWatchlist(item.id),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WatchlistItem[]>(key);
      queryClient.setQueryData<WatchlistItem[]>(key, (old) => old?.filter((i) => i.id !== item.id));
      return { previous };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.watchlists }),
  });
}
