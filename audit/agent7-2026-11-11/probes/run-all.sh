#!/usr/bin/env bash
# Agent #7 (review-only): runs every probe of this folder and writes what each printed to ../evidence/.
# usage:  LF_TEST_DATABASE_URL=postgresql://…/lf_test  bash audit/agent7-2026-11-11/probes/run-all.sh [<upstream main SHA the tree is at>] [<output dir>]
# Needs Node 24 and a disposable local PostgreSQL 17 prepared with `npm run db:test-setup` (never a real database).
set -u
cd "$(dirname "$0")/../../.."
PIN="${1:-$(git merge-base HEAD upstream/main 2>/dev/null || git rev-parse HEAD)}"
# Never overwrite checked-in historical evidence when rerunning against another commit.
OUT="${2:-audit/agent7-2026-11-11/evidence/main-${PIN:0:8}}"
P=audit/agent7-2026-11-11/probes
mkdir -p "$OUT"
: "${LF_TEST_DATABASE_URL:?set LF_TEST_DATABASE_URL to a disposable local test database}"
export NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic
PG="$(node -e "const pg=require('pg');const c=new pg.Client({connectionString:process.env.LF_TEST_DATABASE_URL});c.connect().then(()=>c.query('show server_version')).then(r=>{console.log(r.rows[0].server_version);return c.end()}).catch(()=>console.log('unknown'))")"
head3() { printf '# pin: %s\n# command: %s\n# run: %s, Node %s, PostgreSQL %s (disposable local)\n' "$PIN" "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(node -v)" "$PG"; }
# what the app logs while refusing (stack traces, validator dumps) is noise here; the probe's own lines are kept
quiet() { grep -v -E '^$|^\s+at |^\s+[\]\}\{\[],?$|^\s+(code|path|message|expected|received|origin|values|keys|minimum|inclusive|input|format|pattern|note|unionErrors|errors|issues|name|cause|generatedMessage|actual|operator|diff|stack): |^\s+"|Period Locked|Error: Schema|^\[BULK|^\[API Error\]|^\[Reversal|^Error: |^ZodError'; }
status=0
run() { # name, command…
  local name="$1"; shift
  local rc=0
  # Preserve the real probe's exit code: quiet/grep can succeed after a crashed
  # probe or a timeout (124), and a missing test-summary line is not a pass.
  {
    head3 "$*"
    "$@" 2>&1 | quiet
    rc=${PIPESTATUS[0]}
    printf '# exit: %s\n' "$rc"
  } > "$OUT/$name.txt"
  if [ "$rc" -ne 0 ] || grep -q -E '^ℹ fail [1-9]|^SQL error|ERR_MODULE_NOT_FOUND' "$OUT/$name.txt"; then
    status=1
    echo "PROBE DID NOT COMPLETE AS WRITTEN: $name (exit $rc)"
  else
    echo "ok  $name"
  fi
}
run a7-01-ledger-door-dataflow      npx tsx $P/a7-01-ledger-door-dataflow.ts
run a7-02-fx-reversal-residue       npx tsx $P/a7-02-fx-reversal-residue.ts
run a7-05-browser-writes-ledger     node $P/run-sql.mjs $P/a7-05-browser-writes-ledger.sql
run a7-06-residual-browser-writes   node $P/run-sql.mjs $P/a7-06-residual-browser-writes.sql
for t in a7-02b-fx-reversal-route a7-02d-fx-journal-screen-shape a7-03-fx-installments a7-04-system-entries-editable a7-04e-rate-by-partial-update a7-04f-unpost-then-delete a7-04g-ledger-list-void-button a7-06-forged-credit a7-07-closed-period-sweep a7-08-recurring-entry a7-10-smoke; do
  run "$t" timeout 170 npx tsx --test --test-force-exit "$P/$t.test.ts"
done
exit $status
