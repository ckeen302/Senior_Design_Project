/**
 * Insider trade feed: infinite scrolling pages from Supabase plus a Realtime
 * subscription that prepends newly ingested filings as they arrive.
 */

import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  FEED_PAGE_SIZE,
  type FeedFilter,
  type FeedItem,
  fetchCompanySummary,
  fetchFeedPage,
  type InsiderTransaction,
  matchesFeedFilter,
  queryKeys,
} from "../lib/api";
import { collapseGroupFilings, signalDirection, stakeChangePct } from "../lib/signal";
import { supabase } from "../lib/supabase";

export const FEED_FILTERS: FeedFilter[] = ["key", "buys", "sells", "whales", "all"];

/** Realtime rows older than this are backfilled history, not news: never prepend them. */
const LIVE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

type FeedData = InfiniteData<FeedItem[], number>;
export type RealtimeStatus = "connecting" | "live" | "offline";

export function useInsiderFeed(filter: FeedFilter) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.feed(filter),
    queryFn: ({ pageParam }) => fetchFeedPage(filter, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < FEED_PAGE_SIZE ? undefined : allPages.length),
  });

  // Realtime inserts shift offsets, so later pages can repeat rows: de-duplicate,
  // then fold group filings of the same trade into one card.
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: FeedItem[] = [];
    for (const item of query.data?.pages.flat() ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return collapseGroupFilings(out);
  }, [query.data]);

  return { ...query, items };
}

/** Realtime rows arrive without joins or generated columns: rebuild them. */
export function normalizeRealtimeTransaction(raw: Record<string, unknown>): InsiderTransaction {
  const shares = Number(raw.shares) || 0;
  const price = Number(raw.price_per_share) || 0;
  const post = raw.post_transaction_shares;
  const code = String(raw.transaction_code ?? "");
  const postShares = post === null || post === undefined ? null : Number(post);
  const flags = {
    transaction_code: code,
    is_10b5_1: raw.is_10b5_1 === true,
    is_sell_to_cover: raw.is_sell_to_cover === true,
    is_option_sale: raw.is_option_sale === true,
    parser_version: Number(raw.parser_version) || 1,
  };
  return {
    id: String(raw.id),
    company_id: String(raw.company_id),
    accession_number: String(raw.accession_number),
    filing_date: String(raw.filing_date),
    transaction_date: String(raw.transaction_date),
    reporting_owner_name: String(raw.reporting_owner_name ?? ""),
    owner_title: (raw.owner_title as string | null) ?? null,
    shares,
    price_per_share: price,
    total_value: raw.total_value !== undefined && raw.total_value !== null ? Number(raw.total_value) : shares * price,
    is_direct: (raw.is_direct as boolean | null) ?? null,
    post_transaction_shares: postShares,
    insider_cik: (raw.insider_cik as string | null) ?? null,
    ...flags,
    signal_direction: raw.signal_direction !== undefined && raw.signal_direction !== null
      ? Number(raw.signal_direction)
      : signalDirection(flags),
    stake_change_pct: raw.stake_change_pct !== undefined && raw.stake_change_pct !== null
      ? Number(raw.stake_change_pct)
      : stakeChangePct(code, shares, postShares),
  };
}

function updateFeedCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (data: FeedData, filter: FeedFilter) => FeedData,
) {
  for (const filter of FEED_FILTERS) {
    queryClient.setQueryData<FeedData>(queryKeys.feed(filter), (old) =>
      old && old.pages.length > 0 ? update(old, filter) : old
    );
  }
}

/**
 * Subscribes to insider_transactions changes and patches every cached feed.
 * Returns the connection status and the ids that just arrived (for highlighting).
 */
export function useRealtimeFeed(): { status: RealtimeStatus; freshIds: ReadonlySet<string> } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const channel = supabase
      .channel("feed:insider_transactions")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "insider_transactions" }, async (payload) => {
        const row = normalizeRealtimeTransaction(payload.new as Record<string, unknown>);
        // The market-wide backfill inserts months-old filings: they belong further
        // down the feed (where a refresh will show them), not at the top.
        if (Date.now() - Date.parse(row.filing_date) > LIVE_WINDOW_MS) return;
        const company = await fetchCompanySummary(row.company_id).catch(() => null);
        if (!active) return;
        const item: FeedItem = { ...row, company };
        updateFeedCaches(queryClient, (data, filter) => {
          if (!matchesFeedFilter(item, filter) || data.pages.some((p) => p.some((i) => i.id === item.id))) return data;
          const [first = [], ...rest] = data.pages;
          return { ...data, pages: [[item, ...first], ...rest] };
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.company(row.company_id) });
        if (row.signal_direction !== 0) queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        if (row.signal_direction === 1) queryClient.invalidateQueries({ queryKey: ["feed", "biggest-buys"] });

        setFreshIds((prev) => new Set(prev).add(item.id));
        timers.push(
          setTimeout(() => {
            setFreshIds((prev) => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
            });
          }, 8000),
        );
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "insider_transactions" }, (payload) => {
        const row = normalizeRealtimeTransaction(payload.new as Record<string, unknown>);
        updateFeedCaches(queryClient, (data) => ({
          ...data,
          pages: data.pages.map((page) => page.map((i) => (i.id === row.id ? { ...i, ...row } : i))),
        }));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "insider_transactions" }, (payload) => {
        const id = (payload.old as { id?: string }).id;
        if (!id) return;
        updateFeedCaches(queryClient, (data) => ({
          ...data,
          pages: data.pages.map((page) => page.filter((i) => i.id !== id)),
        }));
      })
      .subscribe((state) => {
        if (!active) return;
        if (state === "SUBSCRIBED") setStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setStatus("offline");
      });

    return () => {
      active = false;
      timers.forEach(clearTimeout);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return { status, freshIds };
}
