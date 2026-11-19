# AI #10 re-verification probes — 2026-11-19

These probes re-run the Agent #10 findings of 2026-11-16 (`audit/agent10-2026-11-16/`) against the
current `main` (`5eacf71f` at the time of writing) and report, per finding, **LIVE** (the defect
still reproduces) or **FIXED** (the server / database now refuses it). They print a JSON report and
do not assert the vulnerable behaviour, so a fixed finding does not fail the run.

| Probe | Findings | Result at `5eacf71f` |
|---|---|---|
| `r1-documents-reverify.ts` | B1–B5 (forged settlement, voiding a paid invoice, credit reset, re-dating out of a closed period, deleting a spread document) | **B1–B5 FIXED** |
| `r2` (re-used `../agent10-2026-11-16/probes/probe-02-…ts`) | C1 (posted entry's rate/currency), F (report/brain 500s, cache), G (PDF preview copy mark) | **C1, G FIXED; F LIVE → issue #914** |
| `r3-rls-and-minor-units-reverify.ts` | A1–A4, A6 (RLS writes as a `viewer`), H1 (JPY/KWD minor units) | **A1, A3, A4, H1 FIXED; A2 → #915, A6 → #916** |

## Running them

A real Postgres is authoritative (CI runs one). This sandbox has no Postgres server and no apt, so
the probes were run against PGlite (WASM Postgres) exposed over the wire protocol:

```bash
npm install --no-save --no-package-lock @electric-sql/pglite @electric-sql/pglite-socket

# .arena/pglite-server.mjs (untracked): PGlite.create({dataDir}) + PGLiteSocketServer({db, port: 5433, host:'127.0.0.1'})
node .arena/pglite-server.mjs &

export LF_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
export DATABASE_URL=$LF_TEST_DATABASE_URL
export PG_POOL_MAX=1          # PGlite serves one session; the pg pool must not open a second
export NODE_ENV=test
export SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic

npx tsx scripts/db-test.ts setup      # stub + every migration
npx tsx scripts/db-test.ts rls        # ALL RLS TESTS PASSED

npx tsx audit/agent10-2026-11-19/probes/r1-documents-reverify.ts
npx tsx audit/agent10-2026-11-19/probes/r3-rls-and-minor-units-reverify.ts
npx tsx audit/agent10-2026-11-19/probes/r4-il-vat-foreign-currency.ts   # pure, no database
npx tsx audit/agent10-2026-11-16/probes/probe-02-tx-fx-partial-update-and-report-brain-500s.ts
```

`probe-03` of the 2026-11-16 set opens a second `pg.Pool` and therefore cannot run against PGlite
(one session); `r3` is its PGlite-safe replacement, and it also fixes two probe defects of its own:
it `COMMIT`s the RLS writes (a rolled-back write made every verdict vacuous) and it creates the
revenue account `creditnote.create` requires.

## Saved output

`r1-output.json` and `r3-output.json` are the results quoted in the audit report, re-run on 2026-11-19
against PGlite with every migration applied. Read the `verdict` field, not the prose:

- `FIXED` — the 2026-11-16 defect no longer reproduces.
- `LIVE` — it still does; A2 is issue #915 and A6 is issue #916.
- `INFO` — read-only figure, no pass/fail.
- `CHECK` — the figure matched neither the fixed nor the known-bug value and needs a human.

The r3 `H1-prepaid-line` verdict was inverted when it was first committed (it called 449 cents — the
old 100x undercount — `FIXED`, and the correct 44,890 `CHECK`); Gitar caught it on PR #919 and it is
fixed here, so the JSON now agrees with the report.

## r4 — the Israeli VAT return and foreign currency (issue #928)

`r4` is pure (no database): it runs the product's `israelVatReturn` over one standard-rated sale in
ILS books and compares the reported taxable sales with the correct home amount.

| Document | Correct (ILS agorot) | Reported | Verdict |
|---|---|---|---|
| ¥10,000 @ 0.0067 | 6,700 | 67 | UNDERCONVERTED (99% low) |
| KWD 12.345 @ 12.0 | 14,814 | 148,140 | OVERCONVERTED (10×) |
| $1,000.00 @ 3.7 | 370,000 | 370,000 | OK |

Cause: `israelVatReturn` builds the return without `baseCurrency`, and `computeTaxReturn`'s `toBase`
only applies the ISO-4217 minor-unit shift when `baseCurrency` is present. Filed as issue #928;
`r4-output.json` is the run quoted there. The same omission is in `accountantExportPack.ts`.
