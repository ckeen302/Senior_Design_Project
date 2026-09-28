/**
 * Client-side helpers for the Weighted Insider Sentiment Index (WISI).
 * The database computes and stores the score (see the Phase 3 migration);
 * these mirror its 0–100 gauge mapping for display.
 */

import { colors } from "../theme";

export type SentimentLabel = "Bullish" | "Neutral" | "Bearish";

/** index = 50 + 50 * tanh(GAUGE_SCALE * WISI) — must match wisi_sentiment_index() in SQL. */
export const GAUGE_SCALE = 500;
export const BULLISH_THRESHOLD = 60;
export const BEARISH_THRESHOLD = 40;

export function wisiToIndex(wisi: number | null | undefined): number {
  const value = Number.isFinite(wisi) ? (wisi as number) : 0;
  return Math.round((50 + 50 * Math.tanh(value * GAUGE_SCALE)) * 10) / 10;
}

export function labelForIndex(index: number): SentimentLabel {
  if (index >= BULLISH_THRESHOLD) return "Bullish";
  if (index <= BEARISH_THRESHOLD) return "Bearish";
  return "Neutral";
}

export function normalizeLabel(label: string | null | undefined, index: number): SentimentLabel {
  return label === "Bullish" || label === "Bearish" || label === "Neutral" ? label : labelForIndex(index);
}

export function sentimentColor(label: SentimentLabel): string {
  if (label === "Bullish") return colors.buy;
  if (label === "Bearish") return colors.sell;
  return colors.neutral;
}

/** "+12.4 bps of market cap" — the raw WISI expressed in basis points. */
export function formatWisiBps(wisi: number | null | undefined): string {
  const bps = (Number.isFinite(wisi) ? (wisi as number) : 0) * 10_000;
  const rounded = Math.abs(bps) >= 100 ? bps.toFixed(0) : bps.toFixed(1);
  return `${bps > 0 ? "+" : ""}${rounded} bps of market cap`;
}
