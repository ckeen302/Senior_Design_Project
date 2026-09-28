/**
 * SEC Form 4 ingestion pipeline (fetch → parse → upsert).
 *
 * Storage is abstracted behind `IngestRepository` so the pipeline can be unit
 * tested without a database; `SupabaseIngestRepository` (repository.ts) is the
 * production implementation.
 */

import {
  EdgarClient,
  EdgarHttpError,
  type FilingRef,
  normalizeTicker,
  padCik,
  prettifyCompanyName,
  recentForm4Filings,
  type SubmissionsResponse,
} from "./edgar.ts";
import { fetchMarketCapUsd } from "./finnhub.ts";
import { Form4ParseError, parseForm4Xml, summarizeForm4 } from "./form4.ts";
import { isExecutiveTitle } from "./wisi.ts";

export interface CompanyRecord {
  id: string;
  ticker: string;
  cik: string;
  company_name: string;
  market_cap: number | null;
  market_cap_updated_at: string | null;
  last_synced_at: string | null;
}

export interface TransactionInsert {
  company_id: string;
  accession_number: string;
  filing_date: string;
  transaction_date: string;
  reporting_owner_name: string;
  owner_title: string | null;
  transaction_code: string;
  shares: number;
  price_per_share: number;
  is_direct: boolean;
  post_transaction_shares: number | null;
}

export interface IngestRepository {
  findCompanies(by: { tickers?: string[]; ciks?: string[] }): Promise<CompanyRecord[]>;
  listCompaniesForSync(limit: number): Promise<CompanyRecord[]>;
  /** Inserts the company if its CIK is new; never modifies an existing row. */
  ensureCompany(input: { ticker: string; cik: string; company_name: string }): Promise<CompanyRecord>;
  /** Accessions already stored as transactions, or already skipped for this company. */
  existingAccessions(companyId: string, accessionNumbers: string[]): Promise<Set<string>>;
  /** Upserts on accession_number; returns the number of rows written. */
  upsertTransactions(rows: TransactionInsert[]): Promise<number>;
  recordSkippedFilings(rows: SkippedFiling[]): Promise<void>;
  markSynced(companyId: string, at: Date): Promise<void>;
  updateMarketCap(companyId: string, marketCapUsd: number, at: Date): Promise<void>;
}

export interface SkippedFiling {
  company_id: string;
  accession_number: string;
  reason: "not_issuer" | "no_transactions";
}

export type IngestTarget =
  | { kind: "ticker"; ticker: string }
  | { kind: "cik"; cik: string }
  | { kind: "company"; company: CompanyRecord };

export interface IngestOptions {
  /** Maximum not-yet-stored filings fetched per company in one run. */
  maxFilingsPerCompany: number;
  /** Only filings accepted within this many days are considered. */
  lookbackDays: number;
  /** Epoch ms after which no new SEC request is started. */
  deadline: number;
  finnhubApiKey?: string;
  marketCapMaxAgeDays?: number;
  /** Whale alert threshold (USD) for CEO/CFO open-market purchases. */
  whaleMinValueUsd?: number;
  /** Only filings accepted within this many hours can trigger alerts. */
  whaleMaxAgeHours?: number;
  now?: () => Date;
  fetchFn?: typeof fetch;
}

export interface CompanyReport {
  ticker: string | null;
  cik: string | null;
  companyId: string | null;
  status: "ok" | "partial" | "error" | "skipped";
  filingsInWindow: number;
  alreadyStored: number;
  fetched: number;
  upserted: number;
  /** Filings where the company is the reporting owner rather than the issuer. */
  notIssuer: number;
  noTransactions: number;
  failedFilings: number;
  remaining: number;
  error?: string;
}

export interface WhaleTrade {
  companyId: string;
  ticker: string;
  companyName: string;
  accessionNumber: string;
  ownerName: string;
  ownerTitle: string | null;
  shares: number;
  pricePerShare: number;
  totalValue: number;
  filingDate: string;
}

export interface IngestReport {
  companies: CompanyReport[];
  totals: {
    companies: number;
    succeeded: number;
    failed: number;
    filingsFetched: number;
    transactionsUpserted: number;
    alreadyStored: number;
    notIssuerFilings: number;
    noTransactionFilings: number;
    failedFilings: number;
  };
  whales: WhaleTrade[];
  secRequests: number;
  deadlineReached: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyReport(ticker: string | null, cik: string | null, companyId: string | null): CompanyReport {
  return {
    ticker,
    cik,
    companyId,
    status: "ok",
    filingsInWindow: 0,
    alreadyStored: 0,
    fetched: 0,
    upserted: 0,
    notIssuer: 0,
    noTransactions: 0,
    failedFilings: 0,
    remaining: 0,
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Resolves request targets to company rows, creating companies for new tickers/CIKs. */
async function resolveCompany(
  target: IngestTarget,
  edgar: EdgarClient,
  repo: IngestRepository,
): Promise<{ company: CompanyRecord; submissions?: SubmissionsResponse }> {
  if (target.kind === "company") return { company: target.company };

  if (target.kind === "ticker") {
    const ticker = normalizeTicker(target.ticker);
    const [known] = await repo.findCompanies({ tickers: [ticker] });
    if (known) return { company: known };

    const entry = (await edgar.getTickerMap()).get(ticker);
    if (!entry) throw new Error(`Ticker ${ticker} was not found in the SEC ticker list`);
    const [byCik] = await repo.findCompanies({ ciks: [entry.cik] });
    if (byCik) return { company: byCik };

    const company = await repo.ensureCompany({
      ticker,
      cik: entry.cik,
      company_name: prettifyCompanyName(entry.title),
    });
    return { company };
  }

  const cik = padCik(target.cik);
  const [known] = await repo.findCompanies({ ciks: [cik] });
  if (known) return { company: known };

  const submissions = await edgar.getSubmissions(cik);
  const ticker = submissions.tickers?.[0];
  if (!ticker) throw new Error(`CIK ${cik} (${submissions.name}) has no listed ticker symbol`);
  const company = await repo.ensureCompany({
    ticker: normalizeTicker(ticker),
    cik,
    company_name: prettifyCompanyName(submissions.name),
  });
  return { company, submissions };
}

type Classified = { row: TransactionInsert } | { skip: SkippedFiling["reason"] };

function classifyFiling(company: CompanyRecord, filing: FilingRef, xml: string): Classified {
  const doc = parseForm4Xml(xml);
  // Issuer submissions also list Form 4s the company filed as a *reporting
  // owner* of another issuer; those trades belong to the other company.
  if (doc.issuer.cik && /^\d{1,10}$/.test(doc.issuer.cik) && padCik(doc.issuer.cik) !== company.cik) {
    return { skip: "not_issuer" };
  }
  const summary = summarizeForm4(doc, filing.reportDate ?? filing.filingDate);
  if (!summary) return { skip: "no_transactions" };
  return { row: {
    company_id: company.id,
    accession_number: filing.accessionNumber,
    filing_date: filing.acceptedAt,
    transaction_date: summary.transactionDate,
    reporting_owner_name: summary.reportingOwnerName,
    owner_title: summary.ownerTitle,
    transaction_code: summary.transactionCode,
    shares: summary.shares,
    price_per_share: summary.pricePerShare,
    is_direct: summary.isDirect,
    post_transaction_shares: summary.postTransactionShares,
  } };
}

export async function runIngestion(
  targets: IngestTarget[],
  deps: { edgar: EdgarClient; repo: IngestRepository },
  options: IngestOptions,
): Promise<IngestReport> {
  const { edgar, repo } = deps;
  const now = options.now ?? (() => new Date());
  const whaleMin = options.whaleMinValueUsd ?? 1_000_000;
  const whaleMaxAgeMs = (options.whaleMaxAgeHours ?? 72) * 60 * 60 * 1000;
  const marketCapMaxAgeMs = (options.marketCapMaxAgeDays ?? 7) * DAY_MS;

  const reports: CompanyReport[] = [];
  const whales: WhaleTrade[] = [];
  let deadlineReached = false;
  const pastDeadline = () => {
    if (Date.now() >= options.deadline) deadlineReached = true;
    return deadlineReached;
  };

  for (const target of targets) {
    const label = target.kind === "company"
      ? { ticker: target.company.ticker, cik: target.company.cik }
      : target.kind === "ticker"
      ? { ticker: normalizeTicker(target.ticker), cik: null }
      : { ticker: null, cik: target.cik };
    const report = emptyReport(label.ticker, label.cik, target.kind === "company" ? target.company.id : null);
    reports.push(report);

    if (pastDeadline()) {
      report.status = "skipped";
      report.error = "Time budget exhausted; will be picked up by the next run";
      continue;
    }

    try {
      const resolved = await resolveCompany(target, edgar, repo);
      const company = resolved.company;
      Object.assign(report, { ticker: company.ticker, cik: company.cik, companyId: company.id });

      const submissions = resolved.submissions ?? await edgar.getSubmissions(company.cik);
      const since = new Date(now().getTime() - options.lookbackDays * DAY_MS);
      const filings = recentForm4Filings(submissions, since);
      report.filingsInWindow = filings.length;

      const stored = await repo.existingAccessions(company.id, filings.map((f) => f.accessionNumber));
      const pending = filings.filter((f) => !stored.has(f.accessionNumber));
      report.alreadyStored = filings.length - pending.length;
      const batch = pending.slice(0, Math.max(0, options.maxFilingsPerCompany));

      const rows: TransactionInsert[] = [];
      const skipped: SkippedFiling[] = [];
      let attempted = 0;
      let cutShort = false;
      for (const filing of batch) {
        if (pastDeadline()) {
          cutShort = true;
          break;
        }
        attempted++;

        let xml: string;
        try {
          xml = await edgar.getForm4Xml(company.cik, filing);
        } catch (err) {
          // Throttled even after retries: stop hammering SEC for this company.
          if (!(err instanceof EdgarHttpError) || err.status === 403 || err.status === 429) throw err;
          report.failedFilings++;
          console.warn(`[ingest] ${company.ticker} ${filing.accessionNumber}: ${errorMessage(err)}`);
          continue;
        }
        report.fetched++;

        try {
          const result = classifyFiling(company, filing, xml);
          if ("row" in result) {
            rows.push(result.row);
          } else {
            skipped.push({ company_id: company.id, accession_number: filing.accessionNumber, reason: result.skip });
            if (result.skip === "not_issuer") report.notIssuer++;
            else report.noTransactions++;
          }
        } catch (err) {
          report.failedFilings++;
          const kind = err instanceof Form4ParseError ? "parse error" : "unexpected parse failure";
          console.warn(`[ingest] ${company.ticker} ${filing.accessionNumber}: ${kind}: ${errorMessage(err)}`);
        }
      }

      report.upserted = await repo.upsertTransactions(rows);
      await repo.recordSkippedFilings(skipped);
      report.remaining = pending.length - attempted;

      const nowMs = now().getTime();
      for (const row of rows) {
        const value = row.shares * row.price_per_share;
        if (
          row.transaction_code === "P" &&
          isExecutiveTitle(row.owner_title) &&
          value >= whaleMin &&
          nowMs - Date.parse(row.filing_date) <= whaleMaxAgeMs
        ) {
          whales.push({
            companyId: company.id,
            ticker: company.ticker,
            companyName: company.company_name,
            accessionNumber: row.accession_number,
            ownerName: row.reporting_owner_name,
            ownerTitle: row.owner_title,
            shares: row.shares,
            pricePerShare: row.price_per_share,
            totalValue: Math.round(value * 100) / 100,
            filingDate: row.filing_date,
          });
        }
      }

      if (options.finnhubApiKey) {
        const updatedAt = company.market_cap_updated_at ? Date.parse(company.market_cap_updated_at) : 0;
        if (nowMs - updatedAt > marketCapMaxAgeMs) {
          const cap = await fetchMarketCapUsd(company.ticker, options.finnhubApiKey, options.fetchFn);
          if (cap) await repo.updateMarketCap(company.id, cap, now());
        }
      }

      if (cutShort) {
        report.status = "partial";
      } else {
        await repo.markSynced(company.id, now());
      }
    } catch (err) {
      report.status = "error";
      report.error = errorMessage(err);
      console.error(`[ingest] ${report.ticker ?? report.cik}: ${report.error}`);
    }
  }

  const totals = {
    companies: reports.length,
    succeeded: reports.filter((r) => r.status === "ok" || r.status === "partial").length,
    failed: reports.filter((r) => r.status === "error").length,
    filingsFetched: reports.reduce((s, r) => s + r.fetched, 0),
    transactionsUpserted: reports.reduce((s, r) => s + r.upserted, 0),
    alreadyStored: reports.reduce((s, r) => s + r.alreadyStored, 0),
    notIssuerFilings: reports.reduce((s, r) => s + r.notIssuer, 0),
    noTransactionFilings: reports.reduce((s, r) => s + r.noTransactions, 0),
    failedFilings: reports.reduce((s, r) => s + r.failedFilings, 0),
  };

  return { companies: reports, totals, whales, secRequests: edgar.requestCount, deadlineReached };
}
