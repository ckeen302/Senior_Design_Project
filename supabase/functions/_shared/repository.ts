/** Supabase (PostgREST) implementation of the ingestion repository. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRecord, IngestRepository, SkippedFiling, TransactionInsert } from "./ingest.ts";

const COMPANY_COLUMNS = "id, ticker, cik, company_name, market_cap, market_cap_updated_at, last_synced_at";
const CHUNK = 100;

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

export class SupabaseIngestRepository implements IngestRepository {
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
        await this.db.from("insider_transactions").select("accession_number").in("accession_number", part),
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
    let written = 0;
    for (const part of chunks(rows)) {
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
    const rows = check(
      await this.db
        .from("profiles")
        .select("id, expo_push_token")
        .eq("whale_alerts_enabled", true)
        .not("expo_push_token", "is", null),
      "Loading push recipients",
    ) as { id: string; expo_push_token: string }[];
    return rows.map((r) => ({ userId: r.id, token: r.expo_push_token }));
  }

  async clearPushTokens(tokens: string[]): Promise<void> {
    for (const part of chunks(tokens)) {
      check(
        await this.db.from("profiles").update({ expo_push_token: null }).in("expo_push_token", part),
        "Clearing invalid push tokens",
      );
    }
  }
}
