# TRACKER — finished items (moved 20 Oct 2026; nothing deleted)

- [x] Codex C-1: unused variables and parameters outside Claude's reserved files; ESLint warnings 2022 → 1805 (codex, PR #31; merged snapshot verified).
- [x] A-01 Remove 1-cent tolerance in trial balance
- [x] A-02 Remove 1-cent tolerance in balance sheet
- [x] A-03 FX rounding: by account role only, refuses without the account, tested
- [x] A-04 Property test: debits === credits exactly
- [x] A-05 `orphanedLines` surfaced in the UI
- [x] A-06 `isBalanced` shown on the balance sheet report
- [x] A-07 Duplicate orphan logic removed from `TruthEngine`
- [x] A-08 `anchorDay` required
- [x] A-09 Exhaustive `never` check on frequency
- [x] A-10 `allowedWorldPaths` protected
- [x] A-11 `billingLedgerChain` protected
- [x] A-12 `analyticalTopology` / `computeHardnessScore` protected
- [x] A-13 `schema-drift.test.ts` asserts protected fields
- [x] A-14 Subscriptions and `WORKSPACE_SCOPED_COLLECTIONS` kept in sync by the guard test (both directions)
- [x] A-15 Test: subscription list === the constant (both directions)
- [x] A-16 UTC date extractions: none left except the allowed fallback in `utils.ts` (5e4dfa9). Server "today" is still UTC, not the workspace's time zone (note for later)
- [x] A-17 `server.ts` (0, was 8)
- [x] A-18 `fiscalCalendar.ts` (0, was 5)
- [x] A-19 `workspaceRoutes.ts` (0, was 4)
- [x] A-20 `recurringEngine.ts` (0, was 4)
- [x] A-21 `transactionRoutes.ts` (0, was 3)
- [x] A-22 PurchaseOrdersView / BackupExportSettings / ToolSandbox / FixedAssetsView (all 0)
- [x] A-23 paymentTerms · depreciationEngine · estimateConverter · creditNoteEngine (all 0)
- [x] A-24 Timezone-safety test
- [x] B-01 `npm audit`: 0 (Firebase tools removed with the move to Supabase)
- [x] B-02 `csv-parse` prototype replacement
- [x] B-03 `stream-json` DoS
- [x] B-04 `qs` array-limit bypass
- [x] B-05 `@opentelemetry/core` memory (gone with firebase-tools)
- [x] B-06 `firebase-tools` / `@google-cloud/pubsub` (removed)
- [x] B-07 `esbuild` (bumped to 0.28.2)
- [x] B-08 `npm audit` step configured in CI
- [x] B-09 `rel="noopener noreferrer"` present on all three links
- [x] B-10 `uncaughtException` handler
- [x] B-11 zod — consolidationRoutes
- [x] B-12 zod — documentRoutes
- [x] B-13 zod — inventoryRoutes
- [x] B-14 zod — invoiceEmailRoutes
- [x] B-15 zod — leaseRoutes
- [x] B-16 zod — revenueRoutes
- [x] B-17 zod — supportRoutes
- [x] B-18 `validation-guard` scans route files
- [x] C-01 `transactionRoutes:1087` transactions scan
- [x] C-02 `transactionRoutes:1046` chartAccounts scan
- [x] C-03 `transactionRoutes:1213` chartAccounts scan
- [x] C-04 `transactionRoutes:1336` chartAccounts scan
- [x] C-05 `transactionRoutes:1749` chartAccounts scan
- [x] C-06 `transactionRoutes:1750` chartAccounts scan
- [x] C-07 `documentRoutes:55` invoices scan
- [x] C-08 `documentRoutes:56` bills scan
- [x] C-09 `documentRoutes:57` payments scan
- [x] C-10 `workspaceRoutes:267` invites scan
- [x] C-11 `server.ts` auditLogs scan
- [x] C-12 `server.ts` jobRuns scan
- [x] C-13 Guard against unbounded scans
- [x] C-14 Screens ask for their data (`useLedgerCollections`); core data at workspace open, the rest on first use, kept live; guard test
- [x] C-16 Reference lists (templates, partners, patterns, dimensions) read once; tax rates and rules live but fetched incrementally
- [x] C-17 Dev-only document-read counter — **done 10 Oct (Claude)**: the old Firestore counter was gone with Firestore; now every list and document read in the browser (`fetchRows`, `getDoc` in `src/lib/db/firestore.ts`) counts its rows per table, shown in Settings → Developer when the developer switch is on, with "Start again" (`src/lib/db/readCounter.ts`, `ReadCounterPanel.tsx`; tests `read-counter.test.tsx`).
- [x] C-18 Sharded counter service
- [x] C-20 Seed 200k transactions, record load time + reads — **done 7 Oct**: `scripts/load-test.ts` seeds a workspace with 200,000 entries in a local database and measures the app's paged query for the newest 20,000, their size, the browser's report maths on them, and the balances worked out by the database; results in `docs/perf.md`. Found on the way: long lists were read 1,000 rows a request one after another (20 round trips for 20,000 entries); now the first page alone, then four at a time, with the id as the last sort key so rows with the same date never move between pages (`fetchRows` in `src/lib/db/firestore.ts`; tests `paged-reads.test.ts`)
- [x] D-01 `computeReports.ts` (0 `any`)
- [x] D-02 `LedgerPostService.ts` (18 → 0)
- [x] D-03 `useTransactionActions.ts` (codex, `codex/c-5-explicit-types`)
- [x] D-04 `useLedgerStore.ts` (codex, `codex/c-5-explicit-types`)
- [x] D-05 `useLedgerData.ts` (0 `any`)
- [x] D-06 `server.ts` and the route files split from it (0 `any`; Stripe webhook objects typed)
- [x] D-07 `transactionRoutes.ts` (92 → 0 `any`; typed caller, `HttpError`, database types)
- [x] D-08 `reportRoutes.ts` (23 → 0; found L-139, L-140)
- [x] D-09 `workspaceRoutes.ts` (0 `any`; found L-138)
- [x] D-10 `documentRoutes.ts` (0 `any`, one lookup instead of the if/else chain; found L-137)
- [x] D-11 `TransactionQueryEngine.ts` (codex, `codex/c-5-explicit-types`)
- [x] D-12 `algorithms/niche-tools.ts` (codex, `codex/c-5-explicit-types`)
- [x] D-13 `algorithms.ts` (0 `any`; two unused engines removed, 180 lines)
- [x] D-14 `IntelligenceCenter.tsx` (codex, `codex/c-5-explicit-types`)
- [x] D-15 `SystemCommandCenter.tsx` (codex, `codex/d-15-command-center-types`; owner-authorized follow-up)
- [x] D-16 `ApiHub.tsx` (0 `any`; found L-144; billing data it loaded and threw away no longer loaded)
- [x] D-17 `StatementImporter.tsx` (codex, `codex/c-5-explicit-types`)
- [x] D-18 `TransactionGrid.tsx` (codex, `codex/c-5-explicit-types`)
- [x] D-19 `BudgetManager.tsx` (codex, `codex/c-5-explicit-types`)
- [x] D-20 `useUIStore.ts` (0 `any`; display choices from storage checked against the allowed values; found L-143)
- [x] D-21 `ToolSandbox.tsx` (codex, `codex/c-5-explicit-types`)
- [x] D-22 `registry.tsx` (codex, `codex/c-5-explicit-types`)
- [x] D-23 `Ledger.tsx` (0 `any`)
- [x] D-24 `Reconciliation.tsx` / `App.tsx` (0 `any`)
- [x] D-25 `noImplicitAny`: on (part of `strict: true` in tsconfig.json)
- [x] E-01 Lint script — type check and ESLint are separate CI steps now
- [x] E-02 Eligible inputs named and labels linked, including the 46 remaining layouts and fields missed by lint (codex, branch `codex/c-3-accessible-form-labels`, PR pending)
- [x] E-03 Eligible selects linked to labels or given accessible names (codex, branch `codex/c-3-accessible-form-labels`, PR pending)
- [x] E-04 Icon-only buttons and switches named (lint rule now clean)
- [x] E-05 Every table names itself with a caption (43 added, 56 tables; guard test)
- [x] E-06 Both images have alt text (receipt viewer, document vault)
- [x] E-07 Eligible labels use matching htmlFor/id; per-instance IDs verified in Chromium; label-has-associated-control 185 → 46 → 0 (codex, branch `codex/c-3-accessible-form-labels`, PR pending)
- [x] E-08 InvoiceModal — dialog role + name, focus in, Tab kept inside, Escape (asks before discarding), focus returned; axe 0 (browser test)
- [x] E-09 BillModal — same; title says "Edit bill …" when editing; axe 0 (browser test)
- [x] E-10 ReceivePaymentModal — same (useDialog; component test still passes)
- [x] E-11 CustomerModal — same; close button had no name; axe 0 (browser test)
- [x] E-12 VendorModal — same; close button had no name; axe 0 (browser test)
- [x] E-13 TransactionEditModal — same; heading levels fixed
- [x] E-14 JournalEntryModal — its label pointed at an id that did not exist; now named by its title, focus kept inside
- [x] E-15 PurchaseOrder editor — new order + goods received dialogs: focus, Tab, Escape
- [x] E-16 Estimate editor — inline form; axe 0 (browser test)
- [x] E-17 CreditNote editor — dialog role + name, Escape; axe 0 (browser test)
- [x] E-18 Item editor — item and cost-of-sale dialogs in Inventory
- [x] E-19 Payment run — no payment-run screen exists yet (K-24, later); new dialogs get the same behaviour from `useDialog`, and a ratchet counts overlays without a dialog role (40, only goes down)
- [x] E-20 WriteOffModal — same as the other money dialogs
- [x] E-21 `scope` on every header cell (221 added; guard test)
- [x] E-22 Visible focus ring on every keyboard-focused control (index.css; browser test)
- [x] E-23 Keyboard-only invoicing (browser test); native buttons on report rows, grid headers and reconciliation controls; independent filter/Tab behavior (codex, `codex/c-4-keyboard-controls`)
- [x] E-24 Screen-reader pass: axe finds nothing on any of the 33 screens (landmarks: sidebar navigation, status bar, cookie notice; no nested main; named chart slices), checked on every screen by e2e/layout.spec.ts; with captions, scopes, one h1 per screen and dialogs (E-05, E-21, E-30, C-11)
- [x] E-25 `aria-live` for async results — save/fail messages go to the toast live region, loading/failed lines use `role="status"`, field errors `role="alert"`; buttons that wait say so (`aria-busy`)
- [x] E-26 Colour not the only +/− signal — transaction list, pivot sheet and owner overview show "+" / "−" with the colour (`formatSignedAmount`, tested); found L-145
- [x] E-27 Contrast in both themes: axe color-contrast on 6 screens × 2 themes with a baseline (0–4 left per screen)
- [x] E-28 Reduced motion: animations follow the system setting (`MotionConfig reducedMotion="user"` + CSS)
- [x] E-29 Skip-to-content link, first Tab stop (browser test)
- [x] E-30 Headings: one h1 per screen (was the sidebar logo on every screen; 7 screens had none), no skipped levels; checked on all 33 screens by the layout browser test
- [x] F-01 Split `server.ts`: 5,383 → 188 lines. Start-up settings, allowed origins, security headers, rate limits, request log and the long-running server live in `src/server/config` and `src/server/http`; every route in `src/server/routes` (same order: checked by comparing the live route table, 108 entries)
- [x] F-02 Lint rule blocking new routes in `server.ts`
- [x] F-03 `ApiHub.tsx` (3,147)
- [x] F-04 `algorithms.ts` (codex, PR #38; six implementation modules below 800 lines)
- [x] F-05 `useTransactionActions.ts` 2,032 → 68 lines: the actions live in `src/hooks/transactionActions/` (shared context, posting helpers, rules, entries, import, workspace, reconcile, integrity); same names and order returned
- [x] F-06 `transactionRoutes.ts` 1,833 → 24 lines: the routes live in `src/server/routes/transactions/` (one-entry, bulk, reconciliation, period, reversal; same order and middleware, checked against the live router)
- [x] F-07 `SystemCommandCenter.tsx` (1,783)
- [x] F-08 `TransactionGrid.tsx` (1,637)
- [x] F-09 `IntelligenceCenter.tsx`
- [x] F-10 `types.ts` split by domain: `src/model/` ledger, documents, workspace, operations; `src/types.ts` re-exports them, so `import ... from "../types"` is unchanged
- [x] F-11 `LedgerPostService.ts` 1,097 → 27 lines: one file per document type in `src/services/ledgerPost/` (invoice, bill, credits, payment, delete) plus `postingKit.ts` (lookups, lock check, the one server call); `LedgerPostService.*` names unchanged
- [x] F-12 `Reconciliation.tsx`
- [x] F-13 `BalanceSheetView.tsx` — report rendering extracted into `BalanceSheetReport.tsx`; calculations and controller statements preserved (Codex)
- [x] F-14 `TransactionEditModal.tsx` — controller and sibling view; save/reversal/locking callbacks and JSX preserved (Codex)
- [x] F-15 `QBOMigrationWizard.tsx` — migration controller and sibling view; parsing/mapping/commit logic and JSX preserved (Codex)
- [x] F-16 `Inventory.tsx` (798 → 629 lines: item form, stock dialogs, category manager and record-a-sale dialog in their own files)
- [x] F-17 `RulesSettings.tsx` — rules controller and sibling view; rule saving/testing/applying callbacks and JSX preserved (Codex)
- [x] F-18 `PivotSheet.tsx` — pivot controller and sibling view; grouping/matrix calculations and JSX preserved (Codex)
- [x] F-19 `businessTemplates.ts` — three sibling template data modules; all 23 definitions/order and public exports preserved (Codex)
- [x] F-20 `Projects.tsx` — projects controller and sibling view; mutations, project calculations and JSX preserved (Codex)
- [x] F-21 800-line limit — no `max-lines` warnings and filesOver800 0; no baseline raised (Codex)
- [x] F-22 Shared report shell: period presets, compare, permalink and print on the Reports page (Prompt R); one table layout with sticky header and totals (`PartyReportLayout`); one CSV writer for every export (`src/lib/csvExport.ts`, 15 screens moved, guard test)
- [x] G-01 StatementImporter (4) (codex, PR #32; merged snapshot verified)
- [x] G-02 TransactionRow (3) — the money grid (codex, PR #32; merged snapshot verified)
- [x] G-03 PurchaseOrdersView (3) (no index keys left)
- [x] G-04 ToolSandbox (3) (codex, PR #32; merged snapshot verified)
- [x] G-05 QBOMigrationWizard (3) (codex, PR #32; merged snapshot verified)
- [x] G-06 TransactionEditModal (2) (codex, PR #32; merged snapshot verified)
- [x] G-07 HelpGuideView (2) (codex, PR #32; merged snapshot verified)
- [x] G-08 ForensicAuditor (2) (codex, PR #32; merged snapshot verified)
- [x] G-09 RulesSettings (2) (codex, PR #32; merged snapshot verified)
- [x] G-10 CashFlowPredictor (2) (codex, PR #32; merged snapshot verified)
- [x] G-11 ProjectProfitabilityView (2) (codex, PR #32; merged snapshot verified)
- [x] G-12 IntelligenceCenter / AICustomBlueprint / AICommandCenter / Dashboard (codex, PR #32; merged snapshot verified)
- [x] G-13 Remaining single-occurrence files (codex, PR #32) + `BillModal`, `InvoiceModal` and 3 step/dot lists (Claude); ratchet `arrayIndexKeys` 0
- [x] G-14 `react/no-array-index-key` rule (plugin installed, ESLint passes)
- [x] G-15 Error boundary per view (`MainViewSwitcher`, `key={activeTab}`)
- [x] G-16 Recovery action on the boundary
- [x] H-01 InvoiceModal (component test: totals, tax on top/included, edit keeps number + memo, no customer no save)
- [x] H-02 BillModal (component test: tax included/excluded, approval limit, edit keeps number)
- [x] H-03 ReceivePaymentModal (component test: open documents only, oldest first, amounts sent, refusal)
- [x] H-04 WriteOffModal (component test: amount still owed, bad debt account, refusal)
- [x] H-05 CustomerDetailView (party-detail-views.test.tsx; found L-162)
- [x] H-06 VendorDetailView (party-detail-views.test.tsx)
- [x] H-07 TaxLiabilityView (tax-liability-view.test.tsx: boxes, who can file, the request, changes since filing)
- [x] H-08 StatementView (statement-view.test.tsx, statement-credits.test.ts; found L-160)
- [x] H-09 ARAgingReportView (aging-views.test.tsx; found L-159)
- [x] H-10 APAgingReportView (aging-views.test.tsx)
- [x] H-11 ExpenseByCategoryReportView (report-views.test.tsx)
- [x] H-12 IncomeBySourceReportView (report-views.test.tsx; found L-158)
- [x] H-13 AverageMonthlyReportView (report-views.test.tsx)
- [x] H-14 TopExpensesIncomeReportView (report-views.test.tsx)
- [x] H-15 TagBreakdownReportView (report-views.test.tsx)
- [x] H-16 ForensicAuditor (forensic-checks.test.ts; found L-164)
- [x] H-17 TanStackDataGrid (ui-primitives.test.tsx; sort headers are buttons now)
- [x] H-18 RadixModal — no longer exists (dialogs use useDialog, tested)
- [x] H-19 RequireRole (ui-primitives.test.tsx; found L-161)
- [x] H-20 AsyncButton (ui-primitives.test.tsx; found L-161)
- [x] H-21 ConfirmButton (ui-primitives.test.tsx)
- [x] H-22 EmptyState (ui-primitives.test.tsx)
- [x] H-23 PublicInvoicePage (public-invoice-page.test.tsx; loading/error states readable by screen readers)
- [x] H-24 EstimatesView (estimate-conversion.test.ts; found L-163)
- [x] H-25 CustomerModal (customer-modal.test.tsx; names and emails are trimmed, blank names refused)
- [x] H-26 AuditLogViewer (audit-log-viewer.test.tsx, codex)
- [x] H-27 `src/components/finance` (account register, payments list; found L-165)
- [x] H-28 `src/hooks` (hooks.test.tsx renders the hooks: ledger totals, reports, role, timers, shortcuts; found L-166)
- [x] H-29 `src/stores` (stores-workspace.test.ts: totals, workspace switch, saved views, data loading, record links; found L-167)
- [x] H-30 Property tests (added) + `test:cov` gate: covers every test file and runs in CI instead of plain `npm test`; fails below 75% lines / 72% branches / 73% functions (measured 76.4 / 72.9–73.0 / 73.6); raise as tests are added
- [x] I-01 Loading state: data status line + "Loading…" on the money lists (guard test)
- [x] I-02 Failed loads shown with "Try again" (data status line); render errors already have the view boundary with retry
- [x] I-03 Empty states: the list screens have one (Projects and Audit trail added, with loading first; the rest already had them)
- [x] I-04 `<ViewShell>` wrapper — done another way: one data status line above every screen (loading / failed with "Try again" / cut at limit), an error boundary per screen with a recovery action, and a guard test that screens ask for their data and show "Loading…" (I-01 I-02 I-05)
- [x] I-05 Guard test: a screen with an empty state that loads data on demand must show loading
- [x] I-06 Optimistic updates with rollback — transaction edits show at once and roll back on failure (verified); other saves wait for the server and the live lists update, so nothing is shown that was not saved
- [x] I-07 Unsaved-changes warning in the invoice and bill dialogs (tested)
- [x] I-08 Void/delete confirmations name the record (Sales, Purchases)
- [x] I-09 30-second undo — "Undo" stays 30 seconds after adding or voiding a transaction, and says whether it worked (a failed undo was silent before)
- [x] I-10 Discoverable keyboard shortcuts — one list (`src/config/shortcuts.ts`) feeds the keys and the card (press ?, or "Keyboard shortcuts" in the command palette); Ctrl/⌘ shown per platform; keys the browser keeps freed: Quick entry ⌘Q → ⌘⇧E (⌘Q quits the browser on a Mac), Focus mode ⌘F → ⌘⇧F (find works again), Reports ⌘P → ⌘4 (print works again); tested C-14 also lists the existing focused-screen/grid/editor/tag/dialog handlers in the question-mark overlay (screenShortcuts.ts); component test.
- [x] I-11 Tabular figures everywhere — table cells, fields and mono text use tabular figures app-wide (one CSS rule; browser test)
- [x] I-12 Dates follow the user's chosen format (formatDate; Preferences); tested
- [x] I-13 Persist column layout per user — the transaction list's Columns menu now really hides account, project, class, location, running balance or status, remembered per person on this device (browser test); it changed nothing before (L-148) C-14 adds per-user widths/order with sanitized storage, reset and responsive alignment; persistence/user-switch/corrupt-storage tests and Chromium header/row geometry check.
- [x] I-14 Sticky headers + totals row — report tables (shared report layout, data grid) scroll in their box with the header kept in view (full length when printed); balance summaries have a totals row over the rows shown (component test) C-14 adds a sticky transaction totals row using the existing filtered stats, with a component test. Invoice and bill lists (Claude, 5 Oct): the header and a totals row (count, total, still due; one line per currency; drafts and voided not counted) stay in view while the list scrolls (tested).
- [x] I-15 Inline row editing — description, account and amount can be changed in the transaction list; changing the amount now resizes both lines of a simple entry (L-147); split entries open the dialog
- [x] I-16 Breadcrumb on drill-down — the account drill-down from P&L, Balance Sheet, Reports and the pivot sheet shows "Report › Account" and goes back from it; it is a proper dialog now (component test)
- [x] I-17 Shareable links: report settings and the transaction list (search + date range) live in the address; opening the link restores them (tested)
- [x] I-18 Print stylesheet (Reports page)
- [x] I-19 Active filters as chips — the transaction list shows each active filter as a chip with a remove button and "Clear All"; the command palette's search now shows there too (L-143) C-14 chips remove individual multi-select values, retain zero-amount filters and clear local/page search independently; Hebrew/zero/empty-filter component tests.
- [x] I-20 "What changed since I last looked" — the Overview opens with "Since your last visit (date): 3 new transactions · 1 invoice paid…" per person and workspace on this device (tested)
- [x] I-21 **Owner request (5 Oct): pin pages.** Done: pin button in the top bar (Alt+P), pinned pages as buttons under the top bar on every page with their report/settings tab, Alt+1 … Alt+9 (also on Mac keyboards, where Alt shortcuts never worked before), kept on the device (tested). A pin button on every page; pinned pages stay as buttons on every other page; keyboard shortcuts to jump to them (zero friction)
- [x] J-01 Customer Balance Summary (as-of date, tested)
- [x] J-02 Vendor Balance Summary (as-of date, tested)
- [x] J-03 Contact Balance Summary (customers and vendors on one list, a business that is both on one row by email or name, net; tested)
- [x] J-04 Transactions by Customer (drafts skipped, FX, credits, date range, tested)
- [x] J-05 Transactions by Vendor (drafts skipped, FX, credits, date range, tested)
- [x] J-06 Transactions by Reference (entry reference, else the invoice/bill number; reversals marked; natural order; tested)
- [x] J-07 Sales by Item: issued invoices, base currency, posted or estimated cost, tested
- [x] J-08 Purchases by Item — **done 9 Oct (Claude)**, with bills that buy stock: a bill line can name a stock item and its units (Stock item, Units on the bill). Such a line posts to the Inventory account, and the bill's entry carries its item lines (`metadata.stockIn`: item, units, the value the line posted, its exact share as the ledger books it); the server raises the stock and the item's weighted average cost in the same transaction and records the purchase in the stock history with its bill; editing the bill takes the old units out before the new ones come in, voiding it takes them out (`src/lib/billStock.ts`, `billPosting.ts`, `cogsStockService.ts`). Reports → Inventory Item Details shows "Bought in the period" per item (units, cost, per unit), from bills and from Inventory purchases (`purchasesByItem`). Tests `bill-stock.test.ts` (the app's own bill posting against the real server), `bill-stock-ui.test.tsx`, `inventory-details.test.tsx`. Unblocks BA-03 (landed cost). A purchase order line can be a stock item too (its name and cost fill in), and the bill made from the order brings in the units received, or ordered when none came yet (`billLinesFromOrder`; tests `purchase-orders.test.ts`, `purchase-orders-inline.test.tsx`).
- [x] J-09 Inventory Valuation Sheet (stock at cost, share, reorder flags, compared with the Inventory account in the books; tested)
- [x] J-10 Inventory Item Details — **done 9 Oct (Claude)**, on the stock-moves ledger (W-02), which records every change (sales, purchases on Inventory, returns, adjustments, counts, deliveries, transfers): Reports → Inventory Item Details: for a period, each item's opening quantity and value, every movement in order with its entry, what came in and went out, and the closing quantity and value, read by the server from the full history (`itemDetails` in `src/lib/stockMoves.ts`, `GET /api/v1/reports/inventory-details`, `InventoryDetailsReportView.tsx`; tests `inventory-details.test.tsx`). Stock bought on a bill is in it since J-08.
- [x] J-11 Sales Tax Liability Summary (Tax screen: tax by rate, collected and paid, in the home currency; adds up to the return boxes; tested)
- [x] J-12 Journal Sheet: isPostable + lineAmount, unbalanced list, tested
- [x] J-13 Budget vs Actual with drill-down (AI #2, `codex/c24-budget-actual`; existing general-ledger math, inclusive dates, monthly caps, full-history read and account-impact drill-down)
- [x] J-14 Deferred-revenue waterfall — **done 6 Oct**: Reports → Deferred Revenue Waterfall: each invoice spread over months (K-16) with what is earned in each month of the report period, earned by its end and still deferred after it, with totals; "Show: Expenses (bills)" gives the same for prepaid expenses (K-17). Read from the monthly entries (`src/lib/spreadWaterfall.ts`), so a voided share isn't counted; says so when the loaded ledger is incomplete. Tests: `spread-waterfall.test.tsx`; browser: in `e2e/everyday-reports.spec.ts`
- [x] K-01 Bulk import wizard (customers, vendors, items, accounts; undo; tested)
- [x] K-02 Items on invoice lines: pick by name/SKU, fills price + cost, free text unlinks, tested
- [x] K-03 Sale receipts — **done 6 Oct**: Sales → "Sale receipt" (writers) opens the invoice form in receipt mode: "Paid into" (Undeposited Funds first, so Make deposit takes it to the bank, or a bank account) and the method, one "Save receipt". It saves an issued invoice due on receipt, marked as a receipt ("Receipt" in the list, "SALES RECEIPT" on the PDF, no pay-now code), and records its payment at once through the server's payments (`src/services/receiptActions.ts`); if the payment is refused the invoice stays open and the message says to record it. Tests: `sale-receipt.test.tsx`
- [x] K-04 Sales orders — **done 6 Oct**: on Sales → Estimates a writer marks a quote "Order" when the customer says yes (with the customer's own reference, e.g. their PO number) or "Declined". An order is invoiced in one go or in parts: "Invoice" asks for all that is left, a percentage of the order, or an amount, shows what is already invoiced (with the invoice numbers) and the lines of the draft invoice first, and makes a draft invoice to review and send. Each part gives every order line its share in whole cents, so once everything is invoiced each line was invoiced exactly; a line invoiced whole keeps its quantity and price. What is invoiced is read from the invoices made from the order (voided ones don't count, so voiding one reopens the rest); the order is closed when nothing is left. The list filters All · Quotes · Orders to invoice · Invoiced or closed, and an order's PDF is titled SALES ORDER with the customer's reference. No database change (`src/lib/salesOrders.ts`; tests `sales-orders.test.tsx`)
- [x] K-05 Manual journals entity — **done 6 Oct**: Ledger → General journal is now a working list: entries typed in by hand only (or all), newest first, search by description/reference/account, each opens to its debit/credit lines, badges for "a reversal", "reversed" and "reverses on …". Writers can Reverse a manual entry on a chosen day with a reason (the server's reverse route: a mirror entry, never twice) or Duplicate it into the journal form with the same lines. The old "Cryptographic Log / Full Audit" buttons, which claimed a verification that never ran, are gone. Tests: `journal-view.test.tsx`
- [x] K-06 Bulk action bar: transaction list (categorize safely, Enter/Apply, accounts used most first; L-180); invoice and bill lists: tick several, then download the PDFs as a zip, email the invoices to their customers (drafts and voided ones left out, each failure named), or pay them in full at once ("Record payment" / "Pay bills": one payment per customer or vendor into or out of the chosen bank account; drafts, paid and other-currency documents left out with the reason; a refused payment doesn't stop the others; not for viewers) (tested)
- [x] K-07 Attachments — **done 6 Oct** for invoices, bills, customers and vendors: a "Files" panel on the record (in the invoice and bill forms, and on the customer and vendor pages) lists its files (newest first, size, date), downloads them, attaches more (writers; up to 700 KB each, as the Vault; a file that doesn't fit is refused with the reason and nothing else is held up) and removes them. Files picked while writing a new invoice or bill are kept with it once it is saved. They are stored like the Vault's (the `documents` table, linked to the record), so they show in the Vault too. Removing goes through the server (`DELETE /api/v1/workspaces/:id/attachments/:fileId`): owners, accountants and bookkeepers any file, others only their own, never another workspace's, with an audit line naming the file and the record. Fixed on the way: the invoice and bill forms' old "Attachments" box said "2 file(s) attached" and saved nothing; the Vault said "uploaded" even when the database refused the file. (`src/lib/attachments.ts`, `src/components/common/AttachmentsPanel.tsx`; tests `attachments.test.ts` with the database, `attachments-ui.test.tsx`.) Estimates, purchase orders and bank lines can use the same panel next
- [x] K-08 Email templates (invoice, reminder, receipt; preview)
- [x] K-09 Credit note refunds (DR A/R, CR cash; tested)
- [x] K-10 Vendor credit refunds (DR cash, CR A/P; tested)
- [x] K-11 Payment links: emailed link → pay online → payment recorded, invoice paid, team notified (tested; needs Stripe keys live)
- [x] K-12 Item categories: filter chips on Inventory, existing categories suggested in the item form (renaming a category across items: BA-05)
- [x] K-13 Inventory adjustments: Adjust stock per item (correction, stock received with average cost, opening stock), posted at cost with the quantity in one database transaction (tested)
- [x] K-14 Account groups — **done 7 Oct** (AI #3): an account can sit inside a parent account of the same type. On the chart of accounts each row has "Inside" (edit in place, the shared `InlineEdit` as a select): the list offers only the parents that account may have, and taking it back to "No parent (top level)" saves no parent; the new-account form offers the same list and now really saves the parent it collected. The rules — same type, never a loop, at most three levels, and a parent that is in this chart — are refused with their reason before anything is written (`accountParentProblem`, `allowedParentAccounts` in `src/lib/accountGroups.ts`). The P&L, the balance sheet, the trial balance and the shared statement-columns table show a group's accounts indented under their parent with a "Total <parent>" subtotal, and the chevron closes the group (the reports start open, the chart of accounts starts closed as before). A subtotal is only the accounts inside it added up, so no section total, no report figure, no export total and no posted amount moves; the statement CSV carries the subtotals it shows. A saved link that cannot be used — a parent that is gone or archived out of the list, a loop from an import, a fourth level — never hides an account: it is shown at the top level instead, and nothing walks a loop. No database change (`parentId` was already an allowed field on `chartAccounts`). Tests: `account-groups.test.ts` (23 hand-checked cases: the tree and its depths, subtotals that add back to the section total, a loop cut, a missing parent, a loop / another type / a fourth level refused, the statement rows and their figures and CSV), `account-groups-ui.test.tsx` (10 DOM cases: choosing and un-choosing a parent in place as a writer, a viewer who only reads, and the subtotal, the indent and the collapse on the trial balance, the balance sheet and the P&L with each report's own total unchanged)
- [x] K-15 Tags as an entity — **done 6 Oct**: Settings → Tags lists every tag used in the workspace with where ("2 customers · 1 invoices · 1 entries"), counting "VIP" and "vip" as one (as the tag filters do). Owners, accountants and bookkeepers rename a tag everywhere at once (customers, vendors, projects, invoices, bills, credits, entries, journal entries), merge two by renaming one to the other's name (the screen says "Merge into …"), or remove a tag from every record; only the tags change, never amounts or postings; batches of 300 records per database transaction, so a repeat finishes anything interrupted; audited; another workspace is never touched. No database change (`src/server/services/tagService.ts`, `GET/POST /api/v1/workspaces/:id/tags`; tests `tags.test.ts` with the database, `tags-ui.test.tsx`)
- [x] K-16 Revenue recognition schedules — **done 6 Oct**: the invoice list has "Spread" on a posted invoice (writers): income account (the biggest income line, lines without an account counting for the default one; tax is not income), Deferred Revenue account (Settings → Defaults, else a liability named "deferred/unearned revenue"; never invented), 2–60 months from the invoice's month or later, with the monthly share shown first. The server (the same service as K-17, `prepaidService.ts`) posts in one database transaction the move to Deferred Revenue on the invoice date and one share earned at each month end (whole cents, remainder last), records the schedule on the invoice (spread once) and audits it. The list shows the progress with "Undo spread" (voids the schedule; refused once one of its months is closed); Void undoes the spread first. Entries are tagged `spreadOfInvoiceId`, so editing the invoice re-posts only its own entry, and un-posting a spread invoice elsewhere is refused until the spread is undone. Tests: `revenue-spread.test.ts` (database, through the real workspace routes), `revenue-spread-ui.test.tsx`
- [x] K-17 Prepaids + auto-reversing accruals — **done 5 Oct**: accruals that reverse themselves are R-05. Prepaids: a posted bill has "Spread" in the bills list (writers): amount (the biggest expense line, in the home currency), expense account, Prepaid Expenses account (Settings → Defaults, else an asset named "prepaid"; never invented), 2–60 months from the bill's month or later, with the monthly share shown first. The server posts, in one database transaction, the move to Prepaid on the bill date and one share back to the expense at each month end (whole cents, the remainder last; marked `scheduled` so the future-date check doesn't flag them), records the schedule on the bill (spread once), and audits it. The list shows "Spread over 12 months from Sep 2026 · 2 of 12 taken" with "Undo spread" (voids every entry of it; refused once one of its months is closed); voiding the bill undoes the spread first. The bill's own posting is not touched: the spread's entries are tagged `spreadOfBillId` (not `billId`), so editing the bill re-posts only its own entry, and turning a spread bill back to draft or void from anywhere else is refused until the spread is undone. Tests: `prepaid-spread.test.ts` (database), `spread-bill.test.tsx`
- [x] K-18 Retainers — **done 5 Oct (with BE-12)**: money received before an invoice (a customer deposit) or paid before a bill waits in Customer Deposits / Vendor Prepayments (found by Settings mapping or name; without one it stays on A/R or A/P as before), and the customer or vendor page lists it as "Unapplied: $X" with "Apply to invoices/bills": the open ones in the same currency are filled oldest first, amounts can be changed, more than is left or open is refused, and `POST /api/v1/payments/:id/apply` settles them and moves the money to A/R or A/P in one database transaction (writers only, closed period refused, audited). Tests: `advance-payments.test.ts` (database), `unapplied-payments.test.tsx`
- [x] K-19 Bad debt with reversal (server, base currency, tested)
- [x] K-20 Undeposited funds (Make deposit; tested)
- [x] K-21 Expected-bill tracking: vendors that bill on a rhythm (weekly to quarterly, at least 3 regular bills) are learned from the bills already recorded; Purchases shows "Expected bills" (usual amount or range, how often, expected by / days late) with "Record bill" (the latest bill's lines copied, new dates) and "Not expected"; vendors on a recurring bill schedule are left out (tested)
- [x] K-22 Expense claims — **done 6 Oct**: Purchases → "New expense claim" (anyone who can write): who paid, the date, one line per expense (what, category from the chart, amount), a note. It is saved as a draft bill owed to that person (a vendor of type "employee", added if new), so nothing is in the books yet. The Expense claims panel lists the waiting ones; owners and accountants Approve (it becomes an approved bill: posted, and paid like any bill or in a payment run with the person's bank details) or Reject with a reason (stays out of the books). Nobody approves their own claim except the owner. (`src/lib/expenseClaims.ts`; tests `expense-claims.test.tsx`.) Follow-up: the approval rule is checked on the screen; a database guard like the invoice approval one (L-191) needs a migration
- [x] K-23 Purchase requisitions — **done 6 Oct**, as purchase orders that wait: a bookkeeper's new purchase order is a request ("Send for approval": status pending approval); an owner or accountant Approves it (a normal order) or Declines it with a reason (cancelled, the reason in its notes); nobody approves their own request except the owner; nothing is received or billed while it waits. Uses the order's existing approval fields, so no database change (`src/lib/purchaseOrders.ts`; tests `purchase-requisitions.test.tsx`)
- [x] K-24 Payment runs + bank file — **done 6 Oct**: Purchases → "Payment run" (writers): every open bill due by a date (default a week ahead) ticked, untick any; one payment per vendor out of the chosen bank account on the chosen day (the same server payments as K-06 "Pay bills"; other-currency bills left out with the reason), and a bank file (CSV: payee, account name, account number/IBAN, routing/sort code/BIC, amount, currency, date, the bills it pays) downloaded with it or alone. Vendors keep their bank details on their page, edited in place: an IBAN must pass its check digits, spaces are taken out, viewers see only the last four; the run warns about vendors without details. (`src/lib/paymentRun.ts`; tests `payment-run.test.tsx`.) Bank-specific formats (NACHA, SEPA XML) can follow when someone needs one
- [x] K-25 Remittance advice: "Pay bills" can email each vendor what was paid, on which date, for which of their bills (new "Payment sent to a vendor" email, editable in Settings → Emails; logged; vendors without an address are skipped) (tested)
- [x] K-26 Dunning: reminders on chosen days after the due date, per-customer opt-out (tested)
- [x] K-27 Customer portal: on a customer's page, "Make a portal link" (bookkeepers and above; New link replaces it, Turn off ends it, each in the audit trail). At /c/<link> the customer sees their issued invoices only (no drafts, voids or invoices still waiting for approval; paid ones from the last 12 months), what is still due, and "View and pay" to each invoice's own page; no sign-in, the invoice pages' rate limit, the token written by the server only. Tests `customer-portal.test.ts`, `customer-portal-ui.test.tsx`
- [x] K-28 Scheduled reports: Settings → Scheduled reports: the profit and loss, balance sheet or receivables aging emailed by itself after each finished week (Monday to Sunday) or month, figures in the email and a CSV attached, to up to 10 addresses; each period sent once (recorded before sending, by the server only); "Send now" for owners and accountants; the database checks the schedule list (migration 20261011000000_scheduled_reports). Nothing is sent until email sending is set up (FOR_YOU item 7). Tests `scheduled-reports.test.ts`, `scheduled-reports-ui.test.tsx`
- [x] K-29 Exchange-rate history at posting — **done 6 Oct**, read from the documents themselves (no second copy that could disagree): `rateHistory` / `rateOn` in `src/lib/exchangeRates.ts` give, per currency, the rates the books were posted at by day. A back-dated invoice, bill, payment or journal entry now gets the rate used on (or the closest day before) its date, with a note saying which, instead of today's live rate (which would be wrong for a past day); with none recorded it asks for that day's rate. Reports → Exchange Rates Used lists them for the period (journals included), with lowest/highest/latest. Tests: `rate-history.test.tsx`; browser: `e2e/everyday-reports.spec.ts`
- [x] K-30 Loans with amortisation — **done 6 Oct (AI #3, A-2; ready for review on `arena/2f87acb1-ledgerflow`)**: Money Out → Loans holds a loan's lender, principal, rate a year, term, start date, liability account, interest-expense account and bank account. The schedule is worked out to the cent (the annuity payment rounded up, each month's interest rounded half up on the balance, the last payment taking the remainder, so the closing balance is exactly zero); "Record the money arriving" posts bank ← liability and "Record payment" posts liability + principal part, interest expense + interest, bank − the payment, both through the ordinary transaction route (owner/accountant/bookkeeper, closed periods refused), and every entry carries the loan's own reference so the ledger balance is shown beside the schedule. The screen never invents an account. New `loans` table in `supabase/migrations/20261009000000_loans.sql` (needs applying by the lead); `src/lib/loanSchedule.ts`, `src/lib/loans.ts`, `src/components/finance/LoansView.tsx`; tests `loans.test.ts` (hand-checked schedule + database posting cases) and `loans-view.test.tsx`
- [x] K-31 Petty cash — **done 6 Oct (AI #3, A-3; ready for review on `arena/65f21ba7-ledgerflow`)**: Money Out → Petty Cash. The box is one of the workspace's own cash-type accounts (no new table, no new collection); "cash in the box" is read straight from the posted lines on that account. "Spend from petty cash" (amount, category = an expense account, note, receipt number) posts expense ← box; "Top up from bank" posts box ← bank as a transfer; "Count the box" compares the cash counted with the book balance and posts the difference to a chosen over/short expense account (short debits it, over credits it, counting exactly right posts nothing). All three go through the ordinary transaction route (owner/accountant/bookkeeper, closed periods refused); the screen never invents an account. `src/lib/pettyCash.ts`, `src/components/finance/PettyCashView.tsx`; tests `petty-cash.test.ts` (hand-checked cents + database posting cases) and `petty-cash-view.test.tsx`
- [x] K-32 Notification preferences — done as S-19: each person chooses which notices they get (`src/lib/notifications.ts` `wantsNotification`, the bell's settings)
- [x] K-33 Categories management UI — **covered (10 Oct)**: an entry's category is its account, kept on Chart of Accounts (edited in place, grouped under parents, K-14); item categories have their own manager on Inventory (rename, merge or remove on every item at once, BA-05); vendor categories are edited in place on the vendor list (I-22).
- [x] K-34 Workspace switcher — **done 8 Oct (Claude, taken over from AI #5's E-1 to unblock V1)**: the sidebar's workspace name is a button that opens a list to type in (any part of the name, Hebrew vowel marks ignored), most recently opened first (kept in this browser), each with your role and currency; arrows, Enter, Escape; "Switch to …" in ⌘K (`src/lib/workspaceSwitcher.ts`, `WorkspaceSwitcher.tsx`; tests `workspace-switcher.test.tsx`). The old menu opened only on mouse hover. Still to come on each row: the needs-attention count (DA-02) and the group (DA-01 is there to use). **Expanded 7 Oct (roadmap, `docs/ROADMAP.md`), V1; = AI #5's E-1, with BD-02)**: find and enter the right books in seconds. Type to filter (Hebrew names too), arrows + Enter, the most recent first, "Switch to …" in ⌘K. Each row shows the role, and later the count of things that need attention (DA-02) and its group (DA-01). It lists only workspaces the user is a member of. One switcher, not two
- [x] K-36 Transaction enrichment — **done 6 Oct** (names): bank lines show a readable payee ("SQ *JOES COFFEE 4421 SEATTLE WA" → "Joes Coffee", "AMZN Mktp US*2K4L91TQ0" → "Amazon") with the bank's own text underneath and on hover, on the reconciliation screen. Card-processor prefixes, card numbers, dates, store numbers and codes are removed, well-known merchants named, Hebrew and other non-Latin text kept as written; `lineKind` tells fees, interest, refunds, transfers and payroll apart for hints. Display only: the stored line and the matching keep the bank's text (`src/lib/merchantNames.ts`, `src/components/ui/BankLineName.tsx`; tests `merchant-names.test.tsx`). Logos and learned names can follow
- [x] K-37 Webhook delivery tracking — **done 6 Oct**: Settings → Incoming events (owners and accountants) lists, newest first and in words, what Stripe and the email provider told LedgerFlow about the workspace and what came of it: an online card payment recorded / waiting for the bank / refused (other currency, nothing paid, invoice not found), plan changes, and emails delivered, bounced or marked as spam (with the address). Filters for online payments / email delivery and "only problems". Every Stripe outcome is now kept with its workspace (before, only some were, and without the outcome); events that can't be tied to a workspace are shown to nobody. Read only, no database change (`stripeProcessedEvents`, `emailEvents`; `src/lib/incomingEvents.ts`, `GET /api/v1/workspaces/:id/incoming-events`; tests `incoming-events.test.ts` with the database, `incoming-events-ui.test.tsx`, `online-payments.test.ts`)
- [x] K-38 Rule-group UI — **done 6 Oct** (AI #4, D-3): bank rules in named groups, each group on or off as a whole, the order inside a group (`rule-groups.test.tsx`, `e2e/rule-groups.spec.ts`); the rule actions are K-39 (AI #4's D-7)
- [x] K-39 Rule actions: accounts + type conversion — AI #4's D-7, ready for review in [PR #54](https://github.com/shmuelbiller1/ledgerflow/pull/54). Existing active accounts and expense/transfer classification through the recategorize route; standalone balanced two-line bank entries without tax, splits or document links. Bank line, amounts, currency and FX preserved; conflicts retain the preview and success reloads confirmed records. Part of the rule family in Q-05 (roadmap 7 Oct, Later P1).
- [x] L-01 CI actually running — clean install passes
- [x] L-02 `test:rules` in CI — now the Postgres row level security suite (every collection)
- [x] L-03 `test:e2e` in CI — runs fully (23 pass, 8 fail)
- [x] L-04 `npm audit` in CI — green
- [x] L-05 TZ matrix in CI: Auckland + Los Angeles (94661cd) — found L-79 on its first run
- [x] L-07 Backup restore test: export → change → restore gives the same trial balance and documents (database test); backup holds all the books
- [x] L-08 Per-workspace retention (Settings → Security → Data retention, owners): recovery window after deletion 30–365 days, email send log, browser error reports; pruned by the daily job; bounces/spam reports always kept; audited (tested)
- [x] L-09 Account deletion: shared workspaces handed over (or blocked with a clear message), solo ones scheduled for deletion, personal data removed (tested)
- [x] L-10 Download my data (Settings → Security; tested)
- [x] L-11 Record of processing activities: docs/privacy/ROPA.md (controller + processor parts, rights; company details for you to fill in)
- [x] L-12 Structured logging: `src/server/utils/logger.ts` (JSON lines) used by server.ts (94661cd)
- [x] L-13 `console.log` in `server.ts`: 0 (94661cd)
- [x] L-14 Browser errors and screen crashes reported to errorLogs with a daily digest; server errors as JSON log lines
- [x] L-15 Per-workspace usage metrics — **done 10 Oct (Claude)**: Settings → Billing starts with "Usage on the <plan> plan": entries, people with access and document storage, each against its limit, counted by the server the same way the limits are checked (`workspaceUsage` in `planCapacity.ts`, `GET /api/v1/workspaces/:id/usage` for any member); near the limit from 80%, and when reached it says what is refused (`UsagePanel.tsx`; tests `workspace-usage.test.tsx`).
- [x] L-16 Health endpoint
- [x] L-17 Status page: public /status (no sign-in) from GET /api/v1/public/status — app, database, daily job (recorded by the cron, late/failed = problems), sign-in, email, card payments, bank feeds (set up or not); 30 s cache (tested + browser test)
- [x] L-18 i18n: finish or remove — **removed 7 Oct** (the owner's decision, docs/FOR_YOU.md #10: menus in English, Hebrew handled in the data): the language toggle was already gone; its leftovers are removed (the unused language setter, the Hebrew-only text in the currency converter and the onboarding steps). Hebrew screen names stay, because search uses them
- [x] L-19 Setup wizard for new workspaces: business basics, chart template, opening balances posted as one entry that balances by construction (difference → Opening Balance Equity; receivables/payables come from invoices/bills), or start from zero; owners/accountants; server-side, audited (tested). The old welcome screen's "Explore with sample data" button only showed a toast; removed
- [x] L-20 Docs page for all 74 views
- [x] L-21 Lockfile-platforms guard test
- [x] L-22 Type check as its own CI step
- [x] L-23 `/api/ai/process` restored: real AI, login, workspace, credits, no invented data
- [x] L-24 Route-contract test: every `/api/...` the browser calls has a server route
- [x] L-25 Un-mocked E2E call to `/api/ai/process` passes
- [x] L-26 AI rule builder: workspace categories, server rejects unknown ones, tested
- [x] L-27 Rules: lock-date check crash fixed
- [x] L-28 Rules: audit-log identity fields must match the signed-in user; viewers only USER_LOGIN
- [x] L-29 Rules: voided documents can no longer be hard-deleted
- [x] L-30 `stream-json` override removed; emulator starts
- [x] L-31 `app/applet/` + `bun.lock` removed, guard test added
- [x] L-32 Write-off, PDF preview and aging drill-down all present
- [x] L-33 Ratchet metrics all measured for real
- [x] L-34 AI endpoint: guest-token login removed, membership failure → 403
- [x] L-35 AI endpoint: no invented data on failure
- [x] L-36 AI rules: delete/overwrite actions stripped, validated on the server, owner/accountant only
- [x] L-37 Copilot `chat` and AI blueprint work again
- [x] L-39 Build broken by deleted Party components — builds again, type check 0
- [x] L-40 Rules test: bankLines treated as server-only
- [x] L-41 Lockfile in sync, `bun.lock` removed with a guard
- [x] L-42 Purchases: pay, void, CSV export back (+ guard test)
- [x] L-43 Customer/vendor pages with invoices, payments, balances
- [x] L-44 Aging export + sort
- [x] L-45 Accessibility check on every view — all pass their limits
- [x] L-46 AI: workspaceId required
- [x] L-47 AI: login checked before the key (E2E test passes)
- [x] L-48 Money shown 100× too small — all 64 fixed + guard test
- [x] L-49 Guest mode shows demo data — lifecycle E2E passes
- [x] L-50 E2E transaction-list tests pass
- [x] L-52 Status bar computes balance with `lineAmount()`
- [x] L-53 `--faint` contrast fixed (4.88:1)
- [x] L-54 Account Statement / Sales Tax start at the fiscal year
- [x] L-55 ESLint back under the limit, limit lowered to 2,813
- [x] L-56 "Never raise the ratchet" is in the wrapper of every prompt
- [x] L-57 Type check 0 errors
- [x] L-58 Demo banner contrast fixed
- [x] L-59 Tax tests pass with their original inputs
- [x] L-60 Report code split: `computeReports.ts` 490 + `partyReports.ts` 309 lines
- [x] L-61 Search bug fixed — view filter and typed search both apply; unit + E2E tests
- [x] L-62 Status-bar green contrast fixed (emerald-700)
- [x] L-63 Saved-view chip is a real button; star is a sibling
- [x] L-64 Accidental reverts undone (keep step 0 "git pull first" in every prompt)
- [x] L-65 Test files use typed helpers (0 `as any`)
- [x] L-66 **CI fully green on GitHub** (both jobs) — 2026-09-23, commit 7160b13
- [x] L-68 Unused duplicate unmatch endpoint removed — CI green
- [x] L-69 `/reconcile`: role + lock + audit + no-user 401; 3 tests (5e4dfa9)
- [x] L-70 One local-date helper (`getLocalDateISO`)
- [x] L-71 **SECURITY** Payments: workspace (strict) on accounts + documents, 404, cap via `calculateAmountDue`, total cap, role check, void/draft refused, no fake account — d2b8027, 8 tests
- [x] L-72 **SECURITY** Document PDFs: strict workspace check, 404 like missing — d2b8027, tested
- [x] L-73 One audit-entry shape: all server writers use `writeServerAuditLog`; screens read old + new (5e4dfa9)
- [x] L-74 Audit trail no longer deleted after 90 days; guard test (5e4dfa9)
- [x] L-75 Admin Audit Log screen fixed via `auditDescription` / `auditTime` (5e4dfa9)
- [x] L-76 **SECURITY** Same invoice twice in one payment → refused — d2b8027, tested
- [x] L-77 Payment handler: no user → 401 (5e4dfa9, tested)
- [x] L-78 Permission-denied fallback only outside production (5e4dfa9, tested)
- [x] L-79 Dates with no workspace time zone now use the device's zone; tests pass in UTC, Auckland and Los Angeles (2bdcdc7)
- [x] L-81 **SECURITY** workspace restore can't overwrite another workspace's records (tested)
- [x] L-82 Removed AI Studio IAM fallbacks (errors were reported as success) + in-memory billing copy
- [x] L-85 Two-step login management screen (status, remove, recovery codes) — status/add/code-verified removal by AI #4 (D-2); **recovery codes done 7 Oct (AI #1)**: Settings → Security → Two-step login → "Make recovery codes" gives ten one-time codes, shown once (copy or download); only keyed hashes are kept, in a server-only table (`recoveryCodes`, migration 20261013000000; nobody reads it from the browser). On the code step of sign-in, "Lost your phone? Use a recovery code": a right code (any case, with or without the dash) is used up and removes the authenticator, so the person signs in with the password and sets two-step login up again; five wrong codes in an hour lock the step; if removing fails the code is given back. Only that one route accepts a password-only session (`src/server/services/recoveryCodeService.ts`; tests `recovery-codes.test.ts` with the database, `recovery-codes-ui.test.tsx`, `supabase-auth.test.ts`, RLS)
- [x] L-86 Move security-definer helpers to a private schema — **done 7 Oct**: `lf_ws_role`, `lf_mfa_ok` and `lf_assert_table` live in the `private` schema, which the API does not expose, so they can no longer be called as API functions (the Supabase advisor's warning); the row rules point at the functions themselves and keep working, and the seven functions that call them by name were re-created to call `private.…`; new entity tables get the two-step rule with `private.lf_mfa_ok()` (migration `20261013030000_private_helpers.sql`; `rls.test.sql` passes on a database built from scratch)
- [x] L-87 Sort large lists with an index — **done 7 Oct (with C-20)**: the lists read newest first (entries, invoices, payments, estimates, bills, credit notes, vendor credits, bank lines, the audit trail) have an index on (workspace, date newest first, id), matching the browser's order (date, then id); each page is read straight from the index (the 20th page of 200,000 entries went from 36 ms to 14 ms). They replace the (workspace, date) indexes (migration 20261013010000_list_order_indexes)
- [x] L-88 Two-step login enforced on Supabase (database + server + code screen)
- [x] L-89 Moved off AI Studio / Firebase to Supabase + Vercel
- [x] L-90 **SECURITY** server write routes check roles (viewers read-only; members/API keys/billing owner-only; labeler membership)
- [x] L-91 Fake success endpoints (/api/v1/ecommerce, marketing, helpdesk, hr, manufacturing, universal-ops) deleted (API-key callers got "success" for nothing); Admin Panel (simulated logs) behind the developer switch (Settings → Developer)
- [x] L-92 Plaid bank connections belong to the workspace; /sync only that workspace's banks (tested)
- [x] L-93 Express 5 compatibility (params types, wildcard routes, empty body)
- [x] L-95 Payments counted twice when a paid invoice/bill was edited (settledByRecordsCents)
- [x] L-96 Credit notes / vendor credits couldn't be created (posting endpoint refused them)
- [x] L-97 Bank statement import always failed (browser wrote server-only bankLines)
- [x] L-98 Receive payment failed without account mappings; vendor payments could hit receivables
- [x] L-99 Payment records lacked direction/contactId/status (reports and customer pages missed them)
- [x] L-100 Time zone / fiscal year / server-set workspace fields refused by the database (settings save failed)
- [x] L-101 Adding a customer failed (`status` not allowed by the database)
- [x] L-106 Emailing an invoice never worked (browser sent no login token); now sent by the server after posting
- [x] L-107 "+" on a customer row saved an empty invoice (misspelled field) instead of opening the invoice form
- [x] L-108 Customers list showed a made-up "Preferred Partner" label on everyone; now the reminders switch
- [x] L-109 Online card payments (Stripe webhook) guessed accounts, created no payment record and converted currency twice — now a real payment into Stripe Clearing (tested)
- [x] L-110 Payments on foreign-currency invoices were booked unconverted and labelled USD (tested)
- [x] L-111 Recurring invoices wrote ledger entries with blank accounts and no workspace every period (instead of invoices); "Pause" on screen didn't stop them; the screen's Run/Delete buttons did nothing (tested)
- [x] L-112 Purchase orders and goods receipts were never saved (only in the open page, with a made-up demo order)
- [x] L-113 **Invoices with tax added on top billed the customer without the tax** (the tax came out of revenue); the form now saves the total owed and the tax explicitly (tested)
- [x] L-114 The server silently dropped invoice/bill fields it didn't list (discount, "tax inclusive", retainage, deposit, a bill's currency…); guard test added
- [x] L-115 **Invoices and bills ignored the account chosen on each line** (everything went to one income / expense account); now each line's account gets its share (tested)
- [x] L-116 Editing an existing invoice gave it a new number and wiped its stored details (email history, reminder counters)
- [x] L-117 Invoice PDF always showed "$" and no tax or discount lines
- [x] L-118 **Credit notes carried no tax**: crediting a taxed sale never reduced the tax owed (or a vendor credit the input tax); credits for a document now take its share of tax, currency and rate (tested)
- [x] L-119 Later: the old sales-tax report function (`computeTaxLiability`, server /reports) adds document-currency amounts; the Tax return screen uses the home-currency return. Retire it once nothing calls it. — done: `GET /api/v1/reports/tax-liability` and `computeTaxLiability` removed (no screen or public API used them); their tests now check the same numbers through the tax return (`src/tests/helpers/taxTotals.ts`)
- [x] L-120 **Duplicate invoice** posted a copy at once with the original's payments, write-off and an invalid status; it now opens a new draft with the same customer and lines. Also: invoices and bills couldn't be edited from their lists, and the bill dialog would have renumbered a bill being edited
- [x] L-121 **Balances and reports used only the last 12 months of entries** (older opening balances vanished from the balance sheet), and invoices/bills loaded only on a few tabs, so Reports, Data Health and the dashboard saw none or an old copy. Fixed with on-demand live collections
- [x] L-122 The browser tried to write a `ledgerSnapshots` row (a table that doesn't exist) every time balances changed; removed with its unused storage modules
- [x] L-124 Deleting a workspace left newer tables behind (bank connections with tokens, API keys, members, notifications, tax returns, purchase orders, email events…); the purge now covers every table that holds workspace data, with a guard test and a database test
- [x] L-125 Invoice dialog: a customer typed but not on the list was saved as a made-up customer id (no customer record: no statement, balance or email); editing an invoice wiped its memo, terms and email text; the currency defaulted to USD in any workspace
- [x] L-126 Payments: "apply to invoices" paid the newest invoices first (the list is newest first), and draft invoices/bills were offered though the server refuses them
- [x] L-127 The empty invoice list offered "Seed demo data", which wrote 20 made-up invoices, bills and entries into a real workspace's books; removed
- [x] L-128 Preferences → Date Display Format saved a choice that no screen used; dates now follow it
- [x] L-129 Dark-mode styles (`dark:`) followed the computer's light/dark setting, not the app's theme, so either theme could show the other's colours; the accent colour was the same in both themes (brass text about 2:1 on light backgrounds); muted grey text fell just under the contrast minimum
- [x] L-130 "Undo workspace deletion" could never run: the backup import in server.ts used the same address (POST /workspaces/:id/restore) and answered first; it now has its own address and a banner. Guard test against two routes on one address (it also found /api/v1/reports mounted twice, so API keys never reached reports)
- [x] L-131 Settings → Security "Initiate purge" deleted a workspace's books at once (no 30-day window, ignoring closed periods, leaving payments and credits behind); it is now the 30-day "Delete workspace"; instant clearing only for demo data
- [x] L-105 Foreign-currency documents converted twice in the ledger (amounts converted, then the rate applied again); fixed, test proves it; old entries: Month-End Close → Repost
- [x] L-104 Bad debt write-off counted the loss twice (voided the sale and booked the expense); FX ignored
- [x] L-103 Fixed Asset Register saved nothing (assets + depreciation only in the page); now saved + server run
- [x] L-102 Applying a chart-of-accounts template failed (`role` not allowed, dashboard layout protected) — now applied by the server
- [x] L-80 "Today in the workspace" (`getLocalDateISO()`) split from "the day a Date stands for" (`calendarDateISO`) and plain date maths (`addToDateISO`, `monthBoundsISO`, `workspaceYearMonth`); month navigator, report defaults, tax reserve, exports and algorithms no longer shift a day when the workspace and device time zones differ (tested; utcDateCount 37 → 35)
- [x] L-136 ESLint blocks CI again (errors fail; warnings capped by `--max-warnings`, now 1436 — it only goes down)
- [x] L-132 Automation rules were never saved (Settings → Rules, AI rule builder, "Create rule" in the list only changed the open page; legacy format the engine ignored) — now saved, guard test (found by Codex)
- [x] L-133 "Apply rules to existing transactions" said it applied them but saved nothing — now saved through the server (role, period lock, balance checked)
- [x] L-134 Adding a budget always failed ("Workspace context missing") — fixed, guard test (found by Codex)
- [x] L-135 Reconciliation matching hung on a single strong match (Hungarian algorithm arrays one short) — rewritten, tested against brute force (found by Codex)
- [x] L-137 Document PDFs (Preview / Download PDF) always failed: Express passed `next` as the handler's third argument, which it took for the database. Fixed; tested through the router and the database. Estimate PDFs now list their lines (they printed a placeholder), statements show dates, strangers get 403
- [x] L-138 New numbering series started with "2026" hard-coded in the prefix (INV-2026-…) whatever the year; now the current year (tested)
- [x] L-139 Server budget-vs-actual report read `accountId`, which budgets don't have (always "Unknown", 0 spent), and summed raw line amounts; now finds the account by id/name/code and uses posted entries in the base currency (tested)
- [x] L-140 Server aging report ignored deposits and foreign currency and left out approved bills; now uses calculateAmountDue in the base currency and the shared open-document rule (cancelled documents are closed everywhere) (tested)
- [x] L-141 **SECURITY** `POST /api/v1/auth/audit` needed no sign-in and wrote a sign-in record for any user id in the body (shown in that person's "Download my data"); now signed-in only, for yourself, body checked (guard test)
- [x] L-142 Bank CSV upload: dates without a clear format fell back to the UTC day (the workspace was never read); now the workspace's time zone, members only
- [x] L-143 Command palette "show …" never filtered the transaction list (it set a filter field nobody read); saved views put fields the filter doesn't know into the filter chips (they did nothing). Now the palette search filters (tested) and a view only adds its date range
- [x] L-144 API Hub request log showed every request as "Error" (read `status`, the server sends `statusCode`)
- [x] L-145 Six amounts were printed with a hard-coded "$" and their own division by 100 (owner overview totals, rule previews, saved-view minimum, transfer matches): wrong in any other currency; now `formatCurrency`, and a guard test stops it · L-146 same for 17 more: command palette results (invoices and bills always "USD"), statement and bank-feed import previews, Copilot's figures sent to the AI, tax reserve card, insights, Magic Entry, document vault, transaction pivot; two more guard patterns
- [x] L-147 An amount changed in the transaction list showed the new number, but only the total was sent; the server works the total out from the lines, so the change was dropped. Both lines of a simple entry now change together (tested); split entries say to open the entry
- [x] L-148 Transaction list on a normal desktop screen: **no rows were drawn** (the list area had no minimum height, so the sections above left it 0 px high); the header's last column wrapped (layout one width short); the pro layout's header split Amount into Debit/Credit while rows had one amount (every later column shifted); the Columns menu changed nothing; the footer always said "Ledger imbalance" (it added positive totals); the running balance added money out as if it came in ($15,000 then $27,000 instead of $3,000). All fixed, browser test + unit tests
- [x] L-149 Light theme green/red text (`--pos`, `--neg`) was below the 4.5:1 minimum even on white; darkened (5.3 and 5.6 on the page); Transactions contrast failures 6/7 → 0/1
- [x] L-150 Sales opened on a tab nothing draws ("pipeline"): below the cards the page was blank until you clicked a tab; now opens on the invoice list
- [x] L-151 Customer balances in Sales added unpaid invoice totals (part-payments ignored), then any receivable posting whose text mentioned the customer's name, and fell back to a stored balance that never updated (demo: Stark "owed" $9,000 with no invoices). Now the Customer Balance Summary calculation. Same "total instead of still owed" mistake fixed in the Sales cards (overdue / 30 days / total receivable), the stored customer/vendor balance, the working-capital aging tool and the 1099 tool (paid = what was paid)
- [x] L-152 Screens cut off on ordinary laptops: the Overview (and Reports, Settings, Projects, admin) were centred flex items that sized to their content (up to 1,360–1,600 px), so on windows under ~1,600 px the right side was hidden; the transaction list's toolbar and table pushed the page 1,160 px wider at 1,280. Now everything fits at 1,280 × 800 (the table scrolls sideways in its box, the toolbar stacks); new browser test opens all 33 screens by address and checks they fit and draw something
- [x] L-153 Pivot Sheet counted foreign-currency entries twice over: `lineAmount()` already converts to the base currency and the sheet (grouped view, cross-tab and its export) multiplied by the rate again (EUR 100 at 1.10 showed 121 instead of 110). Fixed; guard test fails on `lineAmount(...) *`
- [x] L-154 CSV exports: five built the file as a `data:` link through `encodeURI`, which leaves `#` alone, so the file stopped at the first "#" ("Invoice #1001"): General Ledger export, Trial Balance, Audit Trail; most didn't neutralise text a spreadsheet runs as a formula (`=…`, `@…`); none had the UTF-8 marker Excel needs for accented/Hebrew names; money was written as raw cents (bills) or `x/100`. All 15 exports now use `downloadCsv` (quoted cells, formula guard, UTF-8 marker, `csvMoney`); the transaction list exports amounts signed like the screen (in +, out −)
- [x] L-155 Charts screen ("Executive Financial Visualizer") showed every amount 100× too small (it divided by 100, then formatted as cents), added each line's size so a reversed entry counted twice instead of cancelling, gave zero-balance bank accounts an invented 5,000, invented accounts and expenses ("Main Checking", "Payroll") and a runway when there was no data, and always printed "$". Now `src/lib/chartsData.ts` (tested): cents, signed lines, posted entries only, workspace currency, empty states instead of made-up numbers
- [x] L-156 Query builder showed amounts 100× too small (divided by 100, then `formatDecimal`, which takes cents) with a hard-coded "$": the Amount column and each line in the expanded rows. Now `formatCurrency` in the entry's currency; money guard bans `formatDecimal(x / 100)`
- [x] L-157 Expense by Category, Income by Source, Monthly Averages, Top Line Items and Tag Breakdown counted only the positive half of expense lines / negative half of revenue lines: a reversed entry still showed in full (its reversal was skipped) and refunds or credits back to customers never reduced the totals, so these reports disagreed with the P&L. Now every line counts with its sign; top-item lists leave out reversed pairs (reportGenerators.ts, tested)
- [x] L-158 Income by Source report crashed on opening ("Maximum update depth exceeded"): its store selector filtered the transactions, making a new array on every read. Fixed; guard test bans `.filter/.map/...` inside store selectors
- [x] L-159 A/R and A/P aging screens: counted total − paid (deposits and applied credits ignored) in each document's own currency (a EUR invoice added as dollars) and aged by the document date, while the /aging API used what is still owed in the base currency by due date — two different agings. Now one rule, `src/lib/aging.ts` (tested), used by both: Current / 1–30 / 31–60 / 61–90 / over 90 days past due; the drawer says "N days overdue"; rows open from a real button
- [x] L-160 Account statements left out credit notes and vendor credits, so a customer with a credit showed a higher balance than the Customer Balance Summary; refunds of credits were invisible to both (a refunded credit still showed as owed back). Credits now appear on statements (screen, PDF and API); the server records `refundedCents` when a credit is refunded, and statements and balance summaries count a credit less what was refunded (tested; the closing balance equals the summary)
- [x] L-161 Buttons: a quick double click on any AsyncButton (payments, saves, filings) ran the action twice (the "busy" flag only took effect after a re-render; now a ref guards it, test fails on the old code); RequireRole's greyed-out mode only blocked the mouse, Tab + Enter still pressed the button (now `inert`); the data grid's sort headers were mouse-only (now buttons)
- [x] L-162 Customer and vendor pages: "Outstanding" was total − paid (deposits ignored) added across currencies, cancelled invoices counted, and "overdue" compared a due date read as UTC midnight with the current time (a day off in the Americas). Now `partyStats` / the aging rule (still owed, base currency, days past due, tested); each document shows its open amount in its own currency
- [x] L-163 Converting an estimate to an invoice wrote the invoice straight to the database as "sent": no ledger posting (no receivable, no revenue: P&L and balance sheet missed it while Sales and aging showed it), a dropped `totalCents` field, no lines, and a random invoice number when numbering failed. Now a draft invoice with the estimate's lines through the posting path (useEntityOperations), no made-up number or account; guard test: no screen writes invoices, bills, credits, payments or transactions to the database directly
- [x] L-164 Forensic Auditor called balanced foreign-currency entries unbalanced: it converted and rounded each line separately (+5.5 → 6, −5.5 → −5) before adding them up. It now checks the lines in the entry's own currency, like the server's validator (`src/lib/forensicChecks.ts`, tested)
- [x] L-165 Finance screens: the payments list showed foreign payments in the base currency and every allocation as "invoice: undefined"; it now shows the payment's currency and the invoice/bill number. Credit notes and vendor credits showed amounts without their currency. The account register treated cost-of-goods-sold accounts as credit accounts, so their running balance had the wrong sign (tested)
- [x] L-166 Transactions screen totals: a customer's payment was counted as "Filtered Outflow" (any entry without an income or expense line went there, transfers too); now only money entering or leaving bank/cash accounts counts, and transfers count as neither. The search total and "sort by amount" used foreign amounts as if they were in the base currency. The statements' report hook recomputed an unused profit figure on every ledger change; it now only fetches, with the dates encoded. An unknown stored role now shows as Viewer, as the server treats it (tested)
- [x] L-167 The Transactions list opened filtered by a saved view nobody chose ("Liquid Cash & Bank Funds" was switched on at every start and after each workspace switch), so most entries looked missing; no view is on until the person picks one. Switching workspace kept the old workspace's closed periods, lock exception, invites and "data truncated" banner until the new one loaded, and its hidden sidebar tabs for good. Income/expense totals stayed at zero when the entries loaded before the accounts, and each load rebuilt the account list once per entry (tested)
- [x] L-168 Cash flow statement: the server version ("Load Full Server Report") counted only income, expense, receivable and payable lines of every entry, so tax paid, stock bought and other working-capital money were missing and the total didn't match the change in cash; the screen had its own different math. One function now (`computeCashFlow`, direct method: money in and out of bank, cash and undeposited-funds accounts, by what it was for; debt and equity financing, fixed assets investing). The General Ledger report got its first test (tested)
- [x] L-169 The server's tax liability report (`/api/v1/reports/tax-liability`) added foreign invoices' and bills' tax in their own currency; now in the home currency. Data Health called balanced foreign entries "unbalanced" because of per-line rounding (same as L-164), and its findings showed raw cents ("1250 cents"); now money (tested)
- [x] L-170 Document PDFs printed only the first 15 lines (the total still covered all of them), on one page, and only Latin letters (Hebrew names came out as garbage). PDFs are now made with pdfkit and an embedded font (DejaVu Sans): every line over as many pages as needed, Hebrew and mixed Hebrew/English text in reading order, the due date and payment terms printed (tested, including the text read back from the PDF)
- [x] L-171 Customers and vendors could not be edited at all (the forms only added), so a wrong email or name could not be fixed; one shared form now adds and edits (Edit on the contact page). Bills had no currency field, so a bill from a foreign supplier could only be entered in the home currency (tested)
- [x] L-172 **SECURITY** `/api/v1/inventory/adjust` and `/cogs` only checked membership: a viewer could post stock entries and change quantities. Both now need owner, accountant or bookkeeper; `/adjust` also hung (no answer) when its database transaction failed, and both labelled entries USD in any workspace. Stock changes now go through one service: every line in one entry with the new quantities, in the workspace currency, never below zero (tested)
- [x] L-173 Stock quantity could be typed into the item form: it changed what is on hand without any entry, so Inventory on the balance sheet and the stock list drifted apart (the record-a-sale dialog also lowered the stock a second time, and fell back to a made-up $50 cost and to any asset or expense account). Quantity now changes only through the server (database rule + tested); new items' opening stock is posted to Opening Balance Equity
- [x] L-174 Inventory showed each person only the items they created; teammates now see all the workspace's items
- [x] L-175 Bank reconciliation "Auto Align All" reloaded bank lines and entries filtered to the signed-in person's own records, so lines imported by the server or a teammate were never matched, and it ignored the account filter. It now matches what the screen shows (tested, with a screen test of matching, ignoring, undoing and the filters)
- [x] L-176 Quick entry and search phrases: amounts came out as fractions of a cent ("28.99" → 2898.9999…), "between 100 and 250.75" used 0.75 as the upper bound ("between 100 and 250" failed), "hosting 0.29" was read as 0.20, and a typed date on the 31st ("3rd feb") rolled into March (tested)
- [x] L-177 An automatic rule with a "set amount" action rewrote an entry's total without its lines, so the entry and the ledger disagreed; rules never change amounts now (tested)
- [x] L-178 CI was red for 3 pushes: the coverage floor (75%) failed after Codex's split files were counted with few tests; tests added for the reconciliation screen, the category engine, the rules engine, the quick-entry parser and recording a sale (coverage back above 75%)
- [x] L-179 Deactivating an account that has history always failed: it wrote a `status` field the database doesn't allow on accounts; it now sets isArchived (found while adding edit-in-place to the chart of accounts)
- [x] L-180 **Money:** bulk categorize on the transaction list changed "line 0" even when it was the bank line, so entries stored bank-line-first lost their bank side (gone from the bank balance), and transfers/journal entries were rewritten too; it also applied while typing ("Software" before "Software Licenses" was finished) and offered bank accounts as categories. Now: bank/cash lines never change, transfers and journal entries are skipped with a message, Enter or Apply only, categories only (tested)
- [x] L-181 **Money:** "Transfer between accounts" only changed the list on screen: the transfer was gone after a reload and never reached the books. "Link as Transfer" (two entries that are one transfer) only set a flag on screen and left the expense and the income in place. Now the transfer is saved through the server as one balanced entry in the workspace currency, and linking moves both entries' other side to a Transfer Clearing account (added once, reused), so the made-up expense and income disappear (tested)
- [x] L-182 **Money:** the keyboard category editor in the transaction list (Enter on the category cell) changed "line 0", which is the bank line when an entry is stored bank-first, so the entry lost its bank side; it also changed the accounts of entries made by invoices, bills and payments, and the amount editor changed amounts of those too. Now the same rules as clicking in the row: only the category side changes, transfers and journal entries and document entries say where to change them instead (tested)
- [x] L-183 **Money:** a bill could not be saved at all in a workspace without a tax account ("Missing Tax Paid account"), even with no tax on it. A tax account is now needed only when the bill has tax (tested)
- [x] L-184 The Taxes screen (opened from the menu) got no data: it listed no tax codes, "New tax", Edit and Delete did nothing, and the tax estimate used no accounts. It now reads the workspace's tax codes and accounts and saves through the normal path; delete asks first; name and rate (one-part taxes) change in place; viewers only read (tested)
- [x] L-185 The first entry dated in a new year quietly added four made-up tax rates ("Federal compliance 22%", "State 5%", city and county levies) to the workspace, which then showed up as tax codes. Removed
- [x] L-186 Choosing payment terms on an invoice (Net 15/30/60) didn't change its due date: it stayed on the invoice date, so every invoice looked due at once and reminders went out early. The due date now follows the terms and moves with the invoice date; a new invoice for a customer takes the terms of their latest invoice (I-23) (tested)
- [x] L-187 **Money:** "Run month-end revaluation" (currency tool) posted one entry that applied a single exchange rate to every asset and liability account, home-currency ones included, for any member, and the rate service fell back to made-up rates (USD→EUR 0.92…) when it couldn't be reached. Rates are now never invented (an error instead; the converter shows no amount and says why) and the run posts nothing until R-07 is built (it must revalue open foreign invoices and bills, since foreign documents are stored in the home currency) (tested)
- [x] L-188 Credit notes and vendor credits got random numbers (CN-1234, VC-5678) that could repeat and didn't follow any series; a double click on Save made two. They now take the next number of their own series (Settings → Document numbering: credit notes CN-2026-0001…, vendor credits VC-2026-0001…, allocated by the server so two people never get the same one), Save works once, and the amount label shows the workspace currency instead of "$" (tested)
- [x] L-189 Payments were numbered PMT-<random 4 digits> too, so two payments could share a number. They now take the next number of their own series (PMT-2026-0001…, Settings → Document numbering), allocated in the same database step that saves the payment, so a refused payment uses no number. New estimates no longer fall back to a random EST-1234 either: without a number from the series nothing is saved (tested)
- [x] L-190 **Money:** the journal entry form filled foreign-currency rates from a made-up table (EUR 0.92 × 1.1 for 2026, ILS 3.65 × 1.1…), and those were even the wrong way round (euros per dollar, used as dollars per euro), so €100 posted as about $101 instead of about $108; clearing the rate box silently used 1. It now fills the last rate used for that currency, then today's rate from the rate service, and posts nothing until a rate is there; the currency list includes the workspace's own currency (a workspace in AUD couldn't choose it) and the ones already used (tested)
- [x] L-191 Invoice approval (BE-04, merged from the arena AI) trusted the browser: the server stored whatever `approval` a save carried, so a bookkeeper going around the app could mark their own invoice approved, or leave the field out on an invoice saved as sent. Now the server decides on every invoice it saves (only owners and accountants approve or send back, and the record names them with the server's time; an invoice going out over the limit without a record gets one), and a database guard refuses the same from a direct write. Also: a customer who gets paper got the same "send a paper copy" note in the bell every day; now once per reminder day (tested, incl. database rules)
- [x] L-192 **Money:** a payment on a foreign-currency invoice or bill was booked at the document's own rate, so the bank account in the books got a different amount than the real bank (EUR 100 invoiced at 1.10 and received at 1.15: $110 booked, $115 arrived) and no exchange gain or loss was ever recorded. The payment dialog now shows amounts in the document's currency and asks for the rate on the payment day (filled from the rate service or the last one used); the server books the bank at that rate, clears the receivable/payable at the document's rate and posts the difference as realized exchange gain or loss (refused if there is no such account). Without a rate it stays as before (tested against the database)
- [x] L-193 **Lost work:** a new invoice or bill saved as a draft ("Save Draft", the draft invoice made from an estimate, an expense claim waiting for approval) was never saved: a draft posts nothing to the books, and the posting step returned before sending the document itself, so the draft simply wasn't there afterwards (edits to a draft, and rejecting an expense claim, were lost the same way). The document is now sent to the server with no entries; a draft that had entries still reverses them in the same request (`draft-documents-saved.test.ts`; found 6 Oct while building K-04)
- [x] L-51 Ratchet: all metrics real, fast, warnings via `--max-warnings`
- [x] AA-01 Per-collection truncation flag
- [x] AA-02 Banner naming truncated collections
- [x] AA-03 Block client-side sums on truncated lists
- [x] AA-04 Raise caps on reference data
- [x] AA-05 Truncation guard test
- [x] AB Storage purge error handling
- [x] AC `customTemplates` scoping
- [x] AD-01 Timers: all 7 listed already clear themselves (checked 5e4dfa9)
- [x] AD-02 Guard test: effects that start timers return a cleanup (with a self-test)
- [x] AD-03 `PublicInvoicePage` timers
- [x] AE-01 Tax-inclusive branch in posting
- [x] AE-02 Shared `calculateDocumentTax`
- [x] AE-03 Posting === reporting test matrix
- [x] AE-04 Recompute tax: `scripts/recompute-document-tax.ts --workspace <id> [--apply --uid <uid>] [--date]` lists documents whose ledger tax differs and posts one audited adjusting entry each (tax ↔ revenue/expense, never edits old entries, period lock respected, runs twice safely); Data Health lists them too (tested)
- [x] AF-01 Discount/retainage in tax
- [x] AF-02 In shared `documentMath`
- [x] AF-03 Deposits = payment in advance (FOR_YOU 13 default): tax on the full invoice, the deposit lowers the amount due; posted DR Customer Deposits / CR A/R; payments, credits, Stripe link, PDF and public page follow it (tested)
- [x] AF-04 Tie-out fixture: EUR + discount + retainage + tax on top (94661cd)
- [x] AG-01 Canonical `amountCents`
- [x] AG-02 `totalCents` removed from Invoice
- [x] AG-03 `paidAmountCents` removed
- [x] AG-04 `LedgerPostService` typed
- [x] AG-05 Guard exists: no `??`/`||` fallback between money field names
- [x] AH-01 `documentMath.ts`
- [x] AH-02 All three callers use it
- [x] AH-03 `/ (1 +` guard test
- [x] AH-04 Tie-out now structural
- [x] AI-01 Parameters typed
- [x] AI-02 Surfaced issues fixed
- [x] M-01 Items / products catalogue — covered (checked 7 Oct): Inventory's items (name, SKU, price, cost, category; services without stock too) are the catalogue, picked by name or SKU on invoice lines (K-02, K-12)
- [x] M-02 Sales orders — done as K-04 (an order is an accepted estimate; no separate table)
- [x] M-03 Sale receipts — see K-03 (done 6 Oct)
- [x] M-04 Manual journals — see K-05 (done 6 Oct)
- [x] M-05 Email templates (= K-08)
- [x] M-06 Exchange-rate entity — covered by K-29 (checked 7 Oct): each document keeps the rate it was posted at; the "Exchange rates used" report lists them by currency and day, and a back-dated document gets the rate used on its day (no separate table needed)
- [x] M-07 Expected bills — done as K-21 (vendors' billing rhythm learned; late bills shown with one-click record)
- [x] M-08 Report schedules — done as K-28
- [x] M-09 Generic attachments — done as K-07 (the `documents` table, linked to the record; one panel for any record)
- [x] M-10 Transaction links — **done 10 Oct**: an entry's edit window has "Linked entries": the entries said to belong with it (a refund and its sale, a transfer's two sides, a correction), with a note, each opening from there; owners, accountants and bookkeepers link and unlink (once per pair, never to itself, both in the workspace, audited); everyone reads. Nothing in the books changes. Kept with the workspace's documents (kind "entryLink", server-written; no migration) (`src/lib/entryLinks.ts`, `entryLinkService.ts`, `EntryLinks.tsx`; tests `entry-links.test.tsx`)
- [x] M-11 Price lists — **done 10 Oct (Claude)**: Settings → Price lists: a named list (e.g. Wholesale) with a discount on every item and/or a price of its own for some items, and its customers (one list each). On an invoice or estimate for a customer on a list, picking an item fills the list's price (its own, else the item's price less the discount, in whole cents); the line can still be changed and nothing posted changes. Owners and accountants keep the lists, saved by the server with an audit line (`src/lib/priceLists.ts`, `priceListService.ts`, `PUT /workspaces/:id/price-lists`, `PriceListsSettings.tsx`; tests `price-lists.test.tsx`). **Open:** lists in another currency; dates a price is valid from.
- [x] M-12 Delivery notes — deliveries from an order that move stock and book the cost (BF-08 step 2, 7 Oct); **the printable note done 8 Oct**: "Delivery note" on each delivery opens a PDF with the company, customer, order and their reference, date, each item and quantity (no prices) and a line to sign on receipt (`deliveryNotePdf.ts`, `GET /api/v1/inventory/deliveries/:id/note`, any member). Found on the way: the shared role check crashed on GET requests that pass the workspace in the query (`req.body` is empty on a GET); fixed.
- [x] M-14 Item categories (= K-12)
- [x] M-16 Purchase requisitions — see K-23 (done 6 Oct)
- [x] M-17 Bulk action bar (= K-06)
- [x] M-18 Bulk import wizard (= K-01)
- [x] M-19 Customer portal — done as K-27
- [x] M-20 Available budget — done 7 Oct: under a bill's expense account and Money out, what is left of the account's budget for that date's period, amber when the amount would go over (`src/lib/availableBudget.ts`, `BudgetLeft.tsx`; tests `available-budget.test.tsx`)
- [x] N-01 Compare previous period (calendar-aware; P&L, Balance Sheet, Cash Flow)
- [x] N-02 Compare same period last year
- [x] N-03 Period columns — P&L activity and balance-sheet closing snapshots, fiscal quarters/months and clipped ranges (C-13; hand-number/component/browser tests)
- [x] N-04 % of total — income on P&L, total assets on balance sheet; zero denominator shown as undefined (C-13)
- [x] N-05 Variance column — comparative amount and percentage, zero/negative previous amounts handled; shared CSV export (C-13)
- [x] N-06 Print / Save as PDF on every report (only the report prints, with title + period)
- [x] N-07 Presentation currency — **done 10 Oct (Claude)**, through the group summary: Reports → Group Summary offers "This workspace only" (also with no groups), so one company's profit and loss and balance sheet can be shown in another currency: income and costs at the average rate, assets and liabilities at the closing rate, equity at the historical rate, the translation difference on its own line, and account by account; rates typed or filled from the rate service, never invented (`groupId=ws:<id>` in `groupReport.ts`, only for a workspace the person can open; tests `group-summary.test.tsx`). The other reports stay in the home currency.
- [x] N-08 Cash vs accrual everywhere — **the P&L done 10 Oct (Claude, was Codex's C-31)**: Profit & Loss → Basis: Accrual (as posted) or Cash (when paid). On cash basis, an invoice's or bill's posting counts as it is paid, in proportion to each payment applied to it, on the payment's date (partly paid in part, unpaid not at all, in whole cents); cash already in a posting counts on its date; other entries on trade receivables or payables without cash (credit notes, write-offs) are left out and counted on screen; everything else counts as posted. Calculated by the server only, from the full history (`src/server/reports/cashBasis.ts`, `GET /reports/profit-and-loss?basis=cash`); the screen never shows accrual figures as cash ones (tests `cash-basis.test.ts` by hand, `main-path.test.ts` through the app's own invoice, bill and payment code, `cash-basis-ui.test.tsx`). **The balance sheet too, 10 Oct:** Balance Sheet → Basis → Cash: the same entries without the trade receivables and payables, so the profit to date is the cash-basis profit; a payment not yet applied to an invoice or bill has nowhere else to go and is shown on its own line with the liabilities ("Paid, not yet applied"), so the sheet balances; books that don't balance as posted are shown as they are (`cashBasisBalanceSheet`, `GET /reports/balance-sheet?basis=cash`; tests `cash-basis.test.ts`, `main-path.test.ts`, `cash-basis-ui.test.tsx`). **Open:** period columns and comparison on cash basis; the entries behind a cash-basis figure.
- [x] N-09 As-of date passed to every report (Balance Sheet, balance summaries follow it)
- [x] N-10 Column chooser — **done 10 Oct for the reports with a scrolling table (Claude, was Codex's C-29)**: "Columns" above the table lists its headings; a column unticked is hidden on screen and when printed, remembered per report on this device; the first column and one other always stay. Works on every report wrapped in `ReportTableScroll` (12 reports) by reading the table's headings (`src/lib/columnChoice.ts`, `ReportTableScroll.tsx`; tests `column-chooser.test.tsx`). **AI #2 follow-up (11 Oct):** rectangular native report tables now reorder headers/cells together, keep the identifying column first, remember choices per signed-in user/workspace/report, and export the visible rows/columns as displayed text. P&L/balance-sheet period groups can be hidden/reordered, preserving their amount/percentage/comparison cells; their financial CSV follows visible periods and collapsed account rows. **Scope:** specialized/spanning/custom-component tables retain their existing contracts. Legacy statement XLS is offered only on the uncustomized layout; period layouts offer their matching financial CSV. Verification is recorded in coordination.
- [x] N-11 Permalink: report, year, period, comparison in the address
- [x] N-14 Hebrew learned patterns overwrite each other — **done 8 Oct (Claude)**: `learnedPatternId` (`src/lib/learnedPatterns.ts`) used by both writers; plain Latin text keeps its old id, anything else gets a readable start and a 64-bit hash of the whole text, ids at most 80 characters (`learned-patterns.test.ts`). Older Hebrew patterns that had already collided keep their last value; new learning is kept separately. **Found 8 Oct by DA-05 (TOOL_REVIEW F1), V1**: `recordLearnedPattern` (`useEntityOperations.ts`) and `postingHelpers.ts` make the record id with `replace(/[^a-z0-9]/g, '_')`, so two Hebrew-only descriptions of the same length ("שלום", "תודה") save to the same `rulePatterns`/`learnedDeltas` record and the second overwrites the first. Fix: a collision-free id from the whole normalized text (both places together), existing records still read, and a test that saves both and keeps two.
- [x] N-13 One sign for opening balances — **found 8 Oct by N-12, done 8 Oct (Claude)**: `openingBalanceCents` was read in the account's own direction by the screens (balance sheet, trial balance, account register) and the server's general ledger, but debit-positive by the server's balance sheet and trial balance columns, the close package, the closing snapshot and the tax-software trial balance export, and the cash-conversion figure. A loan's opening balance could show as a liability on screen and an asset elsewhere. **One rule now:** the opening balance is kept as the account shows it (as the new-account form asks: a loan typed as 10,000; a bank overdrawn is negative), and `openingDebitCents` (`src/lib/accountUtils.ts`) turns a credit account's around wherever the books are added up. The form says which way. A closing snapshot taken before the rule is compared the way it was stored, so nothing looks changed since the close. Test fixtures that had typed credit openings as negatives were turned to the account's direction. Tests: `explain-number.test.ts` (N-13), the report, close package, snapshot and dashboard suites.
- [x] O-01 Sunburst
- [x] O-02 Treemap
- [x] O-03 Icicle — AI #4, D-9: trial-balance account hierarchy, direct postings counted once, signed shares/table and keyboard zoom; full GitHub gates pending on `ai4/d-9-chart-drill-shapes`.
- [x] O-04 Brush selector — AI #4, D-9: pointer/touch drag and native keyboard sliders share the two financial time-plot windows and exact report dates; full GitHub gates pending on `ai4/d-9-chart-drill-shapes`.
- [x] O-05 Chart switcher — D-6, PR #69: remembered bar/line/area choices for two financial time plots and five dashboard trends; specialized shapes retained.
- [x] O-06 Legend toggling — D-6, PR #69: shared financial series/category controls and dashboard trend legends preserve accessible values.
- [x] O-07 Scatter plot
- [x] O-08 Consistent tooltips — D-6, PR #69: shared full-label tooltips use workspace currency/native units, original-total allocation percentages and current hierarchy values.
- [x] P-05 Two-person rule — **done 10 Oct**: Settings → Security → Two-person rule (owners; needs a second owner or accountant; audited). Nobody approves what they prepared: an invoice over the approval limit waits for someone other than whoever issued it, and every pay run waits for an owner or accountant other than whoever prepared it; the server refuses, the screens hide Approve. Purchase orders not covered (FOR_YOU 36) (`src/lib/twoPersonRule.ts`; `two-person-rule.test.tsx`, `pay-run-posting.test.ts`)
- [x] P-07 In-app changelog (codex, `codex/p-07-in-app-changelog`): Help & Guide → What’s new; dated shipped updates, keyboard-accessible disclosure
- [x] P-08 Product tour — **done 10 Oct (Claude, taken over from AI #4's D-4, waiting since 6 Oct)**: six steps of the basics only (the overview, money in, money out, the bank, reports, Ctrl+K search; no stock, projects or payroll), each with "Show me" for its screen; Back, Next, Skip, Escape. It opens once for a signed-in person whose workspace is set up (never in guest mode or before setup), is remembered per person in this browser, and Help & Guide → "Take the tour" opens it again (`src/lib/productTour.ts`, `src/components/onboarding/tour/ProductTour.tsx`; tests `product-tour.test.tsx`). **Open:** the later hints when a module is first used. = AI #4's D-4. **Expanded 7 Oct (roadmap, Later P0, with BB-07)**: short, and it grows with the workspace. The first tour shows only the basics (the books, money in, money out, the bank, reports). Later hints appear when something new starts being used (the first project, the first stock item, a second workspace)
- [x] P-09 Onboarding (= L-19 setup wizard)
- [x] P-11 Multi-language documents — **done 10 Oct**: the printed words on every document PDF (title, labels, totals, page numbers, watermark) in English or Hebrew: the workspace's choice in Settings → Branding, a customer's own in their details (kept in the customer's `metadata`, no migration). Downloads, zips, emailed invoices and statements use the customer's language (`src/lib/documentLanguage.ts`; `document-language.test.tsx`). Tax-invoice titles: FOR_YOU 37
- [x] P-12 Per-customer templates — **done 10 Oct**: in a customer's details, their own terms printed on their documents in place of the workspace's (with their language, P-11), kept in the customer's `metadata` (no migration); downloads, zips and emailed invoices and statements use them (`contactTerms` in `src/lib/documentLanguage.ts`; `document-language.test.tsx`)
- [x] P-13 Sales rep + commission — **done 10 Oct**: Settings → Sales reps keeps each rep's commission percentage and customers (one rep per customer; saved by the server on the workspace, owners and accountants, audit line; no migration). Reports → Sales commission: for a period, each payment from a rep's customers applied to an invoice, less its tax share, at the payment's rate, and the rep's commission and total. Commission follows what was paid; nothing is posted (`src/lib/salesReps.ts`; `sales-reps.test.tsx`)
- [x] Q-01 Units-of-production depreciation — integer-cent cumulative preview; C-21
- [x] Q-02 Depreciation conventions — straight-line calendar-year planning previews; statutory MACRS excluded; C-21
- [x] Q-04 Tiered pricing — three-band graduated and volume previews; C-21
- [x] Q-05 Cost allocation rules — **done 9 Oct (Claude)**: Settings → Split rules: a saved rule (name, the text the vendor or description contains, 2–20 shares adding up to exactly 100% with two decimals, each with its own account or the line's, and its labels). On a bill whose vendor or description contains the text, it is suggested with why ("rule 'Rent split' matched: vendor contains 'Landlord'"); applying it splits each line by the shares in whole cents with the remainder on the last share, and only changes the lines on screen: saving goes through the normal checked route. Owners and accountants keep the rules (saved by the server on the workspace, new ids, an audit line); others see them (`src/lib/allocationRules.ts`, `allocationRuleService.ts`, `PUT /api/v1/workspaces/:id/allocation-rules`, `AllocationRulesSettings.tsx`, `BillModal.tsx`; tests `allocation-rules.test.tsx`). **Open:** the same suggestion on entries and bank lines (with K-39). C-21 percentage/driver calculation preview complete. **expanded 7 Oct (roadmap, `docs/ROADMAP.md`), Later P1; one rule family with K-39 and CA-13)**: a saved rule says which account, labels and splits apply (e.g. rent 60/40 between two properties).
  - **It explains itself:** "rule 'Rent split' matched: payee contains 'Landlord'".
  - **It shows before it posts:** the result is shown first, and posting goes through the normal checked route (whole cents, the remainder on the last share, the period lock).
  - **It never posts on its own:** a suggestion waits for a person.
- [x] Q-06 Standard cost variance — material price/quantity preview; C-21
- [x] R-01 Close checklist (tested; blockers + items to sign off)
- [x] R-02 Sign-off per item (who, when, note; final once hard-closed)
- [x] R-03 Soft vs hard close (soft: only owners/accountants post)
- [x] R-04 Year-end retained-earnings roll (`/close-year`; since CA-07 no closing entry is posted: the balance sheet carries past profit in retained earnings, and the unused `ClosingEntryEngine` was removed)
- [x] R-05 Auto-reversing accruals: a journal entry can be marked "Reverse automatically"; its mirror (every line negated, linked both ways) is posted on the 1st of the next month, or a chosen later date, in the same request, so there is never an accrual without its reversal; a closed month refuses both (tested against the database). The server now accepts a reversal of an entry in the same request
- [x] R-06 Depreciation run (server, one entry per month, catch-up, tested)
- [x] R-07 FX revaluation run (the old run was switched off, L-187: open foreign-currency invoices and bills, owner/accountant, reversal next day) — implementation and local checks done 2026-10-05; **merged 5 Oct after Claude ran the database tests (`fx-revaluation-server.test.ts`, Undo and historical month-end included): they pass**:
  `src/lib/fxRevaluation.ts` holds the arithmetic and skip rules; nothing invents an FX account or a
  rate. Today uses the live exchange rate. A past date must be a real month-end, cannot be in the
  future, and must use rates typed for that date — a missing historical rate is named by the preview
  and cannot be used to post a partial entry or silently fall back to today's rate. Impossible dates,
  non-month-end historical dates and future dates are refused. The Currencies panel asks for the
  valuation date and, after its preview identifies the open foreign currencies, each rate as base
  currency per unit; its rows and descriptions name the historical rate date. Home-currency documents
  are never listed; paid/draft/void/closed documents, zero open amounts, missing booked rates, missing
  receivable/payable accounts and accounts already kept in that foreign currency are skipped with a
  reason. A missing live rate stops the entire current-date run. Receivables and payables move by the
  difference from their own booked rate; the unrealized gain/loss account takes the other side, every
  line is whole cents, and the entry sums to zero.
- [x] R-08 Unposted-drafts review (drafts in the period block the close, listed)
- [x] R-09 Close comparison (AI #3: the Month-End Close "Compare <month>" panel shows this month's P&L and balance sheet beside the previous month and the same month last year with big-move flags; see COORDINATION Messages)
- [x] R-10 Lock by role (close/reopen owner+accountant; hard reopen owner; soft close by role)
- [x] R-11 Close package export — **done 7 Oct**: Month-End Close → "Close package (.xlsx)": a Close status sheet (open or closed and through when; every checklist item and the client's own steps with who signed them off, when and the note), the trial balance on the month's last day (opening balances in, drafts and later entries out, a total row), the month's general ledger with references, and the month's questions about entries with the latest answer; money as numbers, not text (`src/lib/closePackage.ts`; tests `close-package.test.ts`)
- [x] S-01 invoice.sent (email to the customer, logged)
- [x] S-02 invoice.viewed — **done 7 Oct**: opening an invoice's own page (/i/…, from the email or the customer portal) records when the customer first and last opened it and how often (at most once an hour; drafts and voided invoices are not counted), and the first time owners, accountants and bookkeepers are notified ("Acme opened invoice INV-7 · $500.00 is still due by 2026-10-31"). The Sales list shows "Opened by the customer <date>" on unpaid invoices. Server-only fields; never breaks the page (`src/server/services/invoiceViewService.ts`; tests `invoice-viewed.test.ts` with the database)
- [x] S-03 invoice.overdue (daily, once per invoice, workspace date; tested)
- [x] S-04 payment.received (recorded payments and bank-line payments; online card payments with K-11)
- [x] S-05 payment.failed — **done 7 Oct**: when Stripe reports that a customer's bank payment for an invoice (paid from its link) did not go through, owners, accountants and bookkeepers are told once ("Acme's bank payment of $500.00 did not go through…"); the invoice stays open and Settings → Incoming events shows it as a problem (`src/server/services/paymentFailureService.ts`, `checkout.session.async_payment_failed` in the Stripe webhook; tests `payment-failures.test.ts` with the database)
- [x] S-06 bank.feed.disconnected (when a bank login expires)
- [x] S-07 reconciliation.discrepancy — **done 7 Oct**: the nightly check keeps, for each bank account's latest reconciliation, the books-minus-statement difference on the statement date as first seen (outstanding items are fine); when it moves (an entry on or before that date added, changed, voided or deleted), owners and accountants are told once with then and now (`src/lib/reconciliationDrift.ts`, in `ledgerHealthService.ts`; tests `reconciliation-drift.test.ts`, `ledger-health.test.ts` with the database)
- [x] S-08 period.close.reminder — **done 7 Oct**: from a chosen day of the month (the 5th unless changed in Settings → Alerts, or off), owners and accountants are reminded to close last month until it is closed (soft or hard), once a month, and only once the workspace has entries (`src/lib/bookAlerts.ts`, `src/server/services/bookAlertService.ts`, daily job `bookAlerts`; tests `book-alerts.test.ts` with the database)
- [x] S-09 approval events — **done 7 Oct**: an invoice that starts waiting for approval (over the limit, saved by a bookkeeper) tells owners and accountants; approving it or sending it back tells the people who keep the books, with the approver's note ("Invoice INV-50 for Acme ($2,500.00) needs changes before it can be sent: …"). Once per event, never the person who did it, sent after the save commits (`src/server/services/approvalNotifications.ts`, `bulkRoutes.ts`; tests `approval-notifications.test.ts` with the database)
- [x] S-10 budget.exceeded — **done 7 Oct**: an account budget whose month, quarter or year has spent more than budgeted tells owners and accountants once per period ("$250.00 spent against $200.00 budgeted for October 2026"); on unless turned off in Settings → Alerts (same files and tests as S-08)
- [x] S-11 cash.low — **done 7 Oct**: Settings → Alerts takes an amount; when the bank and cash accounts in the home currency hold less, owners and accountants are told once, and again only after it was back above. The ledger is read only when the books or budgets changed or a month began (same files and tests as S-08; settings `PUT …/alerts`, owners and accountants, audited; `alerts-settings-ui.test.tsx`)
- [x] S-12 job.failed — **done 6 Oct** for what a workspace can act on: a recurring invoice, bill or entry that could not be created (a missing account, a closed month…) now tells the people who keep the books, once per occurrence, with the reason and a link to Recurring Items (`recurring.failed`, can be turned off like the others). The installation-wide daily run's own failures stay on the status page and Settings → Schedule (BB-06), not in every customer's bell
- [x] S-14 user.invited / joined
- [x] S-15 permission.changed — **done 7 Oct**: when an owner changes someone's role, that person alone is told ("Your role is now Accountant · before: Bookkeeper"); the same role again tells nobody. Viewers can get this one notice (`notify(…, { onlyUids })`; tests `role-change-notice.test.ts` with the database)
- [x] S-16 subscription events — **done 7 Oct** (failed charge): when the workspace's own plan could not be charged (`invoice.payment_failed`), the owners are told to update the card in Settings → Billing; the plan ending was already recorded (same files and tests as S-05)
- [x] S-17 transaction.unusual — **done 7 Oct**: the nightly check tells owners and accountants once about an entry of the last two weeks that is at least 3 times its account's usual (median) amount and bigger than anything on it before (with at least 5 earlier amounts and at least 100.00; bank and cash accounts left out): "$4,800.00 on 2026-10-05; it usually sees about $122.50. Check it is right." (`src/lib/unusualEntries.ts`, in `ledgerHealthService.ts`; tests `unusual-entries.test.ts`)
- [x] S-18 Digest vs immediate — **done 7 Oct**: the bell → gear → "By email too": no emails (the default), an email for each notice as it happens, or one email a day with the notices not yet read since the last one (grouped by workspace). Each notice is emailed once, never for an event already told; everything people typed is escaped; nothing is sent without an email provider (docs/FOR_YOU.md #7). The choice is kept by the server (`GET/PUT /api/v1/account/notification-email`; `src/lib/notificationEmail.ts`, `src/server/services/notificationEmailService.ts`, daily job `notificationDigest`; tests `notification-email.test.tsx` with the database)
- [x] S-19 Per-type opt-out (each person, bell → gear)
- [x] T-01 Compound tax (a part charged on top of the others; tested)
- [x] T-02 Tax groups (a tax code with several parts, e.g. GST + PST; tested)
- [x] T-03 Reverse charge (bill carries no tax; posted as due and reclaimable; boxes 2 and 4; tested)
- [x] T-04 Zero-rated vs exempt (treatment on the tax code; reported separately in the return)
- [x] T-05 Party exemption certificates (number and last day on the customer; the invoice says exempt and offers "Charge no tax", or that it ran out; tested; A-55 added the claimed type from a sourced vocabulary — resale, nonprofit, SST/MTC multistate… — kept only from `CERTIFICATE_TYPE_IDS`, the editor's dropdown pending in PartyModal, AI #3 13 Oct)
- [x] T-06 Tax return boxes (generic 9-box layout, home currency, credits included; tested)
- [x] T-07 Filed-return copy (server keeps it, once per period, owners/accountants; tested)
- [x] U-01 Payslip PDF — **done 7 Oct**: on Payroll → pay runs, "Payslips" lists the employees of a posted run, each with a PDF payslip: gross pay, pre-tax deductions, each tax withheld (federal, state, local, Social Security, Medicare), net pay and the year to date up to that run. Only what the run kept is shown, so a later salary change does not alter an old payslip; owners and accountants (`src/server/services/payslipPdf.ts`, `GET …/pay-runs/:id/payslips/:employeeId`; tests in `pay-run-posting.test.ts`)
- [x] U-02 Payroll journal posting — **done 7 Oct, as a fix**: "Post to ledger" on Payroll only changed what the screen showed (nothing was saved, so the entry and the run were gone after a reload), could post to whatever account came first, assumed dollars, and its entry did not balance when an employee had pre-tax deductions. Now owners and accountants choose the bank, wages expense, payroll tax expense and payroll liabilities accounts (suggested by name, only real accounts of the right kind), and the server works out each active employee's pay for the period and posts one balanced entry on the pay date (deductions go to the liabilities with the withholding and employer taxes), saving the run with its per-employee amounts and an audit line. A second run on the same date needs confirming; Undo voids the entry while the date is open (`src/lib/payRunPosting.ts`, `src/server/services/payRunService.ts`; tests `pay-run-posting.test.ts` with the database, `pay-run-ui.test.tsx`)
- [x] U-03 YTD tracking — **done 7 Oct**: the Payroll employee directory shows what this year's posted pay runs paid each employee (gross, withheld, net, number of runs), from the per-employee amounts each run keeps since U-02; undone runs are left out (`yearToDate` in `src/lib/payRunPosting.ts`; tests in `pay-run-posting.test.ts`)
- [x] U-04 PTO accrual — **done 7 Oct**: the Payroll employee directory shows each employee's paid time off in hours and what it is worth (the balance at salary ÷ 2,080 an hour). "Time off" sets the hours earned a year (spread over the pay runs: 52 a year weekly, 26 every two weeks, 12 monthly; only posted runs that paid the employee count, so undone or waiting runs earn nothing) and the hours brought in, and records or removes time taken (a real day, two decimals at most, never more than is available). Contractors earn none; viewers only read (`src/lib/ptoAccrual.ts`, `src/components/hr/TimeOffCell.tsx`; tests `pto-accrual.test.tsx` with hand-checked hours)
- [x] U-05 Benefits and deductions — **done 7 Oct**: each employee on Payroll has "Deductions" (under the period net pay): named pre-tax deductions (401(k), health, HSA: lower the taxable pay, exactly like the one pre-tax amount kept before) and after-tax ones (Roth, union dues), each a fixed amount a pay period or a percent of gross pay. The dialog shows this period's gross, taxes, deductions and net, and says when a deduction is cut because not enough pay is left (pay never goes below zero). Every deduction is credited to payroll liabilities, so the pay run still balances; the payslip lists each by name in its place (`src/lib/payrollDeductions.ts`, `computePeriodPayroll`, `src/components/hr/DeductionsCell.tsx`; tests `payroll-deductions.test.tsx`). Employer contributions (a 401(k) match, the employer's share of health) are not in it yet
- [x] U-06 Garnishments — **done 7 Oct**: a deduction can be a garnishment (a court or agency order: child support, a levy), a fixed amount or a percent of disposable earnings (gross pay less the taxes withheld), taken after taxes and before after-tax deductions, and never more than the order's limit (25% of disposable earnings unless the order allows more, at most 65%); the dialog says when it is held to the limit, and the payslip shows it as a garnishment (same files and tests as U-05)
- [x] U-07 Multiple pay schedules — **done 7 Oct**: a pay run pays everyone or one schedule (monthly, every two weeks, weekly people); the preview and the posted entry follow it. Paying the same people twice on one date asks first; another schedule on that date is fine (`schedule` on the run; `payRunTotals(…, schedule)`; tests in `pay-run-posting.test.ts`)
- [x] U-08 Contractor vs employee — **done 7 Oct**: a person on Payroll is an employee (taxes withheld) or a contractor (paid in full: nothing withheld, no employer taxes; the run still balances). The employee directory marks contractors, and "1099-NEC for <year>" lists contractors paid $600 or more by this year's posted pay runs (`workerType` on the employee; `contractorsToReport` in `src/lib/payRunPosting.ts`; tests in `pay-run-posting.test.ts`)
- [x] U-09 Direct deposit file — **done 10 Oct**: on a posted pay run, "Direct deposit file": each person's net pay and bank account (added or changed right there, kept on the employee; routing numbers checked by their check digit; account numbers shown as the last 4 digits), the company's bank details (kept in that browser only), and a NACHA (ACH) file of credits (PPD, checking 22 / savings 32) to upload to the bank, dated for the pay date. People without an account are left out and named. Nothing is posted (`src/lib/nacha.ts`, `DirectDepositDialog.tsx`; tests `direct-deposit.test.tsx`)
- [x] U-10 Payroll approval — **done 7 Oct**: on Payroll → Pay runs an owner can tick "An owner approves pay runs that others prepare". Then an accountant's run is saved with its per-employee amounts but not posted, and the owners are told in the bell; an owner sees what it pays and costs and who prepared it, and either approves it (exactly those amounts are posted, even if a salary changed since, with the same checks as posting: real accounts, the period lock, the same people twice on one date) or sends it back with a note, and whoever prepared it is told. The preparer can withdraw it while it waits; there are no payslips until it is posted; owners' own runs post straight away. Pay runs are now written only by the server (members still read them), so a run cannot be marked approved or posted from the browser (`approvePayRun`, `rejectPayRun`, `setPayrollApproval` in `src/server/services/payRunService.ts`, `src/components/hr/PayRunApprovals.tsx`, migration `20261013020000_pay_runs_server_only.sql`; tests `pay-run-posting.test.ts` with the database, `pay-run-ui.test.tsx`, `rls.test.sql`)
- [x] U-11 Timesheet-driven pay — **done 11 Oct**: on Payroll each employee's "Salary" / "Hourly" opens how they are paid: a yearly salary, or by the hour (rate, and whose approved time on Time pays them). A pay run pays each hourly employee's approved time up to the pay date that no earlier run paid, at their rate (minutes × rate ÷ 60, whole cents); nobody is paid for no time. The payroll engine is unchanged: the period's pay goes in as the yearly salary it would be, which it divides back to exactly the same gross, so taxes and deductions work as for everyone. The run marks that time paid (locked on Time); sending the run back, withdrawing or undoing it frees the time. The run preview uses the same time (`src/lib/hourlyPay.ts`, `HourlyPayCell.tsx`, `payRunService.ts`; tests `hourly-pay.test.ts`)
- [x] V-01 Time entries — **done 10 Oct**: Time (menu, Money in): log a day, how long (1:30, 1.5, 90m), what was done, customer, project; everyone logs their own, owners and accountants see everyone's and log for others; kept with the workspace's documents (kind "timeEntry", server-written; no migration) (`src/lib/timeEntries.ts`, `timeService.ts`, `TimeView.tsx`; tests `time-tracking.test.tsx`)
- [x] V-02 Timer — **done 10 Oct**: Time → "Start a timer": it runs in that browser even if the page is closed; "Stop the timer" puts how long it ran (whole minutes, rounded up) and what it was for into Log time (`TimeTimer.tsx`, `timerMinutes`; tests `time-tracking.test.tsx`)
- [x] V-03 Billable flag — **done 10 Oct** with V-01: billable time needs its customer; only billable time is invoiced
- [x] V-04 Rate hierarchy — **done 10 Oct**: Time → Hourly rates (owners, accountants): by project, customer and person; an entry uses its own rate, else its project's, its customer's, its person's; values in whole cents (minutes × rate ÷ 60, rounded once)
- [x] V-05 Timesheet approval — **done 10 Oct**: "Submit my time"; owners and accountants approve (one by one or all) or send back with a note (the person is told); submitted time is changed only by an approver; invoiced time is locked; audited
- [x] V-06 Time → invoice line — **done 10 Oct**: Time → Bill approved time: for a customer, approved billable time not yet invoiced becomes a draft invoice (a line per entry: day, what, hours, rate, amount), and the entries are marked invoiced on it; the invoice is reviewed and sent from Sales as usual
- [x] V-07 Project budget vs actual — **covered (10 Oct)**: each project on Projects shows its budget (editable in place), what was spent and earned on it, and the share of the budget spent as a bar (`ProjectsView.tsx`, `Projects.tsx`). By label, Profit by Label (CB-25) gives each project's income and costs account by account.
- [x] V-09 Milestone billing — **done 10 Oct**: a sales order (an accepted estimate) keeps a milestone schedule in its Invoice dialog ("Set milestones": name, percentage, optional date; 100% at most); "Invoice the next milestone" fills its percentage of the order (K-04) and marks it invoiced once the draft invoice is made; the order's row says when a milestone is due. Customers sign estimates online (Y-20) (`src/lib/milestones.ts`, `MilestoneSchedule.tsx`; tests `milestones.test.tsx`)
- [x] W-01 Stock per location — **done 7 Oct**: no second quantity field. Stock per location is the stock history (W-02) added up by the Location label.
  - **Where each change lands:** sales and returns are where their invoice line's label says, and returns come back where they left from. Purchases, opening stock and adjustments go where the Adjust stock dialog says (optional). A count at a location is compared with what is there.
  - **Moving stock:** "Move stock between locations" (in the item's Stock history) moves units without posting, since the total and the books don't change. It refuses more than is at the "from" location or a closed date, and is audited.
  - **What the window shows:** how much is at each location. Stock from before the history, or never placed, is "No location".
  - Code: `stockByLocation` and `transferProblem` in `src/lib/stockMoves.ts`, `stockTransferService.ts`, `POST /api/v1/inventory/transfer`. Tests: `stock-locations.test.tsx`, with the database. The original plan was: stock per location is a sum of the movement ledger (W-02), not a second quantity field. A transfer between locations is two movements in one database transaction
- [x] W-02 Stock-moves ledger — **done 7 Oct**: the new table `stockMoves` (server writes only, members read; migration `20261013060000_stock_moves.sql`).
  - **What is recorded:** every change to an item's quantity, written with the change in the same database transaction: sales and their reversals (each entry in order), purchases, opening stock, adjustments, counts, imported opening stock and the manual cost-of-goods-sold entry.
  - **Each record keeps:** the quantity before and after, its value, and the entry and document it belongs to.
  - **On Inventory:** "Stock history" on each item lists the changes, links each to its entry, and says when the history does not end at the quantity on hand.
  - **The nightly check:** "stock-history" reports such an item.
  - **Backup:** a backup carries the history, and restore replaces it.
  - **Bug fixed on the way:** undoing an import of items looked for invoice lines under `lines`, but invoices keep them under `items`, so an imported item already sold could be removed. Any recorded movement other than the import's own opening stock now keeps the item.
  - Tests: `stock-moves.test.tsx`, with the database. The original plan was: the source of truth for quantities. Every movement is one row with the item, location, quantity, unit cost, its document and its ledger entry: a sale or delivery, a receipt, an adjustment, a count, a return, or a transfer. An item's quantity is the sum of its rows; today's stored quantity becomes a cache that is checked against them. Unblocks J-10 and BA-03
- [x] W-03 COGS posting on sale + stock moves with the ledger (tested)
- [x] W-04 Stock count: enter counted quantities for any items; one entry for all differences (tested)
- [x] W-05 Count variance account: chosen per count (default: an expense named shrinkage/adjustment/variance, else Cost of Goods Sold)
- [x] W-06 Negative-stock policy — **done 7 Oct**: one explicit rule.
  - **By default:** an invoice that sells more than is on hand is recorded, stock goes below zero, and a warning says so. Simple books are never blocked.
  - **Owner switch:** on Inventory, an owner can turn on "Refuse sales beyond stock". Then the server refuses any sale that would take an item below zero, and nothing of it is written. Sales within stock still work, and putting stock back (a reversal) is never refused.
  - **Who sees what:** others see a line saying sales beyond stock are refused.
  - **How it is stored:** only the server writes the setting (`refuseNegativeStock`, owners only, audited). No database change was needed.
  - **Unchanged:** stock adjustments never go below zero, and the manual cost-of-goods-sold entry always refuses it.
  - Code: `stockPolicyService.ts`, `PUT /api/v1/inventory/stock-policy`, the check in `cogsStockService.ts`, `StockPolicySwitch.tsx`. Tests: `stock-policy.test.tsx`, with the database.
- [x] W-09 Aging + slow-moving reports — **done 10 Oct (Claude)**: Reports → Stock Aging: as of a day, each item's stock on hand split by how long ago those units came in (0–30, 31–90, 91–180, 181–365 days, over a year; first in, first out; a purchase undone takes back the latest units; moves between locations keep the age; stock from before the history said apart), its value and its last sale with how long ago, the oldest stock first; from the server's stock history (`stockAging` in `src/lib/stockMoves.ts`, `GET /api/v1/reports/stock-aging`, `StockAgingReportView.tsx`; tests `stock-aging.test.tsx`). Slow-moving items by sales on invoices were already on Inactive Items.
- [x] X-01 Asset from a bill — **done 7 Oct**: "Add asset" on the Fixed Asset Register offers "From a bill": bill lines on a fixed-asset account (not cash, receivables, stock, prepayments or accumulated depreciation; not drafts or voids) that are not in the register yet. Picking one fills the name, cost, purchase date and asset account; the asset keeps the bill line it came from, so it is not offered twice (`src/lib/assetFromBill.ts`; tests `asset-from-bill.test.tsx`)
- [x] X-02 Depreciation schedule report — **done 7 Oct**: on the Fixed Asset Register, "Schedule" under each asset opens its depreciation by year (depreciation, accumulated and book value at the year end, and whether the month-end run already posted it), and "Monthly schedule (.csv)" downloads every month. Worked out by the same engine the run posts from, by the asset's own method (`depreciationSchedule`, `scheduleByYear` in `src/lib/depreciationEngine.ts`; tests `depreciation-schedule.test.tsx`)
- [x] X-03 Disposal with gain/loss — **done 7 Oct**: Fixed Asset Register → "Sell or scrap" (owners, accountants, bookkeepers): the date, what was received (0 if scrapped), where the money went and the account for the gain or loss, with the book value and the gain or loss shown before posting. One balanced entry on that date posts the depreciation still due through the month, takes the cost and all accumulated depreciation off the books, records the money and the gain (credit) or loss (debit); the asset is marked disposed and leaves the register totals. "Undo disposal" voids that entry and puts the asset back while the date is open; the period lock applies (`src/lib/assetDisposal.ts`, `src/server/services/assetDisposalService.ts`; tests `asset-disposal.test.ts` with hand-checked cents and the database, `asset-disposal-ui.test.tsx`)
- [x] X-04 Partial disposal — **done 7 Oct**: "Sell or scrap" → How much → "Part of it" and the share (for example 2 of 5 vans: 40%). One balanced entry on that date posts the depreciation still due for the whole asset, then takes only that share of the cost and of the accumulated depreciation off the books, with the money received and the gain or loss on the share; the dialog shows the share's book value, the gain or loss and the cost that stays first. The asset stays active on the smaller cost and salvage value and keeps depreciating from there without a jump; the register lists each part sold, and "Undo last part sold" takes the latest back while its date is open and no depreciation was posted after it (`portionOf`, `partialDisposalInput` in `src/lib/assetDisposal.ts`, `disposeAsset` with `portionPercent`; tests `asset-disposal.test.ts` with hand-checked cents and the database, `asset-disposal-ui.test.tsx`)
- [x] X-05 Asset transfer — **done 7 Oct**: "Move" on the Fixed Asset Register: the day, a new location, and if it changes class the asset account and the accumulated depreciation account it moves to; the dialog says what will be posted first. A move between accounts is one balanced entry on that day (the cost to the new asset account, the depreciation posted so far to the new accumulated depreciation account), nothing gained or lost; a move of place only is not posted. The register shows the latest move, and "Undo last move" takes it back while its date is open (`src/lib/assetTransfer.ts`, `src/server/services/assetTransferService.ts`, `POST/DELETE …/assets/:id/transfer`; tests `asset-transfer.test.tsx` with the database)
- [x] X-06 Maintenance log — **done 10 Oct (Claude)**: on the fixed asset register, each asset's "Maintenance log": every service, repair or inspection (day, what was done, by whom, cost) newest first with the cost in all, noted in place by anyone who keeps the books; noting one can set the next service, which is also editable in place and reminded like the warranty, 30 days before, on the register and once in the bell (nightly job). The cost is a note: the service's bill books it (`src/lib/assetMaintenance.ts`, `MaintenanceLog.tsx`, `assetReminders.ts`, `assetReminderService.ts`; tests `asset-maintenance.test.tsx`). **11 Oct, AI #3 A-8 client follow-up on `arena/ff49edf9-ledgerflow` (awaiting review):** confirmed metadata-only saves update the scoped cache, refuse double submission, retain refused drafts, validate real calendar days, and refuse the 501st note without discarding history. Files reuse `documents` with the actual `assets` link and load only when the log opens. Tests: `asset-metadata-workflow.test.tsx`, `asset-metadata-persistence.test.ts`, `e2e/agent3-assets-purchases.spec.ts` (phone refusal/retry/removal/upload, long notes, and no changed financial fields).
- [x] X-07 Asset tag / barcode — **done 10 Oct (Claude)**: each fixed asset has a tag (editable in place); "Give tags" numbers those without one AT-0001… after the highest in use, oldest first (disposed and hand-typed tags left alone); "Print labels" opens a printable sheet with each tagged asset's tag, name and company and a QR code of the tag; the register's Find takes a tag (what a phone reads from the label), a name or a place (`src/lib/assetTags.ts`, `AssetLabels.tsx`, `FixedAssetsView.tsx`; tests `asset-tags.test.tsx`). **11 Oct, AI #3 A-8 client follow-up (awaiting review):** tag/service inline fields now pass the metadata allowlist; manual tag edits check all workspace tags, including disposed assets, with trimmed case-insensitive duplicate refusal. Labels retain QR and add Code 128-B SVG, the purchase date, isolated print content and focus recovery after printing. Independent checksum/quiet-zone fixtures and real Chromium PDF/focus/320px checks pass (`code128.ts`, `assetTagAdapter.ts`, `asset-metadata-workflow.test.tsx`, `e2e/agent3-assets-purchases.spec.ts`). **16 Oct verification (AI #3):** main now includes `20261014010000_unique_asset_tags.sql`, and `asset-metadata-persistence.test.ts` verifies database-enforced trimmed/case-folded uniqueness on a clean migrated Postgres. **Deployment check for AI #1:** the migration skips index creation if legacy duplicates exist; resolve duplicates and confirm deployed `assets_workspace_tag_uq`. The existing bulk Give tags action remains cache-based; no production database was inspected. Non-ASCII legacy tags retain QR rather than being changed.
- [x] X-08 Warranty / insurance alerts — **done 7 Oct**: each asset on the Fixed Asset Register has "Warranty ends" and "Insurance renews" dates (edit in place). From 30 days before (and on the day), the register says "The warranty on … ends in 12 days", and a nightly job tells the owners, accountants and bookkeepers in the bell, once for each date (in the workspace's own date; a new date is told again); disposed assets are left out (`src/lib/assetReminders.ts`, `src/server/services/assetReminderService.ts`, daily job `assetReminders`; tests `asset-reminders.test.tsx` with the database)
- [x] X-09 Construction in progress — **done 7 Oct**: "Still being built" when adding an asset (with the construction-in-progress account its bills are posted to and the day building started). While it is built it does not depreciate (the month-end run and the close checklist skip it) and "Add cost" records each cost as it comes in. "Place in service" (the day it was ready, the asset account it belongs in, its life and end value) posts one entry moving the cost out of construction in progress, and depreciation starts the month after; the register shows when building started. "Undo placing in service" makes it in progress again while its date is open and before it was depreciated, sold in part or moved (`src/server/services/placeInServiceService.ts`, `POST/DELETE …/assets/:id/in-service`, `src/components/assets/ConstructionActions.tsx`; tests `construction-in-progress.test.tsx` with the database)
- [x] Y-01 QIF import (AI #4, PR #45; merged 6 Oct)
- [x] Y-02 BAI2 import (AI #4, PR #45; merged 6 Oct)
- [x] Y-03 Saved CSV column map per bank (by header; tested)
- [x] Y-08 Bank feed re-auth flow (reconnect when the bank login expires; tested)
- [x] Y-09 Split one bank line (tested)
- [x] Y-10 Match one bank line to many invoices/bills → payment record (tested)
- [x] Y-11 PDF template designer — **done 10 Oct**: Settings → Branding → Page style: Classic, Bold header band (company and title in white on the brand colour) or Minimal (no coloured fills), and "Leave out the quantity column"; with the logo, colour, address, footer, terms, payment QR and language already there, and Preview PDF before saving. Found with it: saving Branding dropped the documents' language (P-11), now kept (`pdfService.ts`, `brandingRoutes.ts`; tests `document-pdf.test.ts`)
- [x] Y-12 Logo upload (Settings → Branding & PDFs; PNG/JPEG up to 200 KB, checked by the server)
- [x] Y-13 Brand colour on documents (title, rule and table header)
- [x] Y-14 Custom footer / terms (footer on every page, terms at the end, address under the name)
- [x] Y-15 QR code on invoices (to the invoice's payment page once sent; can be switched off)
- [x] Y-16 Watermark: DRAFT, VOID (void/cancelled) and PAID (invoices, bills) stamped across every page of document PDFs; statements and receipts never (tested)
- [x] Y-17 Page numbers ("Page x of y"; long documents run over pages with the table header repeated)
- [x] Y-18 Batch PDF zip: tick invoices or bills in their lists → "Download PDFs (zip)"; up to 100 per zip, only this workspace's documents (tested)
- [x] Y-19 Print stylesheet — **done 10 Oct (Claude)**: printing a report already showed only the report (Reports → Print / PDF); now paper is always light (the default dark theme's pale text printed faint on white), table headings repeat on every page, rows and charts aren't split across pages, and shadows are left out (`src/index.css`).
- [x] Y-20 Digital signature — **done 10 Oct**: on Sales → Estimates, "Ask to sign" makes the estimate's private link (`/e/…`, copied; asking again gives the same one; not for drafts, declined, converted or expired estimates). The customer reads the estimate and signs with their full name and "I accept"; the server keeps who, when, the address and the browser, and the estimate becomes an order (as with Order, K-04), with an audit line and a notice to the people who keep the books. Signed once; the estimate's PDF says who signed. No migration (`src/lib/estimateSignature.ts`, `estimateSignService.ts`, `PublicEstimatePage.tsx`; tests `estimate-signature.test.tsx`)
- [x] Y-21 Multiple contacts per company (people with role, email, phone on the customer/vendor form and page)
- [x] Y-22 Default currency per contact (new invoices and bills start in it; bills got a currency and rate field)
- [x] Y-23 Merge duplicate contacts: "Merge a duplicate" on a customer's or vendor's page (owners/accountants); likely duplicates listed first; the server moves invoices/bills, estimates, credits, payments, schedules and ledger references in one step, no amount changes, details combined, audited (tested)
- [x] Y-24 Contact tags (on the form, shown on the page, filter chips on the customer and vendor lists)
- [x] Y-25 Notes timeline per contact (newest first, who and when; viewers read)
- [x] Y-26 Portal access toggle — **covered (10 Oct)**: each customer's portal link has "Turn off" (the link stops working at once) and can be made again (`CustomerPortalLink.tsx`, `customerPortalRoutes.ts`).
- [x] Y-27 Preferred delivery method: each customer and vendor says how their documents reach them — Email (the default, and what happened before anyone could choose), Print, Post, or Nothing automatic. Set it in the contact form or on the contact's page (viewers read). Only what the app does by itself obeys it: the daily payment reminder, the monthly statement batch and emailing an invoice when it is saved as "sent" — a customer who gets paper is left out of the statements and their reminder is put in the bell for someone to print or post instead. Pressing Email still sends (it is a person deciding) and the send log says "against their choice" (tested)
- [x] Y-28 Statement send preference: Settings → Emails → "Email each customer their statement on the 1st of every month" (customers with something open; the daily job, once a month, a missed 1st made up the next day); each customer's page has "Monthly statement: email it" to leave them out (tested; database rule: customers.noStatements)
- [x] Y-30 2FA enforcement policy — **done 7 Oct**: Settings → Security → "Sign-in rule for this workspace" (owners). It can only be turned on from a session that passed two-step login, so an owner cannot lock themselves out. Then anyone in the workspace who has not set up an authenticator app sees "Set up two-step login" (which workspaces ask for it, the authenticator setup, Continue) instead of the books, and everyone signs in with a code. The server's token check refuses their password-only sessions (a 403 with a setup code, not a sign-out) and the database rules show them nothing; people in other workspaces are unaffected; turning it off lets them in at once (`requireTwoStep` on the workspace, server-only; `src/server/services/twoStepPolicyService.ts`, `PUT …/security/two-step`, `GET /api/v1/account/two-step`, `src/core/auth/TwoStepSetupScreen.tsx`, migration `20261013040000_require_two_step.sql`; tests `require-two-step.test.ts` with the database, `require-two-step-ui.test.tsx`, `rls.test.sql`)
- [x] Y-31 Password policy — **done 7 Oct**: a password must have at least 10 characters, not be one of the most used (and keyboard runs), not contain your email name, and not repeat one character; sign-up says so under the field and refuses a weak one before asking for an account. Found and fixed with it: a password-reset link signed people in but never asked for a new password; now "Choose a new password" (typed twice, same rules) comes first. Supabase's own minimum is for you to set (docs/FOR_YOU.md #26) (`src/lib/passwordPolicy.ts`, `src/core/auth/NewPasswordScreen.tsx`, `setNewPassword` in `src/lib/db/auth.ts`; tests `password-policy.test.tsx`)
- [x] Y-33 Branding settings page (with "Preview PDF" of unsaved choices; owners and accountants)
- [x] Y-34 Default terms per document type (invoices, estimates, credit notes, statements, receipts)
- [x] Z-01 OpenAPI spec from code — **done 7 Oct**: `GET /api/v1/openapi.json` is an OpenAPI 3.1 description of the transaction endpoints (list with paging, fields and ETags; create; batch create; change with If-Match; delete) and both ways in (API key, session token). The entry shape is generated from the schema the server checks requests with (`TransactionSchema` → JSON Schema), so it cannot drift; a test checks every described path is a real route (`src/server/openapi.ts`; tests `openapi.test.ts`)
- [x] Z-02 Per-key rate limits — **done 7 Oct**: requests made with an API key count against that key's own limit a minute (chosen when the key is made, "Requests a minute (this key)" on the API keys screen; 120 unless chosen), not the caller's IP, so one busy integration does not use up another's; over it the answer is a 429 with `RateLimit-*` headers. Documented in `API_DOCS.md` (`apiKeyRateLimiter` in `src/server/middleware/rateLimiters.ts`, applied in `apiAuthenticate`; tests `api-key-rate-limit.test.ts` with the database)
- [x] Z-03 Batch create endpoints — **done 7 Oct**: `POST /api/v1/transactions/batch-create` creates up to 500 entries in one request, all or none, each checked as a single entry is (schema, balanced lines, accounts, the period lock, a unique id); a refusal names the entry by its index and writes nothing; a batch counts in full against the plan's entry limit. Documented in `API_DOCS.md` (`src/server/routes/transactions/crudRoutes.ts`; tests `batch-create.test.ts` with the database)
- [x] Z-04 Sparse fieldsets — **done 7 Oct**: `?fields=date,description,totalAmountCents` on the API's transaction list returns only those fields of each entry (and its id), one level into an object too (`metadata.invoiceId`); a bad name or more than 50 fields is a 400; without it, whole entries as before. Documented in `API_DOCS.md` (`src/server/http/sparseFields.ts`; tests `sparse-fields.test.ts` with the database)
- [x] Z-05 ETag — **done 7 Oct**: every API read answers with an `ETag`, and the same read with `If-None-Match` is a `304` with no body (shown for the transaction list); `PUT /api/v1/transactions/:id` takes `If-Match: "<updatedAt>"` and answers `412` with the current entry when it changed since, saving nothing (the existing `expectedUpdatedAt` check, 409, still works). Documented in `API_DOCS.md` (`ifMatchVersion` in `src/server/routes/transactions/helpers.ts`; tests `etag.test.ts` with the database)
- [x] Z-06 Client SDK — **done 7 Oct**: `sdk/ledgerflowClient.ts`, a typed client with no dependencies: list entries across pages (with fields and dates), create one or a batch (each with an Idempotency-Key, so a retry never creates twice), change with If-Match, delete; it waits and retries when the key's limit a minute is reached and throws `LedgerFlowError` with the status and message on a refusal. Documented in `API_DOCS.md` (tests `sdk-client.test.ts`, against the real server with an API key)
- [x] Z-07 Duplicate invoice number check
- [x] Z-08 Duplicate vendor bill ref check
- [x] Z-09 Negative inventory check
- [x] Z-10 Future-dated posting check
- [x] Z-11 Non-zero suspense check (suspense, uncategorized and clearing accounts not at zero; Data Health, tested)
- [x] Z-13 Stale unreconciled check (bank lines unmatched over 30 days, one finding per bank account, opens Reconcile; tested)
- [x] Z-14 Empty invoice / accountless line check
- [x] Z-15 FX line with no rate check
- [x] Z-28 Connection health monitor — **done 10 Oct (Claude)**: Banking → Connected banks says each connection's health in words (connected; not synced yet; no sync for N days after 3; login expired; the last sync failed, with the bank's code), and Needs attention lists a connection whose last sync failed or that has not synced for more than 3 days. A bank that fails no longer stops the others: the sync goes on, says which failed and why (`failed`), and fails only when every connection failed (`bankHealth` in `src/lib/bankFeedStatus.ts`, `plaidRoutes.ts`, `needsAttention.ts`; tests `plaid.test.ts`, `connected-banks.test.tsx`, `bank-feed-sync.test.tsx`, `needs-attention.test.tsx`).
- [x] Z-29 Sync log per integration — **done 10 Oct (Claude), for bank connections**: each sync attempt is kept on its connection (the last 20, newest first: when, synced with how many bank lines, login expired, or failed with the bank's code) and shown under "Sync history" on Connected banks (`appendSyncLog`, `syncLog` on the bank; same tests). Emails sent keep their own send log already; **open:** a log for the other integrations (payments).
- [x] Z-30 Disconnect with cleanup — **done 8 Oct (Claude)**: Bank Connections lists the connected banks (state, last good sync, Reconnect when the login expired) and owners and accountants can Disconnect one, after a confirmation. The bank is told to stop (Plaid removes the connection, so nothing more is downloaded or billed), then the stored connection and its encrypted token are deleted; the bank lines already imported stay, with everything posted from them; an audit line is written. If the bank can't be told, nothing is removed and it says to try again; one the bank no longer knows is removed here (`POST /api/v1/plaid/disconnect`, `ConnectedBanks.tsx`; tests `plaid.test.ts`, `connected-banks.test.tsx`).
- [x] Z-31 Recent items Last ten distinct openRecord references, scoped by user/workspace, persisted locally and reopened through typed links; store and Chromium tests.
- [x] Z-32 Deep links to any record
- [x] Z-33 Grouped search results Search results grouped by kind; transactions/accounts/invoices/bills open typed records. Unicode comparison matches vocalized Hebrew; Chromium and grouping tests. Removed duplicate palette mounting and made the remaining palette a named dialog.
- [x] Z-34 Web app manifest — Overview launch, brand PNG/Apple icons; six-screen 390px keyboard/layout checks (AI #2, C-22).
- [x] Z-35 44px touch targets Phone buttons, fields and checkbox/radio targets have 44px minimums; compact virtual transaction rows remain at least 44px on phones. Chromium verifies controls, selection, navigation and no page overflow.
- [x] BA-01 Merge duplicate contacts dialog (= Y-23)
- [x] BA-02 Vendor opening balance (customers too): on a vendor's or customer's page, type what was owed on the day the books start and press Enter. It becomes one open bill (invoice) booked against Opening Balance Equity (added if missing), so aging, statements and balances include it and it is paid like any other; not counted as sales or expenses (Sales by Item leaves it out); entered once, then shown (tested)
- [x] BA-03 Allocate landed cost — **done 9 Oct (Claude)**: on a bill with a stock item (J-08), another line can be marked "Spread over the items (freight, duty)". It posts to Inventory too, and its amount is added to the item lines' values in proportion to them (by units when they cost nothing), in whole cents that add up exactly, so the items' average cost includes getting them in (`billStockLines` in `src/lib/billStock.ts`; tests `bill-stock-lines.test.ts`, `bill-stock.test.ts` against the real server, `bill-stock-ui.test.tsx`). Without a stock item on the bill the mark does nothing.
- [x] BA-04 Inventory adjustment form (= K-13)
- [x] BA-05 Item category management: rename, merge or remove a category on all its items at once (Inventory → Manage categories; tested)
- [x] BA-06 Add-a-currency dialog: invoices and bills offer the home currency, the ones the workspace uses and 35 common world currencies; switching to one fills the exchange rate (the last rate used for it at once, then today's rate from the rate service; never a guessed number; a typed rate is kept) and says where it came from (tested). A Currencies settings page (BB-02): done 10 Oct
- [x] BA-07 Numbering per document type: Settings → Document Numbering (prefix, next number, digits, live preview) for invoices, bills, estimates; a number already used is refused, so numbers never repeat; owners/accountants; audited (tested)
- [x] BA-08 PDF preview per document type: purchase orders (branded, with terms from Branding), bills and vendor credits join invoices, estimates, credit notes, receipts and statements; Preview/Download on each list (tested)
- [x] BA-09 Quick payment from a list row (invoice and bill rows open the payment dialog)
- [x] BA-10 Allocate a credit note to an open invoice (tested)
- [x] BA-11 Allocate a vendor credit to an open bill (tested)
- [x] BA-12 Refund a credit note (dialog)
- [x] BA-13 Refund a vendor credit (dialog)
- [x] BA-15 Partial period unlock (date range, reason, close again)
- [x] BA-16 Branch activate / deactivate — **covered by dimensions (checked 7 Oct)**: a branch is a value of a dimension (Settings → Dimensions, e.g. a "Branch" dimension); Archive deactivates it and Unarchive brings it back (saved with Save changes). An archived branch is hidden from new entries while the entries that already carry it keep it (`DimensionsSettings.tsx`, the entry form's dimension pickers)
- [x] BA-17 Money-In / Money-Out dialogs — **done 2026-10-05**: "Money in" and "Money out" on the banking page
  (`src/components/banking/CashMovementDialog.tsx`, the rules in `src/lib/cashMovement.ts`): how much, which of
  your accounts it lands in or leaves, which account it belongs to, and a name and a reference if there is one.
  It posts **one balanced entry** through the ordinary save path — server-checked, survives a reload — never a
  side list. Three things are refused, each with the reason said out loud: another of your own accounts (that is
  a transfer, and the transfer dialog is what keeps it out of income and expense), a receivable or payable account
  (money that settles an invoice or a bill goes on that document, otherwise the document keeps reading as owed),
  and an amount that is not a positive whole number of cents. Words the workspace has used before are suggested,
  and the account used most is offered first; the bank line carries no description on purpose, so what the
  workspace learns from the entry points at the account the money is for and not at the bank. Someone who only
  reads sees the dialog and its words, with no button. This is also the first half of an advance payment: money in
  booked against the customer deposits account is what a later deposit invoice draws down (see the note on
  BE-05). (tested: 14 on the rules, 7 on the dialogs)
- [x] BA-18 Import uncategorised transactions — **covered (10 Oct)**: a bank statement (CSV, QIF…) imports lines without categories; rules and past patterns categorise what they can and the rest wait as bank lines to review on Reconcile (`StatementImporter.tsx`, `importActions.ts`).
- [x] BA-19 Branding templates screen (= Y-33)
- [x] BA-20 Export dialog
- [x] BB-01 Categories — **covered (10 Oct)**, see K-33.
- [x] BB-02 Currencies — **done 10 Oct (Claude)**: Settings → Currencies: the workspace's own currency, every other currency its invoices and bills use (how many, how many still open, the newest rate posted and when; never an invented rate), a link to Reports → Exchange Rates Used, and the month-end revaluation of what is still open (R-07), which until now was only inside the currency converter (`currenciesInUse` in `src/lib/exchangeRates.ts`, `CurrenciesSettings.tsx`; tests `currencies-settings.test.tsx`).
- [x] BB-03 Defaults — **done 5 Oct**: Settings → Defaults lists each kind of posting (A/R, A/P, sales, expenses, bank, sales tax payable, tax paid on purchases, customer deposits, vendor prepayments, prepaid expenses) with the account it uses now: the chosen one, or "Automatic (…)" by the posting's own rule (`src/lib/accountDefaults.ts`), or a warning when the chart has none. Choosing saves at once (owner/accountant; others read), keeping other mappings. The keys are the ones the postings read (`customer deposits`, `vendor prepayments`, `prepaid expenses` now match the invoice posting's spelling). Not here: default payment terms (they come from the customer or their last invoice, I-23; a workspace-wide default needs a new workspace field and so a database migration, left for later) and the default tax code (marked on the tax code itself). Tests: `defaults-settings.test.tsx`; the tab is in the browser view-coverage test
- [x] BB-04 Email (Settings → Emails & Reminders: templates, reminders, thank-you emails, monthly statements)
- [x] BB-05 Localisation — **done 10 Oct**: menus stay in English (owner decision 10); everything regional is in Settings → Appearance: time zone and fiscal year start (workspace), date format (each person), and now money display for the whole workspace — a country's number style (separators and where the symbol goes) and negatives with a minus or in brackets, with a live sample (owners and accountants; display only, `moneyDisplay`, its database rule already applied). Documents print in English or Hebrew (P-11) (`MoneyDisplayPanel.tsx`; tests `money-display-panel.test.tsx`)
- [x] BB-06 Schedule (UI over jobRuns): Settings → Schedule — anyone signed in may read it, and there is nothing to change — says what the
  once-a-day run takes care of — the recurring drafts, the reminders and statements, the notices, the clearing away of logs past their
  time — when it last ran, whether anything in it went wrong (with the words the job said), and when it is next due. The daily run now
  records what each job answered, not only that one of them failed, and a run that was silent about a job is shown as "not reported"
  rather than as all clear. Read-only on purpose: when jobs run is the installation's schedule (`vercel.json`'s cron + its secret), so a
  switch here would promise something the app cannot do, and there is deliberately no "run it now" button — that would email people on
  demand; the fix for a failed job is what it failed about, which is written next to its name. The rules and the sentences are in
  `src/lib/jobSchedule.ts`, mounted at `GET /api/v1/schedule` (signed in; only the run's timings, no counts — the status page has less
  for anyone). Two lists that must not drift are held together by tests: the jobs the cron route runs, and the jobs this screen
  describes; and the time the screen calls "due" is read out of `vercel.json`. (tested: 15 on the rules, 5 on the tab, plus its
  settings tab in the browser suite)
- [x] BB-08 Invoice settings (Settings → Branding & PDFs for logo, colours, footer and terms; Document Numbering; default terms per document type, Y-34)
- [x] BB-09 Settings search: ⌘K finds every screen, report and settings tab, settings also by what they're about ("logo", "invoice number", "2fa"); opens at once (the palette's 0.4 s pause before every action removed) (tested)
- [x] BC-01 Configurable widget grid
- [x] BC-02 Per-role dashboards — **done 10 Oct**: on the Overview, Customize widgets → "Starting dashboard for" a role (owners, accountants, bookkeepers, viewers) → "Give them this layout" (owners). Anyone who has not arranged their own dashboard starts from their role's; Reset layout goes back to it. Saved on the workspace by the server (`roleDashboards`, owners only, audited; no migration) (`startingLayout` in `src/lib/dashboardOverview.ts`, `roleDashboardService.ts`; tests `dashboard-widgets.test.tsx`, `role-dashboards.test.ts`)
- [x] BC-03 Dashboard date range
- [x] BC-04 Widget refresh — **done 10 Oct (Claude)**: the dashboard's figures follow live changes already; what Needs attention reads from the server once (bank logins, last month's close sign-offs) is now read again when the tab comes back into view and every 5 minutes (`useRefreshTick`, `NeedsAttentionCard.tsx`; tests `refresh-tick.test.tsx`).
- [x] BC-05 Prior-period comparison
- [x] BC-06 KPI sparklines
- [x] BC-07 KPI drill-through
- [x] BC-08 Receivables widget
- [x] BC-09 Payables widget
- [x] BC-10 Account balance widget
- [x] BC-11 Bank feed health widget — stored last successful sync shown; null/legacy missing distinguished, expired status retained; client parser/DOM and existing cancellation tests verified (AI #2, C-16 follow-up).
- [x] BD-01 Practice view — **done 10 Oct (Claude, taken over from AI #5's E-1, which had waited since 6 Oct)**: "All my books" (Overview group, and ⌘K): one row per workspace the person can open, with their role, currency and groups (DA-01); bank lines to review, banks to log in to again, questions waiting, drafts (entries, invoices, bills), last month closed or not, and the next recurring item; most work first. Each number opens that workspace on that screen. Find by name and filter by group. The server counts each with one grouped query over only those workspaces' own rows (`src/lib/practice.ts`, `practiceService.ts`, `GET /api/v1/account/practice`, `PracticeView.tsx`; tests `practice-view.test.tsx`). Data Health per workspace: the nightly check's serious problems (missing required labels, duplicate bills, unbalanced entries…), counted in the work, with the warnings and when it ran on hover. Bills in force without a file attached, per workspace (shown, not counted in the work). **Expanded 7 Oct (roadmap, `docs/ROADMAP.md`), Later P0)**: answers "which clients need work today?" One row per workspace the user belongs to, with:
  - bank lines not reconciled, and the bank connection's state;
  - unanswered questions (BD-07);
  - entries missing a document or a required label;
  - drafts waiting, and Data Health warnings;
  - the last month closed and the steps left this month;
  - the next recurring obligations.
- [x] BD-02 Client switcher — = K-34, done 8 Oct (one switcher for owners and accountants)
- [x] BD-03 Adjusting-entry flag — **done 6 Oct**: the journal form has "Adjusting entry" (an accountant's year-end, audit or correcting adjustment), saved with the entry; Ledger → General journal marks them "adjusting" and lists them alone with "Adjusting entries only"; Duplicate keeps the mark (tests `journal-view.test.tsx`). An adjusted/unadjusted trial balance can build on the mark
- [x] BD-04 Workpapers — **done 7 Oct (AI #3, A-6)**: on Month-End Close, a "Workpapers" panel lists, per account and the month being closed, the balance at month end (the general ledger's own figures, `computeGeneralLedger` at the month's last day), a note, files (the attachments service, `linkedCollection: 'chartAccounts'` with the month in `linkedLabel`) and a "reviewed by … on …" mark. Owners and accountants keep the note and the mark on the account document (`workpapers`, one entry per month; migration `20261013050000_chart_account_workpapers.sql` to apply), everyone else reads. Read-only on money (`src/lib/workpapers.ts`, `src/components/ledger/WorkpapersPanel.tsx`; tests `workpapers.test.ts`, `workpapers-ui.test.tsx`) Roadmap (7 Oct): with R-11 (close package) and BD-06 (report pack, AI #2's C-30) this completes the cycle from the close to the client. Still open: the review mark checked by the server (today the browser writes who reviewed), and the workpapers inside the close package (R-11).
- [x] BD-05 TB export for tax software: Settings → Export → "Trial balance — for tax software": the trial balance on a date from the complete workspace, one row per account with a balance (account number, name, type, the tax line it is mapped to), debit/credit columns or one balance column, no totals row; a trial balance that does not balance is still downloaded but says by how much (`workspace-exports.test.tsx`)
- [x] BD-07 Client queries — **done 6 Oct**: in an entry's edit window, owners, accountants and bookkeepers use "Ask about this entry" ("What was this $340 at Amazon?"); the owner and accountants get a notification and answer there or on the new Questions screen (Transactions → Questions about Entries: waiting, answered, closed). Any member may answer; the asker's follow-up puts it back to waiting; the asker, an owner or an accountant closes it. Only the server writes questions (members read them live); each step is in the audit trail; at most 5 open questions per entry (`client-queries.test.ts`, `client-queries-ui.test.tsx`)
- [x] BD-08 Asset register export — **done 10 Oct (Claude)**: "Export register" on Fixed Assets downloads every asset (tag, status, place, category, bought, cost, salvage, life, method, asset account, depreciation posted and through which month, book value, and for a disposed one the day, money received and gain or loss) as a spreadsheet (`src/lib/assetRegisterExport.ts`; tests `asset-register-export.test.ts`).
- [x] BD-09 Journal entry templates: in the journal entry form, "Save as template" keeps the lines (accounts, sides, dimensions, and amounts if typed) under a name, and "Start from a template" fills a new entry from one. A template balances or holds no amounts; saving under a used name replaces it. Templates are shared by the workspace: writers save and remove them, and every change is in the audit trail. Nothing is posted from a template (`journal-templates.test.tsx`; same as CA-27)
- [x] BD-10 Checklist per client — **done 6 Oct**: on Month-End Close, owners and accountants keep this client's own month-end steps ("Get the payroll report", "File the VAT return" at each quarter end), or copy another client's. Each step is in the checklist of the months it is due (every month, fiscal quarter ends or the fiscal year end) and needs a sign-off, like any item that needs attention, before the month is ready to close; bookkeepers sign steps off but don't change the list. Saved by the server with an audit line (`PUT …/periods/close-steps`; tests `close-steps.test.ts`, `close-steps-ui.test.tsx`)
- [x] BE-01 Reminder schedule (daily job; tested)
- [x] BE-02 Thank-you email after payment: Settings → Emails & Reminders switch (off by default); payments recorded by hand, from a bank line or online send the "Payment received (thank you)" email, logged, skipped for bounced addresses; never holds up the payment (tested)
- [x] BE-03 Recurring pause/resume/delete (and recurring invoices now create draft invoices; tested)
- [x] BE-04 Invoice approval: Settings → Emails & Reminders can say that no invoice over a chosen amount may reach the customer until an owner or an accountant signs it off. It holds the **sending**, not the books: the invoice is dated, saved, posted and counted in accounts receivable exactly as before — only the customer receiving it waits. An owner's or accountant's save of an invoice that is going out *is* the signature; anybody else's leaves it waiting, shown under the invoice's state in the list (the amount and the limit in the tooltip), where an approver can Approve it or Send it back with a reason the author then sees. While it waits it is not emailed, not saved as Sent, and not reminded about; approving it puts the reminders back on. An invoice that already went out before the rule existed is left alone, so switching this on never silences reminders for old invoices. The amount is compared in the workspace's currency, using the exchange rate on the invoice, and an invoice of exactly the limit goes out on its own. The gate sits in the app and in the email endpoint, not in the row: it is a rule about documents, not a lock on the data (tested)
- [x] BE-05 Deposit invoice from estimate — **done 6 Oct**, on the advance payments (BE-12) instead of a separate deposit invoice, so the same money can't count as income twice: "Deposit" on an open estimate (writers) records a payment from the estimate's customer linked to it (`estimateId`) and applied to nothing (half by default, 25% / 50% / all of it), so it waits in Customer Deposits; the server refuses another customer, a converted/declined/expired estimate, or allocations. The estimate shows "Deposit received $X"; converting it says the deposit waits; the invoice made from it, once issued, shows "Apply deposit $X" (up to what it owes), which applies the waiting deposits oldest first and moves the money from deposits to receivables (`src/lib/advancePayments.ts`, `src/services/depositActions.ts`). Tests: `estimate-deposit.test.ts` (database), `estimate-deposit-ui.test.tsx`
- [x] BE-06 Auto-apply credits: "Apply open credits" on the credit notes screen (all customers or all vendors) and on each customer's or vendor's page: every open credit, oldest first, goes to that contact's open invoices (bills) in the same currency, the one due first first; drafts, voided and paid ones get nothing; one database transaction on the server, audited; no ledger entry (issuing the credit already lowered what is owed) (tested)
- [x] BE-07 Batch statement send: "Email statements" on the customer list: every active customer with something open gets their statement PDF with the new "Customer statement" email (editable in Settings → Emails); no address, nothing open, archived or bounced customers are skipped and listed with the reason; logged per customer; writers only. Also: the statement PDF now reads only that contact's payments, not the whole workspace's (tested)
- [x] BE-08 Recurring expense: a new bill can be set to repeat (every week, month, quarter or year). The daily job makes a draft copy on each date (vendor, lines, tax and currency; not the number or payments), tells the team, and it is posted only when someone checks it and saves it; paused like other schedules on the Recurring screen; once per date (tested)
- [x] BE-09 Mileage — **done 6 Oct**, in expense claims (K-22): a line can be "Mileage": from → to, distance in km or miles and the rate per km/mile (typed by the person, tenths of a cent allowed, e.g. 0.655; the last rate and unit used come back next time in that browser; no made-up default rate). The amount is worked out in whole cents and the claim line says how ("Mileage Office → Acme (42 mi × USD 0.655/mi): Client visit") (`src/lib/expenseClaims.ts`; tests `expense-claims.test.tsx`)
- [x] BE-10 Per-diem — **done 6 Oct**, in expense claims: a "Per diem" line is days (half days allowed) × the daily rate, worked out in whole cents, with the working in the line's description; the last daily rate comes back next time (tested with BE-09)
- [x] BE-11 PO → bill conversion (purchase orders saved, goods received, "Create bill"; tested)
- [x] BE-12 Vendor prepayment — **done 5 Oct (with K-18)**: see K-18
- [x] BE-13 Cheque printing — **done 6 Oct**: Payments → the printer button on a payment made to a vendor (owners, accountants, bookkeepers) prints it as a cheque on US Letter cheque stock, cheque on top and two vouchers (vendor copy, for your records): payee, date, cheque number (the payment's reference), the amount in figures behind asterisks and written out in words ("One thousand two hundred thirty-four and 56/100", filled to the end of the line), DOLLARS or the currency code, memo, signature line; the vouchers list the bills it pays by number and any part paid in advance. Nothing is posted (the payment already is); a money-in or voided payment is refused, as is another workspace's (`src/lib/amountInWords.ts`, `src/server/services/chequePdf.ts`, through `GET /api/v1/documents/cheque/:paymentId/pdf`; tests `cheque-printing.test.ts` with the database). Printing positions for a specific bank's pre-printed stock (MICR line, offsets) can follow when someone needs them
- [x] BF-01 Item type — **done 10 Oct (Claude)**: an item is a stock item or a service ("Kind" on the item form; an item with stock on hand stays a stock item). Picking a service on an invoice or estimate fills its name and price (the customer's price list too) but leaves the line unlinked, so it moves no stock and books no cost; bills and purchase orders offer only stock items to bring in (`applyInventoryItem` in `src/lib/invoiceLines.ts`, `InventoryItemDialog.tsx`, `Inventory.tsx`; tests `item-type.test.tsx`). **Open:** service lines in the item-wise reports.
- [x] BF-02 Customer price overrides — **covered (10 Oct)** by Settings → Price lists (M-11): a list with prices of its own for some items, for one customer or several.
- [x] BF-06 Sales returns / RMA — **done 7 Oct**:
  - **The form:** a customer credit note can be for one invoice (the new "For invoice" choice; none could be linked before) and list the goods that came back, per stock line of that invoice. It shows what was sold and what earlier returns took back, and offers the credit at the invoice's price.
  - **Posting:** puts the units back into stock at the cost they left at (DR Inventory, CR Cost of goods sold), once.
  - **Limits:** a line can't take back more than was sold, less earlier returns. That is checked on the screen and again by the server.
  - **Undoing:** each return is in the stock history, and voiding the credit note takes the units out again.
  - **Bug fixed on the way:** a voided credit note's reversal didn't name the invoice, so its return would still have counted against the line. It is now found either way, and the reversal names the invoice too.
  - Code: `src/lib/salesReturns.ts`, `ReturnedGoodsFields.tsx`, `creditPosting.ts`, `cogsStockService.ts`; tests `sales-returns.test.tsx`, with the database. The original plan was: a return is linked to the delivery or invoice line it returns. It gives back at most the quantity that left, at the cost it left at, only once, and it reverses that cost. The credit note and the refund use K-09
- [x] BF-07 Purchase returns — **done 10 Oct (Claude)**: a vendor credit can now name the credited bill (it could not be chosen on screen before) and, for its stock lines, how many units go back ("Goods sent back": bought, already back, sent back now; "Credit their cost" fills the amount). The credit's entry takes their value (the bill line's cost per unit, the exact remainder when the rest goes) off Inventory instead of the expense and lists the units; the server takes them out of stock ("Sent back to the vendor" in the stock history) and puts them back when the credit is voided; more than the line brought in, or goods worth more than the credit, are refused (`src/lib/vendorReturns.ts`, `VendorReturnFields.tsx`, `creditPosting.ts`, `cogsStockService.ts`; tests `vendor-returns.test.ts` against the real server, `vendor-returns-ui.test.tsx`). **Open:** freight spread over the items (BA-03) stays in the remaining units' cost.
- [x] BF-09 Line-level class / location — **done 7 Oct**: labels on invoice and bill lines.
  - **On screen:** each line of the invoice and bill forms has "Labels" (Project, Location, Property and the workspace's own labels), folded away until wanted. The workspace's values are offered. It opens by itself and names what is missing when the line's account needs a label (Z-12).
  - **In the books:** the labels are posted with the line's revenue or expense. Two lines on the same account with different labels stay two posted lines, the amounts still add up to the cent, and an invoice line's labels go with its cost of goods sold too.
  - **What it unblocks:** reports by label now include invoices and bills (`LineLabels.tsx`, `TransactionTemplates.ts`, `postingKit.lineAccounts`, `invoiceCogs.ts`; tests `line-labels.test.tsx`). This unblocks DA-08 and AI #3's A-12, A-13 and A-15.
- [x] BG-01 @mention — **done 10 Oct**: writing @name (the part of their email before the @, or the whole email) in a question about an entry, an answer, or a task's title or note tells that person (only people in the workspace, never the writer); the text boxes say so (`src/lib/mentions.ts`, `mentionService.ts`; tests `mentions.test.ts`)
- [x] BG-02 Assign a record — **done 10 Oct** with BG-03: a task can be about an invoice, bill, entry, account or item (chosen from the newest 300), which opens from the task list
- [x] BG-03 Task list — **done 10 Oct**: Tasks (menu, next to Questions about Entries): owners, accountants and bookkeepers give a task to anyone in the workspace (viewers too), with an optional due date, note and record; For me / All open / Done, the late ones flagged. The person is told when given one; the person, whoever made it or an owner ticks it done (whoever made it is told) or opens it again; whoever made it or an owner removes it; every step is audited. "N tasks for you" in Needs attention. Kept with the workspace's documents (kind "task", written by the server; no migration) (`src/lib/tasks.ts`, `taskService.ts`, `TasksView.tsx`; tests `tasks.test.tsx`)
- [x] BG-04 Watch a record — **done 10 Oct**: Tasks → "Records I watch": anyone in the workspace watches an invoice, bill, entry, account or item; the nightly job tells them once about each change since they were last told (the notice opens the record itself) and when it is deleted (the watch then ends). By the row's own last-change time, so every way of changing a record counts. Kept with the workspace's documents (kind "watch", server-written; no migration) (`src/lib/watches.ts`, `watchService.ts`, `WatchingPanel.tsx`; tests `watches.test.tsx`)
- [x] BG-05 Shared-inbox triage — **done 10 Oct**: on To Review, each entry says who has it ("With dana@…") or has "Give to…" (owners, accountants, bookkeepers): a task "Review: <entry>" for that person, who is told (BG-03) (`HandOver.tsx`, `useHandOvers.ts`; tests `hand-over.test.tsx`)
- [x] BG-06 Custom status workflows — **done 10 Oct**: Settings → Stages: the workspace's own steps for invoices and bills (owners, accountants; e.g. bills: Received, Checked, Ready to pay); each invoice and bill shows its stage on its row, where owners, accountants and bookkeepers change it (viewers see it); audited. A stage never changes the document's status, the books or what is paid. Kept with the workspace's documents (server-written; no migration) (`src/lib/stages.ts`, `stageService.ts`, `StageChip.tsx`, `StagesSettings.tsx`; tests `stages.test.tsx`)
- [x] BG-07 Threshold approvals + delegate — **done 10 Oct**: the threshold is Invoice approval (BE-04); now under it, "While you are away, someone approves in your place": an owner or accountant hands their invoice approvals to a bookkeeper, accountant or owner until a date (at most 92 days; the last day included), or takes them back. The person is told, sees Approve, and their approval counts on the server until then; every decision still names who made it; audited (`src/lib/approvalDelegation.ts`, `approvalDelegateService.ts`, `ApprovalDelegatePanel.tsx`; tests `approval-delegation.test.tsx`)
- [x] BH-01 Currency minor-unit divisor
- [x] BH-03 Round-trip test across exponent classes
- [x] BH-04 Other formatters audited — fixed + `money-format-guard` test
- [x] BJ-04 Retention per kind of data: docs/privacy/RETENTION.md
- [x] BJ-05 Legal hold: nothing pruned, a deleted workspace is not purged until lifted; audited (tested)
- [x] BJ-06 Personal data inventory: docs/privacy/PERSONAL_DATA.md
- [x] BJ-08 Sub-processor list: docs/privacy/SUBPROCESSORS.md
- [x] BJ-09 DPA template: docs/privacy/DPA_TEMPLATE.md (lawyer review before use)
- [x] BK-01 Generic CSV import (= K-01; columns matched by header name)
- [x] BK-05 Per-row import errors (row number + problem)
- [x] BK-06 Import rollback (undo; records in use are kept)
- [x] BK-07 GL to CSV
- [x] BK-08 Chart of accounts export
- [x] BK-09 Contacts export
- [x] BK-11 QIF export (posted base-currency bank accounts)
- [x] BK-12 OFX export (posted base-currency bank accounts)
- [x] BL-01 Bounce handling (provider reports → log + suppression)
- [x] BL-03 Suppression list (bounced/complained addresses skipped)
- [x] BL-05 Send log per document (invoice email dialog)
- [x] BL-08 Plain-text fallback (every email)
- [x] BM-01 Symbol placement per locale — **done 10 Oct** with BB-05: the workspace's number style (Settings → Appearance → Money display) over AI #2's formatter
- [x] BM-02 Separators per locale — **done 10 Oct** with BB-05 (saved on the workspace, `moneyDisplay.locale`)
- [x] BM-03 Accounting negatives — **done 10 Oct** with BB-05 (`moneyDisplay.negativeStyle`)
- [x] BM-07 `<Money>` component wired
- [x] BO-01 Contextual help per view
- [x] BO-02 Searchable docs
- [x] BO-03 First-run wizard (= L-19)
- [x] BO-05 Feedback widget — AI #2 any-screen text ticket + screen/version and optional PNG/JPEG/WebP screenshot (11 Oct), using AI #1’s merged attachment target/viewer. Preview and 700 KB limit before submission; upload follows the confirmed ticket, retries reuse its ID, and a failed image can be omitted without losing the saved feedback. Workspace changes prevent an old response from starting an upload. Unit and phone/browser tests; branch pending review.
- [x] BO-06 Status page link in Help ("Something not working? System status")
- [x] BO-07 Errors name a remedy (describeError: central reporter, payment and write-off dialogs; tested)
- [x] BO-08 Undo for destructive actions: deleting a customer, vendor, item or draft bill takes it off the list with "Deleted · Undo" for 8 seconds before it is really deleted (`src/lib/undoableDelete.ts`; Undo cancels the delete, so nothing posted can come back); contacts are checked by the server first (`?check=1`) so one in use is never hidden; an item with stock still asks first; projects by AI #2 (C-26). Tests `undoable-delete.test.ts`, `party-row-actions.test.tsx`, `contact-merge.test.ts`
- [x] BP-05 Visual regression *(AI #4 / PR #85; final integration checks pending)*
- [x] BP-08 Mutation testing on money files (AI #4, manual command and contract tests; integration/lead merge pending)
- [x] CA-01 Payment reconciliation: bank deposit → payment allocated to invoices, line matched
- [x] CA-02 Unreconcile — exists, now role-checked, lock-checked, audited
- [x] CA-03 Repost accounting ledger (check + repost; tested)
- [x] CA-04 Bank clearance date — **done 6 Oct**: in the Account Register, marking an entry cleared asks for the day the bank cleared it (today by default, never before the entry's own date) and shows "cleared 2026-05-04" under its date; unmarking undoes it. Saved through the server (owners, accountants, bookkeepers; the period lock applies; viewers can't). Fixed on the way: the register's cleared tick changed only the screen and was gone after a reload, and entries cleared by bank reconciliation showed as not cleared there (`src/services/clearanceActions.ts`, `POST /api/v1/transactions/reconciliation/clear`; tests `account-register-view.test.tsx`, `clearance-date.test.ts` with the database)
- [x] CA-06 Closing balance snapshots: closing a month (soft or hard) keeps every account's balance on its last day with the period; Month-End Close shows "Balances since the close" for a closed month: still as closed, or the accounts that moved since (then, now, difference), worked out again by the server from the whole ledger. Closing again after a reopen replaces the snapshot whole (`closing-snapshot.test.ts`, `closing-balance-check-ui.test.tsx`)
- [x] CA-07 Period closing voucher — **done 6 Oct, as a fix**: the year-end close posted an entry moving revenue and expenses to retained earnings, and nothing left it out of the profit and loss, so after closing a year its P&L showed zero profit (and closing twice at once could post two). The balance sheet already carries every past year's profit in retained earnings by itself, so closing a year no longer posts an entry: it records the year's profit (the twelve months ending on the closing date) in the audit trail and locks the year when asked; entries from earlier closes are ignored everywhere (`isPostable`), so a closed year reads right again and the balance sheet still balances. Month-End Close → "Record the year as closed" (owner) (tests `year-end-close.test.ts` with the database)
- [x] CA-08 Opening invoice tool: "Opening invoices" on Sales and "Opening bills" on Purchases take the unpaid documents of the old system pasted from a spreadsheet (contact, number, date, due date, amount still owed). Each becomes an open invoice or bill against Opening Balance Equity with its own number and due date, so aging is right on day one; unknown contacts are added, and lines with a problem are named and left out (`opening-documents.test.tsx`)
- [x] CA-09 Advance payment ledger — **done 6 Oct**: Reports → Open Advances lists customer deposits (or, switched, vendor prepayments) not yet applied to an invoice or bill: contact, payment, date, paid, applied, still open and days waiting at the period end (90+ days in red), oldest first, totals per currency and the contacts holding the most; voided payments and ones after the date are left out. What is open is today's state (applying is not dated), only the age follows the date. Applying stays on the contact's page (BE-12) (`openAdvances` in `src/lib/advancePayments.ts`; tests `open-advances.test.tsx`; browser `e2e/everyday-reports.spec.ts`)
- [x] CA-10 Transaction deletion record — **done 6 Oct**: deleting an entry (only drafts can be; posted ones are voided) or a draft invoice, bill or credit through the posting route now leaves an audit line saying what it was ("Deleted the invoice INV-9 of 2026-10-01 (Acme, USD 50.00)") with a copy of its main fields and up to 100 lines, written in the same database transaction as the deletion; before, only "Deleted transaction ref [id]" was kept, and document deletions weren't recorded at all (`src/server/services/deletionRecord.ts`; tests `deletion-record.test.ts` with the database)
- [x] CA-11 Import log (recent imports from the audit log)
- [x] CA-12 Saved column map (= Y-03)
- [x] CA-15 Cheque print template — done as BE-13 (cheque on top, two vouchers, US Letter)
- [x] CA-25 Seasonal budget distribution — posted prior-year monthly expense pattern preview; C-21
- [x] CA-26 Cost centre allocation % — three-recipient exact-cent preview; no posting; C-21
- [x] CA-27 JE templates — done as BD-09
- [x] CA-32 Ledger health monitor — **done 6 Oct**: the daily job now runs the Data Health checks on the whole ledger of every workspace whose books changed (anything added, changed or deleted) since its last check, or once a week regardless; keeps the result on the workspace (server-only) and tells owners and accountants about serious problems that are new since the last check ("2 new problems in the books: Entries whose debits and credits differ (2)…"), never the same problem twice. Data Health shows when the last nightly check ran and what it found. Bounded to a minute a night, longest-unchecked first, so the daily job always finishes; no database change (`src/lib/ledgerHealth.ts`, `src/server/services/ledgerHealthService.ts`; tests `ledger-health.test.ts` with the database)
- [x] CA-33 Ledger merge — **done 6 Oct**: on the chart of accounts, "Merge into…" (owners and accountants) folds a duplicate account into the one kept: pick an account of the same kind, see what moves ("12 entries, 1 bill, 2 rules will use \"Office\" instead"), merge. Every record that points at it (entry and document lines with their account name, items, rules, budgets, loans, assets, recurring schedules, sub-accounts, workspace defaults) points at the kept account; opening balances are added up; the merged account is removed; one audit line, and the audit trail's history is left as it was. Refused for accounts of different kinds or currencies, for an account LedgerFlow uses itself, and when it would change anything in a closed period (reopen first) (`src/lib/accountMerge.ts`, `src/server/services/accountMergeService.ts`, `POST …/chart-accounts/merge[/preview]`; tests `account-merge.test.ts` with the database, `account-merge-ui.test.tsx`)
- [x] CA-34 Bisect accounting statements — **done 6 Oct (AI #3, A-4)**: the balance sheet does not balance and nobody knows since when. New `src/lib/balanceBreak.ts` finds the first day it was off by halving the dates that carry a postable entry (a balance cannot change on a day with no entries), probing the report code's own `computeBalanceSheet` at each step (the end date first: a history that balances costs one look), then adds that day's entries one at a time and reports what each changed the difference by, so the day's numbers add up to the day's change; a line whose account is missing from the chart is named as such. Data Health now shows "Since when don't the books balance?" with the day, the amount, each entry's share and an Open button into the usual record viewer — read-only, it posts nothing and leaves the existing `unbalanced` and `missing-account` checks alone (`src/components/system/BalanceBreakPanel.tsx`; tests `balance-break.test.ts` with hand-checked dates — first day, last day, middle, never, and a missing account — and `balance-break-ui.test.tsx`)
- [x] CA-35 Invalid ledger entries — **covered (10 Oct)** by Data Health (same as CB-20).
- [x] CA-36 Process deferred accounting — **covered (10 Oct)** by invoices and bills spread over months (K-16, K-17): their monthly entries are posted with the spread, shown on the deferred revenue and prepaid expenses waterfall.
- [x] CB-01 Customer ledger summary
- [x] CB-02 Supplier ledger summary
- [x] CB-03 Trial balance for party
- [x] CB-04 Payment period by invoice date
- [x] CB-05 Voucher-wise balance — **covered by Data Health (10 Oct)**: every entry whose debits and credits differ is listed with the difference and opens (the "unbalanced" check, `src/lib/dataChecks.ts`); the balance-break search says since when the books don't balance (A-4).
- [x] CB-06 Account balance
- [x] CB-07 Gross profit
- [x] CB-08 Profitability analysis — **covered (10 Oct)** by Reports → Profit by Label (CB-25: income, costs and result per value of any label such as project, property or location, adding back to the P&L) and Gross Profit by Customer (`LabelProfitReportView.tsx`, `CustomerGrossProfitView.tsx`).
- [x] CB-09 Financial ratios
- [x] CB-10 Sales trends
- [x] CB-11 Purchase trends — **11 Oct (AI #3, A-20; implemented on `arena/ff49edf9-ledgerflow`, awaiting review)**: Reports → Purchase Trends by Vendor now switches between the unchanged vendor report and monthly item purchases from the existing `purchaseRegister` helper. Item rows show units, stored line amounts, currency and line count for twelve calendar months through the chosen end date, with comparison and safe Hebrew CSV (explicit minor units). Currencies stay separate; cached figures are provisional until a scoped, uncapped paginated bills/items refresh succeeds; refusals retain the last result and obsolete workspace responses are discarded (`src/lib/purchaseItemTrends.ts`, `PurchaseItemTrendsView.tsx`; `purchase-item-trends.test.tsx`, `e2e/agent3-assets-purchases.spec.ts`). **Limits:** gross recorded item purchases only, not net inventory cost; vendor returns, freight-only lines, opening documents and document-level tax/discount allocation are excluded. No new accounting/allocation formula or posting change.
- [x] CB-12 Item-wise sales register — **done 10 Oct (Claude)**: Reports → Item-wise Register, "Sold": every issued invoice's line with a stock item in a period, for one item or all, oldest first, each opening its invoice, with each item's units and amount (by currency) at the end (`src/lib/itemRegister.ts`, `ItemRegisterReportView.tsx`; tests `item-register.test.tsx`).
- [x] CB-13 Item-wise purchase register — **done 10 Oct (Claude)**: the same report, "Bought": every bill line with a stock item (J-08), its units and price per unit; landed costs and void bills left out (same files and tests).
- [x] CB-14 Inactive items
- [x] CB-16 Deferred revenue & expense — **covered (10 Oct)** by Reports → Deferred Revenue Waterfall (J-14): invoices spread over months with what is earned in each month, by the end, and still deferred; switchable to prepaid expenses (bills spread, K-17) (`SpreadWaterfallView.tsx`).
- [x] CB-17 Billed not received — **done 10 Oct (Claude)**: a bill made from a purchase order now keeps, on each line, the order line and the units it bills (kept when the bill is opened and saved, not when copied for a new one); Goods Not Yet Billed has "Billed, not received": the units billed above those received, at the order's price. Bills made from an order before 10 Oct don't carry this and are not counted (`billedNotReceived` in `src/lib/unbilledGoods.ts`, `billLinesFromOrder`, `BillModal.tsx`; tests `unbilled-goods.test.tsx`).
- [x] CB-18 Delivered not billed — **done 10 Oct (Claude)**: Reports → Goods Not Yet Billed, "Delivered, not invoiced": for each sales order line, the units delivered and kept (deliveries less returns, from the delivery entries in force) above the units invoiced from the order, at the order's price (`src/lib/unbilledGoods.ts`, `GoodsNotBilledReportView.tsx`; tests `unbilled-goods.test.tsx`).
- [x] CB-19 Received not billed — **done 10 Oct (Claude)**: the same report, "Received, not billed": units received on purchase orders that have no bill yet, at the order's price, with totals per currency (same files and tests).
- [x] CB-20 Invalid ledger entries report — **covered by Data Health (10 Oct)**: its checks list entries whose debits and credits differ, lines on accounts that don't exist, future-dated entries, tax posted wrongly and more, each opening its record, in the browser and every night on the whole ledger (`src/lib/dataChecks.ts`).
- [x] CB-21 Incorrectly cleared cheques — **done 10 Oct (Claude)** as a Data Health check: an entry matched to a statement line dated more than 3 days before the entry (cleared before it was made: the date is wrong or the match is), opening the entry (`cleared-before-issued` in `src/lib/dataChecks.ts`; tests `data-checks.test.ts`).
- [x] CB-23 GL vs payment ledger — **done 10 Oct (Claude)** as a Data Health check: each payment record (not void) against its entry in force: none (serious), or another amount than the payment at its rate (payments at another day's rate, with a realized exchange difference, not compared); only payments inside the entries read, so the browser's newest-entries limit can't make one look missing; also every night (`payment-ledger` in `src/lib/dataChecks.ts`, `ledgerHealthService.ts` reads payments; tests `data-checks.test.ts`).
- [x] CB-24 Bank clearance summary — **done 10 Oct (Claude)**: Reports → Bank Clearance Summary: for a bank account and period, each entry on it and the day the bank cleared it (its matched statement line; "Reconciled" when marked without one); at the end, the deposits not yet on the statement, the payments not yet taken, and the balance the bank should show; undone entries left out; each entry opens (`src/lib/bankClearance.ts`, `BankClearanceReportView.tsx`; tests `bank-clearance.test.tsx`).
- [x] CB-25 Dimension-wise balance — **done 10 Oct (Claude, was Arena's A-12)**: Reports → Profit by Label: choose a label and a period; income, cost of goods sold, expenses and the result of each value and of the lines without one ("Unassigned"), account by account, read by the server from the full history with the profit and loss's own code, so the columns add back to the P&L of the period (tested); each figure opens the entries behind it, filtered to that value (`src/server/reports/byLabel.ts`, `GET /api/v1/reports/by-label`, `LabelProfitReportView.tsx`; tests `by-label.test.tsx`). **Open:** balance sheet accounts by label.
- [x] CB-27 Asset depreciation ledger — **done 10 Oct (Claude)**: Reports → Asset Depreciation Ledger: for a period, each fixed asset's cost, depreciation before the period, posted in it by the monthly runs in force (an undone run doesn't count), at its end, and its book value, with totals; what an asset came with before its first run counts as before; disposals and partial sales marked (`src/lib/depreciationLedger.ts`, `DepreciationLedgerReportView.tsx`; tests `depreciation-ledger.test.tsx`).
- [x] CB-29 Sales payment summary
- [x] CC-05 Recurring expenses — **covered (10 Oct)**: recurring bills (BE-08: a draft bill copied from the schedule each time, posted when someone saves it) and recurring entries (a posted expense entry each period) (`src/server/services/recurringService.ts`).
- [x] CD-06 Notes on any entity — **done 14 Oct (AI #3, A-36)**: notes with who and when on a customer, vendor, item, invoice, bill, estimate, entry or project, searchable from Reports → Record Notes; the panel adds a note or changes your own, and is also on the Inventory item form. Notes live in the record's own metadata (`recordNotes`), card numbers masked; nothing is posted.
- [x] CD-07 Account groups — covered by K-14 (7 Oct): accounts inside a parent account, with subtotals on the reports
- [x] CF-05 Per-user bookmarks — **11 Oct (AI #2, C-37):** sidebar stars registered pages and report/settings subviews, remembers each user/workspace’s order on this device, with keyboard reorder and explicit storage-refusal status. Exact registered navigation preserves mixed-language IDs; dates/filters are not captured. Local checks passed, including 2386 unit cases with coverage/RLS and 201 full Chromium cases; later E-14/bookmark delta 15/15 passed. Review/checks pending on `codex/c37-bookmarks`; exact integration boundaries in `docs/verification/c37-bookmarks-2026-10-11.md`.
- [x] CG-01 Custom field entities — **done 14 Oct (AI #3, A-37)**: Settings → Custom fields: owner-defined fields (text, number, date, choice) on customers, vendors and items, definitions on the workspace (`customFields` migration checked in, needs applying), values on each record's metadata, shown in a values list and the CSV export. The forms' own screens do not show the values yet.
- [x] DA-02 Needs attention: one queue — **done 8 Oct (Claude)**: the top of the Overview lists, worked out from the books each time (so a row goes only when its cause has gone): bank lines to review, invoices waiting for approval, serious Data Health problems, entries missing a required label, duplicate bills, and last month not closed (from the reminder day in Settings → Alerts, else the 10th). Each row says why and for whom, and opens its screen (`src/lib/needsAttention.ts`, `NeedsAttentionCard.tsx`; `needs-attention.test.tsx`). Questions about entries added (waiting for the owner; answers to read). Added 8 Oct: banks whose login expired (opens Bank Connections), pay runs waiting for an owner's approval, purchase orders waiting for approval. The close row says how many of the workspace's own close steps (BD-10) due last month are not signed off. A row with exactly one thing behind it (one bank line, one invoice, one finding with its record) opens that record itself. **Open:** counts per workspace (BD-01 Practice view, AI #5's E-1); bills and expenses have no approval step today. **Later P1**: the daily starting point for people who don't want to learn the whole menu. It is one shared queue, not another warning screen. Rows look like this:
  - 3 bank lines to review;
  - 1 connection to reconnect;
  - 2 documents to approve;
  - 4 entries missing a required label;
  - 1 possible duplicate bill;
  - 2 close steps left;
  - 1 client question unanswered.
- [x] DA-03 Ask the books, verified — **done 8 Oct (Claude)**: Reports → Ask the Books. The question is read by plain matching (`src/lib/askBooks.ts`, no AI): account names (an account takes in its sub-accounts; "spend"/"income" alone mean all expense/income accounts), a label value by its code, description or alias, and a period (last/this year or fiscal year, last/this month, a month, a quarter, a year; none named is this year so far, and said). What was understood is shown and each part can be changed; nothing it can't place is filled in. The figure comes from the server's explanation (N-12) on the full history: posted entries only, the workspace's currency, under the person's access; the entries behind it are listed and open their documents (`AskBooksView.tsx`; tests `ask-books.test.tsx`, including the example question below against the real database). **Later P1**: a human question becomes a typed query, the server calculates it exactly, and the answer can be traced.
  - **Example:** "How much did Property 5 spend on electricity last year?" becomes:
    - workspace = the current one, as allowed;
    - label Property = Property 5;
    - account = Utilities › Electricity;
    - dates = last fiscal year;
    - posted entries only;
    - home currency.
- [x] DA-05 What works today: one truth table — **done 8 Oct (Claude, taken over from AI #3's A-10 to unblock V1)**: `docs/CAPABILITIES.md`, 94 rows (the tool review's 70, re-labelled, and the work since), each with one label, its evidence and its limit; `capabilities-guard.test.ts` fails if a named file disappears or an Available row has no test. README (no more "enterprise multi-entity ERP" or "automated reconciliation"), the Help consolidation line and `docs/STATUS.md` (now a pointer) brought in line. Found: N-14. **V1**: one table of capabilities, each with one label:
  - Available;
  - Available with limits;
  - Partial;
  - Internal, test or demo only;
  - Planned;
  - Needs an owner decision.
- [x] DA-06 Workflow pages for the main path — **done 8 Oct (Claude, taken over from AI #3's A-11 to unblock V1)**: Help & Guide → Main path: twelve pages, each answering the ten questions below and opening its screen (`src/lib/mainPathGuide.ts`, `MainPathGuide.tsx`; `main-path-guide.test.tsx` checks every step has all ten answers, links to a real screen, and promises nothing the app doesn't do). Claims checked against `docs/CAPABILITIES.md` and the code (overpayment refused, close refused while drafts are dated in the month, a changed reconciled month reported). **V1**: for each step of the main path (ROADMAP "The main path"), Help says:
  - before you start;
  - what you do;
  - what LedgerFlow changes;
  - what you see afterwards;
  - what it affects further on;
  - what can fail;
  - whether it can be undone;
  - what belongs to this workspace only;
  - what happens by itself;
  - what still needs a person to check.
- [x] DA-07 The main path, tested end to end (one simple business) — **done 7 Oct, against the real database** (`src/tests/main-path.test.ts`). Ten steps run through the routes and services the app uses; invoices and bills are posted by the app's own posting code, whose requests go to the real server routes:
  1. the books; 2. accounts, a customer and a vendor imported; 3. the bank statement's lines; 4. an invoice and a bill; 5. a part payment and a bill paid in full; 6. both bank lines matched; 7. trial balance, P&L, balance sheet and receivables aging checked against hand figures; 8. May closed, and a write into it refused; 9. backup and restore; 10. the 400.00 owed traced to its entries, its invoice and its bank line. Hebrew and English data together.
- [x] DA-08 The main path with labels — **done 7 Oct, against the real database** (`src/tests/main-path-labels.test.ts`).
  - **What it runs:** an invoice with a line per location and bills split between them, posted by the app's own code. Every income and expense figure split by Location adds back to the server's own P&L total. "Location required on Office expenses" lists the one bill without it; editing the bill to carry one clears the finding, with the totals unchanged.
  - **Real bug found and fixed:** editing, voiding or deleting an invoice, bill, credit or payment reversed the old entry dated **today** while the corrected entry kept the document's date. A past month then showed the old and the new amount together, and the current month a negative: every monthly report was wrong after a correction. Now the old entry is reversed on its own day while that day is open, and today only when it is closed (`reversalDate` in `postingKit.ts`, used by all five posting files).
  - **Also:** the missing-label check skips an entry that was corrected and its reversal.
  - **The original plan:** the same path, with two locations and a project on the entries; each report figure split by label, and each split adds back to the total.
- [x] DA-09 The main path across a group of books — **done 8 Oct (Claude)**: `main-path-group.test.ts` against the real database: two companies with their own sales and costs, a loan posted between them as intercompany, one group; the group summary adds them up, matches the loan on both sides, takes it out of the total and balances; each company figure equals its own P&L and balance sheet and its explanation adds up to it; in euros the total still balances with the translation difference on its line. **Found and fixed:** posting between companies (`/transactions/intercompany/post`) was always refused the first time (the new clearing accounts were checked before they were saved). **Found and fixed (Z-19):** posting between companies in different currencies recorded the same number on both sides; the amount that arrives is now required. **Later P1, after DA-01 and Z-20**: the same path in two workspaces of one group, plus a report across both that drills back into each.
- [x] AU-2 (17 Oct: the P&L has a Label filter (kind + value, case ignored), using local figures while a label is chosen; test `pl-label-filter-ui.test.tsx`. 14 Oct: shared `lineHasLabel` + `stableLabelValue` in `src/lib/dimensionUtils.ts`; the figure drill-down and the retention review use it; old == new proved on 2000 generated lines in `label-filter.test.ts`. Left: P&L and trial balance have no label filter yet — add it through `lineHasLabel`; registrationThresholdWatch keeps its own variant (it also matches by root only)) One label/dimension filter: label filtering is written separately in ~7 files; make one shared slice function, prove old == new on generated scopes, then switch P&L and trial balance first.
- [x] AU-3 (done 14 Oct: src/tests/posting-properties.test.ts — 11,000 generated entries through the ledger door; 20 concurrent sends of one payment make one payment and one journal on the real database) Property tests on posting (postingKit): thousands of generated entries always balance; the same command posted twice (and 100 times at once) makes exactly one entry.
- [x] AU-5 (17 Oct: the 153 uses checked — almost all format cents as text for screens/CSV; the four that read amounts from text with `parseFloat × 100` (MT940, camt.053, quick-add text, approval limit) now use exact `parseAmountToCents`; `money-parse-exact.test.ts` refuses the pattern from now on) Money arithmetic audit: 132 uses of parseFloat/toFixed(2) in server and library code; list each one that touches money and move it to whole cents (or the shared money helpers).
- [x] AU-6 (14 Oct: done — the last 7 writers moved: two reversal sets and the stock adjustment through `ledgerWrite`, four marks (void, reversed-by) through `ledgerMark`, which refuses any change to amounts or lines; ratchet now 0, test `ledger-mark.test.ts`. 13 Oct: door `src/server/services/ledgerDoor.ts` + ratchet `ledger-door-baseline.json`, 7 direct writers left (updates and two reversal sets); 25 entry creations across 18 files now go through the door) One door to the ledger: about 30 server files write transaction documents directly. Map them, route each through the shared posting module, then add a lint rule that rejects ledger writes outside it.
- [x] PREV-2 (done 13 Oct as the bug-pattern ratchet test, which fails CI on any new silent catch / success-before-save / write-in-loop) Lint rules (fail CI): no empty or silent `catch`; no success toast in the same function before an awaited write; no `await` of a store write inside a loop in components (multi-row changes go to one server route).
- [x] PREV-3 (done 13 Oct: /transactions/batch, time moves/invoicing, transfer pairing) All-or-nothing server routes for bulk actions (transfer pairing, bulk categorise, bulk approve/invoice, payment batch): one database transaction, validated before any write.
- [x] PREV-4 (done 13 Oct: workspaceScope helper; every screen and dialog remounts on a book switch) Workspace-scoped async helper: every load/import/AI call carries the workspace id and an abort signal; results from a previous workspace are dropped. A lint rule bans raw fetch in components outside it.
- [x] ISS-A Save-then-say-success (#105, #108, #109, #110, #111, #97 fixed 13 Oct): #105 transfer dialog, #108 bulk categorise, #109 bank-file export before server accepts, #110 statement import swallows errors, #111 receipt marked verified when save rejected, #97 duplicate draft invoices from time — one rule: success only after the server confirms; buttons disabled while saving; idempotency key per action.
- [x] ISS-B All-or-nothing writes (#98, #106, #112, #113 fixed 13 Oct): #106 transfer pairing as one server transaction, #98 bulk time approval/invoicing validated before any write.
- [x] ISS-C (fixed 13 Oct) Workspace switch safety: #99, #100, #102, #107 — every async load/import carries the workspace id and is dropped if the user switched books.
- [x] ISS-D (fixed 13 Oct) #101 CSV parser: apostrophes are not quotes; amounts never silently become 0 (fixture from the issue).
- [x] AUD-06 (18 Oct: `npm test` and `test:cov` now also run `src/server/utils/*.test.ts` (safeFetch, fileValidation); `test-discovery-guard.test.ts` fails if any `src/**/*.test.ts(x)` file is outside the globs) — Security suites are outside ordinary unit-test discovery
- [x] AUD-07 (18 Oct: generic commands and bulk posting store who sent the key and a fingerprint of the request; the same key from another user or with a different request is refused (409), a true retry gets the first answer; bulk recognises a replay first in its transaction; test in `invoice-cogs.test.ts`) — Generic and bulk idempotency have weaker replay identity than payment posting
- [x] AUD-08 (18 Oct: both bulk paths re-read the workspace inside the commit transaction and check the closing date (and role, for /batch) there; test closes the month between the checks and the save — refused, nothing changed; the test fails without the fix) — Bulk validation reads workspace locks outside its posting transaction
- [x] ISS-141 Account statement PDF ignores the chosen period (issue #141): one statement scope for screen, JSON, PDF and email (with AUD-01). PDF download + preview now follow the screen period with an opening-balance row (tested); The statements email API takes the same optional startDate/endDate (the monthly automatic email keeps the full balance-forward statement).
- [x] CON-5 Item configuration screens verified and hardened (AI #2, C-128, 18 Oct): bundles/unit labels/package size, form and real RLS persistence tests, phone dialog fixes; capabilities 151/152 corrected. Capabilities 143/144 remain Partial for reserved invoice-line integration and posted conversions.
- [x] DEP-1 (18 Oct: the server refuses, inside the save, an invoice that takes an order past its total — test `order-invoice-limit.test.ts`: 25% + rest accepted, a second delivery charge refused, two people at once → only one; fails without the fix) Deposits and part-invoicing (owner's QuickBooks example, 18 Oct): golden test — order 1,000 goods + 100 delivery, 25% deposit, then invoices by parts and the rest → delivery charged exactly once, the deposit applied once, the customer owes exactly 1,100 in total. And: "never more than is left to invoice" checked on the server inside the save, so two people invoicing the same order at once cannot double it (today the check is on screen only).
- [x] BUG-01 (18 Oct: list totals count each income/expense line by its side; a sale and its reversal → 1,000 in and 1,000 out; test `list-totals-reversal.test.ts`) Transaction-list inflow/outflow totals lose reversal signs (sale + its reversal shows 2,000 in, 0 out).
- [x] BUG-03 (18 Oct, see INT-2) A stale or retried invoice save gets a new posting identity and can post the invoice twice without reversing the first (one active posting per invoice revision, checked on the server).
- [x] BUG-04 Statement PDF/email ignores the chosen period (same as ISS-141/AUD-01).
- [x] BUG-05 (18 Oct: posted entries replace same-id rows in the local list; test `post-cache-upsert.test.ts`) After a successful post the local list adds the rows again instead of replacing them by id.
- [x] BUG-06 Ten enabled buttons do nothing; one "Close Period" button only selects (AI #2, `codex/c127-action-buttons`, 18 Oct: existing navigation wired, selection relabelled, unsupported actions visibly disabled; 11 control cases and four scoped Chromium runs pass; full GitHub CI pending).
- [x] BUG-07 (18 Oct: the server now also balances every foreign-currency entry in the home currency — rounding cents go to the largest line and each line's home amount is stored (`baseAmountCents`, read by `lineAmount`); a bigger gap from different rates is refused; test `home-currency-balance.test.ts`, 616 FX/validation tests pass) Foreign-currency entries: lines balance in the foreign currency but not after conversion to the home currency — validate the base amounts too.
- [x] AUD-07b see INT-3 (18 Oct).
- [x] INT-1 P0 authority at commit: bulk create and batch edit re-read the workspace inside the posting transaction and refuse if the user is no longer a member or no longer owner/accountant/bookkeeper (403), next to the closing-date check. API-key workspace scope is fixed per request (checked at the route). Test `authority-at-commit.test.ts` (real Postgres): role downgrade and removal between the first check and the commit are refused with nothing written (both fail without the fix), month closed meanwhile refused, two writers at once both succeed. Left: other write routes (payments, documents services) — same pattern to apply (AUD-09).
- [x] INT-2 P0 invoice posted once (BUG-03): inside the posting transaction the server reads the invoice's postings; if a live accrual exists that this request does not reverse, the identical posting is answered as already done (`replayed`, nothing written, the browser does not add it locally) and a different one is refused (409, reload). A proper edit (with its reversal) goes through. Test `invoice-posting-once.test.ts` (real Postgres): stale retry → one posting; stale changed save → 409, nothing written; proper edit → new live posting; two tabs at once → exactly one live posting. All 4 fail without the fix; 1,346 related invoice/bulk tests pass, 0 skipped. Bills done 18 Oct (same rule for `bill-accrual`, test added: 5 pass, 1,087 bill/bulk tests pass). Payments made from documents done 19 Oct: one live `invoice-payment`/`bill-payment` per document, and a save is a replay only when every such entry is already live and identical, so an old tab marking a posted invoice paid is refused (409) instead of silently dropping the payment (test added; it fails without the fix; 280 invoice/bill/payment/bulk tests pass). Left: a server-issued revision number on the invoice (today the revision is identified by the posting's date, total and lines).
- [x] INT-3 P1 the three admin `executeIdempotent` calls (workspace update, user update, global config) pass the fingerprint of the validated request with its target id; replay needs the same actor, operation and request. Test `idempotency-identity.test.ts` (real Postgres): same request once, changed request 409, other actor 409, field order irrelevant, two at once → one effect; 5 pass, 0 skipped. Payment path unchanged.
- [x] INT-4 P1 SDK: `createTransaction`/`createTransactions` take `{ idempotencyKey }` (make one with `LedgerFlowClient.newOperationKey()`); a dropped connection is retried with the same key; the header comment documents the contract (key = operation identity; identical real payments need two keys; reuse for another request → 409). Test (real Postgres, `sdk-client.test.ts`): server commits, answer lost, new call with the same key → first result, still 1 entry; changed request with that key → 409; two identical payments with two keys → 2 entries; in-call retry after a drop → no duplicates. 4 pass, 0 skipped.
- [x] INT-5 P1 home-currency rounding — rule: foreign lines at ONE rate: the rounding residual (≤ a cent per line) goes on the largest line and each line's home amount is stored; lines at DIFFERENT rates must balance in the home currency by themselves (an explicit exchange gain/loss line), else refused however small. `home-currency-balance.test.ts` 7 tests (one rate, divergent rates refused, gain line accepted, opposite signs + several lines, reversal mirror); 1,113 related FX/payment/validation tests pass, 0 skipped.


---

# Moved 10 Nov 2026 (AI #13 repo cleanup audit; nothing deleted) — finished [x] items

> Path note: evidence notes named `docs/verification/<name>.md` below were moved on 10 Nov 2026 to
> `docs/archive/verification/<name>.md` when their tasks were finished; the text here is unchanged.

## SECTION L — OPERATIONS & TRUST

- [x] L-94 Build invoice/bill postings on the server (with the document engine) — design 21 Oct: `docs/design/L-94-server-postings.md`; **step 0 done 21 Oct**: entry builders import only `postingCore.ts` (no Firebase client, stores, toasts), the browser registers its host in `postingKit.ts`, `context.capture` collects entries, guard test `l94-posting-core.test.ts`. **step 1 shadow done 21 Oct** (`postingShadowCheck.ts` logs any difference after each invoice/bill save). Next: read the logs of the first testers; then refuse a mismatch (409), then step 2 **Done (24 Oct, checked by AI #1):** L94-STEP2 (#308) and L94-STEP2B: the server builds the entries of invoices, bills, credit notes and vendor credits (`POST /api/v1/documents/:type/:id/post`); `/transactions/bulk` refuses those documents and any entry naming one (`documentPostedByServer`, tests `l94-step2-document-post`, `l94-step2b-documents`). The shadow check lives on in the tests only, so no live logs are needed before enforcing.

## SECTION U — PAYROLL LIFECYCLE

- [x] U-12 (done in 7d41a654: `u12-shared-time.test.ts`) Refuse paying the same time entry twice inside one pay run — **AI #2 review, 11 Oct (TOOL_REVIEW F13), AI #1 payroll ownership**: two active hourly employees can select the same `timeUid`; one approved 60-minute entry at 2500 cents/hour then produces two 2500-cent employee lines, gross 5000 cents. Later-run paid markers do not deduplicate this run. Agree the employee/person linking rule or authoritative allocation, and verify duplicate-entry refusal on the server and approval/release lifecycle. Pure selector/totals reproduction confirmed; no synthetic payroll posting performed.

## SECTION W — INVENTORY DEPTH

- [x] W-07 Assembly / kitting — covered by kits built from parts: bundles (BF-03, `itemBundles`), Kit Assembly plan (A-116, `kitAssembly`) and work orders with pick lists (A-169, `WorkOrdersView`); a kit sold uses its parts' stock. Building kits ahead into their own stock (a finished-goods item) is not done, by design — FOR_YOU #55; ticked 8 Nov

## SECTION Y — BANKING · DOCUMENTS · CONTACTS · SETTINGS

- [x] Y-35 Rounding policy setting — Settings → Appearance "Tax rounding": half up (default, unchanged), half to even, or down; invoices and bills use it for the tax when created or edited (`roundTaxCents` in `src/lib/taxCodes.ts`; migration `20261101000000_workspace_tax_rounding`)

## SECTION BH–BP — CURRENCY · COMPLIANCE · OPS

- [x] BH-02 Storage model decision for 3-decimal currencies — (decided and built with BM-04, PR #322: three-decimal dinars stored as fils; ticked 2 Nov)

- [x] BJ-02 Audit evidence pack (codex, 25 Oct, PR #381): Settings → Security → Audit evidence pack downloads one ZIP for a chosen period — audit trail, period locks, approvals, approval rules and the access review, each a CSV, plus a README of its limits. Browser-built; no server, schema or posting change. See `docs/verification/ai2-c35-c36-2026-10-25.md`.

- [x] BJ-03 Access review report (codex, 25 Oct, PR #381): Settings → Security → Access review lists every person with role, last recorded sign-in, two-step login and last role change, CSV and print, owners and accountants, read-only; limits (500-entry trail window, another person's authenticator not readable) said on screen. See `docs/verification/ai2-c35-c36-2026-10-25.md`.

- [x] BK-10 Full workspace archive — (AI #5, E-21: `src/lib/workspaceArchive.ts`, Settings → Backup & Export; ticked 2 Nov)

- [x] BM-04 Per-currency rounding — (AI #9, PR #322: `src/lib/currencyMinorUnits.ts`, amounts in each currency's own minor units; design `docs/design/BM-04-currency-minor-units.md`; ticked 2 Nov)

- [x] BM-06 `rateUsedId` per line — (AI #9, PR #332: `metadata.ratesUsed` on payment entries, shown in the entry detail; `src/tests/bm06-rate-used.test.ts`; ticked 2 Nov)

- [x] BN-01 Structured JSON logging *(AI #1, 1 Nov, D-21: `src/server/utils/logger.ts` adds the request context (id, method, route, workspace) to every line and redacts personal fields; `src/server/http/requestContext.ts` gives each request an `x-request-id` and writes one JSON access line per /api request instead of the morgan text line; test `structured-logging.test.ts`.)*

- [x] BN-02 Slow-query log *(AI #1, 1 Nov, D-22: `src/server/db/slowQueryLog.ts` times every pool and transaction query; one over 500 ms (or `SLOW_QUERY_MS`) is logged with its shape only — literals as `?`, parameter count, never values — plus the request context from the D-21 logger; test `slow-query-log.test.ts`.)*

- [x] BN-07 Runbooks — (AI #4, D-14: `docs/runbooks/`; ticked 2 Nov)

- [x] BP-03 ADRs — (AI #4, D-13: `docs/adr/` 0001–0007; ticked 2 Nov)

## SECTION CA–CG — FROM 12 OPEN-SOURCE PRODUCTS

- [x] CA-28 Mode of payment — Settings → Defaults has one account per payment method (cash, check, transfer, card, other), preselected on Record payment; unset = the Bank default (`paymentModeAccountId` in `src/lib/accountDefaults.ts`)

- [x] CA-29 Party link — a customer can be linked to the vendor that is the same business (customer page); both pages show what they owe us, what we owe them and the net (`src/lib/partyLink.ts`, `PartyLinkPanel`; migration `20261102000000_customer_linked_vendor`)

- [x] CC-04 Recurring quotes — Reports → Customer quotes: "Repeat this estimate" saves a monthly/quarterly/yearly schedule; the daily job makes a numbered draft estimate on each date (no signing link, nothing sent) and tells the team (`generateEstimate` in `recurringService.ts`, `estimate.draft_ready`)

- [x] CC-08 Payment terms entity — Settings has the workspace's own Net N terms (1–365 days) next to Due on Receipt / Net 15 / 30 / 60; invoices offer them and set the due date (`termOptions`, `PaymentTermsSettings`; migration `20261102010000_workspace_payment_terms`)

- [x] CC-09 Payment types entity — Settings has the workspace's own payment types (e.g. PayPal under Card; changed only through the server, one change at a time); Record payment offers them, the server takes the type's method and name from the workspace and keeps the name on the payment (`src/lib/paymentTypes.ts`, `PaymentTypesSettings`; migration `20261102020000_workspace_payment_types`)

- [x] CC-10 Expense categories — (AI #5, E-22: `src/lib/expenseAccountCategories.ts`, Expenses by Category; ticked 2 Nov)

- [x] CC-11 Client-group settings — Settings has customer groups with default payment terms (kept by the server, one change at a time); a customer joins a group on its page and new invoices take the group's terms when it has none (`src/lib/customerGroups.ts`, `customerGroupService`, `CustomerGroupsSettings`; migration `20261102030000_customer_groups`)

- [x] CC-12 Passkeys — "Sign in with a passkey" on the sign-in screen and a Passkeys section in Settings → Security (add with a name, list, remove) through Supabase Auth's WebAuthn; an authenticator-app user still gives the code (`src/lib/db/auth.ts`, `PasskeySettings`, `passkeys.test.tsx`); needs passkeys enabled in Supabase (FOR_YOU #49); ticked 7 Nov

- [x] CC-13 User-defined scheduler — covered by the schedules users already set: recurring invoices/bills/entries/estimates (`recurringService`), scheduled reports (K-28, `scheduledReportService`), payment reminders and monthly statements (BE-01/BE-07, `reminderService`, `statementMonthDue`); ticked 7 Nov

- [x] CC-14 Tasks + statuses — same item as BG-03: tasks given to a workspace member, optionally about a record, with a due date and open/done status (`src/lib/tasks.ts`, `taskService`, `TasksView`); ticked 7 Nov

- [x] CF-06 Export templates — **26 Oct (AI #2, C-38):** named C-29 column/order choices for indexed report tables and statement period groups, scoped per user/workspace/report on this browser. Apply then use the existing CSV action; changed schemas are refused, and blocked storage is explicit. The feature is on `main`; `export-templates.test.tsx` 4/4 and `column-chooser.test.tsx` re-verified at `116ee530`. Earlier fifteen targeted tests and phone CSV download remain historical evidence.

## From the owner's second AI audit (13 Oct) — only the parts the code check showed are real gaps

- [x] AU-4 (done in 4e1aafcd: Reports → Import acceptance, `ImportAcceptanceView`) Migration acceptance by reconciliation: after a QuickBooks/CSV import, show trial balance, A/R, A/P, cash and tax payable against the source, not just a record count.

- [x] ACC-1 (31 Oct: System Command Center → Deep User Matrix → Give access; `POST /api/v1/admin/give-access`, `src/server/routes/giveAccessRoutes.ts`, test `acc1-give-access.test.ts`) Owner "Give access" screen (owner request, 13 Oct): as platform admin, type a person's email, pick Full / Pro / Growth / tester, and it sets bypassBilling or the plan on their workspaces (and can make them admin), with an audit line. Today this needs SQL or the System Command Center per workspace.

- [x] ACC-1b (31 Oct) Seat checks count the owner twice when the owner is also in `members` (`workspaceRoutes.ts` invite, `invitePublicRoutes.ts` accept, `TeamSettings.tsx`): count unique people (`uid` + `members`), so a 5-seat plan really allows 5. Older than #460; noted there by Codex/CodeRabbit.

- [x] ACC-2 (31 Oct: the jargon was already gone; free access now says "Free access (given by LedgerFlow)", and plan names come from `src/lib/plans.ts` on the badge and the usage panel) Settings → Billing & Plan: remove jargon ("Precision Core v2.0", "institutional rule bridges", "Documentation Protocol … topological registries"); show "Free access (given by LedgerFlow)" when bypassBilling is on; plan names match everywhere (sandbox/growth vs Free/Growth/Pro).

## Prevent the whole family (owner, 13 Oct: "what can prevent all these types of bugs?") — before the single fixes

- [x] PREV-5 Failure tests by default: a test harness that runs each save action with the server refusing, slow, or switched workspace mid-request, and asserts no success message, no partial write, no stale data. Every new save action gets these three cases. *(AI #9: #313 PREV-5 money-save failure tests, #331 PREV-5b workspace switched mid-save.)*

- [x] PREV-6 Parsers: fuzz + real-file corpus (F-37, E-56) so import bugs like #101 are found before users. *(AI #9: parser-corpus.test.ts + parser-fuzz.test.ts; odd statement files refused whole.)*

## Deep code audit findings (PR #144, 16 Oct; details and acceptance tests in docs/DEEP_CODE_AUDIT.md)

- [x] AUD-01 (merged; ticked 31 Oct) — Statement screen, server JSON and PDF do not have one scope contract

- [x] AUD-02 (18 Oct: every ledger entry in a backup is checked by the ledger door before anything is read or written — an unbalanced one restores nothing; test in `workspace-restore.test.ts`. 20 Oct: the closed-books check, the other-workspace ownership check and the reads of what is deleted now run inside the one serializable transaction that writes the backup, so nothing can change between checking and writing; 17 backup/restore tests incl. the main path pass. 20 Oct: invoices, bills, projects, credit notes and vendor credits in a backup must have the field types a save accepts (an amount as text refuses the backup; missing fields and older status labels are not judged, and unknown fields are kept); the backup export reads every table in one read-only serializable transaction, so it is one consistent moment of the books) — Restore commits atomically, but validation and ownership reads precede the commit transaction

- [x] AUD-03 (merged; ticked 31 Oct) — RMA decisions/history remain editable metadata, not server approval authority

- [x] AUD-04 (merged; ticked 31 Oct) — Scheduled-report pre-marking trades duplicate avoidance for lost delivery and is not a concurrent claim

- [x] AUD-05 (merged; ticked 31 Oct) — Standalone background-job coverage differs from Vercel

- [x] AUD-09 — Privileged server access means SQL client guards are not a universal safety net. *31 Oct: step 1, `aud09-write-access.test.ts`: all 89 write routes under `/api/v1/workspaces/:workspaceId` refuse a non-member (403), and every one a viewer may not use refuses a viewer (4xx); the writes a viewer may make by design are listed in `VIEWER_MAY`; `delete /tasks/:taskId` is tested on a real task (#464). 1 Nov: step 2, `aud09-outside-routers.test.ts` (#463): the write routes mounted outside `/workspaces` refuse non-members and viewers; it found that a viewer could post a journal through `/api/v1/revenue/recognize` and `/api/v1/lease/capitalize` (fixed: owner, accountant or bookkeeper). 1 Nov: step 3, `aud09-app-routes.test.ts` (real sign-in tokens) and Plaid in the router sweep: an accountant or bookkeeper could revoke a workspace API key (now owner only, as making one), and a non-member got 500 instead of 403 from `handleApiError` (fixed). A platform admin outside the workspace revokes a key (tested). 1 Nov: valid-body cases (#468): even the owner gets 400 with the reason ("does not belong to authorized workspace", "Period Locked") for another workspace's account or a closed date, on revenue and lease.*

- [x] AUD-09a (1 Nov) The person who created a workspace can no longer be given another role on the role screen (they always count as owner, so the stored role disagreed); test `creator-role.test.ts` (CodeRabbit on #463).

- [x] AUD-10 (merged; ticked 31 Oct) — Report fallback and cache completeness need one visible provenance contract

- [x] AUD-11 (merged; ticked 31 Oct) — Safe-fetch DNS validation is not a pinned connection

- [x] AUD-12 (merged; ticked 31 Oct) — Static Vercel CSP can disagree with the configurable Supabase project

- [x] AUD-13 (merged; ticked 31 Oct) — Async auth-derived UI state has no identity generation check

- [x] AUD-14 (merged; ticked 31 Oct) — A registered receipt algorithm is a hard-coded demonstration

- [x] AUD-15 (merged; ticked 31 Oct) — Client post-success cache inserts request entries rather than a canonical server result

- [x] AUD-19 (merged; ticked 31 Oct) — Altman analytical EBIT loses reversal signs

- [x] AUD-20 (merged; ticked 31 Oct) — Remote database TLS does not authenticate the server unless a CA is supplied

## Issues and connections (18 Oct)

- [x] ISS-131 *(AI #9, merged 20 Oct)* Inventory valuation as-of date mixes today's stock with past books (issue #131): historical quantities/costs from stock moves, or the comparison hidden for past dates.

- [x] ISS-143 RMA approvals and quantities enforced on the server in one transaction (issue #143, with AUD-03). *(AI #9, #302; AUD-03 done by the same PR.)*

- [x] CON-1 *(AI #9, merged 20 Oct)* US sales-tax table (capability 137) and item taxability (139) used by invoice lines for the supported states; label stays "not verified" for others.

- [x] CON-2 *(AI #9, merged 20 Oct)* US nexus watch (138) on a screen from posted invoices, for the supported states.

- [x] CON-3 *(AI #9, merged 20 Oct)* Israel special VAT areas (141, Eilat) applied to invoices with a test.

- [x] CON-4 *(AI #9, merged 20 Oct)* Israel VAT reporting frequency (161) drives the VAT report period and PCN874.

- [x] CON-4b (merged; ticked 31 Oct) (from AI #9, #244) The Israeli VAT return record on the server carries its registration (dealer number), so "filed" can be attributed to one of several registrations; then let the screen clear it per registration. Also check the Eilat Law s.5 subsection numbers against the statute, and the PCN874 bi-monthly header month against the Tax Authority spec.

- [x] CON-1 (merged; ticked 31 Oct) *(→ AI #9 from 20 Oct)* US sales-tax table (capability 137) and item taxability (139) used by invoice lines for the supported states; label stays "not verified" for others.

- [x] CON-3 (merged; ticked 31 Oct) *(→ AI #9 from 20 Oct)* Israel special VAT areas (141, Eilat) applied to invoices with a test.

- [x] CON-4 (merged; ticked 31 Oct) *(→ AI #9 from 20 Oct)* Israel VAT reporting frequency (161) drives the VAT report period and PCN874.

- [x] DIM-1 (21 Oct: payments recorded on their own (Record payment, and applying a deposit later) carry the paid invoices'/bills' line labels in proportion; the part not applied stays unlabelled; worked figures in `dim1-payment-records.test.ts`. 18 Oct: invoices and bills — receivable/payable, tax, discount and retainage now carry the lines' labels in proportion, so each label balances; the lines' own revenue/expense lines keep exactly their labels; test `labels-every-side.test.ts`. 19 Oct: the payment posted with a paid invoice/bill now carries the document lines' labels in the same proportions — each label balances and a full payment clears each label's receivable/payable to 0 (300 random cases in `labels-every-side.test.ts`; 404 posting tests pass). Left: payments recorded separately (payment records applied to invoices/bills: bank, fees, FX difference)) Labels on every side of an entry (owner, 18 Oct): today only revenue/expense lines and the cost of goods carry the document line's labels. Carry them (in proportion) to receivable/payable, tax, discount, retainage, the payment entry (bank, fees, FX difference), and stock moves; so a P&L or balance sheet by label is complete. Test: an invoice with two labelled lines, paid with a fee → every line of every entry has the right labels and each label's books balance.

## Audit of 18 Oct (audit/VERIFIED_BUG_REPORT.md) — AI #1 fixes these, each with the test the report names

- [x] DIM-3 (merged; ticked 31 Oct) Each label kind gets an accounting role: informational (no balancing), fully attributed (every line has a value), or self-balancing (each value balances) — so balancing is applied only where it is required (strategy §16).

## AI #2 launch-readiness batch — 26 Oct 2026

- [x] **C-38 / CF-06** named export templates: verified existing per-user/workspace/report storage, compatibility refusal and blocked-storage wording.

- [x] **C-54 / C-91** report empty states: one next-action fallback for empty report tables, explicit states where missing, and a 130-report coverage guard.

- [x] **C-65** keyboard shortcut help: verified global and registry-backed screen shortcut lists and their tests.

- [x] **C-67** column chooser on invoices, bills, payments, customers and vendors; locked selection/actions and print restoration.

- [x] **C-68** print-friendly reports: verified report-only print heading with period/entity and report-pack cover.

- [x] **C-85** named report views: report, period, comparison and custom dates by user/workspace on this device.

- [x] **C-87** Excel report exports: one header block with entity, period, basis, currency and generated-at above headings.

- [x] **C-89** report column chooser: verified `ReportTableScroll` coverage of the ten busiest reports and 82 report files.

- [x] **C-90** negative formatting: verified one `moneyText` helper and workspace minus/accounting setting.

- [x] **C-96** exact report links with filters and a stated clipboard-refusal path.

- [x] **C-97** bilingual, searchable accounting glossary with 36 terms, RTL isolation and help/registry wiring.

- [x] **C-98** first-bookkeeping checklist: verified existing first-hour guide with bank, import, invoice, bill, payment, reconcile and report steps.

- [x] **C-101** tax registrations per entity/label: verified existing Tax profiles editor and tests.

## Money input fixes (AI #1, 28–29 Oct)

- [x] **AF-010** typed amounts: `readAmountCents` on ten screens (#432); quick entry always posts two lines (#431); a mistyped estimate price no longer freezes the price box (#437).

- [x] **AF-011** decimal comma: `12,50` read 1,250.00 and `1.234,56` read 1.23. Now `1.234,56`, `1 234,56` and `1234,56` read as the decimal everywhere, and `12,50` / `1,23` finish as a decimal only in comma-decimal books, so an en-US save still refuses a half-typed `1,234` (#438).

## UX — the whole front end, screen by screen (owner, 9 Nov: "make sure the UI/UX of the whole site is good, normal and great")

- [x] UX-1 Journal Entries: one-row toolbar, table fills the window and fits the width, one line per entry, plain words (PR #582)

- [x] UX-2 Sales: plain header and cards, fake "Mid-Term" $0 card removed, page padding; compact Columns chooser on every list (PR #582)

- [x] UX-3 Reconcile: normal-case title, "0% of bank lines matched", controls fit at 1280 and 390, names wrap (#589, 9 Nov)

- [x] UX-4 Reports: the controls above a report (paper size, Generate, saved views, "Choose report" box) into one tidy row — done (#591, 9 Nov)

- [x] UX-5 Dashboard: the empty "First-hour bookkeeping guide" box, spacing, date range in the header row — done (#594, 9 Nov)

- [x] UX-6 Settings: survey and tidy — plan cards fixed in #582; 25 sub-pages checked at 1280/390, nothing clipped (9 Nov)

- [x] UX-7 Top of every page: backup reminder and demo banner in one slim line; tab bar spacing — done (#596, 9 Nov)

- [x] UX-8 One shared page-header component used by every main screen — `PageHeader` on Dashboard, Sales, Purchases, Purchase orders (#597, 10 Nov)

- [x] UX-9 Phone (390 px) pass over the same screens — clipping check over 10 main screens at 1280/390 clean (#598, 10 Nov)


---

# Whole ✔ DONE sections moved 10 Nov 2026 (AI #13 repo cleanup audit; nothing deleted)

## Batch 1 — makes CI fully green ✔ DONE (7160b13 + 9f9c419)

**CARD 1.1 — Test helpers must set `createdAt`** (3 type errors)
- Where: `src/tests/fixtures.ts` — `makePayment` (line 56), `makeCreditNote` (74), `makeVendorCredit` (88).
- Change: in each of the three, add this line directly **above** `...overrides`:
  ```ts
      createdAt: '2026-01-01T00:00:00.000Z',
  ```
- Done when: `npm run lint:types` → no errors.

**CARD 1.2 — Remove the 34 `as any` casts from tests** (ESLint over the limit)
- Where: `src/tests/report-contract.test.ts` lines 22, 55, 195, 211, 227, 243, 253, 281, 294,
  306, 315, 319, 324 · `src/tests/reports-math.test.ts` lines 16, 21, 29, 34, 38, 63, 78, 82,
  86, 103, 106, 109, 122, 125, 128, 142, 146, 149, 160, 163 · `src/tests/document-math-tax.test.ts` line 158.
- Change: wrap every object in the matching helper from `src/tests/fixtures.ts`
  (`makeCustomer`, `makeVendor`, `makeInvoice`, `makeBill`, `makePayment`, `makeCreditNote`,
  `makeVendorCredit`, `makeChartAccount`, `makeTransaction`), give the array a real type, drop the cast:
  ```ts
  // before
  const mockCustomers = [
    { id: 'cust-1', name: 'Acme Corp', email: 'acme@example.com', phone: '555-0101' },
  ] as any[];
  // after
  const mockCustomers: Customer[] = [
    makeCustomer({ id: 'cust-1', name: 'Acme Corp', email: 'acme@example.com', phone: '555-0101' }),
  ];
  ```
  At the top of each test file add the imports it needs, e.g.
  `import { makeCustomer, makeInvoice, makePayment } from './fixtures';` and
  `import type { Customer, Invoice, Payment } from '../types';`.
  `document-math-tax.test.ts:158`: the literal has `totalCents`, a field Invoice dropped on
  purpose and nothing reads. Pass `makeInvoice({ id: invoice.id, date: invoice.date,
  amountCents: invoice.amountCents, salesTaxCents: invoice.salesTaxCents, status: invoice.status })`.
  Same values, same expected numbers.
- Done when: `grep -c "as any" <each file>` → 0 · `npm test` → all pass.

**CARD 1.3 — Saved-view chip: no button inside a button** (Overview accessibility)
- Where: `src/components/ui/SavedViewsBar.tsx` lines 84–138.
- Change (3 edits):
  1. On the outer `<div key={view.id}` delete `role="button"`, `tabIndex={0}`, `onClick={...}`
     and the whole `onKeyDown={...}` block. Keep its `className`.
  2. Right after that div's opening `>`, open a real button around the icon + text:
     ```tsx
     <button
       type="button"
       aria-pressed={isActive}
       onClick={() => setActiveView(isActive ? null : view.id)}
       className="flex items-center gap-2 text-left"
     >
     ```
  3. Close it with `</button>` just before the existing star `<button type="button"` — so the
     star button becomes a sibling, not a child.
- Done when: `npm run test:e2e` → "Navigate and mount view: Overview" passes.

**CARD 1.4 — Lower the warning limit**
- Where: `package.json` line 16 (`"lint:eslint": "eslint . --max-warnings 2816"`).
- Change: after 1.2 and 1.3, run `npx eslint . 2>&1 | tail -1`, put that number in place
  of 2816 (it must be ≤ 2808), then run `npm run ratchet:update`.
- Done when: `npm run lint:eslint` passes; both GitHub CI jobs green.


## Batch 6 — ✔ DONE in cdd1f46 (leftovers moved into Prompt L Part 2)

**CARD 6.1 — Remove the unused endpoint** (fixes both CI failures)
- Where: `src/server/routes/transactionRoutes.ts` — delete the whole
  `transactionRouter.post('/bank-lines/:id/unmatch', …)` block added in `5119ad2`, and its
  `import { requireWorkspaceRole } from './workspaceRoutes';` line if 6.2 doesn't use it.
- Done when: `npm run lint:eslint` passes (≤ 2803) and `npm test` → 324/324.

**CARD 6.2 — Harden the real reconcile endpoint** (`transactionRoutes.ts:657`, `POST /reconcile`)
- a. Role: add `requireWorkspaceRole(['owner', 'accountant', 'bookkeeper'])` as middleware
  (import from `./workspaceRoutes`) — viewers get 403.
- b. Locked period: after loading each bank line and transaction the operations touch, if
  its `date` is on or before the workspace `lockDate`, return
  `400 { error: 'This period is locked' }` and write nothing.
- c. Audit: in the same batch, write one `auditLogs` entry per call with the standard fields
  `{ workspaceId, uid, action: 'reconcile' (or 'reconcile_undo' when a line goes back to
  pending), details, severity: 'info', timestamp }` — the fields `AuditLogViewer` reads.
- d. Types: use the existing authenticated-request type instead of `(req as any)`, and
  `catch (e)` with `e instanceof Error ? e.message : String(e)` — no new `any`.
- e. Tests (new `src/tests/reconcile-endpoint.test.ts` or the existing route tests):
  viewer → 403 · line dated inside a locked period → 400 · undo sets the bank line to
  `pending` + `matchedTransactionId: null` **and** the transaction back to `completed` ·
  one audit entry written.
- Done when: all 7 checks pass.

**CARD 6.3 — One local-date helper**
- `src/lib/utils.ts`: keep `getLocalDateISO` (line 142 — follows the workspace timezone).
  Replace every `getLocalDateIso` import/call with `getLocalDateISO` in: `sales/Sales.tsx`,
  `platform/settings/BackupExportSettings.tsx`, `platform/ToolSandbox.tsx`,
  `hr/PayrollView.tsx`, `banking/TransferModal.tsx`, `lib/paymentTerms.ts`,
  `lib/depreciationEngine.ts`, `lib/estimateConverter.ts`, `lib/creditNoteEngine.ts`.
  Then delete `getLocalDateIso` (line 397).
- Watch out: `src/lib/*` files are also used on the server, where there is no signed-in
  workspace — `getLocalDateISO` falls back to UTC there; pass the workspace timezone in
  from the caller when it's known (`formatTzDate(d, workspace.timezone)`).
- Done when: `grep -rn "getLocalDateIso" src` → nothing; all tests pass.

