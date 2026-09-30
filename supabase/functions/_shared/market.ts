/**
 * Market-wide Form 4 ingestion: every insider filing on EDGAR, not only the
 * companies someone already tracks. Steps (all share one time budget):
 *
 *   latest     the EDGAR "latest filings" feed, newest first
 *   reparse    rows written by an older parser version
 *   backfill   EDGAR daily form indexes, newest day first
 *   marketcaps Finnhub market caps for companies with recent signal trades
 *
 * Each filing costs exactly one SEC request: the full submission text file
 * holds the SEC header (acceptance time, form type) and the Form 4 XML. The
 * issuer is read from the XML and created on the fly.
 */

import {
  addDays,
  easternDate,
  EdgarClient,
  EdgarHttpError,
  extractOwnershipXml,
  type FilingPointer,
  isWeekend,
  normalizeTicker,
  padCik,
  parseDailyFormIndex,
  parseLatestFeed,
  prettifyCompanyName,
  submissionAcceptedAt,
  submissionFormType,
  type TickerEntry,
} from "./edgar.ts";
import { fetchMarketCapUsd } from "./finnhub.ts";
import { type Form4Document, type Form4Summary, parseForm4Xml, summarizeForm4 } from "./form4.ts";
import { buildTransactionRow, findWhaleTrades, PARSER_VERSION, type TransactionInsert, type WhaleTrade } from "./ingest.ts";

export type ProcessedStatus = "stored" | "no_transactions" | "no_ticker" | "amendment" | "unparseable" | "missing";

export interface ProcessedFiling {
  accession_number: string;
  status: ProcessedStatus;
  issuer_cik: string | null;
  parser_version: number;
}

export interface IssuerInput {
  cik: string;
  ticker: string;
  company_name: string;
}

export interface IssuerRecord extends IssuerInput {
  id: string;
}

export interface EdgarDay {
  day: string;
  status: "partial" | "done" | "empty";
  form4_count: number;
}

export interface MarketRepository {
  /** The accession numbers not yet processed by parser >= minVersion. */
  unprocessedAccessions(accessions: string[], minVersion: number): Promise<Set<string>>;
  /** Creates missing issuers; returns every requested issuer that exists afterwards. */
  ensureCompanies(issuers: IssuerInput[]): Promise<IssuerRecord[]>;
  upsertTransactions(rows: TransactionInsert[]): Promise<number>;
  recordProcessed(rows: ProcessedFiling[]): Promise<void>;
  getDays(days: string[]): Promise<Map<string, EdgarDay>>;
  saveDay(day: EdgarDay): Promise<void>;
  reparseCandidates(limit: number, minVersion: number): Promise<FilingPointer[]>;
  marketCapCandidates(limit: number): Promise<{ id: string; ticker: string }[]>;
  recordMarketCap(companyId: string, marketCapUsd: number | null, at: Date): Promise<void>;
}

export type MarketStep = "latest" | "reparse" | "backfill" | "marketcaps";

export interface MarketOptions {
  steps: MarketStep[];
  /** Epoch ms after which no new SEC request is started. */
  deadline: number;
  /** Epoch ms after which nothing new is started at all (market caps). */
  hardDeadline?: number;
  /** Latest-filings feed pages to scan (100 entries ≈ 50 filings each). */
  latestMaxPages?: number;
  /** Calendar days before today (Eastern) covered by the backfill. */
  backfillDays?: number;
  /** Backfill only this day (YYYY-MM-DD). */
  backfillDay?: string;
  reparseLimit?: number;
  marketCapLimit?: number;
  /** Filings buffered before writing to the database. */
  flushEvery?: number;
  finnhubApiKey?: string;
  whaleMinValueUsd?: number;
  whaleMaxAgeHours?: number;
  now?: () => Date;
  fetchFn?: typeof fetch;
}

export interface DayReport {
  day: string;
  status: EdgarDay["status"] | "unpublished" | "skipped";
  form4: number;
  pending: number;
  processed: number;
}

export interface MarketReport {
  steps: MarketStep[];
  latest: { pages: number; seen: number; pending: number; processed: number };
  reparse: { candidates: number; processed: number };
  backfill: { days: DayReport[]; complete: boolean };
  marketCaps: { checked: number; updated: number };
  outcomes: Record<ProcessedStatus | "failed", number>;
  transactionsUpserted: number;
  companiesSeen: number;
  whales: WhaleTrade[];
  secRequests: number;
  deadlineReached: boolean;
  error?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** SEC throttling that survived the client's retries: stop the whole run. */
function isThrottle(err: unknown): boolean {
  return err instanceof EdgarHttpError && (err.status === 403 || err.status === 429);
}

let cikIndexSource: Map<string, TickerEntry> | null = null;
let cikIndex = new Map<string, TickerEntry>();

/** CIK → primary ticker (the SEC list names a company's main share class first). */
async function tickerEntryForCik(edgar: EdgarClient, cik: string): Promise<TickerEntry | undefined> {
  const map = await edgar.getTickerMap();
  if (map !== cikIndexSource) {
    cikIndex = new Map();
    for (const entry of map.values()) if (!cikIndex.has(entry.cik)) cikIndex.set(entry.cik, entry);
    cikIndexSource = map;
  }
  return cikIndex.get(cik);
}

const NOT_A_TICKER = new Set(["NONE", "NA", "N-A", "NULL", "TBD", "PRIVATE"]);

/** The first plausible symbol in a Form 4 `issuerTradingSymbol` ("brk.a, brk.b" → "BRK-A"). */
export function tickerFromForm4(symbol: string | null): string | null {
  for (const token of (symbol ?? "").split(/[,;\s]+/)) {
    const ticker = normalizeTicker(token.replace(/^\$/, "").replace(/\//g, "-"));
    if (/^[A-Z][A-Z0-9-]{0,9}$/.test(ticker) && !NOT_A_TICKER.has(ticker)) return ticker;
  }
  return null;
}

type Inspection =
  | { status: Exclude<ProcessedStatus, "stored">; issuerCik: string | null; detail?: string }
  | {
    status: "stored";
    issuer: IssuerInput;
    summary: Form4Summary;
    acceptedAt: string;
  };

/** Downloads and classifies one filing (one SEC request). */
export async function inspectFiling(
  edgar: EdgarClient,
  pointer: FilingPointer,
  fallbackAcceptedAt: () => string,
): Promise<Inspection> {
  const submission = await edgar.getFullSubmission(pointer);
  if (submission === null) return { status: "missing", issuerCik: null };

  const formType = submissionFormType(submission);
  if (formType !== null && formType !== "4") return { status: "amendment", issuerCik: null, detail: formType };

  const xml = extractOwnershipXml(submission);
  if (!xml) return { status: "unparseable", issuerCik: null, detail: "no ownership XML" };

  let doc: Form4Document;
  try {
    doc = parseForm4Xml(xml);
  } catch (err) {
    return { status: "unparseable", issuerCik: null, detail: errorMessage(err) };
  }

  let issuerCik: string;
  try {
    issuerCik = padCik(doc.issuer.cik ?? "");
  } catch {
    return { status: "unparseable", issuerCik: null, detail: `bad issuer CIK ${doc.issuer.cik}` };
  }

  const summary = summarizeForm4(doc, doc.periodOfReport);
  if (!summary) return { status: "no_transactions", issuerCik };

  const listed = await tickerEntryForCik(edgar, issuerCik);
  const ticker = listed?.ticker ?? tickerFromForm4(doc.issuer.ticker);
  if (!ticker) return { status: "no_ticker", issuerCik };

  return {
    status: "stored",
    issuer: {
      cik: issuerCik,
      ticker,
      company_name: prettifyCompanyName(listed?.title ?? doc.issuer.name ?? ticker),
    },
    summary,
    acceptedAt: submissionAcceptedAt(submission) ?? fallbackAcceptedAt(),
  };
}

interface Pending {
  pointer: FilingPointer;
  inspection: Inspection;
  fresh: boolean;
  /** Record a "missing" outcome permanently (old filings only). */
  finalIfMissing: boolean;
}

export async function runMarketIngestion(
  deps: { edgar: EdgarClient; repo: MarketRepository },
  options: MarketOptions,
): Promise<MarketReport> {
  const { edgar, repo } = deps;
  const now = options.now ?? (() => new Date());
  const flushEvery = Math.max(1, options.flushEvery ?? 25);
  const hardDeadline = options.hardDeadline ?? options.deadline;
  const steps = new Set(options.steps);

  const report: MarketReport = {
    steps: options.steps,
    latest: { pages: 0, seen: 0, pending: 0, processed: 0 },
    reparse: { candidates: 0, processed: 0 },
    backfill: { days: [], complete: false },
    marketCaps: { checked: 0, updated: 0 },
    outcomes: { stored: 0, no_transactions: 0, no_ticker: 0, amendment: 0, unparseable: 0, missing: 0, failed: 0 },
    transactionsUpserted: 0,
    companiesSeen: 0,
    whales: [],
    secRequests: 0,
    deadlineReached: false,
  };

  const pastDeadline = () => {
    if (Date.now() >= options.deadline) report.deadlineReached = true;
    return report.deadlineReached;
  };

  const companies = new Map<string, IssuerRecord>();
  let buffer: Pending[] = [];

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];

    const issuers = new Map<string, IssuerInput>();
    for (const item of batch) {
      if (item.inspection.status === "stored" && !companies.has(item.inspection.issuer.cik)) {
        issuers.set(item.inspection.issuer.cik, item.inspection.issuer);
      }
    }
    if (issuers.size > 0) {
      for (const company of await repo.ensureCompanies([...issuers.values()])) companies.set(company.cik, company);
    }

    const rows = new Map<string, TransactionInsert>();
    const freshRows: TransactionInsert[] = [];
    const processed: ProcessedFiling[] = [];
    for (const item of batch) {
      const { inspection, pointer } = item;
      if (inspection.status === "stored") {
        const company = companies.get(inspection.issuer.cik);
        if (!company) {
          // Ticker already used by another CIK (e.g. a reused symbol).
          report.outcomes.no_ticker++;
          processed.push({
            accession_number: pointer.accession,
            status: "no_ticker",
            issuer_cik: inspection.issuer.cik,
            parser_version: PARSER_VERSION,
          });
          continue;
        }
        const row = buildTransactionRow(company.id, pointer.accession, inspection.acceptedAt, inspection.summary);
        if (!rows.has(row.accession_number) && item.fresh) freshRows.push(row);
        rows.set(row.accession_number, row);
        report.outcomes.stored++;
        processed.push({
          accession_number: pointer.accession,
          status: "stored",
          issuer_cik: company.cik,
          parser_version: PARSER_VERSION,
        });
      } else {
        report.outcomes[inspection.status]++;
        if (inspection.status === "missing" && !item.finalIfMissing) continue;
        processed.push({
          accession_number: pointer.accession,
          status: inspection.status,
          issuer_cik: inspection.issuerCik,
          parser_version: PARSER_VERSION,
        });
      }
    }

    report.transactionsUpserted += await repo.upsertTransactions([...rows.values()]);
    await repo.recordProcessed(processed);

    const byId = new Map([...companies.values()].map((c) => [c.id, c]));
    report.whales.push(
      ...findWhaleTrades(freshRows, (id) => byId.get(id), {
        nowMs: now().getTime(),
        minValueUsd: options.whaleMinValueUsd ?? 1_000_000,
        maxAgeMs: (options.whaleMaxAgeHours ?? 24) * HOUR_MS,
      }),
    );
  }

  /** Processes pointers in order until the deadline. */
  async function processAll(
    pointers: FilingPointer[],
    fresh: boolean,
    finalIfMissing: boolean,
  ): Promise<{ handled: number; failed: number }> {
    let handled = 0;
    let failed = 0;
    for (const pointer of pointers) {
      if (pastDeadline()) break;
      handled++;
      try {
        const inspection = await inspectFiling(edgar, pointer, () => now().toISOString());
        if (inspection.status !== "stored" && inspection.detail) {
          console.warn(`[market] ${pointer.accession}: ${inspection.status} (${inspection.detail})`);
        }
        buffer.push({ pointer, inspection, fresh, finalIfMissing });
      } catch (err) {
        if (isThrottle(err)) throw err;
        failed++;
        report.outcomes.failed++;
        console.warn(`[market] ${pointer.accession}: ${errorMessage(err)}`);
        continue;
      }
      if (buffer.length >= flushEvery) await flush();
    }
    await flush();
    return { handled, failed };
  }

  try {
    if (steps.has("latest") && !pastDeadline()) {
      const queue: FilingPointer[] = [];
      const queued = new Set<string>();
      for (let page = 0; page < (options.latestMaxPages ?? 4) && !pastDeadline(); page++) {
        const pointers = parseLatestFeed(await edgar.getLatestForm4Feed(page * 100));
        report.latest.pages++;
        report.latest.seen += pointers.length;
        if (pointers.length === 0) break;
        const pending = await repo.unprocessedAccessions(pointers.map((p) => p.accession), PARSER_VERSION);
        for (const p of pointers) {
          if (pending.has(p.accession) && !queued.has(p.accession)) {
            queued.add(p.accession);
            queue.push(p);
          }
        }
      }
      report.latest.pending = queue.length;
      report.latest.processed = (await processAll(queue, true, false)).handled;
    }

    if (steps.has("reparse") && !pastDeadline()) {
      const candidates = await repo.reparseCandidates(options.reparseLimit ?? 150, PARSER_VERSION);
      report.reparse.candidates = candidates.length;
      report.reparse.processed = (await processAll(candidates, false, true)).handled;
    }

    if (steps.has("backfill") && !pastDeadline()) {
      const today = easternDate(now());
      const days: string[] = [];
      if (options.backfillDay) {
        days.push(options.backfillDay);
      } else {
        for (let i = 1; i <= (options.backfillDays ?? 90); i++) {
          const day = addDays(today, -i);
          if (!isWeekend(day)) days.push(day);
        }
      }
      const known = await repo.getDays(days);
      let complete = true;

      for (const day of days) {
        const state = known.get(day);
        if (!options.backfillDay && (state?.status === "done" || state?.status === "empty")) continue;
        if (pastDeadline()) {
          complete = false;
          break;
        }

        const index = await edgar.getDailyFormIndex(day);
        if (index === null) {
          // Holidays have no index; recent days may simply not be published yet.
          const final = day <= addDays(today, -4);
          if (final) await repo.saveDay({ day, status: "empty", form4_count: 0 });
          else complete = false;
          report.backfill.days.push({ day, status: final ? "empty" : "unpublished", form4: 0, pending: 0, processed: 0 });
          continue;
        }

        const pointers = parseDailyFormIndex(index);
        const unprocessed = await repo.unprocessedAccessions(pointers.map((p) => p.accession), PARSER_VERSION);
        const todo = pointers.filter((p) => unprocessed.has(p.accession));
        const { handled: processed, failed } = await processAll(todo, false, true);
        // Failed downloads keep the day open so the next run retries them.
        const status = processed >= todo.length && failed === 0 ? "done" : "partial";
        if (status !== "done") complete = false;
        await repo.saveDay({ day, status, form4_count: pointers.length });
        report.backfill.days.push({ day, status, form4: pointers.length, pending: todo.length, processed });
      }
      report.backfill.complete = complete;
    }
  } catch (err) {
    // Keep whatever was already downloaded, then report the failure.
    await flush().catch((flushErr) => console.error(`[market] flush failed: ${errorMessage(flushErr)}`));
    report.error = errorMessage(err);
    console.error(`[market] run aborted: ${report.error}`);
  }

  if (steps.has("marketcaps") && options.finnhubApiKey && !report.error) {
    const candidates = await repo.marketCapCandidates(options.marketCapLimit ?? 10);
    for (const company of candidates) {
      if (Date.now() >= hardDeadline) break;
      const cap = await fetchMarketCapUsd(company.ticker, options.finnhubApiKey, options.fetchFn);
      await repo.recordMarketCap(company.id, cap, now());
      report.marketCaps.checked++;
      if (cap) report.marketCaps.updated++;
    }
  }

  report.companiesSeen = companies.size;
  report.secRequests = edgar.requestCount;
  return report;
}
