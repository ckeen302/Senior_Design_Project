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

type Unit = [size: number, suffix: string, digits: number];

/**
 * Scales a non-negative number to the largest unit it reaches, largest unit
 * first. Moves up a unit when rounding reaches 1000, so 999,999 is "1.0M",
 * not "1000K". Returns null below the smallest unit.
 */
function scaleToUnit(abs: number, units: Unit[]): string | null {
  for (let i = 0; i < units.length; i++) {
    const [size, suffix, digits] = units[i];
    if (abs < size) continue;
    const text = (abs / size).toFixed(digits);
    if (Number(text) >= 1000 && i > 0) {
      const [bigger, biggerSuffix, biggerDigits] = units[i - 1];
      return `${(abs / bigger).toFixed(biggerDigits)}${biggerSuffix}`;
    }
    return `${text}${suffix}`;
  }
  return null;
}

/** $1.3M, -$250K, $4.98T */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (!isNum(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const scaled = scaleToUnit(abs, [
    [1e12, "T", 2],
    [1e9, "B", 1],
    [1e6, "M", 1],
    [1e3, "K", 0],
  ]);
  return scaled ? `${sign}$${scaled}` : `${sign}${usdWhole.format(abs)}`;
}

/** 1.2K, 12K, 3.4M, 1.1B (plain counts). */
export function formatCompactNumber(value: number | null | undefined): string {
  if (!isNum(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const scaled = scaleToUnit(abs, [
    [1e9, "B", 1],
    [1e6, "M", 1],
    // One decimal below 10K ("1.2K"), whole thousands above ("12K").
    [1e3, "K", abs >= 9950 ? 0 : 1],
  ]);
  return `${sign}${scaled ?? wholeNumber.format(abs)}`;
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

function parseDay(day: string | null | undefined): Date | null {
  if (!day) return null;
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/** Formats a plain YYYY-MM-DD date (no timezone shift). */
export function formatDay(day: string | null | undefined): string {
  const date = parseDay(day);
  return date ? longDate.format(date) : "—";
}

/** Like formatDay, but drops the year when it is the current one: "Sep 25". */
export function formatShortDay(day: string | null | undefined, now: number = Date.now()): string {
  const date = parseDay(day);
  if (!date) return "—";
  return date.getFullYear() === new Date(now).getFullYear() ? shortDate.format(date) : longDate.format(date);
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
