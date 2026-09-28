/**
 * Finnhub helpers used server-side to keep companies.market_cap current
 * (market cap is the WISI denominator).
 */

const FINNHUB_BASE = "https://finnhub.io/api/v1";

/** SEC share-class tickers use dashes (BRK-B); Finnhub uses dots (BRK.B). */
export function toFinnhubSymbol(ticker: string): string {
  return ticker.toUpperCase().replace(/-/g, ".");
}

/**
 * Market capitalisation in USD from Finnhub's company profile endpoint, or
 * null when unavailable (unknown symbol, rate limit, network error).
 */
export async function fetchMarketCapUsd(
  ticker: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<number | null> {
  const url = `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(toFinnhubSymbol(ticker))}`;
  try {
    const res = await fetchFn(url, { headers: { "X-Finnhub-Token": apiKey } });
    if (!res.ok) {
      await res.body?.cancel();
      console.warn(`[finnhub] profile2 ${ticker} -> HTTP ${res.status}`);
      return null;
    }
    const profile = await res.json() as { marketCapitalization?: number };
    const millions = Number(profile?.marketCapitalization);
    return Number.isFinite(millions) && millions > 0 ? Math.round(millions * 1_000_000) : null;
  } catch (err) {
    console.warn(`[finnhub] profile2 ${ticker} failed: ${(err as Error).message}`);
    return null;
  }
}
