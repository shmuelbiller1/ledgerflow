#!/usr/bin/env bash
# Observe the current response codes in the existing S-39 synthetic fixture. Not a desired-regression test.
set -euo pipefail
: "${LF_TEST_DATABASE_URL:?Set LF_TEST_DATABASE_URL to the disposable local lf_parity database}"
node -e 'const u = new URL(process.env.LF_TEST_DATABASE_URL); if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.pathname !== "/lf_parity") throw Error("This probe requires the disposable local lf_parity database")'
tmp=$(mktemp src/tests/api-parity-bank-lock-XXXXXX.test.ts)
trap 'rm -f "$tmp"' EXIT
cp src/tests/security-s8-s38-s39-isolation.test.ts "$tmp"
python3 - "$tmp" <<'PY'
import sys
p=sys.argv[1]
s=open(p).read()
for name in ('closedBankPay','closedBankSplit'):
    old=f'assert.ok({name}.status >= 400, `Closed-month bankline {"pay" if name == "closedBankPay" else "split"} must be refused, got ${{{name}.status}}`);'
    new=f'console.log("PROBE {name}", {name}.status, {name}.text); assert.equal({name}.status, 500);'
    if s.count(old) != 1:
        raise SystemExit('Fixture changed; inspect before running probe')
    s=s.replace(old,new)
open(p,'w').write(s)
PY
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit --test-name-pattern='S-39: bank lines, reconciliation' "$tmp"
