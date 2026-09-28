/**
 * TanStack Query client configured for offline-first use:
 *   * cached results are persisted to AsyncStorage and served immediately on
 *     launch (serve-from-cache-first), then refreshed in the background;
 *   * queries pause while offline and refetch when connectivity returns;
 *   * transient failures (network, 408, 429 rate limits, 5xx) are retried with
 *     exponential backoff, other errors fail fast.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import type { PersistedClient, PersistQueryClientProviderProps } from "@tanstack/react-query-persist-client";
import { AppState, Platform } from "react-native";
import { ApiError } from "./errors";

export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true; // network failures and unexpected errors
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      staleTime: 60_000,
      gcTime: CACHE_MAX_AGE_MS,
      retry: (failureCount, error) => failureCount < 3 && isRetryableError(error),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
    },
    mutations: {
      networkMode: "online",
      retry: 0,
    },
  },
});

/** Infinite feeds keep only their first pages in the offline snapshot. */
const MAX_PERSISTED_PAGES = 3;

export function trimPersistedClient(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        const data = query.state.data as { pages?: unknown[]; pageParams?: unknown[] } | undefined;
        if (!data || !Array.isArray(data.pages) || data.pages.length <= MAX_PERSISTED_PAGES) return query;
        return {
          ...query,
          state: {
            ...query.state,
            data: {
              pages: data.pages.slice(0, MAX_PERSISTED_PAGES),
              pageParams: (data.pageParams ?? []).slice(0, MAX_PERSISTED_PAGES),
            },
          },
        };
      }),
    },
  };
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "insiderpulse.query-cache.v1",
  throttleTime: 1000,
  serialize: (client) => JSON.stringify(trimPersistedClient(client)),
});

export const persistOptions: PersistQueryClientProviderProps["persistOptions"] = {
  persister,
  maxAge: CACHE_MAX_AGE_MS,
  buster: "v1",
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === "success" && query.meta?.persist !== false,
  },
};

/** Wires React Query to NetInfo (online state) and AppState (focus). Returns a cleanup function. */
export function registerQueryClientListeners(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    })
  );

  if (Platform.OS === "web") return () => {};
  const subscription = AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });
  return () => subscription.remove();
}

/** Removes every cached query (e.g. after signing out) including the persisted copy. */
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}
