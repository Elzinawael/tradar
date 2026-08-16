#!/usr/bin/env bash
#
# TRADAR — database test runner.
#
# Applies the production migrations to a scratch PostgreSQL database and runs
# the smoke suite against them. This validates the schema, constraints,
# triggers and RLS policies WITHOUT needing a Supabase project: the local
# harness supplies the small part of Supabase's platform surface the
# migrations depend on (the auth schema, auth.uid(), and the anon /
# authenticated roles).
#
# Usage:
#   supabase/tests/run.sh                       # uses PGHOST/PGPORT/PGUSER
#   PGHOST=/tmp/pgrun PGPORT=5433 supabase/tests/run.sh
#
# Requires: a running PostgreSQL instance and psql on PATH.

set -euo pipefail

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
USER_NAME="${PGUSER:-postgres}"
DB="${TRADAR_TEST_DB:-tradar_test}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PSQL=(psql -h "$HOST" -p "$PORT" -U "$USER_NAME" -v ON_ERROR_STOP=1 -q)

echo "==> Recreating scratch database: $DB"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB;" >/dev/null
"${PSQL[@]}" -d postgres -c "create database $DB;" >/dev/null

apply() {
  echo "==> Applying $(basename "$1")"
  "${PSQL[@]}" -d "$DB" -f "$1" >/dev/null
}

apply "$ROOT/supabase/tests/00_local_harness.sql"
apply "$ROOT/supabase/migrations/0001_init.sql"
apply "$ROOT/supabase/migrations/0002_rls.sql"
apply "$ROOT/supabase/migrations/0003_relax_force_rls.sql"
apply "$ROOT/supabase/migrations/0004_backtest_trades.sql"

echo "==> Running smoke tests"
# Assertions raise on failure, so ON_ERROR_STOP turns any FAIL into exit 1.
psql -h "$HOST" -p "$PORT" -U "$USER_NAME" -d "$DB" -v ON_ERROR_STOP=1 \
  -f "$ROOT/supabase/tests/01_smoke.sql" 2>&1 |
  sed 's/^psql:.*NOTICE:  //' |
  grep -E 'PASS|FAIL|^---'

echo
echo "==> All database tests passed"
