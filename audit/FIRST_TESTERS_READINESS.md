# First Testers Readiness

**Target revision:** `9aed5466c4691c5c55c6d4dbec0565d88dbc8462`  
**Recommendation:** **Not ready for testers using real books or real financial records.** The repository is suitable for continued development and synthetic-data testing. A limited internal test with disposable data may proceed only with the guardrails below; it would validate a sandbox, not establish production readiness.

## Decision in one minute

- Unit tests pass, lint/build pass, and the product has substantial working flows. That is useful evidence, not a green light for real records.
- Several money/report defects are reproduced or source-confirmed (BUG-01, BUG-02, BUG-04, BUG-07, AUD-19). Invoice retry duplication has been reproduced at the client boundary but not at a real DB commit (BUG-03).
- The restore path has a partial validation fix; transaction-scoped ownership/deletion checks are still open (AUD-02).
- PostgreSQL/RLS/migration and browser journeys were not run in this environment. Database-backed tests emitted **125 “LF_TEST_DATABASE_URL not set” notices**; TAP reported zero leaf skips, which is not database coverage.
- Migration application state, production TLS configuration, provider credentials and actual deployed CSP were not inspected.
- The product includes features that are previews, internal tools, placeholders, calculation-only paths and a few unhandled controls. Keep them visible, but clearly state what they can and cannot do.

## Readiness by test cohort

| Cohort | Recommendation | Conditions |
|---|---|---|
| Engineering development with synthetic fixtures | **Proceed** | No production database or provider credentials; keep audit probes/test artifacts in the audit lane; every money expected value independently calculated. |
| Internal product/accounting review with disposable workspace | **Conditional / test-only** | Isolated Supabase/PostgreSQL project; migrations applied from a clean baseline; seed synthetic English/Hebrew, multi-currency and role fixtures; no import of production/customer data; known BUGs disclosed; provider test credentials only. |
| External testers with synthetic data | **Hold pending gates** | First complete focused bug regression, real Postgres/RLS tests, core browser journeys, restore drill, TLS/CSP configuration validation and visible feature-status/help. Use provider sandboxes, not live payment or bank accounts. |
| Any tester with real books, live payment/bank activity or tax filing | **No-go at this revision** | Financial validation/reporting/statement/retry/restore issues and environment-boundary checks remain open. A successful build or unit suite cannot replace those gates. |

## Blockers before inviting a real-record pilot

| Gate | Current evidence | Required exit evidence |
|---|---|---|
| Financial answers | BUG-01 reversal totals reproduced; BUG-02 old report data can remain under a new period; BUG-04 statement screen/PDF/email scope differs; BUG-07 FX line validator accepts a one-cent converted imbalance; AUD-19 Altman reversal signs reproduced | Focused tests with independently worked amounts; correct current-period, comparative and all export paths; finance owner approves FX rounding/clearing policy; no stale scope; analytical warnings are appropriately cautious. |
| Posting retry/concurrency | BUG-03 reproduced with stale client cache: new transaction IDs and idempotency keys are generated for the same invoice. Durable DB outcome not tested. | Against PostgreSQL, prove one durable invoice journal for lost-response retry, two tabs, concurrent saves, changed payload and repeated operation ID. Include exact entity revision and idempotency semantics. |
| Cache/workspace isolation | BUG-05 duplicate IDs reproduced in client store on repeated success; cross-workspace late response remains a source risk. | Browser tests: request completes after switching workspace/user; no stale rows/totals appear. Realtime-before-response and idempotent replay upsert canonical records once. |
| Restore/recovery | Restore rejects unbalanced entries before writes; ownership prechecks and delete snapshot remain outside the commit transaction (AUD-02). | Real DB restore drill on a disposable workspace; malformed ledger/doc/relation refused with zero writes; interleave foreign-ID create, new posting, close and restore; re-export and reconcile reports/stock. Back up immediately before restore. |
| PostgreSQL/RLS/migrations | No PostgreSQL, `psql`, Docker or `LF_TEST_DATABASE_URL` in the audit sandbox. | Run the full configured DB suite and RLS suite against a fresh disposable DB; record migration version/checksum and verify required migrations actually applied. Repeat with wrong workspace, viewer, nonmember and foreign account. |
| Browser workflow | No Chromium/Playwright browser installed; no browser tests were executed. Static UI map is not a runtime test. | Automated/browser review for onboarding, invoice → journal, payment, import, reconcile, report/export, close and backup/restore; console/network failure checks; keyboard, narrow viewport, RTL/Hebrew and workspace switch. |
| Remote database TLS / SSRF | AUD-20 config function uses `rejectUnauthorized:false` without CA; AUD-11 DNS check is not connection-pinned. No real connection or exploit was attempted. | Production requires verified DB server identity; test valid CA/hostname success and wrong/missing CA failures. Add deterministic no-internal-network DNS rebinding tests or use reviewed outbound proxy/allowlist. |
| Deployment CSP/config | Vercel CSP host is hard-coded while client/server Supabase hosts are configurable (AUD-12). | Deploy a staging build with its actual Supabase project and inspect the effective combined CSP for API/static responses; sign-in, read, write and realtime tests pass. |
| Authentication UI | AUD-13 stale async admin-claim state can land after an identity change; no server privilege escalation demonstrated. | Browser race: pending old-user token → sign-out → viewer sign-in → old result resolves; no privileged UI/cache remains; server still refuses the request. |
| Scheduled communication | AUD-04 writes sent marker before mail; AUD-05 standalone job set differs from Vercel. No provider email or concurrent schedule was run. | Test provider sandbox with crash-before-send, timeout-after-accept, partial recipient failure, concurrent cron invocation and retry. Verify outbox/claim and one shared job/deployment contract; distinguish queued, sent, failed. |
| Tax/jurisdiction claims | Tax helpers and limited golden fixtures exist; some C-115…C-126 libraries have no screen caller; no filing/provider/authority workflow was exercised. | Publish an explicit supported jurisdiction/period matrix; test dated rates, entity profiles, inclusive/exclusive tax, withholding and report export on full synthetic periods. Label every calculation-only, preview, placeholder and unsupported jurisdiction. No e-filing claim without an end-to-end authority acceptance. |
| UI controls and unfinished features | BUG-06: 10 enabled no-handler button declarations and a miswired close affordance; 3,440 JSX declarations are static. | Focused browser/keyboard checks; wire to existing paths or visibly label incomplete; no silent/hide/disable cleanup. Verify failure/slow/switch cases for every mutation control. |

## Safe synthetic test setup

1. Create a separate disposable Supabase/PostgreSQL project and a test-only auth tenant. Confirm credentials and project URL are not those used by production; do not copy production records.
2. Apply migrations from a clean baseline; record the applied migration version and run the DB/RLS suites. Do not assume checked-in SQL is deployed.
3. Use fictional names, addresses, bank accounts and tax identifiers; generate stable synthetic workspaces, chart accounts, invoices, bills, credits, payments and reversals. Never use real customer data “with names changed” if the rest of the record is identifiable.
4. Configure Stripe/Plaid/mail with provider sandbox credentials and test recipients only. If a provider sandbox is unavailable, leave the connector visible but label it unverified/not configured—do not substitute production credentials.
5. Take a synthetic backup before restore/interleaving tests; verify export checksum, restored record counts, ledger equality, stock quantities, report totals and a second export.
6. Capture exact build/revision, browser, DB version/migration state, feature flags, warnings, console/network errors and fixture expected values with every tester result.

## First-test journey order

Use disposable records and test providers only:

1. Create a workspace, configure a small chart and add opening balances; verify accounts, ownership and workspace switching.
2. Create a simple invoice and bill through the UI, inspect generated journal lines and independently recompute expected cents.
3. Apply a payment, credit and refund; retry after a simulated lost response; verify a single durable ledger effect and clear status.
4. Import the same synthetic bank statement twice, including records outside the normal client load cap; verify duplicate-source handling and pending-vs-posted state.
5. Reconcile imported lines with ledger transactions and verify a repeated match does not create a second posting.
6. Read P&L, balance sheet, trial balance, cash flow and a party statement. Change date/basis/workspace; simulate a failed request; check provenance, current period, opening balance, PDF and email parity.
7. Close a synthetic period, attempt a late post, take a backup and restore into a disposable workspace; verify refused writes and re-open/report/stock invariants.
8. Exercise one dunning/scheduled report email with a test provider; fail the send and retry; distinguish scheduled, queued, sent and failed.
9. For each visible unfinished feature, capture what exists and the remaining handoff; do not mark an unconnected preview as completed because a helper test passes.

## Tester-facing honesty requirements

- Keep unfinished, experimental and disconnected work discoverable in development/testing. Add an accurate “preview,” “calculation only,” “internal,” “not configured,” or “not yet connected” label where appropriate; do not hide it because it is incomplete.
- Only prevent execution where the actual operation could compromise security, correctness or stored data. In particular, do not run irreversible restore, live payment, external bank-link, external email or tax-filing actions against real records before their gates pass.
- Separate “saved,” “posted,” “queued,” “sent,” “approved,” “reconciled” and “filed.” A button click is not proof of any of them.
- Disclose that report limits/fallbacks may affect completeness; preserve the exact workspace, scope, date, basis, currency and source used for each number.
- Do not describe algorithm output as accounting advice or a certified solvency forecast. The Altman result is known to mis-handle reversal signs.

## Bottom line

**Proceed with synthetic internal QA; do not invite testers to trust this revision with real books.** Revisit the decision after the financial, retry, restore, PostgreSQL, browser, TLS/CSP and scheduler gates have current evidence. The source contains enough complete paths for valuable testing, but the missing boundaries are material to trust—not cosmetic polish.
