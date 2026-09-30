import { isPrivilegedSupabaseKey } from "../config/env";
import { createPendingRows, normalizeRealtimeTransaction } from "../hooks/useInsiderFeed";
import { matchesFeedFilter, sanitizeSearchTerm } from "../lib/api";
import { ApiError, errorMessage, toApiError } from "../lib/errors";
import { isRetryableError, trimPersistedClient } from "../lib/queryClient";
import { uniqueTopic } from "../lib/realtime";

const base64url = (text: string) => btoa(text).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${base64url(JSON.stringify(payload))}.c2lnbmF0dXJl`;

describe("client key guard", () => {
  it("rejects secret and service_role keys", () => {
    expect(isPrivilegedSupabaseKey("sb_secret_abc")).toBe(true);
    expect(isPrivilegedSupabaseKey(jwt({ role: "service_role" }))).toBe(true);
  });

  it("accepts publishable and anon keys", () => {
    expect(isPrivilegedSupabaseKey("sb_publishable_abc")).toBe(false);
    expect(isPrivilegedSupabaseKey(jwt({ role: "anon" }))).toBe(false);
  });
});

describe("feed filters", () => {
  const trade = (direction: number, value: number) => ({ signal_direction: direction, total_value: value });
  it("classifies realtime rows for each tab", () => {
    expect(matchesFeedFilter(trade(0, 0), "all")).toBe(true);
    expect(matchesFeedFilter(trade(1, 50_000), "key")).toBe(true);
    expect(matchesFeedFilter(trade(-1, 50_000), "key")).toBe(true);
    expect(matchesFeedFilter(trade(1, 9_000), "key")).toBe(false); // under $10K
    expect(matchesFeedFilter(trade(0, 5_000_000), "key")).toBe(false); // planned / tax / award
    expect(matchesFeedFilter(trade(1, 10), "buys")).toBe(true);
    expect(matchesFeedFilter(trade(-1, 10), "buys")).toBe(false);
    expect(matchesFeedFilter(trade(-1, 10), "sells")).toBe(true);
    expect(matchesFeedFilter(trade(-1, 2_000_000), "whales")).toBe(true);
    expect(matchesFeedFilter(trade(0, 2_000_000), "whales")).toBe(false);
    expect(matchesFeedFilter(trade(1, 999_999), "whales")).toBe(false);
  });
});

it("strips PostgREST filter syntax from search terms", () => {
  expect(sanitizeSearchTerm("  brk.b ")).toBe("brk.b");
  expect(sanitizeSearchTerm("a,b(c)*")).toBe("abc");
  expect(sanitizeSearchTerm("Coca   Cola")).toBe("Coca Cola");
});

it("rebuilds generated columns missing from realtime payloads", () => {
  const row = normalizeRealtimeTransaction({
    id: "1",
    company_id: "c",
    accession_number: "0001-26-1",
    filing_date: "2026-09-28T00:00:00Z",
    transaction_date: "2026-09-27",
    reporting_owner_name: "DOE JANE",
    owner_title: "CEO",
    transaction_code: "P",
    shares: "10000",
    price_per_share: 300,
    is_direct: true,
    post_transaction_shares: 40000,
    is_10b5_1: false,
    is_sell_to_cover: false,
    parser_version: 2,
  });
  expect(row.total_value).toBe(3_000_000);
  expect(row.shares).toBe(10000);
  expect(row.signal_direction).toBe(1);
  expect(row.stake_change_pct).toBe(33.3);

  const planned = normalizeRealtimeTransaction({ transaction_code: "S", shares: 1, price_per_share: 1, is_10b5_1: true, parser_version: 2 });
  expect(planned.signal_direction).toBe(0);
});

describe("errors & retries", () => {
  it("treats network failures, 408, 429 and 5xx as retryable", () => {
    expect(isRetryableError(new ApiError("x", 0))).toBe(true);
    expect(isRetryableError(new ApiError("x", 429))).toBe(true);
    expect(isRetryableError(new ApiError("x", 503))).toBe(true);
    expect(isRetryableError(new ApiError("x", 401))).toBe(false);
    expect(isRetryableError(new ApiError("x", 404))).toBe(false);
  });

  it("normalises network errors", () => {
    const err = toApiError({ message: "TypeError: Failed to fetch" }, 0);
    expect(err.status).toBe(0);
    expect(errorMessage(err)).toMatch(/offline/);
    expect(errorMessage(new ApiError("slow down", 429))).toMatch(/Too many requests/);
  });
});

it("keeps only the first feed pages in the offline snapshot", () => {
  const pages = [[1], [2], [3], [4], [5]];
  const client = {
    timestamp: 0,
    buster: "v1",
    clientState: {
      mutations: [],
      queries: [
        { queryKey: ["feed", "all"], queryHash: "a", state: { data: { pages, pageParams: [0, 1, 2, 3, 4] } } },
        { queryKey: ["company", "x"], queryHash: "b", state: { data: { id: "x" } } },
      ],
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trimmed = trimPersistedClient(client as any);
  expect((trimmed.clientState.queries[0].state.data as { pages: unknown[] }).pages).toHaveLength(3);
  expect(trimmed.clientState.queries[1].state.data).toEqual({ id: "x" });
});

describe("connectivity", () => {
  // jest-expo runs as iOS here, where the OS reports internet reachability.
  const { isOnlineState } = jest.requireActual("../lib/network") as typeof import("../lib/network");
  it("requires a connection and, on native, reachability", () => {
    expect(isOnlineState({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isOnlineState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnlineState({ isConnected: true, isInternetReachable: true })).toBe(true);
    expect(isOnlineState({ isConnected: null, isInternetReachable: null })).toBe(true);
  });
});

describe("realtime rows waiting for their company", () => {
  type Row = { id: string; price_suspect: boolean };

  it("uses the newest version when an UPDATE arrives during the lookup", () => {
    const pending = createPendingRows<Row>();
    pending.start({ id: "a", price_suspect: false });
    pending.update({ id: "a", price_suspect: true }); // flagged by the insert trigger
    expect(pending.finish("a")).toEqual({ id: "a", price_suspect: true });
    expect(pending.finish("a")).toBeNull();
  });

  it("drops a row deleted during the lookup and ignores rows it is not waiting for", () => {
    const pending = createPendingRows<Row>();
    pending.start({ id: "a", price_suspect: false });
    pending.remove("a");
    pending.update({ id: "a", price_suspect: false });
    expect(pending.finish("a")).toBeNull();
    pending.update({ id: "b", price_suspect: true });
    expect(pending.finish("b")).toBeNull();
  });
});

it("gives every realtime subscription its own topic", () => {
  expect(uniqueTopic("company:x")).not.toBe(uniqueTopic("company:x"));
  expect(uniqueTopic("feed")).toMatch(/^feed:\d+$/);
});
