/** Validation of fetch-sec-filings request bodies. */

import { normalizeTicker, padCik } from "../_shared/edgar.ts";
import { HttpError } from "../_shared/http.ts";

export type CallerRole = "service" | "user";

export interface IngestRequest {
  /** "symbols": the tickers/CIKs in the payload; "tracked": every company in the database. */
  mode: "symbols" | "tracked";
  tickers: string[];
  ciks: string[];
  /** Maximum new Form 4 filings fetched per company. */
  limit: number;
  lookbackDays: number;
  /** tracked mode: maximum companies processed (least recently synced first). */
  maxCompanies: number;
  /** Send whale push alerts for qualifying new filings. */
  notify: boolean;
}

const LIMITS: Record<CallerRole, {
  maxSymbols: number;
  limit: [number, number];
  lookbackDays: [number, number];
  maxCompanies: [number, number];
}> = {
  // [default, max]
  service: { maxSymbols: 50, limit: [25, 100], lookbackDays: [365, 730], maxCompanies: [100, 500] },
  // App users may backfill a handful of tickers they are about to track.
  user: { maxSymbols: 3, limit: [15, 15], lookbackDays: [365, 365], maxCompanies: [0, 0] },
};

function intOption(value: unknown, name: string, [fallback, max]: [number, number]): number {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new HttpError(400, `"${name}" must be an integer between 1 and ${max}`);
  }
  return n;
}

export function parseIngestRequest(body: unknown, role: CallerRole): IngestRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  const limits = LIMITS[role];

  if (b.mode !== undefined && b.mode !== "symbols" && b.mode !== "tracked") {
    throw new HttpError(400, '"mode" must be "symbols" or "tracked"');
  }
  const mode = b.mode === "tracked" ? "tracked" : "symbols";
  if (mode === "tracked" && role !== "service") {
    throw new HttpError(403, "Tracked mode is reserved for the scheduler");
  }

  const tickers = new Set<string>();
  const ciks = new Set<string>();
  const addTicker = (raw: string | number) => {
    const ticker = normalizeTicker(String(raw));
    if (!/^[A-Z0-9-]{1,10}$/.test(ticker)) throw new HttpError(400, `Invalid ticker: ${raw}`);
    tickers.add(ticker);
  };
  const addCik = (raw: string | number) => {
    try {
      ciks.add(padCik(raw));
    } catch {
      throw new HttpError(400, `Invalid CIK: ${raw}`);
    }
  };
  const addSymbol = (raw: string | number) =>
    typeof raw === "number" || /^\s*(CIK)?\d{1,10}\s*$/i.test(raw) ? addCik(raw) : addTicker(raw);

  const lists: [string, (raw: string | number) => void][] = [
    ["tickers", addTicker],
    ["ciks", addCik],
    ["symbols", addSymbol],
  ];
  for (const [key, add] of lists) {
    const value = b[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) throw new HttpError(400, `"${key}" must be an array`);
    for (const item of value) {
      if (typeof item !== "string" && typeof item !== "number") {
        throw new HttpError(400, `"${key}" may only contain strings or numbers`);
      }
      add(item);
    }
  }

  if (mode === "symbols") {
    const count = tickers.size + ciks.size;
    if (count === 0) {
      throw new HttpError(400, 'Provide "tickers" and/or "ciks" (e.g. {"tickers":["AAPL"]}), or {"mode":"tracked"}');
    }
    if (count > limits.maxSymbols) {
      throw new HttpError(400, `At most ${limits.maxSymbols} tickers/CIKs per request`);
    }
  }

  return {
    mode,
    tickers: [...tickers],
    ciks: [...ciks],
    limit: intOption(b.limit, "limit", limits.limit),
    lookbackDays: intOption(b.lookbackDays, "lookbackDays", limits.lookbackDays),
    maxCompanies: mode === "tracked" ? intOption(b.maxCompanies, "maxCompanies", limits.maxCompanies) : 0,
    notify: role === "service" && b.notify !== false,
  };
}
