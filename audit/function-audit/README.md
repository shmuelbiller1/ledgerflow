# Independent function-level audit (Pass A) — working ledger

Owner assignment: AI #8 (fork `Chaim-Richard/ledgerflow`), per `docs/INDEPENDENT_AUDIT_AGENT.md`
(owner, 18 Oct) and the AI #8 queue in `docs/COORDINATION.md`. Review scope only: no financial,
posting, migration or server code is changed. Evidence is pinned to a full commit SHA and source
Git blob SHA; when code changes, the affected rows must be rechecked.

## How to run the executed evidence

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx tsx --test src/tests/audit-af001-plaid-contract.test.ts \
                 src/tests/audit-af002-label-cents.test.ts \
                 src/tests/audit-af010-money-primitives.test.ts \
                 src/tests/audit-af010b-csv-dates.test.ts \
                 src/tests/audit-af010c-expr-csv.test.ts \
                 src/tests/audit-af010d-currency-period.test.ts
```

No database is required for these suites (the Postgres-gated route tests stay under
`LF_TEST_DATABASE_URL` and are never claimed as run here). Expected values in the tests are worked
by hand; none are produced by the function under review.

## Documents

| File | Case | Outcome at pinned SHA |
|---|---|---|
| [`SCORECARD.md`](SCORECARD.md) | Coverage, counts, findings register, next batch | Living ledger |
| [`SCORECARD-2026-11-11-agent8.md`](SCORECARD-2026-11-11-agent8.md) | Closure-wave re-verification at `ec3ff49` | **Latest Agent #8 slice**: 4 closures clean, 3 surviving defects → issues #627, #628 |
| [`AF-001-bank-cursor-durability.md`](AF-001-bank-cursor-durability.md) | Plaid cursor vs durable ingestion | Defect confirmed (tracked as issue #151) |
| [`AF-002-label-cent-reconciliation.md`](AF-002-label-cent-reconciliation.md) | Per-label cent reconciliation (#152 regression) | Fix re-verified; one latent gap |
| [`AF-010-money-microfunctions.md`](AF-010-money-microfunctions.md) | Allocators, amount parsers, CSV, date/period helpers | 6 findings (2 P2, 4 P3) + clean helpers |
| [`issue-drafts/`](issue-drafts/README.md) | Ready-to-paste PR/issue/comment text (upstream writes are 403 for this token) | Owner action |

## Probes

Review-only evidence scripts under [`probes/`](probes/). Historical discovery probes print OBSERVED vs EXPECTED for their pinned code; most exit 0 for documentation only. **The current AF-007 regression probe exits non-zero when the real cache fails its bounds**, and does not fall back to a copy of retired code if dependencies are missing. Run them with `npx tsx` (the `.mjs` ones import TypeScript).

| Probe | Covers | Status at `ec3ff49` → at `39b0012` |
|---|---|---|
| `af004-614-residual.ts` | whether PR #614's fixes to `usSalesTaxReturn` reached `usQuarterJourney`, and cross-country inheritance in `resolveSellerProfile` | **7 DEFECT / 4 OK** → **11 OK (all pass)**. Filed #627/#628, fixed by PR #635; now the regression guard for both |
| `af004-tax-authority-probe.ts` | AF-004 P1–P8 | 5 DEFECT / 3 OK → **1 DEFECT (P6 only) / 8 OK**. **P3 and P8 were corrected on 11 Nov**: they asserted the pre-#614 contract and printed DEFECT for closed issues #518 and #517. P1/P2/P7 were #628, fixed by PR #635; P4 was fixed too, with a control added during review |
| `af007-report-cache-growth.ts` | Current exported `REPORT_CACHE_LIMIT`, `rememberReport`, `reportCacheSize` and cache-key behaviour; historical issue [#645](https://github.com/shmuelbiller1/ledgerflow/issues/645) | **Historical at `39b0012`: 4 DEFECT / 1 OK. Fixed by merged PR #660.** Current probe checks 2,000 real cache writes respect the 500-entry bound, an expired full cache is swept, and reports ignored-query key churn as informational. A missing dependency fails visibly; do not quote old probe output as a current result. |
| `af004-519-customer-moves.ts` | #519 destination snapshot | holds in the return |
| `af012-rule-chain-order.mjs` | #161 chained override order | **order-independent — fixed by #611.** It prints the applied rules in *list* order, so compare them as sets |
| `af012-shipped-pack-chains.mjs` | whether any shipped rule pack contains a chain | 18 packs / 584 rules / 67 overrides / 0 nested chains |
| `af011-date-contracts.mjs` | the raw `Date` year-boundary hazard | demonstrates the hazard in the platform API; the shipped display path is covered by `src/tests/date-display.test.ts` |

**A probe's expectation can go stale when the code it audits is fixed.** Before reporting a probe DEFECT as a live
finding, read the current source: that is exactly what happened to P3, and the corrected expectation is now a
regression guard for #518.

## Status vocabulary (from the mission)

`verified-no-finding` · `verified-defect` · `needs-reproduction` · `unsupported/unknown` ·
`not-yet-reviewed`. An index entry or a green happy-path test is never recorded as a review.
