/** The signed-in user's watchlist with optimistic add/remove. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addToWatchlist, fetchWatchlist, queryKeys, removeFromWatchlist, type WatchlistItem } from "../lib/api";
import { useAuthStore } from "../store/authStore";

export function useWatchlist() {
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({ queryKey: queryKeys.watchlist, queryFn: fetchWatchlist, enabled: !!userId });
}

export function useWatchlistEntry(companyId: string | undefined): WatchlistItem | undefined {
  const { data } = useWatchlist();
  return companyId ? data?.find((item) => item.company?.id === companyId) : undefined;
}

export function useAddToWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => addToWatchlist(companyId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.watchlist }),
  });
}

export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: WatchlistItem) => removeFromWatchlist(item.id),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist });
      const previous = queryClient.getQueryData<WatchlistItem[]>(queryKeys.watchlist);
      queryClient.setQueryData<WatchlistItem[]>(queryKeys.watchlist, (old) => old?.filter((i) => i.id !== item.id));
      return { previous };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.watchlist, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.watchlist }),
  });
}
