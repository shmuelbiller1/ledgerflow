# Agent #7 (2026-11-16) — Verification Log

Every command below was run in this session on `arena/93656b5f-ledgerflow` at `3a4ad7d`, in this order.
A blank or "clean" result is the pass condition unless the table says otherwise.

## 1. Environment

| Step | Command | Result |
|---|---|---|
| Node | `node -v` (implicit) | v22.22.2 |
| Install | `npm ci --no-audit --no-fund` | 1,208 packages |
| PostgreSQL | `initdb -D /tmp/lfpg -U postgres --auth=trust`, `postgres -D /tmp/lfpg -k /tmp` | PostgreSQL 16.2 listening on 127.0.0.1:5432 |
| Test DB | `create database lf_test` | ok |
| Migrations | `LF_TEST_DATABASE_URL=… npm run db:test-setup` | every migration applied (base + `20261116000000` + proposed `20261116120000`) |
| Env for probes | `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lf_test` | required: the standalone probes call `poolConfigFromEnv()` |

## 2. Gates on the branch (all green)

| Gate | Result |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` | no errors (the default heap aborts on this repo) |
| `npx eslint --max-warnings 0` on the 9 edited files + the 2 new test files | 0 problems |
| `tsx --test --test-force-exit src/tests/agent7-2026-11-16-remediations.test.tsx src/tests/agent7-2026-11-16-vault-remediations.test.tsx` | **28 pass / 0 fail** |
| `tsx --test --test-force-exit` on `eu-e3-label-tree`, `eu-i3-free-invoice`, `auditor-hash-chain`, `reconciliation-screen`, `attachments-ui`, `invoice-modal`, `estimate-deposit-ui` | **55 pass / 0 fail** |
| `npm run check:layers` | pass (no layer violation reported) |
| `npm run lint:eslint` (whole repo, cap `--max-warnings 2`) | 0 errors, **2 warnings** — both pre-existing in `src/server/db/pg/values.ts` (reserved lane); at the cap, not over it |
| `npm run check:tax-tables` | 55 modules, 34 tables, 1,163 rows, 0 problems |
| `npm run lint:rule-packs` | 584 rules checked, 0 problems |
| `npm run check:perf-budgets` | budgets valid, 5 entries |
| `npm run test:security` | 4 pass, 0 fail, 1 skipped (the DB-backed rule run is skipped by the script unless the RLS database is set; it was run separately below) |
| `npm run db:test-setup && npm run test:rules` (with the proposed `20261116120000` migration present) | `ALL RLS TESTS PASSED` |
| Full suite `npm test` | see §5 |

## 3. Regression tests proven against the pre-fix code

Each behavioural test was re-run with the corresponding implementation reverted (`git checkout -- <file>`,
run, restore), so the test is known to fail where the defect exists:

| Reverted file | Test | Pre-fix result |
|---|---|---|
| `src/services/auditor.ts` | `A7C-03` | 2 of 5 fail (`intervening unlinked signed entry`, `self-link`) |
| `src/hooks/transactionActions/entryActions.ts` | `A7C-06` | 1 of 1 fails (`USD` posted instead of `ILS`) |
| `src/hooks/transactionActions/reconcileActions.ts` | `A7C-07` | 2 of 4 fail (JPY conversion, fee-netted cash) |
| `src/components/sales/Sales.tsx` | `A7C-02` draft hydration | 1 of 1 fails |
| `src/components/forensics/Vault.tsx` | `A7C-04`/`A7C-05` | 3 of 4 fail |
| (whole base) | `A7C-01`/`A7C-02` pure libraries | do not import: the exports they lock did not exist |

## 4. Reserved-lane evidence

| Probe | Command | Unpatched | Patched |
|---|---|---|---|
| `probe-08-translation-and-api-scope.ts` | `DATABASE_URL=… npx tsx audit/agent7-2026-11-16/probes/probe-08-translation-and-api-scope.ts` | `netIncome 6700` for ¥1,000,000 → assertion fails; four period commands reported `write:transactions` | `netIncome 670000` (JPY), `325000` (KWD), all eleven period commands `write:workspaces`; "all assertions held" |
| `probe-11-document-links-and-ticket-visibility.ts` | `DATABASE_URL=… npx tsx audit/agent7-2026-11-16/probes/probe-11-document-links-and-ticket-visibility.ts` | `A/B/C` OPEN (ticket read across members, viewer relink, client-written support badge) | `A/B/C` refused, uploader tags still writable, directory view readable without pay/bank |

`git apply --check` on `patches/08`, `09`, `10`, `11` against `3a4ad7d`: all clean.
`audit/agent7-2026-11-13/patches/06`: clean; `01`–`05`: conflict (see `03-RESERVED-LANE-FINDINGS.md` §carry-forward).

## 5. Full suite

`NODE_OPTIONS=--max-old-space-size=4096 npm test` (the four-glob run: `src/tests/*.test.ts`, `src/tests/*.test.tsx`,
`src/lib/*.test.ts`, `src/server/utils/*.test.ts`):

```
# tests 6229   # pass 6226   # fail 2   # skipped 1   # duration 1,384,416 ms (~23 min)
```

The two failures are **wall-clock performance budgets**, and both fail on the untouched base commit in this
sandbox as well:

| Test | Failure | Same on `3a4ad7d`? |
|---|---|---|
| `R-5: all 151 report views open under 1000 ms …` (`src/tests/r5-every-report-speed.test.tsx:91`) | `reporting/TopPartiesReportView.tsx 1249.76 ms` (budget 1000) | **yes** — `TopPartiesReportView.tsx 1164.5 ms` in a clean `git worktree` of `3a4ad7d` |
| `A-206: AI #3 heaviest reports load well under 1,000 ms on the 12-month fixture` (`src/tests/report-speed-12m.test.tsx:258`) | one subtest over its budget | **yes** — same file fails on `3a4ad7d` (`A-206` and `A-229`) |

Neither file touches anything this branch changed, and GitHub Actions on the same commit is green end to end
(see §7): all 4 unit shards, all 6 timezone shards, browser shards 1–5, Playwright smoke, lint/typecheck/DB
rules, build, SonarCloud and CodeQL. The conclusion recorded here is "this sandbox's CPU is slower than the
budget assumes", not "the branch regresses report rendering".

## 7. CI on the pull request

`CI` run [43984640500](https://github.com/shmuelbiller1/ledgerflow/actions/runs/43984640500) on
`arena/93656b5f-ledgerflow` (`724ffb2`-equivalent tree): **success** — Unit tests 1/4 … 4/4, Unit tests in
`America/Los_Angeles` 1–3/3, Unit tests in `Pacific/Auckland` 1–3/3, Browser shards 1–5/5, Playwright E2E
Smoke, Lint/Typecheck/Database rules, Production build, Accounting & Security Test Suites, SonarCloud, CodeQL,
CycloneDX SBOM.

## 6. Sandbox incidents worth recording

1. **Re-clone.** The sandbox was re-cloned onto a newer `main` mid-session; `9c859dd` no longer exists as an
   object. The tree was rebuilt by backing up the working tree (`/tmp/a7c-backup/worktree.tgz` +
   `mine-tracked.patch`), fast-forwarding to `3a4ad7d`, re-applying the seven fixes with `git apply -3`
   (one conflict in `Sales.tsx`, resolved to the branch version), and re-running every gate above.
2. **Heap.** `npm run lint:types` aborts (V8 OOM) at the default heap on this repository; use
   `NODE_OPTIONS=--max-old-space-size=4096`.
3. **Two screens in one test process.** Rendering both `Sales` and `Vault` in one `tsx --test` file exhausts
   the runner's heap (SIGKILL, no error). The Vault cases therefore live in their own file
   (`agent7-2026-11-16-vault-remediations.test.tsx`).
4. **Stub that resurrects rows.** A fetch stub that keeps serving a document after `DELETE` sends the screen
   into a refetch loop until the process is killed; the Vault test's stub is stateful and splices on delete.
5. **Probe savepoints.** A refused statement aborts its transaction, so every probe attempt runs inside its
   own savepoint; and `asUser()` must `reset role` *after* the rollback, never before.
6. **RLS recursion.** Referencing `public.documents` inside a policy *on* `public.documents` raises
   `42P17 infinite recursion`; the ledger-link guard is a trigger comparing old and new rows instead.
