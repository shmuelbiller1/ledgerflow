# L-123 — balances and reports on the server, opening balances per closed year

AI #9, 22 Oct 2026. Status: design (no code). Reviewer: AI #1, before any code. Goes with C-19 (archive tier).

## Today

1. **The browser holds the books.** `src/lib/ledgerCollections.ts` loads up to 20,000 entries, newest first. A banner
   shows when the cap is reached. `useLedgerStore` computes every account's balance from what is loaded
   (`summarizeLedger`, `LedgerEngine.computeDimensionalBalances`), and 103 components read `transactions` from the
   store (31 of them in `src/components/reporting`).
   - A business with more than 20,000 entries sees wrong balances for its older accounts, and the banner is the
     only warning.
2. **Server reports read entries by date** (`reportRoutes.ts` → `getReportContext`: every entry of the workspace
   up to the end date, streamed). A balance sheet for any date therefore reads every entry since the books began.
3. **Year-end close posts no closing entry** (CA-07, `periodRoutes.ts` `/close-year`). It records the year's profit
   and moves the lock date; the balance sheet carries past profit by summing every income and expense entry ever
   posted. A closed year can be partly reopened (`lockException`: a date range open again) by owners and
   accountants.

## The goal

The browser loads only the **open** years: entries dated after the last closed year end, plus what a person opens
on purpose. Every balance and report figure comes out the same as today, to the cent, for any date and any label.

## The model: a balance snapshot per closed year end

A new table, **`periodBalances`**, written only by the server: one document per workspace and closed year end.

| Field | Meaning |
|---|---|
| `workspaceId`, `asOf` | the closed year end (`YYYY-MM-DD`), the last day the snapshot includes |
| `accounts` | per account id: base-currency cents (debit positive), summed over every postable entry dated ≤ `asOf` |
| `byLabel` | per label kind → value → account → cents (only kinds that exist); the by-label reports read it |
| `retainedEarnings` | the cumulative profit of all years ≤ `asOf` (Σ income + expense accounts), kept separately so the balance sheet does not have to sum P&L accounts |
| `entryCount`, `checksum` | how many entries it sums, and a hash of their ids and `updatedAt` — to tell a stale snapshot |
| `builtAt`, `builtBy` | when it was made, and the user or the job that made it |

- **Rule:** *balance at date D = the newest snapshot with `asOf` < D, plus the postable entries dated after `asOf`
  and ≤ D.* The P&L for a period inside open years reads only entries. A P&L of a closed year reads that year's
  entries; they stay in `transactions` until C-19 moves them to the archive.
- **Building it:**
  - `/close-year` builds the snapshot in the same transaction that moves the lock date.
  - A rebuild job makes the snapshots of years that were closed before this change.
- **Keeping it right:** an entry dated ≤ `asOf` can only change through a reopened range (`lockException`) or an
  admin action.
  - A write trigger on `transactions` marks every snapshot with `asOf` ≥ that entry's date as **stale**. Any insert,
    update or delete dated in a closed year does this, from any path, including the server's.
  - A stale snapshot is never read: the reader falls back to the newest fresh snapshot before it (or none), and
    the server rebuilds the stale one in the background.
  - Closing the reopened range rebuilds it at once.
- **Currency:** snapshots hold base-currency cents (what reports show). A document's own currency stays on the
  entries. FX revaluation entries are ordinary entries, so they are already in the sums.
- **Stock** is not in the snapshot. Stock value comes from `stockMoves` (its own table, already read by date on the
  server: `/inventory-details`, `/stock-aging`); the Inventory account balance comes from the snapshot like any
  other account.

## What moves, in order (each step shippable, each with its tests)

1. **Server balance service.** `src/server/services/balanceService.ts`: `balancesAsOf(db, ws, date, { byLabel })`
   and `buildSnapshot(db, ws, asOf)`, the `periodBalances` migration (server-only, RLS like `stockMoves`), and the
   stale-marking trigger.
   - *Test:* for the gold ledgers (W1, W3W4, W12, W13, YEAR-END, FX, DIM-1), `balancesAsOf` equals a full
     recompute from every entry at each month end, with and without a snapshot.
   - *Test:* an entry edited in a reopened range makes the snapshot stale, and the answer stays right.
2. **Server reports use it.** These read `balancesAsOf` instead of every entry:
   - balance sheet;
   - trial balance;
   - the general ledger's opening line;
   - balance sheet by label;
   - cash flow's opening cash;
   - aging is unchanged (it reads documents).
   - *Test:* each route gives the same JSON as before for the gold ledgers; the report cache key carries the
     snapshot's checksum.
3. **Browser balances from the server.** The account list and every screen showing a balance read
   `GET /api/v1/balances?workspaceId&asOf` (accounts, and labels on request) for the opening, plus the loaded
   open-year entries.
   - The 103 components that read `transactions` are sorted into three kinds:
     - **totals:** they move to the server service;
     - **lists of recent entries:** these stay;
     - **search or explain across all years:** these ask the server.
   - Where they mix, the screen says which.
   - *Test:* a ledger of 25,000 entries, with the loading cap at 20,000: every account balance on screen equals the
     server's. Today they would differ.
4. **Load only open years.** `ledgerCollections` loads entries dated after the newest fresh snapshot (the cap stays
   as a guard). The banner says "Entries before {asOf} are summed in the opening balances; open an account's
   history to see them." Account history and the general ledger fetch older entries from the server, page by page.
   - *Test:* opening the books loads only open-year entries; every report figure is unchanged.
5. **C-19 (separate task):** entries of closed years move to `transactionsArchive`. Reports and history read both
   tables; the snapshot is the only thing the browser needs from closed years.
   - *Test:* a closed year's reports are unchanged after archiving.

## What does not change

- How amounts are posted (L-94 keeps building entries on the server).
- The lock and its exceptions.
- The year-end rule (no closing entry).
- Every report's figures.

## Risks and how each is met

| Risk | Answer |
|---|---|
| A snapshot that is wrong but looks fresh | The checksum is over the entries it sums. A nightly check (ledger health) rebuilds one snapshot per workspace and compares; a difference is logged and the snapshot rebuilt. |
| An entry changed in a reopened range | The trigger marks it stale on any path; a stale snapshot is never read. |
| Restore or backup (`workspaceRestoreService`) | Snapshots are not backed up. They are rebuilt after a restore, so a restored workspace can never carry a snapshot of other books. |
| Time zones | `asOf` is a book date (`YYYY-MM-DD`), the same as entry dates; no clock times. |
| Labels added later to old entries (a batch relabel) | A relabel is an update dated in a closed year, so the trigger marks the snapshot stale. |
| Old years with entries dated after a later close | The rule is by entry date, not by write time, so they are counted. |

## Open questions for AI #1 (defaults used if no answer)

1. **A snapshot per closed year, or one rolling snapshot?** *Default: per closed year.* It keeps an audit trail
   ("what the books said at each year end") and lets a reopened year invalidate only from that year on.
2. **Labels in the snapshot:** every kind, or only kinds marked fully attributed or self-balancing (DIM-3)?
   *Default: every kind present at build time* (the by-label reports allow any kind).
3. **Who may trigger a rebuild?** *Default:* the server only (close-year, the job, the nightly check); owners
   get a "Recalculate opening balances" button that asks the server.

## Tests (summary)

- Equality: `balancesAsOf` against a full recompute on every gold ledger, at every month end.
- Staleness: an edit in a reopened range is caught and the answer stays right; a delete; a relabel.
- Routes unchanged: the balance sheet, trial balance, GL, BS by label and cash flow give byte-identical JSON on
  the gold ledgers before and after.
- Browser: with 25,000 entries and the cap at 20,000, the balances on screen equal the server's; opening the
  books loads only open-year entries.
- RLS: a browser cannot write `periodBalances` (`supabase/tests/rls.test.sql`).

## Step 3 — what was done, and the inventory (AI #9, 23 Oct 2026)

- **Route:** `GET /api/v1/balances?workspaceId&asOf[&byLabel=1]` (`src/server/routes/balanceRoutes.ts`, mounted in
  `server.ts` with `apiAuthenticate`), any member (a viewer too); 400 for a bad date, 403 for a non-member, 404 for no
  workspace. It answers `balancesAsOf`: `accounts` (debit-positive cents, no account openings), `retainedEarnings`,
  `snapshot`, `entriesRead`, and `byLabel` on request.
- **The browser rule** (`src/lib/serverBalances.ts`, `src/hooks/useServerOpening.ts`): balance on screen = the
  account's own opening + the server's sum through the **oldest loaded day** + the loaded entries after that day
  (summed by `LedgerEngine` as before). The loader keeps the newest 20,000 (`LEDGER_COLLECTIONS.transactions.cap`),
  so everything after the oldest loaded day is loaded, and that day, which may be cut part-way, is counted whole by
  the server. Until the server answers (or when it cannot be reached) the screen sums the loaded entries, as before,
  and says so. Step 4 moves the cut-off to the newest fresh snapshot.
- **Moved in this step:** the ledger screen's account balances (`Ledger.tsx` → chart of accounts, trial balance tab,
  the profit figure in its header) and the account register header (`AccountRegisterView.tsx`: "Current Register
  Balance", "Period Activity", and so the running balances, which are anchored on it). Both screens mix kinds and
  say which: the balances are totals of every entry, the journal and the register rows are the loaded entries.
- *Test:* `src/tests/l123-step3-balances.test.tsx` (25,000 entries built in one SQL insert, the newest 20,000
  loaded; the hand-worked figures are in its header).

### Inventory of the components that read `transactions` (107 files in `src/components`)

| Kind | Components | Step |
|---|---|---|
| **Totals → server balance** (moved) | `ledger/Ledger.tsx` (chart of accounts, trial balance tab, profit), `finance/AccountRegisterView.tsx` (header) | 3 (done) |
| **Totals → server balance** (next; see step 3b below for what moved) | everything reading `useLedgerStore.computedAccounts` / `runningBalances` (`layout/Sidebar.tsx`, `finance/TaxReserveWidget.tsx`, `intelligence/DiagnosticConsole.tsx`, `intelligence/FinancialCalculatorView.tsx`, `intelligence/IntelligenceCenter.tsx`, `ledger/CashFlowView.tsx`, `platform/ToolSandbox.tsx`, `platform/settings/DeveloperSettings.tsx`); `ledger/BalanceSheetView.tsx`, `ledger/TrialBalanceView.tsx` (its own sum when given entries), `ledger/ProfitAndLossView.tsx` (balances part), `dashboard/DashboardWidgets.tsx`, `Dashboard.tsx`, `charts/AccountBalanceChart.tsx`, `planning/CashFlowPredictor.tsx`, `planning/BudgetManager.tsx`, `common/BudgetLeft.tsx`, `finance/PettyCashView.tsx`, `finance/LoansView.tsx`, `finance/TaxManager.tsx`, `finance/FinancialChartsDashboard.tsx`, `finance/Consolidation.tsx`, `finance/IntercompanyManager.tsx`, `banking/CashMovementDialog.tsx`, `banking/TransferModal.tsx` (available balance), `purchases/BillModal.tsx` (balance hints), `system/BalanceBreakPanel.tsx`, `system/HealthCheckModal.tsx`, `ledger/OwnerLens.tsx`, `ledger/MonthEndCloseView.tsx`, `ledger/CloseComparisonPanel.tsx`, `ledger/WorkpapersPanel.tsx`, `finance/FiscalPeriodManager.tsx`, `projects/Projects.tsx`, `projects/ProjectPipeline.tsx`, `reporting/PartyLinkedTrialBalanceView.tsx`, `reporting/FinancialRatiosReportView.tsx`, `reporting/EverydayReportViews.tsx`, `reporting/AccountantExportPackView.tsx` | 3b (next) |
| **Period figures** (P&L-type, read entries of a date range; stay on loaded entries while the range is in open years, ask the server for a closed year) | `reporting/ExpenseByCategoryReportView.tsx`, `IncomeBySourceReportView.tsx`, `TopExpensesIncomeReportView.tsx`, `AverageMonthlyReportView.tsx`, `BudgetActualReportView.tsx`, `TagBreakdownReportView.tsx`, `ProfitabilityByView.tsx`, `SpreadWaterfallView.tsx`, `CustomerGrossProfitView.tsx`, `CustomerLifetimeValueReportView.tsx`, `GrossMarginByItemGroupReportView.tsx`, `SalesByItemReportView.tsx`, `RegistrationThresholdWatchReportView.tsx`, `DocumentTrendsView.tsx`, `AssetRegisterReportView.tsx`, `DepreciationLedgerReportView.tsx`, `charts/ChartExploration.tsx`, `SinceLastVisitCard.tsx` | 4 |
| **Lists of recent entries** (stay) | `ledger/TransactionGrid.tsx`, `TransactionGridShared.tsx`, `ledger/InboxView.tsx`, `ledger/ReconciliationWizard.tsx`, `ledger/useReconciliationModel.ts`, `ledger/JournalEntryModal.tsx`, `transactions/TransactionEditModal.tsx`, `transactions/InlineEntryRow.tsx`, `transactions/EntryLinks.tsx`, `ui/RecordInlineField.tsx`, `ui/SavedViewsBar.tsx`, `ui/SavedViewsManagerModal.tsx`, `collaboration/recordChoices.ts`, `inventory/Inventory.tsx`, `inventory/StockHistoryDialog.tsx`, `sales/OrderDeliveryDialog.tsx`, `reporting/PickPackShipPanel.tsx`, `reporting/BackordersReportView.tsx`, `reporting/GoodsNotBilledReportView.tsx`, `reporting/DeliveryNotesReportView.tsx`, `reporting/BankClearanceReportView.tsx`, `reporting/JournalSheetReportView.tsx`, `reporting/RecordNotesReportView.tsx`, `reporting/OneSidedTransfersReportView.tsx`, `reporting/ExchangeRateHistoryView.tsx`, `reporting/DataQualityReportView.tsx`, `finance/CreditNotesView.tsx`, `forensics/Vault.tsx`, `dashboard/NeedsAttentionCard.tsx`, `platform/settings/RulesSettings.tsx` (rule preview), `platform/settings/DimensionsSettings.tsx`, `support/FirstMonthOnboardingHub.tsx`, `support/GuestCountrySamplePicker.tsx`, `layout/StatusBar.tsx`, `intelligence/Copilot.tsx` (counts) | stay |
| **Search or explain across all years** (ask the server) | `ledger/QueryView.tsx`, `ledger/AskLoop.tsx`, `ledger/TimeMachine.tsx`, `ledger/GeneralLedgerView.tsx`, `reporting/TransactionsByReferenceView.tsx`, `reporting/ForensicAuditor.tsx`, `forensics/ForensicAudit.tsx`, `forensics/LedgerInterruptOverlay.tsx`, `common/CategoryWhyPopover.tsx`, `layout/CommandPortal.tsx`, `intelligence/AICommandCenter.tsx`, `system/DataHealthView.tsx`, `reporting/Reports.tsx` (year list) | 4 (history page by page) |

## Step 3b — one central change (AI #9, 23 Oct 2026)

- **Central source:** `useLedgerStore.serverOpening` holds the server's answer (`GET /api/v1/balances` through the
  oldest loaded day). `useServerOpeningSync()` (`src/hooks/useServerOpening.ts`), mounted once in `RootLayout`, keeps
  it current; `recomputeBalances` uses it only when its day is still the oldest loaded day, and then
  `computedAccounts` / `totalLedgerBalance` = account opening + the server's sum + the loaded entries after its day.
  Until the server answers, or when it cannot be reached, they are the loaded entries' sums, as before.
- **For screens that sum entries themselves:** `foldServerOpening(transactions, opening)` (`src/lib/serverBalances.ts`)
  gives one calculation-only entry dated the server's day with its sums, plus the loaded entries after it. Any balance
  as of a later date then equals the server's; a period starting after that day is unchanged. A period that starts
  on or before it keeps the loaded entries and says so (`periodBeforeOpening`).
- *Test:* `src/tests/l123-step3-balances.test.tsx` (step 3b case): with 20,000 of 25,000 loaded, `computedAccounts`
  is Cash 2,505,000 · Sales 3,750,000 · Rent 1,250,000 cents and the dashboard's Cash card equals every entry's figure;
  the DB-backed case checks `computedAccounts` against the real route.

| Screen | Step 3b |
|---|---|
| Every reader of `computedAccounts` / `totalLedgerBalance`: `layout/Sidebar.tsx`, `finance/TaxReserveWidget.tsx`, `intelligence/DiagnosticConsole.tsx`, `intelligence/FinancialCalculatorView.tsx`, `intelligence/IntelligenceCenter.tsx`, `ledger/CashFlowView.tsx` (balances part), `platform/ToolSandbox.tsx`, `platform/settings/DeveloperSettings.tsx`, `support/GuestCountrySamplePicker.tsx` | **moved** (central, no edit to the screens) |
| `dashboard/DashboardWidgets.tsx` (Cash, Net worth, Banks, account summary, 12-month chart's balances; revenue/expenses/profit when the period starts after the server's day, else the loaded entries with a note; the loading cap no longer marks the summary "Unavailable" when the server covers it) | **moved** (`foldServerOpening` + `withServerBalances` in `src/lib/dashboardOverview.ts`) |
| `ledger/BalanceSheetView.tsx`, `ledger/ProfitAndLossView.tsx`, `ledger/TrialBalanceView.tsx` | left: they already offer the server report (`loadServerReport`); their browser-side sum is next to move with `foldServerOpening` |
| `Dashboard.tsx`, `charts/AccountBalanceChart.tsx`, `planning/CashFlowPredictor.tsx`, `planning/BudgetManager.tsx`, `common/BudgetLeft.tsx`, `finance/PettyCashView.tsx`, `finance/LoansView.tsx`, `finance/TaxManager.tsx`, `finance/FinancialChartsDashboard.tsx`, `finance/Consolidation.tsx`, `finance/IntercompanyManager.tsx`, `banking/CashMovementDialog.tsx`, `banking/TransferModal.tsx`, `purchases/BillModal.tsx`, `system/BalanceBreakPanel.tsx`, `system/HealthCheckModal.tsx`, `ledger/OwnerLens.tsx`, `ledger/MonthEndCloseView.tsx`, `ledger/CloseComparisonPanel.tsx`, `ledger/WorkpapersPanel.tsx`, `finance/FiscalPeriodManager.tsx`, `projects/Projects.tsx`, `projects/ProjectPipeline.tsx`, `reporting/PartyLinkedTrialBalanceView.tsx`, `reporting/FinancialRatiosReportView.tsx`, `reporting/EverydayReportViews.tsx`, `reporting/AccountantExportPackView.tsx` | left: each sums `transactions` itself; the move is `foldServerOpening(transactions, useLedgerStore(s => s.serverOpening))` for balance math (never for lists), screen by screen |
| `runningBalances` (income/expense totals, per-project and per-category figures) | left: per-project and per-category sums need `byLabel` from the route; still loaded entries |
