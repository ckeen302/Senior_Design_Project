# InsiderPulse

**Real-time SEC Form 4 insider-trading tracker for iOS, Android and web.**
InsiderPulse reads every insider filing on SEC EDGAR — the whole US market, not a
hand-picked list — and separates the trades that mean something (an executive buying
their own stock on the open market) from the noise (pre-planned 10b5-1 sales, tax sales,
option cash-outs, stock awards). It shows them as a plain-English live feed, scores every
stock with an **Insider Signal** that explains itself, charts buying vs. selling, streams
live prices and pushes an alert when a CEO or CFO buys $1M+ of their own stock.

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
 pg_cron (every 2 min) ──POST {"mode":"auto"}──▶ Edge Function: fetch-sec-filings (Deno)
                                                  │ one run at a time (database lease), ~100 s budget
                                                  │ 1. latest   EDGAR latest-filings feed (new Form 4s)
                                                  │ 2. reparse  rows written by an older parser
                                                  │ 3. backfill EDGAR daily indexes, 90 days, newest first
                                                  │ 4. marketcaps Finnhub, companies with recent signal trades
                                                  │ each filing = 1 SEC request (full submission: header + XML),
                                                  │ 150 ms apart; issuers are created on the fly
                                                  ▼
 PostgreSQL ── trigger on_insider_transaction_change ──▶ recalculate_wisi_score()
      │                                                    ├─ Insider Signal (company_signal)
      │                                                    └─ spec WISI            ──▶ sentiment_scores
      └─ Supabase Realtime (insider_transactions, sentiment_scores)
                     │
                     ▼
 Expo app ── Feed (key trades, biggest buys) · Signals (buying / selling leaderboards)
             Company detail (signal gauge, "Why this score", buy/sell chart, live price) · Watchlist · Settings
```

### What counts as a signal

Every Form 4 is stored (one row per filing), but only **discretionary open-market trades**
move the score. The parser classifies each filing from its transaction codes, the Rule 10b5-1
checkbox and the footnotes:

| Trade | Example card | Counts? |
| --- | --- | --- |
| Open-market purchase (`P`) | *Bought $2.1M · +35% stake* | **Yes (buy)** |
| Open-market sale (`S`) the insider chose to make | *Sold $450K · Sold 12% of stake* | **Yes (sell)** |
| Sale under a pre-scheduled Rule 10b5-1 plan | *Sold $3.7M · 10b5-1 plan · routine* | No |
| Sale to cover taxes on vesting ("sell to cover") | *Sold $938K to cover taxes* | No |
| Options exercised and sold in the same filing | *Exercised options, sold $32.2M* | No |
| Awards, exercises, tax withholding, gifts (`A`, `M`, `F`, `G`, …) | *Received 12,000 shares* | No |
| A price that can't be right (see below) | *Bought 40,000,000 shares · Price looks wrong in filing* | No |

Group members (a fund, its general partner, a director who controls it) often each file a
Form 4 for the same trade; identical trades (same company, date, shares and price) count once
and are folded into one feed card.

**Price sanity checks.** Some filers type the total dollar amount into the price field
(40,000,000 shares "at $40,000,000" = $1.6 quadrillion). An open-market trade is flagged
(`price_suspect`) and never counts when it is worth more than $20B, more than half the
company's market cap (more than $500M while the market cap is unknown), or its price is 20×
off the company's other trades within 45 days. Flags are re-evaluated whenever the company is
re-scored (new filing, new market cap, nightly job); dates after the filing date are treated as
typos and replaced by the filing date.

### The Insider Signal (0–100)

Only discretionary open-market trades of **$10K+** in the **last 90 days** count. Every stock
starts at 50:

```
points(insider) = base × role × size × conviction
  base        +6 for buying, −3 for selling (insiders sell for many reasons, they buy for one)
  role        CEO / CFO 1.5 · director 1.0 · other officer / 10% owner 0.7 · other 0.5
  size        log10(recency-weighted $ / 10,000) + 0.5, clamped 0–4   ($100K → 1.5, $1M → 2.5, $10M → 3.5)
  recency     trades 0–30 days old ×1.0 · 31–60 days ×0.7 · 61–90 days ×0.4
  conviction  buys opening a position or growing it ≥50% ×1.4, ≥10% ×1.2 ·
              sales of ≥50% of it ×1.4, ≥20% ×1.2, <5% ×0.7
cluster       +4 per additional buyer (max +12) · −2 per additional seller (max −6)
score         clamp(50 + Σ points + cluster, 0, 100)
label         ≥75 Strong buying · ≥58 Buying · ≤25 Strong selling · ≤42 Selling · else Neutral
              · "No signal" when nothing qualifies
```

Example: Intel's CEO bought $10.0M on Aug 11 (50 days ago → counts 70%, $7.0M → size 3.35):
6 × 1.5 × 3.35 = **+30.2**, so INTC scores **80 — Strong buying**. The company screen shows
exactly this breakdown ("Why this score"), computed by the `company_signal_breakdown` RPC — the
same function the stored score is built from, so the rows always add up.

### The spec WISI (kept for comparison)

```
WISI_i = Σ_j ( V_j · W_role,j / MarketCap_i ) · δ_j        V_j = shares_j × price_j
```

* **Role weight** `W_role`: CEO / CFO **1.5** · Director / board **1.0** · 10% owner / officer **0.7** · other **0.5**
* **Direction** `δ`: `P` **+1** · `S` **−1** (planned or not) · everything else **0**; 90-day window.
* **Gauge**: `index = 50 + 50·tanh(500·WISI)` → ≥ 60 Bullish, ≤ 40 Bearish.

Dividing by market cap flattens almost every large company to "Neutral", and counting
10b5-1 / tax sales makes routine selling look bearish — which is why the app leads with the
Insider Signal and shows the WISI as a secondary "Classic WISI" stat.

Both scores live in PostgreSQL: every insert/update/delete on `insider_transactions` (and every
market-cap change) re-scores the company, and a daily cron job rolls the 90-day window forward.

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
  migrations/                         Phase 1 schema/RLS · Phase 2 ingestion · Phase 3 WISI · Phase 5 realtime/charts ·
                                      Phase 6 profiles · seed · cron · v2 market-wide + Insider Signal · v2.1 option sales
  functions/fetch-sec-filings/        Edge Function entry point + request validation
  functions/_shared/                  EDGAR client, Form 4 parser, market-wide + per-ticker pipelines, push, Finnhub
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

Enable the schedule by storing the two values the cron job reads (SQL Editor):

```sql
select vault.create_secret('https://pnxzcywtjucanmwmmvsr.supabase.co', 'insiderpulse_project_url');
select vault.create_secret('<same value as INGEST_SECRET>',            'insiderpulse_ingest_secret');
```

From then on pg_cron calls the function every 2 minutes in `auto` mode: new filings first,
then the 90-day backfill (≈ 350 filings per run; the full backfill of ~30,000 filings takes
2–3 hours and resumes where it left off). Once caught up, a run costs one SEC request and
about a second. Two daily jobs re-score every company (05:17 UTC, rolls the 90-day window)
and trim pg_cron's run history to a week (04:41 UTC). To run the ingestion by hand:

```bash
curl -X POST https://pnxzcywtjucanmwmmvsr.supabase.co/functions/v1/fetch-sec-filings \
  -H "x-ingest-secret: $INGEST_SECRET" -H "Content-Type: application/json" -d '{"mode":"auto"}'
```

| Payload | What it does |
| --- | --- |
| `{"mode":"auto"}` | latest filings → re-parse old rows → backfill → market caps (scheduler) |
| `{"mode":"latest","maxPages":4}` | only the EDGAR latest-filings feed |
| `{"mode":"backfill","days":90}` or `{"mode":"backfill","day":"2026-09-15"}` | EDGAR daily indexes |
| `{"mode":"reparse"}` | upgrade rows written by an older parser version |
| `{"tickers":["AAPL"]}`, `{"ciks":["320193"]}`, `{"symbols":["NVDA",1045810]}` | one company's last year (also used by the app's "Track" button, max 3 per call for users) |

Market-wide modes hold a database lease, so overlapping runs never double the SEC load;
a second caller gets `{"skipped": "Another ingestion run is in progress"}`.

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
npm run verify           # TypeScript + Jest (105 tests) + client secret scan
npm run test:functions   # Deno tests for the Edge Function (61 tests, real SEC fixtures)
npm run test:db          # migrations + WISI / Insider Signal / price checks / trigger / RLS on a local PostgreSQL
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
  lines are condensed (like OpenInsider): discretionary open-market `P`/`S` lines win over routine
  ones (10b5-1 plan, sell-to-cover), which win over awards/exercises; shares are summed, the price
  is share-weighted, the date is the latest trade date. Derivative-only filings (RSU/option grants)
  fall back to the derivative table.
* **Market-wide ingestion.** Each filing costs one SEC request: the full submission text holds the
  SEC header (form type, acceptance time in Eastern time, converted to UTC) and the Form 4 XML. The
  issuer comes from the XML and is created on the fly (ticker from the SEC ticker list, else the
  filing's trading symbol). Filings are recorded in `processed_filings` so nothing is downloaded
  twice; `edgar_days` tracks the backfill (days whose index is not published yet are retried every
  30 minutes, not every run). The latest-filings feed is requested with `owner=only` (otherwise its
  `type=4` prefix filter also returns 424B2 / 497K prospectuses) and paging stops at the first page
  with nothing new; amendments (4/A) are skipped.
* **Market caps** (spec WISI denominator and a price check) come from Finnhub, 20 companies per run,
  largest trades first; companies Finnhub doesn't know are retried weekly.
* **Scoring locks.** Re-scoring takes a row lock on the company (not an advisory lock). The nightly
  job commits after every company (a top-level `DO` block run by pg_cron) and ingestion writes rows in
  company order, so no writer holds many locks for long and two writers can't deadlock. The scoring
  trigger fires only when a column that feeds the scores changes.
* **Push tokens.** A device's token belongs to the account that signed in on it last (a trigger
  takes it off any other profile; a token is unique across profiles), signing out clears it only if
  it is still this device's, and alerts are sent once per device.
* **Parser versions.** Rows carry `parser_version`. When classification improves, the `reparse`
  step re-downloads only rows the new parser could classify differently (v3: discretionary sales,
  to detect option exercise-and-sell).
* **Security.** RLS on every table: market data is public read-only; watchlists and profiles are
  owner-only; bookkeeping tables and the SECURITY DEFINER / ingestion functions are not callable
  from the API (`anon`/`authenticated`). Sessions are stored in the iOS Keychain / Android Keystore
  (chunked `expo-secure-store` adapter).
* **Function auth.** `fetch-sec-filings` runs with `verify_jwt = false` and authenticates itself:
  `x-ingest-secret`, the secret/service key, or a signed-in user's token (users may import at most
  3 new tickers per call and never trigger alerts). This works with the new `sb_…` API keys.
* **Navigation.** The spec's "App Stack (Bottom Tab Navigator)" is a native stack wrapping the
  tabs so Company Detail (which needs a ticker) can be pushed from any tab. React Navigation 7 is
  used (the current release; same API as v6).
* **Visual design.** True black with one accent, in the style of Robinhood: mint `#21CE99` for
  buying and actions, orange-red `#F45531` for selling (Robinhood's original pair, which stays
  distinguishable for red–green colour-blind readers). Direction is never shown by colour alone —
  values carry a sign and rows say "Bought" / "Sold". Inter throughout, with tabular figures for numbers.
* **Offline & resilience.** Queries run `offlineFirst`, retry network/408/429/5xx errors with
  exponential backoff, pause while offline and refetch on reconnect. Finnhub rate limits or missing
  quotes show a status instead of failing; the price socket reconnects with backoff. Realtime rows
  older than 3 days (backfill) are not pushed to the top of the feed.

## Known limitations

* 10b5-1 and sell-to-cover detection reads the checkbox and footnote wording; unusual phrasing can
  slip through (the card and "Why this score" always show what was counted).
* Exercise-and-sell is detected within one filing (sale ≤ 110% of the exercised shares).
* Group filings are matched on identical date, shares and price.
* Price checks are heuristics: a real trade can be held back (e.g. a huge block at a company whose
  market cap Finnhub doesn't know) and a mistyped one at a company with no other trades can slip through.
  Trades over 400 days old only get the absolute checks (> $20B, > half the company).
* Form 4/A amendments are not applied; history starts 90 days back (plus a year for tickers
  imported with "Track").
* The Finnhub key ships inside the app because the WebSocket requires it in the URL (as in the
  spec). Keep it on the free tier; rotate it if abused.
* Whale alerts go to every user with alerts enabled; per-watchlist alerts are a natural next step.
