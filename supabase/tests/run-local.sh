#!/usr/bin/env bash
# Runs the schema and row-level security checks against a throwaway local PostgreSQL cluster.
#
#   bash supabase/tests/run-local.sh
#
# It creates a new cluster in a new temporary directory (mktemp), listens on 127.0.0.1 at a random free port, loads the
# Supabase shim, the migration and the checks, runs a parallel-insert concurrency check, prints the result and
# always stops and deletes the cluster. It never touches an existing data directory and never connects anywhere else.
#
# Environment (all optional):
#   PG_BIN_DIR   directory holding initdb, pg_ctl and psql (default: the newest /usr/lib/postgresql/N/bin)
#   TMPDIR       where the temporary directory is made (default: /tmp)
#   MIGRATION    migration file to test (default: supabase/migrations/0001_accounts_submissions.sql)
set -u -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${MIGRATION:-$HERE/../migrations/0001_accounts_submissions.sql}"

# PostgreSQL refuses to run as root. Re-run inside a user namespace that maps root to an unprivileged user, so no
# system user, package install or change outside the temporary directory is needed.
if [ "$(id -u)" = 0 ]; then
  if command -v unshare >/dev/null && [ -z "${RLS_CHECK_UNSHARED:-}" ]; then
    export RLS_CHECK_UNSHARED=1
    exec unshare --user --map-user=1000 --map-group=1000 bash "$0" "$@"
  fi
  echo "run-local.sh: PostgreSQL will not run as root and unshare is not available" >&2
  exit 2
fi

if [ -z "${PG_BIN_DIR:-}" ]; then
  PG_BIN_DIR="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)"
fi
if [ -z "$PG_BIN_DIR" ] || [ ! -x "$PG_BIN_DIR/initdb" ]; then
  echo "run-local.sh: no PostgreSQL binaries found; set PG_BIN_DIR" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/rls-check.XXXXXX")" || exit 2
case "$WORK" in */rls-check.*) ;; *) echo "run-local.sh: unexpected temporary directory $WORK" >&2; exit 2 ;; esac
STARTED=0

cleanup() {
  if [ "$STARTED" = 1 ]; then "$PG_BIN_DIR/pg_ctl" -D "$WORK/data" -m immediate -w stop >/dev/null 2>&1; fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

"$PG_BIN_DIR/initdb" -D "$WORK/data" -U postgres -A trust --no-sync -E UTF8 --locale=C >"$WORK/initdb.log" 2>&1 \
  || { cat "$WORK/initdb.log" >&2; echo "run-local.sh: initdb failed" >&2; exit 2; }

PORT=""
for attempt in 1 2 3 4 5 6 7 8; do
  CANDIDATE=$((20000 + RANDOM % 20000))
  if (exec 3<>"/dev/tcp/127.0.0.1/$CANDIDATE") 2>/dev/null; then continue; fi  # something already listens there
  if "$PG_BIN_DIR/pg_ctl" -D "$WORK/data" -l "$WORK/server.log" -w -t 60 \
      -o "-p $CANDIDATE -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off -c synchronous_commit=off -c max_connections=60" \
      start >"$WORK/start.log" 2>&1; then
    PORT="$CANDIDATE"; STARTED=1; break
  fi
done
if [ -z "$PORT" ]; then
  cat "$WORK/start.log" "$WORK/server.log" 2>/dev/null >&2
  echo "run-local.sh: could not start a local cluster" >&2
  exit 2
fi
echo "cluster: PostgreSQL $("$PG_BIN_DIR/postgres" --version | awk '{print $3}') on 127.0.0.1:$PORT in $WORK"

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=rlscheck PGCONNECT_TIMEOUT=10
PSQL="$PG_BIN_DIR/psql"
"$PG_BIN_DIR/createdb" rlscheck || exit 2

load() { "$PSQL" -X -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null || { echo "run-local.sh: failed loading $1" >&2; exit 1; }; }
load "$HERE/supabase-shim.sql"
load "$MIGRATION"
echo "migration applied: $(basename "$MIGRATION")"

# Row-level security and constraint checks. The last line of output must be "rls ok".
RESULT="$("$PSQL" -X -q -tA -v ON_ERROR_STOP=1 -f "$HERE/rls-check.sql" 2>&1)"
STATUS=$?
echo "$RESULT" | tail -n 5
if [ "$STATUS" != 0 ] || [ "$(echo "$RESULT" | tail -n 1)" != "rls ok" ]; then
  echo "run-local.sh: the checks FAILED" >&2
  exit 1
fi

# Concurrency. SESSIONS psql sessions run in parallel, wait for a shared start time, then each try ATTEMPTS inserts
# for the same owner as a signed-in user. The caps are triggers that take a per-owner advisory lock, so the totals must be exact.
SESSIONS=4
ATTEMPTS=5
ROUNDS=5
FAILED=0

new_owner() {  # $1 = uuid, $2 = handle
  "$PSQL" -X -q -v ON_ERROR_STOP=1 -c "insert into auth.users (id) values ('$1'); insert into profiles (id, handle) values ('$1', '$2');" >/dev/null
}

run_sessions() {  # $1 = owner uuid, $2 = status for the inserts, $3 = round label
  local start pids=() s i file
  start="$("$PSQL" -X -tA -c "select to_char(clock_timestamp() + interval '1500 ms', 'YYYY-MM-DD HH24:MI:SS.US')")"
  for ((s = 1; s <= SESSIONS; s++)); do
    file="$WORK/session-$3-$s.sql"
    {
      echo "set role authenticated;"
      echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\"}', false);"
      echo "select pg_sleep(greatest(0, extract(epoch from (timestamp '$start' - clock_timestamp()))));"
      for ((i = 1; i <= ATTEMPTS; i++)); do
        echo "insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, status) values ('$1', 'c-$3-$s-$i', 'n', 'd', 'h', 'https://x.com', 1, 2, '$2');"
      done
    } >"$file"
    "$PSQL" -X -q -f "$file" >/dev/null 2>"$WORK/session-$3-$s.err" &
    pids+=("$!")
  done
  wait "${pids[@]}"
}

check_count() {  # $1 = label, $2 = sql returning a number, $3 = expected
  local got
  got="$("$PSQL" -X -tA -v ON_ERROR_STOP=1 -c "$2")"
  if [ "$got" = "$3" ]; then echo "concurrency ok: $1 = $got"; else echo "concurrency FAIL: $1 = $got, expected $3" >&2; FAILED=1; fi
}

for ((round = 1; round <= ROUNDS; round++)); do
  # Pending cap: 3 old pending rows (aged past the daily window) leave room for exactly 2 more pending rows.
  owner="$(printf 'abcdef01-0000-0000-0000-%012d' "$round")"
  new_owner "$owner" "race-pending-$round"
  for ((i = 1; i <= 3; i++)); do
    "$PSQL" -X -q -v ON_ERROR_STOP=1 -c "insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, created_at) values ('$owner', 'old-$round-$i', 'n', 'd', 'h', 'https://x.com', 1, 2, now() - interval '3 days');" >/dev/null
  done
  run_sessions "$owner" pending "p$round"
  check_count "round $round pending rows ($((SESSIONS * ATTEMPTS)) parallel attempts, 3 already pending)" \
    "select count(*) from submissions where owner_id = '$owner' and status = 'pending'" 5

  # Daily cap: nothing else pending, 20 parallel attempts, exactly 3 may be created in the 24 hours.
  owner="$(printf 'abcdef02-0000-0000-0000-%012d' "$round")"
  new_owner "$owner" "race-daily-$round"
  run_sessions "$owner" pending "d$round"
  check_count "round $round rows created ($((SESSIONS * ATTEMPTS)) parallel attempts)" \
    "select count(*) from submissions where owner_id = '$owner'" 3
done

# The refusals must have been the cap errors and nothing else.
OTHER="$(cat "$WORK"/session-*.err | grep -i 'error' | grep -vc 'pending_limit\|daily_limit')"
if [ "$OTHER" != 0 ]; then echo "concurrency FAIL: $OTHER unexpected errors" >&2; cat "$WORK"/session-*.err | grep -i error | grep -v 'pending_limit\|daily_limit' | head >&2; FAILED=1; fi
echo "concurrency refusals: $(cat "$WORK"/session-*.err | grep -c 'pending_limit') pending_limit, $(cat "$WORK"/session-*.err | grep -c 'daily_limit') daily_limit"

if [ "$FAILED" != 0 ]; then echo "run-local.sh: the concurrency check FAILED" >&2; exit 1; fi
echo "concurrency ok"
echo "rls ok"
