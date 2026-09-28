/** Display formatting helpers (currency, numbers, relative time, SEC names). */

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** $1,250,000 */
export function formatCurrency(value: number | null | undefined): string {
  return isNum(value) ? usdWhole.format(value) : "—";
}

/** $340.22 */
export function formatPrice(value: number | null | undefined): string {
  return isNum(value) ? usdCents.format(value) : "—";
}

/** $1.3M, -$250K, $4.98T */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (!isNum(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units: [number, string, number][] = [
    [1e12, "T", 2],
    [1e9, "B", 1],
    [1e6, "M", 1],
    [1e3, "K", 0],
  ];
  for (const [size, suffix, digits] of units) {
    if (abs >= size) return `${sign}$${(abs / size).toFixed(digits)}${suffix}`;
  }
  return `${sign}${usdWhole.format(abs)}`;
}

export function formatShares(value: number | null | undefined): string {
  return isNum(value) ? wholeNumber.format(value) : "—";
}

/** +1.25% / -0.40% */
export function formatPercent(value: number | null | undefined): string {
  if (!isNum(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then "Sep 12" / "Sep 12, 2025". */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(then);
  return date.getFullYear() === new Date(now).getFullYear() ? shortDate.format(date) : longDate.format(date);
}

/** Formats a plain YYYY-MM-DD date (no timezone shift). */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return longDate.format(new Date(y, m - 1, d));
}

const KEEP_UPPER = new Set(["LLC", "LP", "LLP", "PLC", "NV", "SA", "AG", "USA", "II", "III", "IV", "CEO", "CFO"]);
const FIX_CASE: Record<string, string> = { INC: "Inc", CORP: "Corp", CO: "Co", LTD: "Ltd", JR: "Jr", SR: "Sr" };

/**
 * SEC lists reporting owners in capitals, surname first ("HUANG JEN HSUN").
 * Title-cases them for display ("Huang Jen Hsun") and leaves mixed-case names
 * untouched.
 */
export function prettifyName(name: string | null | undefined): string {
  if (!name) return "Unknown";
  // Joint filings are stored as "FIRST OWNER +2 more".
  const joint = /^(.*?)(\s\+\d+ more)$/.exec(name);
  if (joint) return prettifyName(joint[1]) + joint[2];
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part) => {
      const upper = part.toUpperCase();
      if (KEEP_UPPER.has(upper.replace(/[.,]/g, ""))) return upper;
      const fixed = FIX_CASE[upper.replace(/[.,]/g, "")];
      if (fixed) return part.replace(/[a-z]+/i, fixed);
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

export type TransactionTone = "buy" | "sell" | "neutral";

const TRANSACTION_CODES: Record<string, { label: string; tone: TransactionTone; description: string }> = {
  P: { label: "Buy", tone: "buy", description: "Open-market or private purchase" },
  S: { label: "Sell", tone: "sell", description: "Open-market or private sale" },
  A: { label: "Award", tone: "neutral", description: "Grant or award from the company" },
  M: { label: "Exercise", tone: "neutral", description: "Exercise or conversion of a derivative security" },
  X: { label: "Exercise", tone: "neutral", description: "Exercise of an in-the-money derivative" },
  C: { label: "Conversion", tone: "neutral", description: "Conversion of a derivative security" },
  F: { label: "Tax", tone: "neutral", description: "Shares withheld to pay tax or exercise price" },
  G: { label: "Gift", tone: "neutral", description: "Bona fide gift" },
  D: { label: "Disposed", tone: "neutral", description: "Disposition back to the issuer" },
  J: { label: "Other", tone: "neutral", description: "Other acquisition or disposition" },
  W: { label: "Inherited", tone: "neutral", description: "Acquired or disposed by will or inheritance" },
};

export function describeTransactionCode(code: string | null | undefined) {
  const normalized = (code ?? "").trim().toUpperCase();
  return (
    TRANSACTION_CODES[normalized] ?? {
      label: normalized ? `Code ${normalized}` : "Unknown",
      tone: "neutral" as const,
      description: "Other Form 4 transaction",
    }
  );
}

/** Link to the filing's index page on SEC EDGAR. */
export function secFilingUrl(cik: string, accessionNumber: string): string {
  const cikInt = String(Number(cik));
  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accessionNumber.replace(/-/g, "")}/${accessionNumber}-index.htm`;
}
