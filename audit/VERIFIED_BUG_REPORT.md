# Verified Bug Report — LedgerFlow

**Target:** `main` at `9aed5466c4691c5c55c6d4dbec0565d88dbc8462` (2026-10-18)  
**Repository:** `shmuelbiller1/ledgerflow`  
**Purpose:** Evidence-led findings, not an implementation patch. No application source or production data was changed.

## Reading this report

- **Confirmed** means the source path and relevant boundary were traced and a deterministic probe/test or direct source condition establishes the stated behavior.
- **Source-confirmed** means the code contains the defect/risk path, but a browser, provider or real-database effect was not run.
- **Boundary reproduced** means an isolated fake or synthetic probe reached that boundary; it does not imply durable production data was changed.
- **Persistence pending** means a database/concurrency outcome must still be tested with a real PostgreSQL environment.
- Severity describes potential user/business impact, not exploitability or a claim that every deployment is affected.

The two public invoice/estimate GET responses of HTTP 404 in the route probe were caused by deliberately invalid synthetic tokens. Their route declarations are present; these are **not missing routes**. Browser testing and PostgreSQL/RLS execution were unavailable. See `AUDIT_PROGRESS.md` for exact commands, counts and limitations.

## High-priority summary

| ID | Finding | Severity | Evidence / verification boundary | Durable data changed? |
|---|---|---|---|---|
| BUG-01 | Transaction-list inflow/outflow totals misclassify reversal lines | High for displayed financial totals | Independent signed-line probe; 4 targeted expectations fail | No |
| BUG-02 | Report screens can retain a prior server period after a failed refetch | High for decision-useful reporting | Source path confirmed; browser reproduction unavailable | No |
| BUG-03 | Stale invoice saves/retries generate fresh posting identities | High financial-integrity risk | Client-boundary synthetic reproduction; real concurrent/retry DB effect pending | No |
| BUG-04 | Statement PDF/email ignores the on-screen selected date scope | High for delivered statement correctness | Source trace plus isolated fake-DB scope probe | No |
| BUG-05 | Successful transaction retries append duplicate rows to the local ledger cache | Medium; cache-only reproduction | Zustand store probe; not a durable-ledger defect in the probe | No |
| BUG-06 | Ten enabled button declarations have no handler path; one “Close Period” button selects instead | Medium workflow/control correctness | AST inventory plus source inspection; browser interaction unavailable | No |
| BUG-07 | Raw-balanced foreign-currency lines can pass validation while base-currency values do not balance | High financial-integrity risk | Synthetic validator + base conversion probe; real route/DB commit pending | No |
| AUD-19 | Altman Z-Score counts a reversing revenue line as more EBIT | High for this analytical output | Actual algorithm compute probe with hand-worked numbers | No |

## Detailed confirmed findings

### BUG-01 — Reversal signs are lost in transaction-list inflow/outflow totals

**Severity:** High for displayed totals. **Status:** Independently reproduced, deterministic function boundary.

- **Code path:** `src/lib/txFilters.ts:379-414`, `calculateFilteredTotals`; rendered by `src/components/ledger/TransactionTotalsRow.tsx`.
- The branch used for an `actual` reversal iterates revenue/expense lines and adds `Math.abs(lineAmount(...))`. It therefore counts a reversing revenue debit as another inflow and a reversing expense credit as another outflow instead of following the signed cash effect.
- **Independent expected values:** a sale of 1,000 cents and its exact reversal should produce 1,000 cents inflow and 1,000 cents outflow. A rent expense of 200 cents and its exact reversal should produce 200 cents outflow and 200 cents inflow.
- **Observed:** sale + reversal = 2,000 inflow / 0 outflow; rent + reversal = 400 outflow / 0 inflow. The focused probe has 34 passing checks and these 4 failed assertions: `work/probe_money.ts`.
- **Scope:** transaction-list totals only; this probe does not establish that the journal posting itself is wrong. Do not “fix” posting signs or change the expected amounts to hide the report defect.
- **Next verification:** add focused `calculateFilteredTotals` tests for sale/credit/refund/reversal, expense reversal and FX; verify the actual transaction-grid display in a browser.

### BUG-02 — A failed report refetch can leave old server figures under a new date heading

**Severity:** High for decision-useful reporting. **Status:** Source-confirmed; browser reproduction unavailable.

- **Code path:** `src/hooks/useFinancialReporting.ts:98-100` returns `null` on a failed HTTP request. The P&L, balance-sheet, trial-balance and cash-flow screens update `serverData` and `isServerAuthoritative` only when the new response is truthy; the null result is not an exception, and the prior data/authoritative flag are not cleared. See `src/components/ledger/ProfitAndLossView.tsx`, `BalanceSheetView.tsx`, `TrialBalanceView.tsx` and `CashFlowView.tsx` report-load callbacks.
- **Failure sequence:** the screen has a successful authoritative answer for period A; the user changes the period to B; B's request fails and the hook returns null; the old answer for A can still be selected for display under B's heading. Comparative-period data can also remain stale.
- **Why the existing `catch` does not solve this:** `fetchReport` catches network/HTTP errors internally and returns `null`, so the calling screen's `catch` is not entered. It also removes the report's explicit error provenance.
- **Verification limit:** the state transition is evident from the current source, but there was no Chromium/Playwright browser to reproduce the visible screen.
- **Next verification:** component test with success(A) → select B → failed B response; assert no A figures are presented as B, and test comparison/basis/workspace switching.

### BUG-03 — Invoice retry/stale-client posting does not reuse a stable document operation identity

**Severity:** High financial-integrity risk. **Status:** Client boundary reproduced; durable retry/concurrency result pending PostgreSQL.

- **Code path:** `src/services/ledgerPost/invoicePosting.ts:68-81,164-270` derives existing postings from the client-loaded transaction list and builds reversal entries only from that list. `src/services/ledgerPost/postingKit.ts:191-230` assigns fresh UUIDs to transactions lacking IDs and uses the first transaction ID as the `Idempotency-Key` by default. `src/server/routes/transactions/bulkRoutes.ts` checks duplicate transaction IDs and idempotency identity, but does not compare an invoice posting revision/CAS token or enforce one active accrual per invoice revision.
- **Synthetic reproduction:** `work/probe_double_post.ts` supplies the same invoice twice against a deliberately stale context whose `transactions` list is empty. Both saves send a new invoice-accrual transaction and a different idempotency key; the second has no reversal. No database was touched.
- **Likely durable consequence if both requests commit:** because the transaction IDs and keys differ, the bulk handler's same-key replay/duplicate-ID checks do not deduplicate the two requests by invoice identity. The current source validates workspace ownership and schema but does not establish an expected invoice revision for this posting operation.
- **Not established here:** the exact simultaneous/lost-response outcome in the real PostgreSQL adapter; do not describe this as a reproduced production duplicate.
- **Next verification/fix acceptance:** use a stable server-owned document/action/revision operation identity or expected revision/CAS; test lost response retry, two tabs, concurrent save, changed payload with reused key and one durable journal effect against PostgreSQL.

### BUG-04 — Statement PDF and email use all-history scope, not the selected screen period

**Severity:** High for delivered statement correctness. **Status:** Source + isolated fake-DB probe.

- **Code path:** the screen `src/components/ledger/StatementView.tsx` computes a selected date scope. `src/server/services/statementService.ts:19-50` loads the selected party's invoices/bills, payments and credits, then calls `computeStatement(..., '1970-01-01', '2099-12-31', ...)` regardless of screen dates. Both `src/server/routes/documentRoutes.ts:151` and `src/server/services/documentEmailService.ts:255` consume `loadStatement`.
- **Synthetic probe:** `work/probe_statement_scope.mjs` created a prior-period item and a February 2026 item. The selected-February screen result carries the prior opening balance and only the in-period item; the PDF/email loader contains both dated items because of its hard-coded range.
- **Impact:** the screen, downloaded PDF and emailed statement can show different transactions and balances for what appears to be one statement action.
- **Product contract to decide:** if a delivered statement is intentionally full-history, label that and do not imply it matches the selected screen. Otherwise pass one explicit `StatementScope` through screen, JSON, PDF and email.

### BUG-05 — `postTxsServerApi` duplicates rows in the current Zustand transaction cache

**Severity:** Medium, cache-only. **Status:** Reproduced in a client-store probe.

- **Code path:** `src/services/ledgerPost/postingKit.ts:191-230` ignores canonical transactions in the response and prepends the request array to the current store after any successful HTTP response. It does not upsert by transaction ID or verify that the same workspace/user is still selected.
- **Synthetic reproduction:** `work/probe_posting.ts` calls it twice with the same ID while the server mock returns success both times. The store contains two same-ID rows after the second call.
- **Scope:** this is not evidence of two database transactions. The probe is cache-only. It can nevertheless duplicate visible rows/totals until refresh/subscription repair, and a late response can potentially repopulate a switched workspace.
- **Next verification:** ID-upsert server-confirmed records or scoped invalidation; test idempotent replay, realtime-before-response, workspace switch during request, and server-normalized fields.

### BUG-06 — Enabled UI declarations include dead and miswired controls

**Severity:** Medium workflow reliability. **Status:** Static source-confirmed; browser interaction unavailable.

- The JSX/AST inventory found **10 enabled button declarations without direct, form-submit or ancestor-click handler paths**. These are declarations, not a claim that all 3,440 scanned interactive JSX elements are rendered in a particular runtime state.
- **No-handler declarations:** `src/components/commercial/PricingPage.tsx:100`; `src/components/finance/Consolidation.tsx:42`; `src/components/finance/FiscalPeriodManager.tsx:284`; `src/components/finance/TaxManager.tsx:254`; `src/components/forensics/ForensicAudit.tsx:263`; `src/components/ledger/ProjectProfitabilityView.tsx:134,184`; `src/components/platform/StressTestPanel.tsx:64`; `src/components/platform/settings/DeveloperSettings.tsx:88`; `src/components/projects/ProjectsView.tsx:288`.
- **Miswired control:** `FiscalPeriodManager.tsx:200` renders a hover-only “Close Period” button inside a card whose ancestor click sets the selected period. The button has no close handler; it selects the card. The separate “Hard Close Period” control calls the established close handler. “Run Year-End Wizard” has no handler.
- **Related control:** the Pricing page is registered/reachable, but its tier buttons do not reach the existing billing checkout flow. Other incomplete controls remain visible; this audit does not recommend hiding them.
- **Next verification:** connect each control to an existing appropriate path or explicitly mark it incomplete; add browser/keyboard tests and preserve the separate working financial close route.

### BUG-07 — Double-entry validation checks raw foreign cents but downstream base amounts can be unbalanced

**Severity:** High financial-integrity risk. **Status:** Synthetic validator boundary reproduced; real route/DB commit pending.

- **Code path:** `src/kernel/validation/DoubleEntryValidator.ts:49-64` requires raw `amountCents` to sum to zero. `src/kernel/validation/TransactionValidator.ts:34-130` calculates an FX-aware absolute total but does not validate the signed FX-converted line sum. `src/lib/txFilters.ts:90-96` converts each line independently using its line or transaction exchange rate.
- **Synthetic input:** EUR lines `+100` at rate `1.083` and `−100` at rate `1.087`. The raw sum is zero, and `TransactionValidator.validateAndPrepare` accepts the transaction. `lineAmount` produces `+108` and `−109`, whose base-currency sum is `−1` cent. Probe: `work/probe_fx_base_balance.ts`.
- **Impact:** the server's double-entry gate can accept a transaction whose converted base amounts used by reports do not balance. This is a rounding/ledger-currency contract issue; whether a valid FX-clearing line should be required is a finance-owner decision.
- **Next verification:** define transaction-currency vs base-currency balancing and rounding rules; run synthetic multi-line/rate cases through the actual route and PostgreSQL adapter, including existing FX posting tests.

## Other material findings and status of earlier audit IDs

These IDs are retained for continuity with `docs/DEEP_CODE_AUDIT.md`, `docs/PLAN.md` and `docs/TRACKER.md`. “Fixed” here means source/test status at the pinned revision; it does not certify production deployment.

| Existing ID | Current status at pinned revision | Evidence and remaining work |
|---|---|---|
| AUD-01 | Open; overlaps BUG-04 | Screen/PDF/email statement scopes do not agree. Decide one scope contract and test the same opening balance/period across all outputs. |
| AUD-02 | **Partially fixed** | `workspaceRestoreService.ts` now calls `checkLedgerEntry` for each restored transaction before queuing writes; synthetic probe confirms an unbalanced ledger record is refused with zero queued writes. Foreign-ID ownership checks and the delete snapshot remain outside the final transaction (TOCTOU). Document shape/relations and coherent export snapshot still need tests. |
| AUD-03 | Open | Return-authorization decisions/history are client-updated metadata, not a server-enforced requester/approver-separated transition with expected revision/CAS and immutable events. Keep stock receipt/credit posting separate. |
| AUD-04 | Open | `scheduledReportService.ts` marks a period sent before rendering/sending. Failed recipients/crashes are not retried for that period; marker is not an atomic concurrent claim. |
| AUD-05 | Open | Standalone `serveApp.ts` timers/boot run do not schedule the same job set as Vercel's `cronRoutes.ts`. Document deployment contract and consolidate the registry without running duplicate effects. |
| AUD-06 | **Fixed in current package scripts** | `npm test` includes `src/server/utils/*.test.ts`; the omitted utility discovery gap is closed. This does not replace real external network/browser tests. |
| AUD-07 | **Partially fixed** | Generic `executeCommand` now hashes requests and actor; bulk posting uses actor + payload hash and checks replays inside its transaction. Three direct `executeIdempotent` callers in `src/server/routes/adminRoutes.ts:175,267,449` omit `payloadHash`; a same-actor changed-payload reuse can return a prior result. Ensure every caller supplies the hash and test conflicts/replays. |
| AUD-08 | **Fixed for the bulk posting path inspected** | The bulk transaction now re-reads workspace lock state within its transaction and checks dates at commit. This is not blanket evidence for every mutation route or the separate role/membership revocation race. |
| AUD-09 | Architectural control, not a reproduced vulnerability | Server PostgreSQL uses privileged access; RLS is not the only safeguard. Each write still needs route/service identity, workspace, role, lock, schema and business-invariant checks. PostgreSQL/RLS tests were unavailable here. |
| AUD-10 | Open; overlaps BUG-02 and BUG-05 | Server-report errors return `null` and allow local fallback; report collection limits can make exact-cap data incomplete. The UI lacks a universal `{source, scope, completeness, asOf, error}` provenance contract; stale last-good data must not masquerade as the new scope. |
| AUD-11 | Open security investigation | `safeFetch.ts` checks DNS answers, then ordinary `fetch(inputUrl)` resolves/connects independently; redirect auto-follow is disabled and timeout exists. DNS/connection pinning is absent. Exploitability was not demonstrated; add deterministic rebinding/canonicalization tests and use an allowlist or pinned outbound strategy. |
| AUD-12 | Open deployment mismatch | Client supports configurable Supabase host while static `vercel.json` CSP hard-codes one `connect-src` project. No deployment outage was reproduced; test the effective combined headers for a configured alternate project. |
| AUD-13 | Open UI race; no server escalation shown | Async admin-claim results can land after identity changes without a generation check. Treat as stale UI/cache risk, not evidence of server authorization bypass. Test pending old-user token → sign out → viewer sign-in. |
| AUD-14 | Open product-honesty/completion item | Registered `receipt-capture` uses a hard-coded Home Depot OCR sample and does not accept user receipt text in `compute`; the “90% accuracy” claim has no evaluation evidence here. Label as a demo or wire/test real input. |
| AUD-15 | Reproduced; tracked as BUG-05 | Client cache prepends requested rows instead of canonical/upserted response and has no workspace-generation guard. Cache-only probe; do not change durable postings to fix it. |
| AUD-16 | Open workflow/process defect | `docs/COORDINATION.md` retains unchecked C-102…C-126 screen-connection requests while many corresponding library/screen capabilities are present. `docs/CAPABILITIES.md` also contradicts itself: rows 151/171 disagree on record notes; rows 152/173 disagree on custom fields. Reconcile against current routes/tests; preserve the history and owners. |
| AUD-17 | Measured performance concern, not a demonstrated outage | Current Node 24 build: main JS 977.68 kB (301.03 kB gzip), ExcelJS 938.06 kB (271.30 kB gzip), visualization vendor 493.94 kB (131.61 kB gzip); PWA precache 334 entries / 6,986.69 KiB. These are build artifacts, not measured load times or Core Web Vitals. Profile before changing chunk/lazy architecture. |
| AUD-18 | Metric-definition issue | `quality-baseline.json`'s `eslintWarnings` metric counts suppression markers in `scripts/quality-metrics.ts`, not ordinary ESLint diagnostics; the actual lint run reports 210 warnings / 0 errors against the 212 warning cap. Scanner counts are budgets, not confirmed-bug counts. |
| AUD-19 | **Confirmed analytical sign defect** | `src/lib/algorithms/altman-z-score.ts` adds `Math.abs` revenue and subtracts absolute expense. Probe output for assets 10,000, liabilities 2,000, equity 8,000: EBIT/assets goes 0.0% → 10.0% after a 1,000 sale → 20.0% after its exact reversal; Z score 9.45 → 10.12 → 10.79. The sale + reversal should net the revenue contribution back to zero. Formula model/calibration is a separate concern. |
| AUD-20 | **Confirmed unsafe TLS fallback; deployment configuration unknown** | `pgFirestore.ts:464` returns `rejectUnauthorized: false` for a remote connection when `DATABASE_CA_CERT` is absent. Pure config probe reproduced the option; no network/production connection was made. Require and test certificate/hostname validation for production. |
| AUD-21 | Source-confirmed cache-refresh reliability issue | `useEntityOperations.ts:58-83` recalculates customer/vendor `balanceCents`, catches errors only to `console.warn`, and callers do not await the refresh. The cached party balance can lag; the ledger/report remains the authority. Add observable retry/invalidation tests. |
| AUD-22 | Source-confirmed import dedupe limit; durable duplicate not reproduced | `importActions.ts:24-35` deduplicates bank imports using the loaded transaction cache (`bankTransactionId`/ID). A re-import outside loaded history can miss the client check; each import creates new IDs. The server enforces row-ID uniqueness, not a server-side unique source fingerprint. Verify with cap/pagination and a DB test before asserting duplicate durable bank activity. |

## Reproduction and follow-up artifacts

- `work/probe_money.ts` — financial totals and hand-worked tax/date/FX expectations.
- `work/probe_double_post.ts` — stale invoice transaction-history boundary (no DB).
- `work/probe_posting.ts` — post-success Zustand duplicate (cache only).
- `work/probe_fx_base_balance.ts` — raw-vs-converted balance (no DB).
- `work/probe_statement_scope.mjs` — selected-period vs PDF/email scope (fake DB).
- `work/probe_legacy.mjs` — restore refusal, Altman reversal and TLS config.
- `work/probe2.mjs`, `work/probe_results.json` — actual-method HTTP probes against a local Express app. Public 404s are invalid-token outcomes, not missing endpoints.

All probes used synthetic/test data and did not touch production or persistent application records. The exact revision, commands, pass/fail counts, test/database/browser limitations and next verification stages are recorded in `AUDIT_PROGRESS.md`.
