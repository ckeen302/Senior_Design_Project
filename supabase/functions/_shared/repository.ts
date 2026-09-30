/** Supabase (PostgREST) implementation of the ingestion repository. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FilingPointer } from "./edgar.ts";
import {
  type CompanyRecord,
  type IngestRepository,
  MIN_REUSABLE_PARSER_VERSION,
  type SkippedFiling,
  type TransactionInsert,
} from "./ingest.ts";
import type { EdgarDay, IssuerInput, IssuerRecord, MarketRepository, ProcessedFiling } from "./market.ts";

const COMPANY_COLUMNS = "id, ticker, cik, company_name, market_cap, market_cap_updated_at, last_synced_at";
const CHUNK = 100;
/** Below PostgREST's default max_rows (1,000), so a short page means the end. */
const RECIPIENT_PAGE = 500;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

export interface PushRecipient {
  userId: string;
  token: string;
}

const LEASE_NAME = "sec";

export class SupabaseIngestRepository implements IngestRepository, MarketRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findCompanies(by: { tickers?: string[]; ciks?: string[] }): Promise<CompanyRecord[]> {
    const found = new Map<string, CompanyRecord>();
    if (by.tickers?.length) {
      const rows = check(
        await this.db.from("companies").select(COMPANY_COLUMNS).in("ticker", by.tickers),
        "Loading companies by ticker",
      ) as CompanyRecord[];
      rows.forEach((r) => found.set(r.id, r));
    }
    if (by.ciks?.length) {
      const rows = check(
        await this.db.from("companies").select(COMPANY_COLUMNS).in("cik", by.ciks),
        "Loading companies by CIK",
      ) as CompanyRecord[];
      rows.forEach((r) => found.set(r.id, r));
    }
    return [...found.values()];
  }

  async listCompaniesForSync(limit: number): Promise<CompanyRecord[]> {
    return check(
      await this.db
        .from("companies")
        .select(COMPANY_COLUMNS)
        .order("last_synced_at", { ascending: true, nullsFirst: true })
        .order("ticker", { ascending: true })
        .limit(limit),
      "Listing companies to sync",
    ) as CompanyRecord[];
  }

  async ensureCompany(input: { ticker: string; cik: string; company_name: string }): Promise<CompanyRecord> {
    check(
      await this.db.from("companies").upsert(input, { onConflict: "cik", ignoreDuplicates: true }),
      `Creating company ${input.ticker}`,
    );
    return check(
      await this.db.from("companies").select(COMPANY_COLUMNS).eq("cik", input.cik).single(),
      `Loading company ${input.ticker}`,
    ) as CompanyRecord;
  }

  async existingAccessions(companyId: string, accessionNumbers: string[]): Promise<Set<string>> {
    const existing = new Set<string>();
    for (const part of chunks(accessionNumbers)) {
      const stored = check(
        // Rows from an older parser version are fetched and parsed again.
        await this.db
          .from("insider_transactions")
          .select("accession_number")
          .in("accession_number", part)
          .gte("parser_version", MIN_REUSABLE_PARSER_VERSION),
        "Loading stored accession numbers",
      ) as { accession_number: string }[];
      const skipped = check(
        await this.db
          .from("ingestion_skipped_filings")
          .select("accession_number")
          .eq("company_id", companyId)
          .in("accession_number", part),
        "Loading skipped accession numbers",
      ) as { accession_number: string }[];
      [...stored, ...skipped].forEach((r) => existing.add(r.accession_number));
    }
    return existing;
  }

  async recordSkippedFilings(rows: SkippedFiling[]): Promise<void> {
    for (const part of chunks(rows)) {
      check(
        await this.db
          .from("ingestion_skipped_filings")
          .upsert(part, { onConflict: "company_id,accession_number", ignoreDuplicates: true }),
        "Recording skipped filings",
      );
    }
  }

  async upsertTransactions(rows: TransactionInsert[]): Promise<number> {
    // The scoring trigger locks each row's company. Taking those locks in one
    // global order (company id) means two writers can never deadlock.
    const ordered = [...rows].sort((a, b) =>
      a.company_id < b.company_id ? -1 : a.company_id > b.company_id ? 1 : 0
    );
    let written = 0;
    for (const part of chunks(ordered)) {
      const { error, count } = await this.db
        .from("insider_transactions")
        .upsert(part, { onConflict: "accession_number", count: "exact" });
      if (error) throw new Error(`Upserting insider transactions: ${error.message}`);
      written += count ?? part.length;
    }
    return written;
  }

  async markSynced(companyId: string, at: Date): Promise<void> {
    check(
      await this.db.from("companies").update({ last_synced_at: at.toISOString() }).eq("id", companyId),
      "Updating last_synced_at",
    );
  }

  async updateMarketCap(companyId: string, marketCapUsd: number, at: Date): Promise<void> {
    check(
      await this.db
        .from("companies")
        .update({ market_cap: marketCapUsd, market_cap_updated_at: at.toISOString() })
        .eq("id", companyId),
      "Updating market cap",
    );
  }

  async whaleAlertRecipients(): Promise<PushRecipient[]> {
    // PostgREST caps a response at max_rows (1,000 by default): page through.
    const byToken = new Map<string, PushRecipient>();
    for (let from = 0;; from += RECIPIENT_PAGE) {
      const rows = check(
        await this.db
          .from("profiles")
          .select("id, expo_push_token")
          .eq("whale_alerts_enabled", true)
          .not("expo_push_token", "is", null)
          .order("id")
          .range(from, from + RECIPIENT_PAGE - 1),
        "Loading push recipients",
      ) as { id: string; expo_push_token: string }[];
      // One message per device, even if a token were ever stored twice.
      rows.forEach((r) => byToken.set(r.expo_push_token, { userId: r.id, token: r.expo_push_token }));
      if (rows.length < RECIPIENT_PAGE) break;
    }
    return [...byToken.values()];
  }

  async clearPushTokens(tokens: string[]): Promise<void> {
    for (const part of chunks(tokens)) {
      check(
        await this.db.from("profiles").update({ expo_push_token: null }).in("expo_push_token", part),
        "Clearing invalid push tokens",
      );
    }
  }

  // --- Market-wide pipeline -------------------------------------------------

  async unprocessedAccessions(accessions: string[], minVersion: number): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunks(accessions, 500)) {
      const rows = check(
        await this.db.rpc("filter_unprocessed_filings", { p_accessions: part, p_min_version: minVersion }),
        "Filtering processed filings",
      ) as { accession_number: string }[];
      rows.forEach((r) => out.add(r.accession_number));
    }
    return out;
  }

  async ensureCompanies(issuers: IssuerInput[]): Promise<IssuerRecord[]> {
    if (issuers.length === 0) return [];
    return check(
      await this.db.rpc("ensure_companies", { p_companies: issuers }),
      "Creating companies",
    ) as IssuerRecord[];
  }

  async recordProcessed(rows: ProcessedFiling[]): Promise<void> {
    const processedAt = new Date().toISOString();
    for (const part of chunks(rows)) {
      check(
        await this.db
          .from("processed_filings")
          .upsert(part.map((r) => ({ ...r, processed_at: processedAt })), { onConflict: "accession_number" }),
        "Recording processed filings",
      );
    }
  }

  async getDays(days: string[]): Promise<Map<string, EdgarDay>> {
    const out = new Map<string, EdgarDay>();
    for (const part of chunks(days)) {
      const rows = check(
        await this.db.from("edgar_days").select("day, status, form4_count, updated_at").in("day", part),
        "Loading backfill progress",
      ) as EdgarDay[];
      rows.forEach((r) => out.set(r.day, r));
    }
    return out;
  }

  async saveDay(day: EdgarDay): Promise<void> {
    const { day: date, status, form4_count } = day;
    check(
      await this.db
        .from("edgar_days")
        .upsert({ day: date, status, form4_count, updated_at: new Date().toISOString() }, { onConflict: "day" }),
      "Saving backfill progress",
    );
  }

  /** The accession numbers that still count as discretionary buys after the database's checks. */
  async countedBuys(accessions: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunks(accessions)) {
      const rows = check(
        await this.db
          .from("insider_transactions")
          .select("accession_number")
          .in("accession_number", part)
          .eq("signal_direction", 1),
        "Confirming whale trades",
      ) as { accession_number: string }[];
      rows.forEach((r) => out.add(r.accession_number));
    }
    return out;
  }

  async reparseCandidates(limit: number, minVersion: number): Promise<FilingPointer[]> {
    const rows = check(
      await this.db.rpc("reparse_candidates", { p_limit: limit, p_min_version: minVersion }),
      "Loading rows to re-parse",
    ) as { accession_number: string; cik: string }[];
    return rows.map((r) => ({ accession: r.accession_number, cik: r.cik }));
  }

  async marketCapCandidates(limit: number): Promise<{ id: string; ticker: string }[]> {
    return check(
      await this.db.rpc("market_cap_refresh_candidates", { p_limit: limit }),
      "Loading market cap candidates",
    ) as { id: string; ticker: string }[];
  }

  async recordMarketCap(companyId: string, marketCapUsd: number | null, at: Date): Promise<void> {
    const checkedAt = at.toISOString();
    const patch = marketCapUsd
      ? { market_cap: marketCapUsd, market_cap_updated_at: checkedAt, market_cap_checked_at: checkedAt }
      : { market_cap_checked_at: checkedAt };
    check(await this.db.from("companies").update(patch).eq("id", companyId), "Recording market cap");
  }

  /** True when this run may talk to the SEC; false while another run holds the lease. */
  async claimLease(holder: string, seconds: number): Promise<boolean> {
    const claimed = check(
      await this.db.rpc("claim_ingestion_lease", { p_name: LEASE_NAME, p_holder: holder, p_seconds: seconds }),
      "Claiming the ingestion lease",
    );
    return claimed === true;
  }

  async releaseLease(holder: string): Promise<void> {
    check(
      await this.db.rpc("release_ingestion_lease", { p_name: LEASE_NAME, p_holder: holder }),
      "Releasing the ingestion lease",
    );
  }
}
