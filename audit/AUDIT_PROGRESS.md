# Audit Progress Ledger

**Target:** Latest checked-in `main` snapshot available to this audit: `9aed5466c4691c5c55c6d4dbec0565d88dbc8462`  
**Working branch:** `arena/c9b073a8-ledgerflow` (fixed by session; no branch switch/push/PR)  
**Audit date:** 2026-10-18  
**Application-source changes:** None. No production data/provider actions were performed.

## Current state

The code/workflow audit and requested reports are assembled. The remaining project work is **verification unavailable in this sandbox**, not unreported source fixes: real PostgreSQL/RLS/migration application, browser journeys, live provider sandboxes and deployed TLS/CSP configuration must be checked by the implementation/release owners before a real-record pilot.

Last completed action: corrected the generated route probe interpretation and workflow references, generated `VERIFIED_BUG_REPORT.md`, `MISSING_CONNECTIONS_AND_SHORTCUTS.md`, `ARCHITECTURE_AND_STRATEGY_REVIEW.md`, `FIRST_TESTERS_READINESS.md`, `MASTER_IMPLEMENTATION_PLAN.md`, and this persistent progress ledger. CSV parser validation is recorded under “Artifact validation.” The two public invoice/estimate HTTP 404s are now treated as expected invalid synthetic-token responses; no missing route was established.

## Deliverables in `audit/`

### Structural and feature maps

1. `COMPLETE_FILE_INVENTORY.csv`
2. `COMPLETE_FUNCTION_MAP.csv`
3. `COMPLETE_CALL_EDGE_MAP.csv`
4. `EVERY_UI_ACTION_MAP.csv`
5. `BACKEND_FUNCTIONALITY_MAP.csv`
6. `DATABASE_OPERATION_MAP.csv`
7. `FEATURE_COMPLETENESS_MATRIX.csv`
8. `END_TO_END_WORKFLOW_MAP.md`

### Findings, strategy and readiness

9. `VERIFIED_BUG_REPORT.md`
10. `MISSING_CONNECTIONS_AND_SHORTCUTS.md`
11. `ARCHITECTURE_AND_STRATEGY_REVIEW.md`
12. `FIRST_TESTERS_READINESS.md`
13. `MASTER_IMPLEMENTATION_PLAN.md`
14. `AUDIT_PROGRESS.md` (this ongoing ledger)

All paths and counts are against the pinned revision above. CSV IDs are stable for this generated snapshot: files `F…`, functions `FN…`, call edges `CE…`, UI declarations `UI…`, backend rows `BE…`, DB operations `DB…`, and features `FC…`. Workflow IDs are from the current Atlas plus local `WF-19` and `WF-20` additions. Bug IDs `BUG-01`…`BUG-07` are stable references in the bug report/matrix; previous `AUD-01`…`AUD-20` IDs are retained for continuity. `AUD-21/22` are new current-source findings.

## Scope and coverage evidence

- Local `HEAD` and local `main` match `9aed5466c4691c5c55c6d4dbec0565d88dbc8462`; no application code or production data was modified.
- 2,178 tracked paths inventoried. Current-revision Atlas generation: 2,178 entries, 1,999 code files, 45 binary assets, 83 unknown relationships, 260 computed API callsites, zero parse diagnostics, 28 stale prior manual notes.
- Re-resolved 18 prior Atlas workflow traces: 215 file/symbol references, zero missing paths/symbols, two line-number drifts.
- TypeScript AST inventory: 29,662 function-like nodes (18,742 production; 10,920 test/e2e), zero parser diagnostics.
- Static call-edge map: 121,619 edge rows / 121,327 call-or-new sites; 27,121 uniquely resolved function edges, 202 ambiguous and 94,004 unresolved/external candidates. This is a static discovery map, not whole-program proof.
- UI declaration map: 3,440 interactive JSX declarations, 1,330 button declarations, 2,313 handler paths statically resolved and 1,127 unresolved/prop/dynamic; 10 enabled button declarations had no direct/form/ancestor handler. FiscalPeriodManager’s “Close Period” was separately traced to ancestor period selection, not close behavior. These are JSX declarations, not a browser-rendered-control count.
- Backend inventory: 282 static path/method patterns versus 279 live Express route objects; the three extra static patterns are array-path variants. The actual-method probe covered 169 concrete client URL patterns. **Two public invoice/estimate GET 404s were expected invalid-token outcomes**, not missing endpoints. Probe status distribution: 2×200, 3×400, 47×401, 115×403, 2×404. Fifteen dynamic URL callsites were not assigned a concrete probe path. No valid credentials, database or external provider were used.
- Database map: 1,403 AST operation candidates. They are not 1,403 individually audited queries or evidence of deployed schema/RLS.
- Capability parse: 193 numeric rows, of which 190 row numbers are unique; 162, 163 and 164 are duplicated in `docs/CAPABILITIES.md`. Feature matrix has 210 rows: 193 parsed rows + 17 audit additions.
- Generated workflow map includes 20 workflows: 18 Atlas entries re-resolved against current source plus two audit additions. Source traces and tests do not certify all runtime paths.

## Independent source review and probe status

- Targeted source/docs/config review covered 72 unique paths recorded in `work/source_reviewed_paths.json`. This is targeted trace evidence, not exhaustive line-by-line human review of 2,178 tracked paths.
- `work/probe_money.ts`: **34 pass / 4 fail**; the four expected-value mismatches reproduce BUG-01. Correct gross expectation for sale + reversal is 1,000¢ inflow + 1,000¢ outflow; for expense + reversal, 200¢ outflow + 200¢ inflow.
- `work/probe_templates.ts`: 24 pass, 0 fail (allocation, balanced invoice/bill templates, labelled balancing, reversal, validation).
- `work/probe_legacy.mjs`: Altman EBIT/assets 0% → 10% → 20% for sale + exact reversal (AUD-19); restore refuses unbalanced backup entry before writes (AUD-02 validation improvement); remote TLS config returns `{ rejectUnauthorized: false }` without a CA (AUD-20). No durable DB/network actions.
- `work/probe_statement_scope.mjs`: isolated fake-DB probe shows selected February 2026 screen output has prior opening + in-period I-2; PDF/email loader includes both 2025 I-1 and 2026 I-2 due hard-coded 1970–2099 dates.
- `work/probe_double_post.ts`: stale client transaction context creates two different idempotency keys and separate accrual requests for the same invoice; **client boundary only, no real DB commit**.
- `work/probe_posting.ts`: repeated success prepends duplicate transaction IDs into the Zustand store; **cache only, no durable DB write**.
- `work/probe_fx_base_balance.ts`: raw-balanced synthetic EUR lines `+100/-100` at rates 1.083/1.087 pass validator; `lineAmount` converts to `+108/-109`, base sum −1 cent. Route/DB commit not exercised.
- `work/probe2.mjs` / `work/probe_results.json`: local Express actual-method probe. Corrected template-string extraction to retain suffix text after interpolations before final results were produced. The 2 public 404s are expected invalid-token outcomes.

## Tool/check results

### Passed

- Dependencies installed with `HUSKY=0 npm ci --ignore-scripts` (exit 0). Package/lock state was not changed by the install.
- Used downloaded Node **24.22.0** at `/home/user/node24/package/bin/node`; initial host Node 22 was not used for final checks.
- Node 24 unit command:
  ```sh
  NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
    node --import tsx --test --test-concurrency=4 \
    src/tests/*.test.ts src/tests/*.test.tsx src/lib/*.test.ts src/server/utils/*.test.ts
  ```
  **2,799 pass, 0 fail.** Output contained **125 `LF_TEST_DATABASE_URL not set` notices**. TAP’s final leaf skipped count was 0; therefore this result does not claim DB/RLS coverage.
- `npm run lint`: pass, 0 errors / 210 warnings under the unchanged 212-warning limit.
- `npm run build`: pass on Node 24.22.0. Main JS 977.68 kB (301.03 kB gzip); ExcelJS 938.06 kB (271.30 kB gzip); visualization vendor 493.94 kB (131.61 kB gzip); PWA precache 334 entries / 6,986.69 KiB. Build artifact sizes are not runtime performance measures.
- `node --test scripts/code-atlas.test.mjs` on Node 24.22.0: 18 pass, 0 fail.

### Not run / unavailable (do not call pass or fail)

- No PostgreSQL, `psql`, Docker or `LF_TEST_DATABASE_URL`; no real DB transaction, RLS suite, migration application state or interleaving test.
- No Chromium/Playwright browser available; no browser/E2E/visual/accessibility test run.
- No live Stripe/Plaid/mail providers or production environment. No external payment/bank/email operation, production write, or actual remote DB TLS connection.
- Deployed CSP, deployed database CA/hostname policy, applied migration revision and production provider settings remain unknown.

## Corrections made during this audit

- Rechecked historical audit findings against current source. AUD-02 is **partly fixed** (ledger-door validation now refuses unbalanced restore entries); AUD-06 is **fixed** in the package test glob; AUD-07 is **partly fixed** (generic commands/bulk request hashes exist, but three direct admin callers omit the hash); AUD-08 is **fixed for the bulk path inspected**, not a blanket statement about every route.
- The public-token 404 probe interpretation was corrected after checking route declarations and the invalid synthetic tokens. No route is reported missing based on those responses.
- `END_TO_END_WORKFLOW_MAP.md` bug IDs/statuses were reconciled with the stable `BUG-01`…`BUG-07` definitions and source/browser/DB limitations. Workflow terms now distinguish source trace from executed E2E proof.
- `uimap.mjs`, `net.mjs` and `probe2.mjs` are audit-only ignored work tools. Template-string parsing was corrected to include trailing literal suffixes after interpolations before generating final maps/probe outputs. `work/` remains ignored; no source app logic was edited.
- Historical `AUD-17` bundle figures were updated to current Node 24 build output. No performance claim beyond artifact size is made.

## Final artifact validation — completed

Ran Python's standard `csv` parser against all seven CSV deliverables after the final report edits. Every row matched the header width; all first-column record IDs were unique:

| File | Data rows | Columns | Ragged rows | Duplicate first-column IDs |
|---|---:|---:|---:|---:|
| `BACKEND_FUNCTIONALITY_MAP.csv` | 4,144 | 15 | 0 | 0 |
| `COMPLETE_CALL_EDGE_MAP.csv` | 121,619 | 18 | 0 | 0 |
| `COMPLETE_FILE_INVENTORY.csv` | 2,178 | 18 | 0 | 0 |
| `COMPLETE_FUNCTION_MAP.csv` | 29,662 | 40 | 0 | 0 |
| `DATABASE_OPERATION_MAP.csv` | 1,403 | 12 | 0 | 0 |
| `EVERY_UI_ACTION_MAP.csv` | 3,440 | 21 | 0 | 0 |
| `FEATURE_COMPLETENESS_MATRIX.csv` | 210 | 9 | 0 | 0 |

Also searched final Markdown/CSV references for stale BUG-ID assignments, incorrect route-probe interpretations, false missing-route claims, misspelled/missing report filenames and local Markdown report links. No missing local report links were found. The workflow's two public 404s are described as expected invalid-token responses. `docs/CAPABILITIES.md` row-number duplication is disclosed as ambiguous; generated `FC…` IDs are unique.

```sh
python3 - <<'CSV_PY'
import csv
from pathlib import Path
for p in sorted(Path('audit').glob('*.csv')):
    with p.open(newline='', encoding='utf-8') as f:
        rows = list(csv.reader(f))
    width = len(rows[0])
    bad = [i + 1 for i, row in enumerate(rows) if len(row) != width]
    ids = [row[0] for row in rows[1:] if row]
    print(f'{p.name}: rows={len(rows)-1}, columns={width}, ragged={len(bad)}, duplicate_first_col_ids={len(ids)-len(set(ids))}')
    if bad or len(ids) != len(set(ids)):
        raise SystemExit(f'CSV validation failed: {p} lines {bad[:5]}')
CSV_PY
```

## Remaining external verification tasks (not performed here)

- [ ] Run the DB/RLS/migration suite against a disposable real PostgreSQL environment; record exact applied migration state.
- [ ] Run browser/E2E/accessibility journeys with Chromium/Playwright and synthetic records.
- [ ] Validate staging TLS/CSP and provider-sandbox email/Plaid/Stripe behavior.
- [ ] Preserve source-only/production-data constraints. No implementation source change, PR, production write or provider action is authorized by this research request.
