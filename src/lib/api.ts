/**
 * Data access layer. All reads go through the public (RLS-protected) API;
 * the only privileged operation — importing a new ticker from SEC EDGAR — is
 * delegated to the fetch-sec-filings Edge Function with the user's token.
 */

import { FunctionsHttpError } from "@supabase/supabase-js";
import type { Database, Tables } from "../types/database";
import { ApiError, toApiError } from "./errors";
import { collapseGroupFilings, MIN_SIGNAL_VALUE } from "./signal";
import { supabase } from "./supabase";

/**
 * key    discretionary open-market buys and sells of $10k+ (the default)
 * buys   discretionary open-market buys
 * sells  discretionary open-market sales (no 10b5-1 plan or tax sales)
 * whales discretionary buys and sells of $1M+
 * all    every Form 4, including awards, exercises and routine sales
 */
export type FeedFilter = "key" | "buys" | "sells" | "whales" | "all";
export const FEED_PAGE_SIZE = 25;
export const WHALE_MIN_VALUE = 1_000_000;

const TRANSACTION_COLUMNS =
  "id, company_id, accession_number, filing_date, transaction_date, reporting_owner_name, owner_title, transaction_code, shares, price_per_share, total_value, is_direct, post_transaction_shares, insider_cik, is_10b5_1, is_sell_to_cover, is_option_sale, price_suspect, parser_version, signal_direction, stake_change_pct";

export type Company = Tables<"companies">;
export type SentimentScore = Tables<"sentiment_scores">;
export type CompanySummary = Pick<Company, "id" | "ticker" | "company_name" | "cik">;
export type InsiderTransaction = Omit<Tables<"insider_transactions">, "created_at">;
export type FeedItem = InsiderTransaction & { company: CompanySummary | null };
export type CompanyDetail = Company & { sentiment: SentimentScore | null };
export type LeaderboardEntry = SentimentScore & { company: CompanySummary | null };
export type Profile = Tables<"profiles">;
export type SignalContribution = Database["public"]["Functions"]["company_signal_breakdown"]["Returns"][number];
export type BigBuy = FeedItem & { relatedFilers: number };
export type SignalDirection = "buying" | "selling";
export type TradeScope = "key" | "all";

export type WatchlistSentiment = Pick<
  SentimentScore,
  | "signal_score"
  | "signal_label"
  | "signal_buyers"
  | "signal_sellers"
  | "signal_buy_value"
  | "signal_sell_value"
  | "sentiment_index"
>;
export interface WatchlistItem {
  id: string;
  created_at: string;
  company: (CompanySummary & { sentiment: WatchlistSentiment | null }) | null;
}

export interface ActivityPoint {
  month: string;
  label: string;
  buys: number;
  sells: number;
  buyCount: number;
  sellCount: number;
  /** 10b5-1 plan and sell-to-cover sales. */
  routineSells: number;
  routineSellCount: number;
}

export const queryKeys = {
  feed: (filter: FeedFilter) => ["feed", filter] as const,
  biggestBuys: (days: number) => ["feed", "biggest-buys", days] as const,
  company: (id: string) => ["company", id] as const,
  companyTransactions: (id: string, scope: TradeScope) => ["company", id, "transactions", scope] as const,
  signalBreakdown: (id: string) => ["company", id, "signal"] as const,
  activity: (id: string, months: number) => ["company", id, "activity", months] as const,
  leaderboard: (direction: SignalDirection) => ["leaderboard", direction] as const,
  watchlist: ["watchlist"] as const,
  search: (term: string) => ["search", term] as const,
  quote: (symbol: string) => ["quote", symbol] as const,
  profile: (userId: string) => ["profile", userId] as const,
};

/** PostgREST returns one-to-one embeds as objects, but tolerate arrays too. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function fetchFeedPage(filter: FeedFilter, page: number): Promise<FeedItem[]> {
  let query = supabase
    .from("insider_transactions")
    .select(`${TRANSACTION_COLUMNS}, company:companies(id, ticker, company_name, cik)`);
  if (filter === "key") query = query.neq("signal_direction", 0).gte("total_value", MIN_SIGNAL_VALUE);
  if (filter === "buys") query = query.eq("signal_direction", 1);
  if (filter === "sells") query = query.eq("signal_direction", -1);
  if (filter === "whales") query = query.neq("signal_direction", 0).gte("total_value", WHALE_MIN_VALUE);

  const from = page * FEED_PAGE_SIZE;
  const { data, error, status } = await query
    .order("filing_date", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + FEED_PAGE_SIZE - 1);
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => ({ ...row, company: one(row.company) }));
}

/** Does a realtime row belong in the feed for this filter? */
export function matchesFeedFilter(
  item: Pick<InsiderTransaction, "signal_direction" | "total_value">,
  filter: FeedFilter,
) {
  switch (filter) {
    case "key":
      return item.signal_direction !== 0 && item.total_value >= MIN_SIGNAL_VALUE;
    case "buys":
      return item.signal_direction === 1;
    case "sells":
      return item.signal_direction === -1;
    case "whales":
      return item.signal_direction !== 0 && item.total_value >= WHALE_MIN_VALUE;
    default:
      return true;
  }
}

/** The largest discretionary insider purchases filed in the last `days` days. */
export async function fetchBiggestBuys(days = 7, limit = 10): Promise<BigBuy[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error, status } = await supabase
    .from("insider_transactions")
    .select(`${TRANSACTION_COLUMNS}, company:companies(id, ticker, company_name, cik)`)
    .eq("signal_direction", 1)
    .gte("filing_date", since)
    .gte("total_value", MIN_SIGNAL_VALUE)
    .order("total_value", { ascending: false })
    .limit(limit * 3);
  if (error) throw toApiError(error, status);
  const rows = (data ?? []).map((row) => ({ ...row, company: one(row.company) }));
  return collapseGroupFilings(rows).slice(0, limit);
}

const companySummaryCache = new Map<string, CompanySummary>();

/** Company ticker/name for realtime rows (which arrive without joins). */
export async function fetchCompanySummary(id: string): Promise<CompanySummary | null> {
  const cached = companySummaryCache.get(id);
  if (cached) return cached;
  const { data, error, status } = await supabase
    .from("companies")
    .select("id, ticker, company_name, cik")
    .eq("id", id)
    .maybeSingle();
  if (error) throw toApiError(error, status);
  if (data) companySummaryCache.set(id, data);
  return data;
}

export async function fetchCompany(id: string): Promise<CompanyDetail> {
  const { data, error, status } = await supabase
    .from("companies")
    .select("*, sentiment:sentiment_scores(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw toApiError(error, status);
  if (!data) throw new ApiError("Company not found", 404);
  return { ...data, sentiment: one(data.sentiment) };
}

export async function fetchCompanyTransactions(
  companyId: string,
  scope: TradeScope = "key",
  limit = 20,
): Promise<InsiderTransaction[]> {
  let query = supabase.from("insider_transactions").select(TRANSACTION_COLUMNS).eq("company_id", companyId);
  if (scope === "key") query = query.neq("signal_direction", 0);
  const { data, error, status } = await query.order("filing_date", { ascending: false }).limit(limit);
  if (error) throw toApiError(error, status);
  return data ?? [];
}

/** Per-insider contributions to the Insider Signal ("Why this score"). */
export async function fetchSignalBreakdown(companyId: string): Promise<SignalContribution[]> {
  const { data, error, status } = await supabase.rpc("company_signal_breakdown", { target_company_id: companyId });
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => ({
    ...row,
    total_value: Number(row.total_value) || 0,
    weighted_value: Number(row.weighted_value) || 0,
    avg_price: row.avg_price === null ? null : Number(row.avg_price),
    stake_change_pct: row.stake_change_pct === null ? null : Number(row.stake_change_pct),
    role_weight: Number(row.role_weight),
    size_factor: Number(row.size_factor),
    conviction: Number(row.conviction),
    points: Number(row.points) || 0,
  }));
}

const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short" });

export async function fetchInsiderActivity(companyId: string, months = 12): Promise<ActivityPoint[]> {
  const { data, error, status } = await supabase.rpc("get_insider_activity", {
    target_company_id: companyId,
    months,
  });
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => {
    const [y, m] = row.period_start.split("-").map(Number);
    return {
      month: row.period_start,
      label: monthLabel.format(new Date(y, m - 1, 1)),
      buys: Number(row.buy_value) || 0,
      sells: Number(row.sell_value) || 0,
      buyCount: Number(row.buy_count) || 0,
      sellCount: Number(row.sell_count) || 0,
      routineSells: Number(row.routine_sell_value) || 0,
      routineSellCount: Number(row.routine_sell_count) || 0,
    };
  });
}

/** Companies with the strongest insider buying (or selling) over the last 90 days. */
export async function fetchLeaderboard(direction: SignalDirection, limit = 40): Promise<LeaderboardEntry[]> {
  const buying = direction === "buying";
  let query = supabase
    .from("sentiment_scores")
    .select("*, company:companies(id, ticker, company_name, cik)")
    .neq("signal_label", "No signal");
  query = buying ? query.gt("signal_score", 50) : query.lt("signal_score", 50);
  const { data, error, status } = await query
    .order("signal_score", { ascending: !buying })
    .order(buying ? "signal_buy_value" : "signal_sell_value", { ascending: false })
    .limit(limit);
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => ({ ...row, company: one(row.company) }));
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const { data, error, status } = await supabase
    .from("watchlists")
    .select(
      "id, created_at, company:companies(id, ticker, company_name, cik, sentiment:sentiment_scores(signal_score, signal_label, signal_buyers, signal_sellers, signal_buy_value, signal_sell_value, sentiment_index))",
    )
    .order("created_at", { ascending: false });
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => {
    const company = one(row.company);
    return {
      id: row.id,
      created_at: row.created_at,
      company: company ? { ...company, sentiment: one(company.sentiment) } : null,
    };
  });
}

export async function addToWatchlist(companyId: string): Promise<void> {
  const { error, status } = await supabase.from("watchlists").insert({ company_id: companyId });
  // 23505 = already on the watchlist; treat as success.
  if (error && error.code !== "23505") throw toApiError(error, status);
}

export async function removeFromWatchlist(watchlistId: string): Promise<void> {
  const { error, status } = await supabase.from("watchlists").delete().eq("id", watchlistId);
  if (error) throw toApiError(error, status);
}

export function sanitizeSearchTerm(term: string): string {
  // Characters with meaning in PostgREST filter syntax are removed.
  return term.replace(/[^A-Za-z0-9 .&'-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

export async function searchCompanies(rawTerm: string): Promise<CompanySummary[]> {
  const term = sanitizeSearchTerm(rawTerm);
  if (!term) return [];
  const { data, error, status } = await supabase
    .from("companies")
    .select("id, ticker, company_name, cik")
    .or(`ticker.ilike.${term}%,company_name.ilike.%${term}%`)
    .order("ticker")
    .limit(25);
  if (error) throw toApiError(error, status);
  const upper = term.toUpperCase();
  const rank = (c: CompanySummary) => (c.ticker === upper ? 0 : c.ticker.startsWith(upper) ? 1 : 2);
  return [...(data ?? [])].sort((a, b) => rank(a) - rank(b) || a.ticker.localeCompare(b.ticker));
}

interface IngestCompanyReport {
  ticker: string | null;
  companyId: string | null;
  status: "ok" | "partial" | "error" | "skipped";
  upserted: number;
  error?: string;
}

/** Imports a ticker that is not tracked yet (SEC lookup + recent Form 4 backfill). */
export async function trackTicker(ticker: string): Promise<{ companyId: string; ticker: string; imported: number }> {
  const { data, error } = await supabase.functions.invoke<{ companies: IngestCompanyReport[]; error?: string }>(
    "fetch-sec-filings",
    { body: { tickers: [ticker] } },
  );
  if (error) {
    let message = error.message;
    let status = 0;
    if (error instanceof FunctionsHttpError) {
      status = error.context.status;
      try {
        const body = await error.context.json();
        message = body?.error ?? body?.companies?.[0]?.error ?? message;
      } catch {
        // keep the generic message
      }
    }
    throw new ApiError(message, status);
  }
  const report = data?.companies?.[0];
  if (!report || !report.companyId || report.status === "error") {
    throw new ApiError(report?.error ?? `Could not import ${ticker}`, 422);
  }
  return { companyId: report.companyId, ticker: report.ticker ?? ticker, imported: report.upserted };
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error, status } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw toApiError(error, status);
  return data;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, "expo_push_token" | "push_platform" | "whale_alerts_enabled">>,
): Promise<void> {
  const { error, status } = await supabase.from("profiles").upsert({ id: userId, ...patch }, { onConflict: "id" });
  if (error) throw toApiError(error, status);
}
