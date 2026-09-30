#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Applies every Supabase migration to a fresh *local* PostgreSQL database and
# runs the automated verification checks (WISI math, trigger audit, chart RPC,
# RLS, constraints). Uses a small stub for Supabase-only objects (auth schema,
# API roles, realtime publication).
#
# Usage:  scripts/verify-db.sh            (uses the standard PG* env variables)
#         DB_NAME=mydb scripts/verify-db.sh
# -----------------------------------------------------------------------------
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
db="${DB_NAME:-insiderpulse_verify}"
psql_cmd=(psql -X -q -v ON_ERROR_STOP=1 -d "$db")

echo "Creating fresh database '$db'"
dropdb --if-exists "$db"
createdb "$db"

"${psql_cmd[@]}" -f "$root/supabase/verification/local_supabase_stub.sql"

for migration in "$root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  "${psql_cmd[@]}" -f "$migration"
done

echo "Running verification checks"
cd "$root/supabase/verification"
"${psql_cmd[@]}" -f 02_automated_checks.sql

# The nightly re-score commits after each company, which only works as a
# top-level DO block: run the exact block the cron job is scheduled with.
echo "Running the nightly re-score job"
nightly="$(sed -n '/^do \$rescore\$/,/^\$rescore\$;/p' "$root"/supabase/migrations/*_review_fixes.sql)"
if [ -z "$nightly" ]; then
  echo "Nightly re-score block not found in the migrations" >&2
  exit 1
fi
started="$("${psql_cmd[@]}" -At -c "select now()")"
printf '%s\n' "$nightly" | "${psql_cmd[@]}"
stale="$("${psql_cmd[@]}" -At -c "select count(*) from public.companies c left join public.sentiment_scores s on s.company_id = c.id where s.last_updated is null or s.last_updated < '$started'")"
if [ "$stale" != "0" ]; then
  echo "Nightly re-score skipped $stale companies" >&2
  exit 1
fi
echo "All database checks passed."
