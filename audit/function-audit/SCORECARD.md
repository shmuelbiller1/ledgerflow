# Audit scorecard — independent function-level review (Pass A) and workflow review (Pass B)

**Latest update:** 2026-10-25 (second session) · **Owner:** AI #8 (independent audit, review-only)
**Pinned SHA:** `50ee1205d9049d7c225beb433bcb3dff75b77be9` (= `upstream/main`, 2026-10-25 21:01 UTC)
**Previous pin:** `8df972da` (2026-10-24, slices 1–3) — 85 commits have landed since; this pass re-verified the
old evidence at the new pin and added slices 4–6.
**Mission:** [`docs/INDEPENDENT_AUDIT_AGENT.md`](../../docs/INDEPENDENT_AUDIT_AGENT.md) · umbrella issue
[#150](https://github.com/shmuelbiller1/ledgerflow/issues/150)
**Owner-facing list:** [`../FINAL_ACCURATE_LIST_2026-10-25.md`](../FINAL_ACCURATE_LIST_2026-10-25.md)

## Headline

- **The release-gate worked-figure suites were executed for the first time in this environment**: six
  gold suites against a real Postgres → **31/31 pass**. They *skip* without `LF_TEST_DATABASE_URL`, which is
  why earlier audit sessions could only read them.
- **Statement scope, entity statements, stock revaluation, inventory as-of and import acceptance** → **51/51**;
  **RMA server** → **5/5**; **RLS** → all pass; types 0 errors; ESLint 0 errors / 61 warnings.
- **Two new verified defects**: **AF-011** (#342, civil-date/time-zone contract, P1) and **AF-012** (#161,
  override chains, P2 latent). **Two source-verified screen defects** carried forward: AF-013 (#104),
  AF-014 (#96).
- **Five open GitHub issues are actually fixed at this pin** and can be closed: #141, #143, #130, #131, AU-4.

## Coverage (honest counts — indexing is not review)

| Metric | Count | Note |
|---|---:|---|
| Inventory: non-test TS/TSX source files at pin | 1,384 | unchanged inventory method |
| Prior atlas extraction (older SHA `74b8318`, incl. tests) | 29,662 functions / 121,619 edges | stale vs this pin; regenerate before relying on it |
| Functions fully inspected, slices 1–3 (previous sessions) | 67 | see the previous scorecard sections (kept below) |
| **Functions fully inspected, slices 4–6 (this session)** | **22** | listed below; each has source + executed evidence |
| Functions read partially (sampled) this session | 4 | named as partial, not counted as reviewed |
| Verified defects open | **13** | AF-001 ×4, AF-002-F1, AF-010 ×7, AF-011, AF-012 (AF-013/AF-014 are screen-level, source-verified) |
| Verified-no-finding with executed check | 15+ helpers, 584 rules, 12 gold workflows | property suites and the real-Postgres runs below |
| DB-gated checks executed here | **yes** | Postgres 18.4 (embedded), stub + all 45 migrations, RLS pass |

### Slice 4 — statements, imports, acceptance (fully read: body + callers + side effects)

`statementDate` · `loadStatement` (statementService) · the statement branch of `documentRoutes`
(period → `loadStatement` → PDF) · `amountCents` · `readSourceTrialBalance` · `compareImport`
(importAcceptance, incl. the QuickBooks `"1200 Accounts Receivable"` code/name matching and the file's own
total row) · `lf_rma_guard` (SQL trigger) · `allocationId` · `realizedFxFor` · `allocationLedgerReady`.

### Slice 5 — civil dates and the rule engine

`parseLocalDate` · `formatDate` · the `TaxManager` year filter · `evaluateRules` (full body) · `holds` ·
`describe` · `ilVatPack` · `stateRateTargets` · `taxRulePacks` / `allTaxRules` (all 18 packs materialised and
measured: 584 rules, 67 overrides, 221 exclusions, 0 chains, 0 dangling targets).

### Slice 6 — screens and recovery (source-verified; browser reproduction outstanding)

`TransactionGrid` keyboard effect (window listener, index arithmetic, no `scrollToItem`) ·
`useDataNeedsStore` `retry`/`markFailed` (no `online`/`visibilitychange` path) · `useLedgerData` subscription
effect (no recovery hook) · `ImportAcceptanceView` + `Reports` registration (reachable at
Reports → Import Acceptance) — read for reachability, **not** counted as full reviews.

## Findings register (the accurate list)

| ID | Sev | Finding | Lane | Tracked |
|---|---|---|---|---|
| AF-001-F1 | P1 (P0 mechanism) | `/sync` advances `syncCursor` with no durable write of returned rows; the router never touches `bankLines` | AI #1 server | issue #151 (re-verified at this pin) |
| AF-001-F2 | P1 | Banking "Sync Feed" reports success and never consumes `transactions/modified/removed` | AI #1/#8 UI | #151 |
| AF-001-F3 | P1 | Plaid `modified`/`removed` never applied; legacy importer hardcodes `accountId:'offset-bank'` | AI #1/#8 | #151 |
| AF-001-F4 | P2 | A healthy zero-change sync answers `success:false` | AI #1 | this audit |
| **AF-011** | **P1** | A stored `YYYY-MM-DD` displays one day earlier and files in the previous tax year when the workspace zone is ahead of the device zone (`formatDate`/`parseLocalDate`/`TaxManager:200`) | AI #1 shared helper | issue #342 (executed repro, [`AF-011`](AF-011-civil-date-contracts.md)) |
| **AF-012** | P2 latent | Override-chain answers depend on array order; a displaced rule keeps its displacement; no lint refuses chains/cycles (0 chains in the 584 shipped rules today) | AI #9 rules engine | issue #161 (executed repro, [`AF-012`](AF-012-rule-override-chains.md)) |
| **AF-013** | P2 | Grid keeps a logical focus without `scrollToItem`; `[-1].id` is reachable after filters empty the list; Tab intercepted globally | AI #3 screens | issue #104 (source-verified, browser repro needed) |
| **AF-014** | P2 | A failed live collection never retries itself on `online`/visible; only the manual Try again path exists | AI #2/#3 | issue #96 (source-verified, browser repro needed) |
| **AF-015** | P3 | The P&L route answers from its 60-second cache before the workspace-membership check; the key includes the user id, so no cross-user leak — only a revoked user's own last-minute answer (`reportRoutes.ts:108–110` vs the balance sheet's authorize-then-cache at `:141`) | AI #1 | this audit |
| AF-002-F1 | P2 latent | Template drops non-positive tax/discount legs (posting guards block reachability) | AI #1 | this audit |
| AF-010-F1…F7 | P2 ×3, P3 ×4 | allocator contracts, amount parser sign/throw/Latin digits, CSV formula guard, `formatDecimal(Infinity)`, expression precision | AI #1 | this audit |

**Fixed at this pin (verified fix + executed test, issue still open upstream):** #141 statement period in the
PDF (entity PDF deliberately refused with a note), #143 RMA server + browser-write trigger,
#130 stock revaluation, #131 inventory as-of, AU-4 import acceptance screen.

## Executed evidence at this pin

```sh
# database: local Postgres 18.4 (embedded npm distribution)
npm run db:test-setup     # stub + all 45 migrations
npm run test:rules        # ALL RLS TESTS PASSED
LF_TEST_DATABASE_URL=… npx tsx --test \
  src/tests/w1-gold.test.ts src/tests/w3w4-gold.test.ts src/tests/w7-gold.test.tsx \
  src/tests/w8-gold.test.tsx src/tests/w12-gold.test.ts src/tests/w13-gold.test.ts      # 31/31
LF_TEST_DATABASE_URL=… npx tsx --test \
  src/tests/aud01-statement-scope.test.tsx src/tests/statement-by-entity.test.ts \
  src/tests/iss130-stock-revaluation.test.ts src/tests/iss131-inventory-as-of.test.tsx \
  src/tests/au4-import-acceptance.test.tsx                                             # 51/51
LF_TEST_DATABASE_URL=… npx tsx --test src/tests/iss143-rma-server.test.ts              # 5/5
LF_TEST_DATABASE_URL=… npx tsx --test src/tests/eg2-payment-ledger.test.ts \
  src/tests/eg2-payment-void.test.ts src/tests/eg2-credits-writeoffs.test.ts \
  src/tests/eg2-client-void-retired.test.ts                                            # 29/29
NODE_ENV=test … npx tsx --test src/tests/audit-af001-plaid-contract.test.ts \
  src/tests/audit-af002-label-cents.test.ts src/tests/audit-af010-{money-primitives,b-csv-dates,c-expr-csv,d-currency-period}.test.ts  # 27/27
npm run lint:types        # 0 errors
npm run lint:eslint       # 0 errors, 61 warnings (cap 105)
```

Probes (reproduce the two new findings from a clean checkout):

```sh
TZ=UTC npx tsx audit/function-audit/probes/af011-date-contracts.mjs
npx tsx audit/function-audit/probes/af012-rule-chain-order.mjs
npx tsx audit/function-audit/probes/af012-shipped-pack-chains.mjs
```

The whole unit suite ran in four shards with the database attached: **4,616 tests · 904 suites · 0 failed ·
0 skipped** (exit 0 on every shard). Recorded in [`../FINAL_ACCURATE_LIST_2026-10-25.md`](../FINAL_ACCURATE_LIST_2026-10-25.md) §5.

## Not run here, and why

- **Browser journeys (89 specs).** No Chromium can be installed in this sandbox: playwright's CDN is blocked,
  and a static Chromium build fails on missing `libnspr4`/`libnss3`. Marker on #104, #96, #146 and #274:
  `needs-reproduction` until a browser run names the commit.
- **The live deployment.** Vercel/Supabase secrets, applied migrations and deployment protection are the
  owner's items; the repository cannot prove them.
- **Plaid sandbox.** AF-001's real-Postgres replay/interrupt test needs a fake Plaid client and a database;
  the recipe is written in issue #151.

## Proposed next batch (10 functions)

`postingCore` entry builder → `ledgerBulkCommit` (dedupe/idempotency) → posting shadow check →
`reconcileRoutes` match/clear → `bankLineService` → `bankRuleService` → `paymentVoidService` (void of a
settled payment) → `allocationLedger.recordAllocation/reverseAllocation` (same-transaction guarantees) →
`periodClosingService` snapshot write → `stockClosingService` snapshot write.
