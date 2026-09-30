/**
 * Insider Signal helpers. The database computes the 0–100 score
 * (company_signal() in the v2 migration); this module mirrors its labels and
 * the generated trade columns, and turns Form 4 rows into plain English.
 */

import { colors } from "../theme";
import { formatCompactCurrency, formatShares } from "./format";

export type SignalLabel = "Strong buying" | "Buying" | "Neutral" | "Selling" | "Strong selling" | "No signal";
export type Tone = "buy" | "sell" | "neutral";

/** Must match signal_label() in SQL. */
export const SIGNAL_THRESHOLDS = { strongBuy: 75, buy: 58, sell: 42, strongSell: 25 } as const;
/** Trades below this value never count towards the signal. */
export const MIN_SIGNAL_VALUE = 10_000;

const LABELS: SignalLabel[] = ["Strong buying", "Buying", "Neutral", "Selling", "Strong selling", "No signal"];

export function signalLabel(score: number, insiders: number): SignalLabel {
  if (!insiders) return "No signal";
  if (score >= SIGNAL_THRESHOLDS.strongBuy) return "Strong buying";
  if (score >= SIGNAL_THRESHOLDS.buy) return "Buying";
  if (score <= SIGNAL_THRESHOLDS.strongSell) return "Strong selling";
  if (score <= SIGNAL_THRESHOLDS.sell) return "Selling";
  return "Neutral";
}

export function normalizeSignalLabel(label: string | null | undefined, score: number, insiders: number): SignalLabel {
  return LABELS.includes(label as SignalLabel) ? (label as SignalLabel) : signalLabel(score, insiders);
}

export function signalTone(label: SignalLabel): Tone {
  if (label === "Strong buying" || label === "Buying") return "buy";
  if (label === "Strong selling" || label === "Selling") return "sell";
  return "neutral";
}

export function signalColor(label: SignalLabel): string {
  if (label === "No signal") return colors.textFaint;
  const tone = signalTone(label);
  return tone === "buy" ? colors.buy : tone === "sell" ? colors.sell : colors.neutral;
}

type TradeFlags = {
  transaction_code: string;
  is_10b5_1?: boolean | null;
  is_sell_to_cover?: boolean | null;
  is_option_sale?: boolean | null;
  price_suspect?: boolean | null;
  parser_version?: number | null;
};

/** Mirrors the generated column insider_transactions.signal_direction. */
export function signalDirection(t: TradeFlags): -1 | 0 | 1 {
  if ((t.parser_version ?? 1) < 2 || t.price_suspect) return 0;
  if (t.transaction_code === "P" && !t.is_10b5_1) return 1;
  if (t.transaction_code === "S" && !t.is_10b5_1 && !t.is_sell_to_cover && !t.is_option_sale) return -1;
  return 0;
}

/** Mirrors insider_transactions.stake_change_pct. */
export function stakeChangePct(code: string, shares: number, post: number | null | undefined): number | null {
  if (post === null || post === undefined || !(shares > 0)) return null;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (code === "P" && post - shares > 0) return round1(Math.min((shares / (post - shares)) * 100, 9999));
  if (code === "S" && post + shares > 0) return round1((shares / (post + shares)) * 100);
  return null;
}

const ROLE_PATTERNS: [RegExp, string][] = [
  [/\bceo\b|chief executive|principal executive/i, "CEO"],
  [/\bcfo\b|chief financial|principal financial/i, "CFO"],
  [/\bcoo\b|chief operating/i, "COO"],
  [/\bcto\b|chief technology/i, "CTO"],
  [/\bpresident\b/i, "President"],
  [/\bchair/i, "Chair"],
  [/\bevp\b|executive vice president/i, "EVP"],
  [/\bsvp\b|senior vice president/i, "SVP"],
  [/\bvp\b|vice president/i, "VP"],
  [/chief [a-z]+ officer/i, ""],
  [/\bdirector\b/i, "Director"],
  [/10\s*%|ten percent/i, "10% owner"],
  [/\bofficer\b/i, "Officer"],
];

/** "Chief Executive Officer, Director" → "CEO"; "Director, 10% Owner" → "Director". */
export function shortRole(title: string | null | undefined): string | null {
  if (!title) return null;
  for (const [pattern, role] of ROLE_PATTERNS) {
    const match = pattern.exec(title);
    if (!match) continue;
    if (role) return role;
    // "Chief Legal Officer" → keep the phrase as written.
    return match[0].replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return title.length <= 24 ? title : null;
}

export type TradeKind =
  | "buy"
  | "sell"
  | "planned-buy"
  | "planned-sale"
  | "tax-sale"
  | "option-sale"
  | "tax-withholding"
  | "award"
  | "exercise"
  | "gift"
  | "suspect"
  | "other";

export interface TradeStory {
  kind: TradeKind;
  tone: Tone;
  /** "Bought $2.1M", "Sold $938K to cover taxes", "Received 12,000 shares". */
  headline: string;
  /** Short verb phrase for list rows: "Bought", "Sold to cover taxes", "Stock award". */
  action: string;
  /** Short chip text: "Open-market buy", "10b5-1 plan", "Tax sale", ... */
  tag: string;
  /** Pre-scheduled or administrative: says little about what insiders think. */
  routine: boolean;
  /** "+35% stake" / "Sold 12% of stake" when the filing reports holdings. */
  stakeNote: string | null;
}

type StoryInput = TradeFlags & {
  shares: number;
  price_per_share: number;
  total_value: number;
  post_transaction_shares?: number | null;
  stake_change_pct?: number | null;
};

function amount(t: StoryInput): string {
  return t.total_value > 0 ? formatCompactCurrency(t.total_value) : `${formatShares(t.shares)} shares`;
}

function stakeNote(t: StoryInput, kind: TradeKind): string | null {
  const pct = t.stake_change_pct ?? stakeChangePct(t.transaction_code, t.shares, t.post_transaction_shares);
  if (pct === null || pct === undefined) return null;
  const shown = pct < 0.1 ? "<0.1" : pct < 1 ? pct.toFixed(1) : pct >= 1000 ? "1,000+" : String(Math.round(pct));
  if (kind === "buy" || kind === "planned-buy") return `+${shown}% stake`;
  // Option sales: the exercised shares inflate the "holding", so skip the note.
  if (kind === "sell" || kind === "planned-sale" || kind === "tax-sale") return `Sold ${shown}% of stake`;
  return null;
}

/** Plain-English description of one Form 4 row. */
export function describeTrade(t: StoryInput): TradeStory {
  const code = (t.transaction_code ?? "").toUpperCase();
  const shares = `${formatShares(t.shares)} shares`;
  let story: Omit<TradeStory, "stakeNote" | "action">;

  if ((code === "P" || code === "S") && t.price_suspect) {
    // The filing's price is implausible, so its dollar amount is not repeated.
    story = {
      kind: "suspect",
      tone: "neutral",
      headline: `${code === "P" ? "Bought" : "Sold"} ${shares}`,
      tag: "Price looks wrong in filing",
      routine: true,
    };
  } else if (code === "P") {
    story = t.is_10b5_1
      ? { kind: "planned-buy", tone: "neutral", headline: `Bought ${amount(t)}`, tag: "10b5-1 plan", routine: true }
      : { kind: "buy", tone: "buy", headline: `Bought ${amount(t)}`, tag: "Open-market buy", routine: false };
  } else if (code === "S") {
    if (t.is_sell_to_cover) {
      story = { kind: "tax-sale", tone: "neutral", headline: `Sold ${amount(t)} to cover taxes`, tag: "Tax sale", routine: true };
    } else if (t.is_10b5_1) {
      story = { kind: "planned-sale", tone: "neutral", headline: `Sold ${amount(t)}`, tag: "10b5-1 plan", routine: true };
    } else if (t.is_option_sale) {
      story = {
        kind: "option-sale",
        tone: "neutral",
        headline: `Exercised options, sold ${amount(t)}`,
        tag: "Option sale",
        routine: true,
      };
    } else {
      story = { kind: "sell", tone: "sell", headline: `Sold ${amount(t)}`, tag: "Open-market sale", routine: false };
    }
  } else if (code === "F") {
    story = {
      kind: "tax-withholding",
      tone: "neutral",
      headline: t.total_value > 0 ? `${amount(t)} of stock withheld for taxes` : `${shares} withheld for taxes`,
      tag: "Tax withholding",
      routine: true,
    };
  } else if (code === "A") {
    story = {
      kind: "award",
      tone: "neutral",
      headline: t.total_value > 0 ? `Received ${amount(t)} in stock` : `Received ${shares}`,
      tag: "Stock award",
      routine: true,
    };
  } else if (code === "M" || code === "X" || code === "C") {
    story = {
      kind: "exercise",
      tone: "neutral",
      headline: code === "C" ? `Converted ${shares}` : `Exercised options for ${shares}`,
      tag: code === "C" ? "Conversion" : "Option exercise",
      routine: true,
    };
  } else if (code === "G") {
    story = { kind: "gift", tone: "neutral", headline: `Gifted ${shares}`, tag: "Gift", routine: true };
  } else {
    story = {
      kind: "other",
      tone: "neutral",
      headline: `Reported ${shares}`,
      tag: code ? `Form 4 code ${code}` : "Other",
      routine: true,
    };
  }
  const action = story.kind === "exercise" && code === "C" ? "Converted" : ACTIONS[story.kind];
  return { ...story, action, stakeNote: stakeNote(t, story.kind) };
}

const ACTIONS: Record<TradeKind, string> = {
  buy: "Bought",
  sell: "Sold",
  "planned-buy": "Bought under a 10b5-1 plan",
  "planned-sale": "Sold under a 10b5-1 plan",
  "tax-sale": "Sold to cover taxes",
  "option-sale": "Exercised options and sold",
  "tax-withholding": "Shares withheld for taxes",
  award: "Stock award",
  exercise: "Exercised options",
  gift: "Gift",
  suspect: "Price looks wrong in filing",
  other: "Other filing",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "3 insiders bought $4.2M · 1 sold $300K" */
export function signalSummary(s: {
  signal_buyers: number;
  signal_sellers: number;
  signal_buy_value: number;
  signal_sell_value: number;
}): string {
  const parts: string[] = [];
  if (s.signal_buyers > 0) {
    parts.push(`${plural(s.signal_buyers, "insider")} bought ${formatCompactCurrency(s.signal_buy_value)}`);
  }
  if (s.signal_sellers > 0) {
    const who = parts.length > 0 ? String(s.signal_sellers) : plural(s.signal_sellers, "insider");
    parts.push(`${who} sold ${formatCompactCurrency(s.signal_sell_value)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No open-market insider buys or sells in 90 days";
}

/**
 * % move from the insiders' average price to the current price. Returns null
 * when the two prices are too far apart to be the same security (a filing in
 * ordinary shares vs. a US-listed ADS, or a different share class).
 */
export function changeSince(avgPrice: number | null | undefined, price: number | null | undefined): number | null {
  if (!avgPrice || !price || avgPrice <= 0 || price <= 0) return null;
  const ratio = price / avgPrice;
  if (ratio < 0.2 || ratio > 5) return null;
  return (ratio - 1) * 100;
}

/** "+22.5" / "−3.8" with a real minus sign. */
export function formatPoints(points: number): string {
  const rounded = Math.round(points * 10) / 10;
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}

type GroupKeyInput = {
  company_id: string;
  transaction_date: string;
  transaction_code: string;
  shares: number;
  price_per_share: number;
};

/**
 * Members of a group (a fund, its general partner, a director who controls it)
 * each file a Form 4 for the same trade. Keeps the first row of each identical
 * trade and counts the other filers.
 */
export function collapseGroupFilings<T extends GroupKeyInput>(items: T[]): (T & { relatedFilers: number })[] {
  const out: (T & { relatedFilers: number })[] = [];
  const byKey = new Map<string, T & { relatedFilers: number }>();
  for (const item of items) {
    const key = item.shares > 0
      ? `${item.company_id}|${item.transaction_date}|${item.transaction_code}|${item.shares}|${item.price_per_share}`
      : null;
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.relatedFilers++;
      continue;
    }
    const entry = { ...item, relatedFilers: 0 };
    if (key) byKey.set(key, entry);
    out.push(entry);
  }
  return out;
}
