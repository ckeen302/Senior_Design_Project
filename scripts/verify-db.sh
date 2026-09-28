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
echo "All database checks passed."
