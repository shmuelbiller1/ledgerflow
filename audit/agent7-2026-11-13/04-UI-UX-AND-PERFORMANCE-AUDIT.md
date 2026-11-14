# Checkpoint 04 — UI/UX, Client State Hygiene & Performance Audit (`F-1` Root-Cause & Fix) (Agent #7 — 2026-11-13)

---

## 1. Root-Cause Investigation & Authorized Fix for `F-1` (`e2e/dashboard-widgets.spec.ts:28` Desktop `1280px` Timeout)

### Symptom (`CURRENT_WORK.md` Open Item `F-1`)
In CI (`e2e/dashboard-widgets.spec.ts:28`), at `1280x800` desktop viewport, clicking the Revenue widget's report link (`await revenue.getByRole('link').click()`) timed out after 5,000ms waiting for `page.getByTestId('reports-heading')` to contain `'Custom range'` — rendering `<div role="status">Loading</div>` across the entire 5s assertion window, while `390x844` mobile passed only because it ran second after Vite had already compiled and cached all modules.

### Exact Root Cause
1. `DashboardWidgets.tsx` (`lines 159, 167, 179, 199`) rendered plain `<a href="?report=pnl&startDate=2025-11-01&endDate=2025-11-30#reports">` anchors without intercepting primary SPA clicks.
2. Because `href` changed `window.location.search` (not just `location.hash`), clicking the link forced the browser to **tear down the running SPA and execute a full cold document navigation**, triggering **four sequential network/Vite compilation waterfalls**:
   - Waterfall 1: `index.html` + `src/main.tsx` + `src/App.tsx`
   - Waterfall 2: `React.lazy(() => loadRootLayout())` (`src/App.tsx:24`) -> `Suspense fallback={<LoadingScreen />}` (`<div role="status">Loading</div>`)
   - Waterfall 3: `React.lazy(() => import('../reporting/Reports'))` (`MainViewSwitcher.tsx`)
   - Waterfall 4: `React.lazy(() => import('../ledger/ProfitAndLossView'))` (`Reports.tsx` / `registry.tsx`).
3. In addition, if `Reports` had already mounted once in the session, `Reports.tsx:67-75` only parsed `window.location.search` inside `useState` initializers on first mount and ignored subsequent URL query changes.

### Authorized Fix Committed on Branch (`arena/cbdeb4bb-ledgerflow`)
- **`src/components/dashboard/DashboardWidgets.tsx`:**
  - Added `preloadReportView(report)` on `onPointerEnter` / `onFocus` / `onClick` to warm `Reports` and the target report view chunk (`ProfitAndLossView`, `BalanceSheetView`, `TrialBalanceView`, `ARAgingReportView`, `APAgingReportView`) ahead of transition.
  - Added `openReportInSpa(event, report)` on unmodified primary clicks (`button === 0`, no modifier keys): calls `event.preventDefault()`, updates the URL bar via `window.history.pushState(..., href)`, updates `useUIStore` (`setActiveReportTab(report)` + `setActiveTab('reports')`), and dispatches `window.dispatchEvent(new window.Event('ledgerflow:report-link'))` — **completely eliminating the document teardown and Waterfalls 1 & 2** while preserving native middle-click / `Ctrl+Click` / `Cmd+Click` / right-click link behavior!
  - Fixed scenario preview (`line 185`) to format ghost amounts in workspace `currency` instead of hardcoded `'USD'`.
- **`src/components/reporting/Reports.tsx`:**
  - Subscribed to `'ledgerflow:report-link'` and `'popstate'` events to synchronize `linked`, `activeTab`, `selectedYear`, `timeframe`, `selectedQuarter`, `selectedMonth`, `compareMode`, and `customPeriod` (`Custom range`) immediately upon in-SPA report link navigation or browser Back/Forward.

---

## 2. Authorized Client & Export Fixes Committed on Branch (`Zero Overlap` with PR `#28` & PR `#697`)

| ID | File(s) | Defect Fixed | Verification |
|---|---|---|---|
| **`A7-UI-01`** | `TransactionEditModal.tsx`, `TransactionEditModalView.tsx` | FX rate panel checked `originalCurrency !== 'USD'` and fetched `/api/v1/currency/historical?...&source=USD`, breaking non-USD home workspaces (`ILS`, `EUR`, `GBP`, `JPY`). Fixed to compare against workspace `baseCurrency` and fetch `source=${baseCurrency}`. | `agent7-ui-and-export-regressions.test.tsx` |
| **`A7-UI-02`** | `TransactionEditModal.tsx`, `TransactionEditModalView.tsx` | Balanced double-entry journals summed signed `amountCents` (`+50000 + -50000 = 0`), displaying `$0.00` in `Total Transaction Sum` and formatting via `/ 100` (`JPY`/`KWD` broken). Fixed to sum debit legs and format via `formatCurrency(..., displayCurrency)`. | `agent7-ui-and-export-regressions.test.tsx` |
| **`A7-UI-03`** | `TransactionEditModal.tsx` | Editing header `exchangeRate` or switching currency left stale `line.exchangeRate = 1` / `baseAmountCents` on lines (`#654` / `A7-02c` client side), and modal closed + toasted success even when `onUpdate` returned `false` (`409`/`403`). Fixed both. | `agent7-ui-and-export-regressions.test.tsx` + `stable-editor-keys.test.tsx` |
| **`A7-UI-04`** | `TransactionEditModal.tsx`, `TransactionEditModalView.tsx` | Modal allowed in-place editing of document-backed entries (`#652`) and offered manual `<option value="reconciled">` on unreconciled entries. Added document-backed read-only guard banner and restricted `'reconciled'` option to already-reconciled entries. | `agent7-ui-and-export-regressions.test.tsx` |
| **`A7-UI-05`** | `src/lib/plExport.ts` | Non-comparative P&L Excel export (`prevData === null`) threw `TypeError: Cannot read properties of undefined` AND hardcoded `/ 100` on `JPY` (0-dec) and `KWD` (3-dec) figures. Fixed optional chaining + `minorToMajor(..., reportContext.currency)`. | `agent7-ui-and-export-regressions.test.tsx` + `report-export-header.test.ts` |
| **`A7-UI-06`** | `src/hooks/transactionActions/entryActions.ts` | `handleDuplicateTransaction` copied `invoiceId`, `metadata`, `reconciled`, `isCleared`, `reversalEventId`, `deletedAt`, and `baseAmountCents` onto copies and toasted success even on failed `POST`; `handleToggleFlag` ignored `res.ok`, omitted `expectedUpdatedAt`, and lacked `#107` `identityScope` stale-async guard; `handleUpdateTransaction` ignored server `data.updatedAt`. Fixed all three. | `agent7-ui-and-export-regressions.test.tsx` + `bug-patterns.test.ts` |
