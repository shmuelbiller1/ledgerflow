# Reproducing this in-progress audit

Revision: `9b815a58ebbe1d0f99c44f908ee77b7faa73705`. These are diagnostic counterexamples, not fixes or a complete certification. Diagnostic tests intentionally assert the **current defective behavior**; once a defect is patched, invert or replace each assertion with positive acceptance assertions. Every test creates synthetic records only and deletes its own workspace-scoped rows.

## Dependencies and safety

- Project requires Node 24 (`>=24 <25`). This environment used `npx -y node@24` (Node `24.22.3`) and `npm ci --ignore-scripts --no-audit --no-fund`. No production configuration or credentials are used.
- DB diagnostics refuse to run unless `LF_TEST_DATABASE_URL` points to host `127.0.0.1`, port `55439`, database `lf_test`. **Never point tests at customer, production, hosted Supabase, or non-disposable databases.**
- Provision a fresh disposable local PostgreSQL 18.7 database `lf_test` on `127.0.0.1:55439` and apply the repository's local test stub + migrations once:

```sh
export LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test
npx -y node@24 --import tsx scripts/db-test.ts setup
npx -y node@24 --import tsx scripts/db-test.ts rls
```

`scripts/db-test.ts rls` reported `ALL RLS TESTS PASSED` on isolated PostgreSQL 18.7; plain-Postgres stub auth does not replace hosted Supabase policy/auth verification.

## Running all 35 custom audit diagnostic files (41 tests)

```sh
export LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test
export NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic
npx -y node@24 --import tsx --test --test-force-exit --test-concurrency=1 \
  audit/accounting-review-2026-11-22/*.test.ts \
  audit/accounting-review-2026-11-22/*.test.tsx
```

Standalone pure-function probes: `probe.ts`, `core-fx-probe.ts`, `reporting-probe.ts`, and `payroll-and-ca-probe.ts`.

## Completed test suite logs in `audit/accounting-review-2026-11-22/`

- **`diagnostic-final-suite.log`**: **41/41 passed (`EXIT=0`, `44.66 s`)** across all 35 custom diagnostic test files (`*.test.ts`, `*.test.tsx`), including `asset-cost-addition-database.test.ts`, `asset-from-bill-database.test.ts`, `camt053-minor-units.test.ts`, `spread-edit-database.test.ts`, `backup-restore-stock-database.test.ts`, `form856-void-and-exempt-database.test.ts`, `export-tax-and-eu-vat.test.ts`, and `delivery-location-balance-sheet-database.test.ts`. (Earlier subsets: `diagnostic-suite.log` 9/9, `diagnostic-all-suite.log` 13/13, `diagnostic-expanded-suite.log` 24/24.)
- **`full-database-suite.log`**: **7,329 tests / 1,193 suites — 7,326 passed, 1 failed, 1 skipped, 1 todo**.
  - Single failure: `src/tests/report-speed-12m.test.tsx:258` (`A-229` cold `tsx` 10-screen import `2,571.82 ms` vs `1,500 ms` budget).
  - Single `todo`: `src/tests/security-s5-idempotency-matrix.test.ts:267` (`S-5 #942`, documented as `ID-01`: headerless retries post twice on `/transactions`, `/payments`, and `/transactions/intercompany/post`).
- **`perf-isolated-suite.log`**: **4/5 passed** when run serially (`--test-concurrency=1`) without background contention; cleared 3 of the 4 timing failures seen in `full-suite.log`, leaving only `A-229` cold `tsx` module-import overhead (`3,269.99 ms` vs `1,500 ms`).
- **`full-suite.log`**: no-DB run — **6,366 tests: 6,351 passed, 4 timing failures under concurrent load, 11 skipped**.
- **Focused existing-test batches (all passed with 0 failures)**:
  - `database-suite.log` (`97/97`)
  - `focused-database-suite.log` (`36/36`)
  - `integration-database-suite.log` (`42/42`)
  - `reconciliation-suite.log` (`49/49`)
  - `tax-and-deferral-suite.log` (`61/61`)
  - `assets-fx-imports-suite.log` (`40/40`)

No tracked production files were modified (`git diff` is empty), and no public-release certification is implied.
