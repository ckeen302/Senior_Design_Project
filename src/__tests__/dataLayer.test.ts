import { isPrivilegedSupabaseKey } from "../config/env";
import { normalizeRealtimeTransaction } from "../hooks/useInsiderFeed";
import { matchesFeedFilter, sanitizeSearchTerm } from "../lib/api";
import { ApiError, errorMessage, toApiError } from "../lib/errors";
import { isRetryableError, trimPersistedClient } from "../lib/queryClient";

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
  const trade = (code: string, value: number) => ({ transaction_code: code, total_value: value });
  it("classifies realtime rows for each tab", () => {
    expect(matchesFeedFilter(trade("A", 0), "all")).toBe(true);
    expect(matchesFeedFilter(trade("P", 10), "buys")).toBe(true);
    expect(matchesFeedFilter(trade("S", 10), "buys")).toBe(false);
    expect(matchesFeedFilter(trade("S", 2_000_000), "whales")).toBe(true);
    expect(matchesFeedFilter(trade("A", 2_000_000), "whales")).toBe(false);
    expect(matchesFeedFilter(trade("P", 999_999), "whales")).toBe(false);
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
    post_transaction_shares: null,
  });
  expect(row.total_value).toBe(3_000_000);
  expect(row.shares).toBe(10000);
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
