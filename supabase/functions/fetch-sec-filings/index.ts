/**
 * fetch-sec-filings — SEC EDGAR Form 4 ingestion Edge Function.
 *
 * POST /functions/v1/fetch-sec-filings
 *   {"tickers": ["AAPL", "TSLA"], "ciks": ["320193"]}   ingest specific issuers
 *   {"symbols": ["NVDA", 1045810]}                       mixed tickers / CIKs
 *   {"mode": "tracked"}                                  every company in the DB
 *   optional: "limit" (new filings per company), "lookbackDays", "maxCompanies", "notify"
 *
 *   Whole market (scheduler only; one run at a time via a database lease):
 *   {"mode": "auto"}       latest filings → re-parse old rows → 90-day backfill → market caps
 *   {"mode": "latest"}     the EDGAR latest-filings feed ("maxPages", default 4)
 *   {"mode": "backfill"}   EDGAR daily indexes ("days", default 90, or one "day": "2026-09-15")
 *   {"mode": "reparse"}    rows written by an older parser version
 *
 * Authorisation (the function is deployed with verify_jwt = false):
 *   * scheduler / admin: `x-ingest-secret: $INGEST_SECRET`, or the service role /
 *     secret API key as `Authorization: Bearer …` or `apikey: …`
 *   * signed-in app users: their Supabase access token (max 3 tickers, no alerts)
 *
 * Environment:
 *   SEC_USER_AGENT             required, e.g. "InsiderPulse Senior Design you@example.com"
 *   SUPABASE_URL               injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY  service role key (falls back to the injected SUPABASE_SECRET_KEYS)
 *   INGEST_SECRET              optional shared secret for pg_cron
 *   FINNHUB_API_KEY            optional, refreshes market caps (WISI denominator)
 *   EXPO_ACCESS_TOKEN          optional, Expo push security token
 *   WHALE_ALERT_MIN_USD        optional, default 1000000
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EdgarClient } from "../_shared/edgar.ts";
import { corsHeaders, HttpError, json, timingSafeEqual } from "../_shared/http.ts";
import { type IngestTarget, runIngestion, type WhaleTrade } from "../_shared/ingest.ts";
import { type MarketStep, runMarketIngestion } from "../_shared/market.ts";
import { sendExpoPushNotifications } from "../_shared/push.ts";
import { SupabaseIngestRepository } from "../_shared/repository.ts";
import { type CallerRole, isMarketMode, type MarketMode, parseIngestRequest } from "./request.ts";

interface Config {
  supabaseUrl: string;
  serviceRoleKey: string;
  serviceKeys: string[];
  secUserAgent: string;
  ingestSecret?: string;
  finnhubApiKey?: string;
  expoAccessToken?: string;
  whaleMinValueUsd: number;
}

const SERVICE_TIME_BUDGET_MS = 100_000; // stay well inside the 150 s Edge Function limit
const USER_TIME_BUDGET_MS = 25_000;
const MARKET_CAP_RESERVE_MS = 8_000;
const MAX_WHALE_ALERTS_PER_RUN = 5;

const MARKET_STEPS: Record<MarketMode, MarketStep[]> = {
  auto: ["latest", "reparse", "backfill", "marketcaps"],
  latest: ["latest"],
  backfill: ["backfill"],
  reparse: ["reparse"],
};

const env = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
};

/**
 * New-style secret keys: hosted functions receive SUPABASE_SECRET_KEYS as JSON
 * ({"default":"sb_secret_…"}); local/self-hosted setups may set SUPABASE_SECRET_KEY.
 */
function secretKeysFromEnv(): string[] {
  const keys: string[] = [];
  const raw = env("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const ordered = [parsed.default, ...Object.values(parsed)];
      keys.push(...ordered.filter((v): v is string => typeof v === "string" && v.length > 0));
    } catch {
      console.warn("[fetch-sec-filings] SUPABASE_SECRET_KEYS is not valid JSON; ignoring it");
    }
  }
  const single = env("SUPABASE_SECRET_KEY");
  if (single) keys.push(single);
  return [...new Set(keys)];
}

function loadConfig(): Config {
  const secretKeys = secretKeysFromEnv();
  const legacyServiceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const serviceRoleKey = legacyServiceKey ?? secretKeys[0];
  const supabaseUrl = env("SUPABASE_URL");
  const secUserAgent = env("SEC_USER_AGENT");

  const missing = [
    !supabaseUrl && "SUPABASE_URL",
    !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    !secUserAgent && "SEC_USER_AGENT",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new HttpError(500, `Missing required environment variable(s): ${missing.join(", ")}`);
  }

  const whaleMin = Number(env("WHALE_ALERT_MIN_USD") ?? 1_000_000);
  return {
    supabaseUrl: supabaseUrl!,
    serviceRoleKey: serviceRoleKey!,
    serviceKeys: [legacyServiceKey, ...secretKeys].filter((k): k is string => !!k),
    secUserAgent: secUserAgent!,
    ingestSecret: env("INGEST_SECRET"),
    finnhubApiKey: env("FINNHUB_API_KEY"),
    expoAccessToken: env("EXPO_ACCESS_TOKEN"),
    whaleMinValueUsd: Number.isFinite(whaleMin) && whaleMin > 0 ? whaleMin : 1_000_000,
  };
}

async function authorize(
  req: Request,
  config: Config,
  admin: SupabaseClient,
): Promise<{ role: CallerRole; userId?: string } | null> {
  const ingestSecret = req.headers.get("x-ingest-secret");
  if (config.ingestSecret && ingestSecret && timingSafeEqual(ingestSecret, config.ingestSecret)) {
    return { role: "service" };
  }

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const apiKey = req.headers.get("apikey")?.trim();
  for (const candidate of [bearer, apiKey]) {
    if (candidate && config.serviceKeys.some((key) => timingSafeEqual(candidate, key))) {
      return { role: "service" };
    }
  }

  // A signed-in user's access token (JWT). Verified against Supabase Auth.
  if (bearer && bearer.split(".").length === 3) {
    const { data, error } = await admin.auth.getUser(bearer);
    if (!error && data.user) return { role: "user", userId: data.user.id };
  }
  return null;
}

function formatUsdShort(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

async function sendWhaleAlerts(whales: WhaleTrade[], repo: SupabaseIngestRepository, config: Config) {
  const trades = [...whales].sort((a, b) => b.totalValue - a.totalValue).slice(0, MAX_WHALE_ALERTS_PER_RUN);
  const recipients = await repo.whaleAlertRecipients();
  if (trades.length === 0 || recipients.length === 0) {
    return { trades: trades.length, recipients: recipients.length, sent: 0, failed: 0, invalidTokensRemoved: 0 };
  }

  const messages = trades.flatMap((w) =>
    recipients.map((r) => ({
      to: r.token,
      title: `🐋 Insider buy: ${w.ticker} ${formatUsdShort(w.totalValue)}`,
      body: `${w.ownerName}${w.ownerTitle ? ` (${w.ownerTitle})` : ""} bought ${
        Math.round(w.shares).toLocaleString("en-US")
      } shares of ${w.companyName} at $${w.pricePerShare.toFixed(2)}.`,
      data: { type: "whale_trade", companyId: w.companyId, ticker: w.ticker, accessionNumber: w.accessionNumber },
      sound: "default" as const,
      priority: "high" as const,
      channelId: "whale-alerts",
    }))
  );

  const result = await sendExpoPushNotifications(messages, { accessToken: config.expoAccessToken });
  if (result.invalidTokens.length > 0) await repo.clearPushTokens(result.invalidTokens);
  return {
    trades: trades.length,
    recipients: recipients.length,
    sent: result.sent,
    failed: result.failed,
    invalidTokensRemoved: result.invalidTokens.length,
  };
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed; use POST" }, 405);

  try {
    const config = loadConfig();
    const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const caller = await authorize(req, config, admin);
    if (!caller) return json({ success: false, error: "Unauthorized" }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Request body must be valid JSON");
    }
    const request = parseIngestRequest(body, caller.role);

    const repo = new SupabaseIngestRepository(admin);
    const edgar = new EdgarClient({ userAgent: config.secUserAgent });

    if (isMarketMode(request.mode) && request.market) {
      const holder = crypto.randomUUID();
      const leaseSeconds = Math.ceil(SERVICE_TIME_BUDGET_MS / 1000) + 30;
      if (!(await repo.claimLease(holder, leaseSeconds))) {
        return json({ success: true, mode: request.mode, skipped: "Another ingestion run is in progress" });
      }
      try {
        const report = await runMarketIngestion({ edgar, repo }, {
          steps: MARKET_STEPS[request.mode],
          deadline: startedAt + SERVICE_TIME_BUDGET_MS - MARKET_CAP_RESERVE_MS,
          hardDeadline: startedAt + SERVICE_TIME_BUDGET_MS,
          latestMaxPages: request.market.maxPages,
          backfillDays: request.market.days,
          backfillDay: request.market.day ?? undefined,
          finnhubApiKey: config.finnhubApiKey,
          whaleMinValueUsd: config.whaleMinValueUsd,
        });
        const notifications = request.notify && report.whales.length > 0
          ? await sendWhaleAlerts(report.whales, repo, config)
          : null;
        const durationMs = Date.now() - startedAt;
        console.log(
          `[fetch-sec-filings] mode=${request.mode} latest=${report.latest.processed}/${report.latest.pending} ` +
            `reparse=${report.reparse.processed} backfillDays=${report.backfill.days.length} ` +
            `stored=${report.outcomes.stored} upserted=${report.transactionsUpserted} failed=${report.outcomes.failed} ` +
            `secRequests=${report.secRequests} whales=${report.whales.length} durationMs=${durationMs}` +
            (report.error ? ` error=${report.error}` : ""),
        );
        return json({
          success: !report.error,
          mode: request.mode,
          caller: caller.role,
          durationMs,
          ...report,
          whales: undefined,
          whaleTrades: report.whales,
          notifications,
        }, report.error ? 502 : 200);
      } finally {
        await repo.releaseLease(holder).catch((err) =>
          console.error(`[fetch-sec-filings] releasing the lease failed: ${(err as Error).message}`)
        );
      }
    }

    const targets: IngestTarget[] = request.mode === "tracked"
      ? (await repo.listCompaniesForSync(request.maxCompanies)).map((company) => ({ kind: "company", company }))
      : [
        ...request.tickers.map((ticker) => ({ kind: "ticker" as const, ticker })),
        ...request.ciks.map((cik) => ({ kind: "cik" as const, cik })),
      ];

    const budget = caller.role === "service" ? SERVICE_TIME_BUDGET_MS : USER_TIME_BUDGET_MS;
    const report = await runIngestion(targets, { edgar, repo }, {
      maxFilingsPerCompany: request.limit,
      lookbackDays: request.lookbackDays,
      deadline: startedAt + budget,
      finnhubApiKey: config.finnhubApiKey,
      whaleMinValueUsd: config.whaleMinValueUsd,
    });

    const notifications = request.notify && report.whales.length > 0
      ? await sendWhaleAlerts(report.whales, repo, config)
      : null;

    const allFailed = report.totals.companies > 0 && report.totals.failed === report.totals.companies;
    const durationMs = Date.now() - startedAt;
    console.log(
      `[fetch-sec-filings] mode=${request.mode} caller=${caller.role} companies=${report.totals.companies} ` +
        `fetched=${report.totals.filingsFetched} upserted=${report.totals.transactionsUpserted} ` +
        `secRequests=${report.secRequests} whales=${report.whales.length} durationMs=${durationMs}`,
    );

    return json({
      success: !allFailed,
      mode: request.mode,
      caller: caller.role,
      durationMs,
      secRequests: report.secRequests,
      deadlineReached: report.deadlineReached,
      totals: report.totals,
      companies: report.companies,
      whaleTrades: report.whales,
      notifications,
      ...(allFailed ? { error: "No company could be ingested; see companies[].error" } : {}),
    }, allFailed ? 502 : 200);
  } catch (err) {
    if (err instanceof HttpError) return json({ success: false, error: err.message }, err.status);
    console.error("[fetch-sec-filings] unexpected error", err);
    return json({ success: false, error: "Internal error", detail: (err as Error)?.message ?? String(err) }, 500);
  }
});
