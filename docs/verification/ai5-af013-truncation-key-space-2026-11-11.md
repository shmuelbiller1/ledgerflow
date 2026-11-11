# AI #5 — AF-013: the "loaded data is incomplete" warning that could never fire

**Date:** 2026-11-11 · **Agent:** AI #5 (E-… queue; tables, screens, imports, exports — no money maths)
**Branch:** `arena/9cf6468f-ledgerflow` · **Base:** `ec3ff49` (upstream `main`, PR #626) · **Fix commit:** `fb8a7708`
**Severity:** Medium (P2) — a figure worked out from a cut list is shown as if complete, with no warning.
**Status:** FIXED, with a regression test. No amount, posting, tax calculation or stored value is changed.

## What the code promises

Every screen that works a figure out **in the browser** must say so when the list it read was cut at
its loading cap or failed to load (`AGENTS.md`; `docs/UI_GUIDE.md`; `src/lib/reportProvenance.ts`).
The canonical words are the banner "Loaded history is incomplete or failed. These figures are
provisional." and, above every screen, `DataStatusBar`.

## The defect

`useLedgerStore.truncatedCollections` is a map of **database collection name → cut?**, written by the
one live subscriber:

```ts
// src/hooks/useLedgerData.ts:417
useLedgerStore.getState().setCollectionTruncated(spec.collection, entryListPartial(snap.docs.length, spec.cap, closedThrough));
```

The store keys the same data by **field name** (`spec` comes from `LEDGER_COLLECTIONS`, whose keys are
the store fields). For every collection but one, the two strings are identical — and that one is the
chart of accounts:

```ts
// src/lib/ledgerCollections.ts:29
accounts: { collection: 'chartAccounts', cap: 2000 },
```

So `truncated[c]` where `c` is a store key reads the right flag for every collection except
`accounts`. `truncated.accounts` is never true: the subscriber writes `chartAccounts`. The failure is
silent in both directions — the screen neither warns nor falls back to the server's figures, and it
looks correct in review because the key reads as the obvious one.

Four screens had already noticed and added a second, collection-named read
(`truncated.chartAccounts || …`); the rest did not.

## Sites fixed (all read `chartAccounts` through the helper now)

| File | What the missed warning hid |
|---|---|
| `src/components/reporting/IsraelVatReportView.tsx:137` | Israel VAT return figures (also the `truncated.accounts` bug Codex flagged on PR #623) |
| `src/components/reporting/FinancialRatiosReportView.tsx:27` | every ratio; `accounts` is its whole input |
| `src/components/finance/FinancialChartsDashboard.tsx:29` | cash, burn, runway chart totals |
| `src/components/reporting/OneSidedTransfersReportView.tsx:20` | transfers needing a counterpart |
| `src/components/reporting/PartyLinkedTrialBalanceView.tsx:22` | party linked-posting trial balance |
| `src/components/reporting/PartyPeriodSummaryView.tsx:33` | customer/supplier period summary, and its CSV export gate |
| `src/components/reporting/AccountantExportPackView.tsx:133` | the accountant pack's blocker list — a pack could be downloaded from a cut chart |
| `src/components/dashboard/DashboardWidgets.tsx:143` | dashboard summary totals |
| `src/components/reporting/EverydayReportViews.tsx:26` | account balances as of a date |
| `src/components/reporting/RegistrationThresholdWatchReportView.tsx:51` | registration threshold watch |
| `src/components/reporting/CustomerGrossProfitView.tsx:18` | gross profit by customer |
| `src/components/reporting/CustomerLifetimeValueReportView.tsx:43` | customer lifetime value |
| `src/components/reporting/DocumentTrendsView.tsx:33` | sales / purchase trends |
| `src/components/reporting/RecordNotesReportView.tsx:93` | record-notes completeness note |
| `src/components/reporting/SpreadWaterfallView.tsx:51` | spread waterfall |
| `src/components/common/RecordDetailsDrawer.tsx:42` | "this is a partial loaded list" |
| `src/components/common/PartyLinkPanel.tsx:33` | linked-party panel |
| `src/components/inventory/StockHistoryDialog.tsx:61` | stock trail completeness (a `cut(k)` call that read the map by store key) |
| `src/hooks/useServerProfitability.ts:30` | **whether to ask the server at all** — the browser answered from a cut chart |
| `src/hooks/useServerCustomerLifetimeValue.ts:31` | same |
| `src/hooks/useServerSpreadWaterfall.ts:29` | same |

## The fix

One place, `src/lib/ledgerCollections.ts`:

```ts
export function isCollectionCapped(truncated: Record<string, boolean> | undefined, key: LedgerKey): boolean {
  return Boolean(truncated?.[LEDGER_COLLECTIONS[key].collection]);
}
export function anyCollectionCapped(truncated: Record<string, boolean> | undefined, keys: readonly LedgerKey[]): boolean {
  return keys.some(key => isCollectionCapped(truncated, key));
}
```

Screens ask through those, so the key space is converted in one tested place instead of 22. The
duplicate `truncated.chartAccounts` workarounds were folded in. Nothing else changed: the same
conditions, the same wording, the same figures — only the flag now fires.

## Evidence

New test `src/tests/truncation-key-space.test.ts` (3 tests):

1. the helper reads `chartAccounts`, not `accounts`; `accounts` is the **only** store key whose
   collection name differs (asserted against `LEDGER_COLLECTIONS`, so a future rename is caught);
2. a source scan of every `.ts`/`.tsx` under `src/components` and `src/hooks` finds no file that
   indexes the truncation map with a store key — **this scan caught a fifteenth site during the
   work** (`StockHistoryDialog.tsx`), which is why it is a test and not a review habit;
3. the live subscriber still records truncation under `spec.collection`.

```
npx tsx --test src/tests/truncation-key-space.test.ts src/tests/truncation-guard.test.ts src/tests/report-provenance.test.ts
# pass 13  fail 0
```

Affected screens' suites (Israel VAT view, dashboard widgets, accountant pack, everyday reports,
data status bar, L-123 step 4b/4c/4d, customer lifetime value, gross margin by group):

```
# tests 53  pass 53  fail 0
```

Full suite: **4,651 pass, 5 skipped, 1 fail** — `report-speed-12m` A-229, "Loading all 10 screen
modules took 1502–1588 ms (budget 1500 ms)". Verified not from this change: unmodified `main` fails
the same assertion (1,511 ms and 1,555 ms in 4 runs), `CI` runs that budget at `1500 * 3`, and a
dependency walk of the ten preloaded screens (421 modules) contains **none** of the files changed
here. This is the standing sandbox timing flake recorded in earlier checkpoints.

`npx tsc --noEmit` exit 0 · `npm run lint:eslint` 0 errors, 42 warnings (unchanged cap).

## Remaining related work (not fixed here)

- **`src/lib/dataChecks.ts:523`** — `control-balance` tests `k === 'accounts'`, so a cut chart never
  produces its "Not checked: the data read is incomplete" note. `ledgerCollections.ts` forbids a
  runtime import of `LEDGER_COLLECTIONS` from `src/lib/dataChecks.ts` (the `AGENTS.md` purity rule),
  so this needs a deliberate decision: pass collection names into `CheckContext.truncated` at the
  caller (`DataHealthView`) or map in `dataChecks` by an explicit constant. Left for review.
- **`src/components/reporting/AssetRegisterReportView.tsx:20`** — lists `'accounts'` but checks only
  `failed[key]`, never `truncated`; the server report is the source, so this is cosmetic, but it is
  inconsistent with its own CSV-disable gate.
- **`DataQualityReportView` / `TruncatedInputs`** — `truncatedInputs()` returns collection names, so
  `DataHealthView` shows "chartAccounts" where a reader expects "accounts" (wording only).
