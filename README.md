# InsiderPulse

**Real-time SEC Form 4 insider-trading tracker for iOS, Android and web.**
InsiderPulse turns dense SEC filings into a live "whale watching" feed, a 0–100 Weighted
Insider Sentiment Index (WISI) per stock, interactive buy-vs-sell charts, live prices and
push alerts when CEOs/CFOs buy millions of dollars of their own stock.

> Information provided is strictly for educational and analytical purposes and does not
> constitute investment advice.

| Layer | Technology |
| --- | --- |
| Mobile client | React Native (Expo SDK 57) + TypeScript, React Navigation 7, Zustand, TanStack Query |
| Charts | Victory Native (Skia) + a Skia sentiment gauge |
| Offline cache | TanStack Query persisted to AsyncStorage (serve-from-cache-first) |
| Backend | Supabase — PostgreSQL, Auth, Realtime, Row Level Security |
| Serverless | Supabase Edge Function `fetch-sec-filings` (Deno), scheduled with pg_cron |
| Data | SEC EDGAR (`data.sec.gov`, no key), Finnhub REST + WebSocket |

---

## Architecture

```
 pg_cron (every 15 min) ──POST {"mode":"tracked"}──▶ Edge Function: fetch-sec-filings (Deno)
                                                      │ 1. SEC submissions API (User-Agent, 150 ms spacing)
                                                      │ 2. Form 4 XML → one row per filing
                                                      │ 3. UPSERT insider_transactions (accession_number)
                                                      │ 4. Finnhub market cap, Expo "whale" push alerts
                                                      ▼
 PostgreSQL ── trigger on_insider_transaction_change ──▶ recalculate_wisi_score() ──▶ sentiment_scores
      │
      └─ Supabase Realtime (insider_transactions, sentiment_scores)
                     │
                     ▼
 Expo app ── Feed (infinite scroll + live inserts) · Signals (WISI leaderboard) · Watchlist
             Company detail (WISI gauge, buy/sell chart, Finnhub live price) · Settings
```

### The WISI model

```
WISI_i = Σ_j ( V_j · W_role,j / MarketCap_i ) · δ_j        V_j = shares_j × price_j
```

* **Role weight** `W_role`: CEO / CFO **1.5** · Director / board **1.0** · 10% owner / officer **0.7** · other **0.5**
* **Direction** `δ`: open-market purchase `P` **+1** · sale `S` **−1** · awards, exercises, gifts, tax (`A`, `M`, `G`, `F`, …) **0**
* **Window**: filings from the last 90 days; market cap defaults to $1B until Finnhub supplies it.
* **Gauge**: `index = 50 + 50·tanh(500·WISI)` → ≥ 60 **Bullish**, ≤ 40 **Bearish**, otherwise **Neutral**
  (≈ ±4 bps of market cap in net weighted insider flow crosses a threshold).

The score is maintained entirely in PostgreSQL: every insert/update/delete on
`insider_transactions` (and every market-cap change) re-scores the company, and a daily cron
job rolls the 90-day window forward.

---

## Repository layout

```
App.tsx, index.ts, app.config.ts      Expo entry points and app config
src/
  config/env.ts                       EXPO_PUBLIC_* config; refuses secret/service_role keys
  lib/                                supabase client, secure storage adapter, API, Finnhub, push, cache
  store/authStore.ts                  Zustand auth state (session restore on boot)
  navigation/                         AuthStack (Login, Register) / AppStack (tabs + CompanyDetail)
  screens/                            Feed, Signals, Watchlist, CompanyDetail, Settings, auth screens
  components/                         TradeCard, SentimentGauge, BuySellChart, TickerSearchModal, …
  __tests__/                          Jest unit + component tests
supabase/
  migrations/                         Phase 1 schema/RLS · Phase 2 ingestion · Phase 3 WISI · Phase 5 realtime/charts · Phase 6 profiles · seed · cron
  functions/fetch-sec-filings/        Edge Function entry point + request validation
  functions/_shared/                  EDGAR client, Form 4 parser, pipeline, push, Finnhub
  functions/tests/                    Deno tests with real Form 4 fixtures
  verification/                       Trigger audit (SQL Editor) + automated SQL checks
scripts/                              verify-db.sh, check-client-secrets.mjs
```

---

## 1. Backend setup (Supabase)

Prerequisites: Node.js 20+, the Supabase CLI (`npx supabase …` works without a global install).

```bash
npx supabase login
npx supabase link --project-ref pnxzcywtjucanmwmmvsr     # asks for the database password
npx supabase db push                                    # applies supabase/migrations/*
```

Function secrets (`SUPABASE_URL` and the Supabase API keys are injected automatically):

```bash
cp supabase/functions/.env.example supabase/functions/.env   # then edit it
#   SEC_USER_AGENT="InsiderPulse Senior Design Project you@example.com"   (required by the SEC)
#   INGEST_SECRET=<openssl rand -hex 32>                                   (used by pg_cron)
#   FINNHUB_API_KEY=<your key>                                            (market caps)
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy fetch-sec-filings
```

Enable the 15-minute schedule by storing the two values the cron job reads (SQL Editor):

```sql
select vault.create_secret('https://pnxzcywtjucanmwmmvsr.supabase.co', 'insiderpulse_project_url');
select vault.create_secret('<same value as INGEST_SECRET>',            'insiderpulse_ingest_secret');
```

Run the first ingestion immediately instead of waiting for the schedule:

```bash
curl -X POST https://pnxzcywtjucanmwmmvsr.supabase.co/functions/v1/fetch-sec-filings \
  -H "x-ingest-secret: $INGEST_SECRET" -H "Content-Type: application/json" \
  -d '{"mode":"tracked","limit":10}'
```

Each call processes companies least-recently-synced first within a ~100 s budget; repeat it (or let
cron run) to backfill a year of filings. Other payloads: `{"tickers":["AAPL","TSLA"]}`,
`{"ciks":["320193"]}`, `{"symbols":["NVDA",1045810]}`; options `limit`, `lookbackDays`,
`maxCompanies`, `notify`.

> **Auth tip:** hosted projects require email confirmation by default. For quick testing, turn it off
> under *Authentication → Sign In / Providers → Email*, or confirm via the emailed link.

## 2. Run the app

```bash
cp .env.example .env        # add EXPO_PUBLIC_SUPABASE_ANON_KEY (publishable key) + EXPO_PUBLIC_FINNHUB_API_KEY
npm install
npx expo start              # scan the QR code with Expo Go, or press i / a / w
```

* Only the **publishable (anon) key** goes in the app. The app refuses to start with a secret /
  `service_role` key, and `npm run check:secrets` fails the build if one appears in code, `.env`
  or an exported bundle.
* Push notifications need a physical device and an EAS project id (`npx eas init`, then set
  `EAS_PROJECT_ID`). Expo Go on Android can't receive remote pushes — use a development build
  (`npx expo run:android`).
* The web build (`npx expo start --web`) works too; `npm install` copies Skia's `canvaskit.wasm` to `public/`.

---

## Testing

```bash
npm run verify           # TypeScript + Jest (55 tests) + client secret scan
npm run test:functions   # Deno tests for the Edge Function (38 tests, real SEC fixtures)
npm run test:db          # migrations + WISI/trigger/RLS checks on a local PostgreSQL
```

CI (`.github/workflows/ci.yml`) runs all three on every pull request.

### Verification playbook

1. **Database trigger audit** — paste `supabase/verification/01_wisi_trigger_audit.sql` into the
   SQL Editor. It inserts, updates and deletes mock transactions for a throw-away company and shows
   `sentiment_scores` recalculating after each step (every row should read `passed = true`), then
   removes the mock data.
2. **SEC rate limit** — call the function for five tickers back-to-back and check the function logs:
   every request logs `[sec] GET …` with ≥ 150 ms between requests and no HTTP 403s.
   ```bash
   curl -X POST …/functions/v1/fetch-sec-filings -H "x-ingest-secret: $INGEST_SECRET" \
     -H "Content-Type: application/json" -d '{"tickers":["AAPL","NVDA","TSLA","LEN","PLTR"],"limit":10}'
   ```
3. **WebSocket continuity** — open a company in Expo Go during market hours; the price card shows
   **LIVE** and the Metro log prints `[finnhub] connected / subscribed / trade …`. Backgrounding the app
   pauses the socket; returning reconnects and re-subscribes.
4. **Offline mode** — load the feed, enable Airplane Mode and reopen the app: cached trades, scores
   and watchlist still render and an "Offline — showing saved data" banner appears.

---

## Design notes

* **One row per Form 4.** The schema keys `insider_transactions` on `accession_number`, so a filing's
  lines are condensed (like OpenInsider): open-market `P`/`S` lines win over awards/exercises,
  shares are summed, the price is share-weighted, the date is the latest trade date.
  Derivative-only filings (RSU/option grants) fall back to the derivative table.
* **Issuer check.** A company's EDGAR submissions also list Form 4s it filed as a *reporting owner*
  (e.g. Berkshire Hathaway buying Lennar). Those are skipped for that company and recorded in
  `ingestion_skipped_filings` so they are never re-downloaded.
* **Filing time** uses EDGAR's `acceptanceDateTime` (UTC) for accurate "filed 3h ago" labels.
* **Security.** RLS on every table: market data is public read-only; watchlists and profiles are
  owner-only; the SECURITY DEFINER scoring functions are not callable from the API. Sessions are
  stored in the iOS Keychain / Android Keystore (chunked `expo-secure-store` adapter).
* **Function auth.** `fetch-sec-filings` runs with `verify_jwt = false` and authenticates itself:
  `x-ingest-secret`, the secret/service key, or a signed-in user's token (users may import at most
  3 new tickers per call and never trigger alerts). This works with the new `sb_…` API keys.
* **Navigation.** The spec's "App Stack (Bottom Tab Navigator)" is a native stack wrapping the
  tabs so Company Detail (which needs a ticker) can be pushed from any tab. React Navigation 7 is
  used (the current release; same API as v6). A **Signals** tab ranks companies by WISI.
* **Offline & resilience.** Queries run `offlineFirst`, retry network/408/429/5xx errors with
  exponential backoff, pause while offline and refetch on reconnect. Finnhub rate limits or missing
  quotes show a status instead of failing; the price socket reconnects with backoff.

## Known limitations

* The Finnhub key ships inside the app because the WebSocket requires it in the URL (as in the
  spec). Keep it on the free tier; rotate it if abused.
* Form 4 `S` includes sell-to-cover tax sales, which the spec counts as sales.
* Whale alerts go to every user with alerts enabled; per-watchlist alerts are a natural next step.
