# InsiderPulse — MVP Progress & Gap Analysis

A checklist comparing the InsiderPulse master specification and MVP outline
against what has actually shipped in this repo. Items are marked:

- `[x]` done and verified in code
- `[~]` partially done / shipped but differs from the MVP outline
- `[ ]` not yet started

Linked Jira tickets are tracked in the [KAN project board](https://shauryakumar1709.atlassian.net/jira/software/projects/KAN/boards/2).

---

## 1. Pre-development setup

- [x] Supabase project (`insider-pulse`) created and linked (`supabase link --project-ref pnxzcywtjucanmwmmvsr`)
- [x] Finnhub API key provisioned (free tier, 60 REST + 50 WebSocket)
- [x] SEC EDGAR `User-Agent` header defined and enforced in every request
- [x] Node.js 20+ / Expo CLI / Supabase CLI installed and documented in the README
- [x] Expo TypeScript project (`insider-pulse`) initialized
- [x] `.env.example` committed, `check:secrets` script keeps the `service_role` key out of the bundle

## 2. Phase 1 — Database schema, indexes, RLS

- [x] `pgcrypto` enabled; migrations under `supabase/migrations/`
- [x] `companies`, `insider_transactions`, `sentiment_scores`, `watchlists` tables with FKs, timestamps, generated `total_value`
- [x] `insider_transactions.accession_number` unique + composite index on `(company_id, filing_date DESC)`
- [x] RLS enabled on every table; public read for market data, owner-only for `watchlists` and `profiles`
- [x] Trigger audit script (`supabase/verification/01_wisi_trigger_audit.sql`) and automated SQL checks

## 3. Phase 2 — SEC EDGAR ingestion (Edge Function)

- [x] `fetch-sec-filings` Deno Edge Function with `SEC_USER_AGENT` + `INGEST_SECRET`
- [x] 10-digit CIK zero-padding, `User-Agent` on every request, 150 ms delay (well under 10 req/s)
- [x] Modes: `auto`, `latest`, `backfill`, `reparse`, plus one-off `tickers` / `ciks` / `symbols`
- [x] UPSERT on `accession_number`; issuer rows created on the fly from the SEC ticker list
- [x] `processed_filings` + `edgar_days` bookkeeping so nothing is re-downloaded
- [x] Database lease prevents overlapping cron runs; structured JSON errors with HTTP status
- [x] `parser_version` column + `reparse` mode so improvements can be back-applied

## 4. Phase 3 — WISI math engine + triggers

- [x] `recalculate_wisi_score(company_id)` PL/pgSQL function (90-day rolling window)
- [x] Role weights (CEO/CFO 1.5, Director 1.0, 10% / officer 0.7, other 0.5) and direction factors
- [x] `on_insider_transaction_change` trigger auto-recalculates on INSERT/UPDATE
- [x] **v2 Insider Signal** (`company_signal`): points-based 0–100 score with role × size × recency × conviction, cluster bonus, 90-day window — the primary consumer-facing score
- [x] `company_signal_breakdown` RPC powers the "Why this score" view on company detail

## 5. Phase 4 — App foundation, auth, navigation

- [x] `src/config/env.ts` loads `EXPO_PUBLIC_*`, refuses secret keys at startup
- [x] Supabase client singleton with chunked `expo-secure-store` adapter
- [x] Zustand `authStore` with persistent session restore on boot
- [x] React Navigation v7: `AuthStack` (Login + Register) and `AppStack` (bottom tabs + CompanyDetail)
- [x] Form validation on Login/Register; email + password only (as per MVP)

## 6. Phase 5 — Feed, charts, live prices

- [x] `FeedScreen` with infinite scroll, color-coded badges (buy / sell), owner title + total value
- [x] Supabase Realtime subscription prepends incoming trades live; status pill (Live / Connecting / Paused)
- [x] `CompanyDetailScreen` shows ticker, name, Insider Signal gauge, "Why this score", classic WISI
- [x] Interactive buy-vs-sell bar chart (Victory Native + Skia)
- [x] Live price via Finnhub WebSocket (`wss://ws.finnhub.io`); backgrounded socket pauses + reconnects
- [x] `WatchlistScreen` with swipe-to-delete, long-press confirm, ticker search modal
- [~] **Search is a modal from Watchlist, not a dedicated tab** — the MVP outline calls for a top-level `Search` tab → [tracked in Jira]

## 7. Phase 6 — Offline, push, hardening

- [x] TanStack Query persisted to AsyncStorage (serve-from-cache-first, offline retries, offline banner)
- [x] `expo-notifications` wired up; permission flow, token saved to profile, trigger-based de-dup
- [x] `expo-secure-store` chunked adapter for session tokens
- [x] `@react-native-community/netinfo` + non-intrusive offline banner
- [x] Legal disclaimer surfaced on Settings and (via `Disclaimer` component) stock detail
- [x] `check:secrets` script fails the build if a `service_role` / secret key leaks

## 8. Verification playbook

- [x] 1. Database trigger audit — `supabase/verification/01_wisi_trigger_audit.sql`
- [x] 2. SEC rate limit — logs show ≥150 ms between requests, no 403s
- [x] 3. WebSocket continuity — reconnect-with-backoff documented and tested
- [x] 4. Offline mode — airplane mode shows cached data + banner
- [x] CI (`.github/workflows/ci.yml`) runs TypeScript, 105 Jest tests, 61 Deno tests, DB migration + trigger tests, and the client-secret scan on every PR

---

## 9. MVP feature matrix (from the MVP outline)

| Feature | MVP target | Status |
| --- | --- | --- |
| Insider transaction feed | ✅ | **Done** — `FeedScreen` with 5 filters (Key / Buys / Sells / $1M+ / All) |
| Company detail page | ✅ | **Done** — gauge, breakdown, chart, live price |
| Basic WISI / Insider Signal | ✅ | **Done** — 0–100 Insider Signal + classic WISI as a secondary stat |
| Watchlist | ✅ | **Done** — add via search modal, swipe-to-delete |
| Push alerts for major purchases | ✅ | **Partial** — single "Whale alerts" switch; MVP outline wants 3 categorized toggles (watchlist / $1M+ / exec) |
| Live stock prices | Later | **Done early** — Finnhub WebSocket |
| Offline mode | Later | **Done early** — TanStack Query persistence |
| Advanced charts | Later | **Done early** — Victory Native + Skia |
| Hedge fund / 13F tracking | Later | Not started |
| Social / community feed | Later | Not started |
| AI summaries | Later | Not started |
| Gamification | Later | Not started |

## 10. Navigation vs. the MVP outline

The MVP outline proposes four tabs: **Feed · Search · Watchlist · Profile**.
The current app ships: **Feed · Signals · Watchlist · Settings** — Signals is an
extra leaderboard view and Search is only a modal inside Watchlist. Closing this
gap is tracked as a Jira ticket.

---

## 11. Sprint 1 — stand up the environment and get real SEC data flowing

The team's immediate goal is to install the APIs we depend on, deploy the backend
to our own Supabase project, and prove real Form 4 trades land in the app. Each
ticket below is designed to be finished in **under a day** and has step-by-step
instructions in Jira.

| Key | Priority | Summary | Est. time |
| --- | --- | --- | --- |
| [KAN-11](https://shauryakumar1709.atlassian.net/browse/KAN-11) | Highest | Create the team's Supabase project and share the API keys | 30 min |
| [KAN-12](https://shauryakumar1709.atlassian.net/browse/KAN-12) | Highest | Register for a Finnhub API key (free tier) for market data | 10 min |
| [KAN-13](https://shauryakumar1709.atlassian.net/browse/KAN-13) | High | Decide and document the team's SEC EDGAR User-Agent string | 5 min |
| [KAN-14](https://shauryakumar1709.atlassian.net/browse/KAN-14) | High | Install Node.js, Expo CLI, and Supabase CLI on every teammate's laptop | 30–60 min |
| [KAN-15](https://shauryakumar1709.atlassian.net/browse/KAN-15) | High | Run the InsiderPulse app locally and reach the Login screen | 30 min |
| [KAN-16](https://shauryakumar1709.atlassian.net/browse/KAN-16) | High | Push the database schema to Supabase (`supabase db push`) | 15 min |
| [KAN-17](https://shauryakumar1709.atlassian.net/browse/KAN-17) | Highest | Deploy the SEC Form 4 Edge Function and confirm the first trades load | 45 min |

**Suggested order:** KAN-11, KAN-12, KAN-13, and KAN-14 can start in parallel.
KAN-15 needs KAN-11, KAN-12, and KAN-14. KAN-16 needs KAN-11 and KAN-14. KAN-17
needs KAN-13, KAN-16, and the Finnhub key.

### Sprint 1 definition of done

- Every teammate has the app running on their own phone from a local build.
- Our own Supabase project holds the full database schema with RLS on.
- The `fetch-sec-filings` Edge Function is deployed to our Supabase project.
- At least 10 real Form 4 trades appear in `insider_transactions`, and those
  trades show up in the app's Feed.

### Future sprints (not yet ticketed)

Larger product work from the MVP outline — dedicated Search tab, categorized
alert toggles, guest browsing, executives-only filter, beta program, store
launch, and Form 4/A amendments — will be re-ticketed once Sprint 1 is green
and we know what to tackle next.

## 12. Known limitations (carried over from the README)

- 10b5-1 and sell-to-cover detection reads the checkbox and footnotes; unusual phrasing can slip through.
- Exercise-and-sell detection is confined to a single filing (sale ≤ 110 % of exercised shares).
- Group filings are matched on identical date / shares / price only.
- Price-sanity checks are heuristics; trades > 400 days old only get the absolute checks.
- History starts 90 days back (plus one year for tickers imported via the user "Track" button).
- The Finnhub key ships inside the app because the WebSocket requires it in the URL.
- Whale alerts go to every opted-in user — per-watchlist alerts are the first follow-up ticket.
