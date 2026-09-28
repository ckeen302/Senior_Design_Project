/**
 * Data access layer. All reads go through the public (RLS-protected) API;
 * the only privileged operation — importing a new ticker from SEC EDGAR — is
 * delegated to the fetch-sec-filings Edge Function with the user's token.
 */

import { FunctionsHttpError } from "@supabase/supabase-js";
import type { Tables } from "../types/database";
import { ApiError, toApiError } from "./errors";
import { supabase } from "./supabase";

export type FeedFilter = "all" | "buys" | "sells" | "whales";
export const FEED_PAGE_SIZE = 25;
export const WHALE_MIN_VALUE = 1_000_000;

export type Company = Tables<"companies">;
export type SentimentScore = Tables<"sentiment_scores">;
export type CompanySummary = Pick<Company, "id" | "ticker" | "company_name" | "cik">;
export type InsiderTransaction = Omit<Tables<"insider_transactions">, "created_at">;
export type FeedItem = InsiderTransaction & { company: CompanySummary | null };
export type CompanyDetail = Company & { sentiment: SentimentScore | null };
export type LeaderboardEntry = SentimentScore & { company: CompanySummary | null };
export type Profile = Tables<"profiles">;

export type WatchlistSentiment = Pick<
  SentimentScore,
  "sentiment_index" | "sentiment_label" | "wisi_score" | "buy_count" | "sell_count"
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
}

export const queryKeys = {
  feed: (filter: FeedFilter) => ["feed", filter] as const,
  company: (id: string) => ["company", id] as const,
  companyTransactions: (id: string) => ["company", id, "transactions"] as const,
  activity: (id: string, months: number) => ["company", id, "activity", months] as const,
  leaderboard: (direction: "bullish" | "bearish") => ["leaderboard", direction] as const,
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
    .select(
      "id, company_id, accession_number, filing_date, transaction_date, reporting_owner_name, owner_title, transaction_code, shares, price_per_share, total_value, is_direct, post_transaction_shares, company:companies(id, ticker, company_name, cik)",
    );
  if (filter === "buys") query = query.eq("transaction_code", "P");
  if (filter === "sells") query = query.eq("transaction_code", "S");
  if (filter === "whales") query = query.in("transaction_code", ["P", "S"]).gte("total_value", WHALE_MIN_VALUE);

  const from = page * FEED_PAGE_SIZE;
  const { data, error, status } = await query
    .order("filing_date", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + FEED_PAGE_SIZE - 1);
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => ({ ...row, company: one(row.company) }));
}

/** Does a realtime row belong in the feed for this filter? */
export function matchesFeedFilter(item: Pick<InsiderTransaction, "transaction_code" | "total_value">, filter: FeedFilter) {
  switch (filter) {
    case "buys":
      return item.transaction_code === "P";
    case "sells":
      return item.transaction_code === "S";
    case "whales":
      return (item.transaction_code === "P" || item.transaction_code === "S") && item.total_value >= WHALE_MIN_VALUE;
    default:
      return true;
  }
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

export async function fetchCompanyTransactions(companyId: string, limit = 20): Promise<InsiderTransaction[]> {
  const { data, error, status } = await supabase
    .from("insider_transactions")
    .select(
      "id, company_id, accession_number, filing_date, transaction_date, reporting_owner_name, owner_title, transaction_code, shares, price_per_share, total_value, is_direct, post_transaction_shares",
    )
    .eq("company_id", companyId)
    .order("filing_date", { ascending: false })
    .limit(limit);
  if (error) throw toApiError(error, status);
  return data ?? [];
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
    };
  });
}

export async function fetchLeaderboard(direction: "bullish" | "bearish", limit = 30): Promise<LeaderboardEntry[]> {
  const ascending = direction === "bearish";
  const { data, error, status } = await supabase
    .from("sentiment_scores")
    .select("*, company:companies(id, ticker, company_name, cik)")
    .or("buy_count.gt.0,sell_count.gt.0")
    .order("sentiment_index", { ascending })
    .order("net_weighted_value", { ascending })
    .limit(limit);
  if (error) throw toApiError(error, status);
  return (data ?? []).map((row) => ({ ...row, company: one(row.company) }));
}

export async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const { data, error, status } = await supabase
    .from("watchlists")
    .select(
      "id, created_at, company:companies(id, ticker, company_name, cik, sentiment:sentiment_scores(sentiment_index, sentiment_label, wisi_score, buy_count, sell_count))",
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
