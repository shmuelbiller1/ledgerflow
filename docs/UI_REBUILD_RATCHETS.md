# The screen-rebuild ratchets

Prompt 2 asks for five counters that may only go down, so the interface cannot drift back to the way it
was built. They live in `quality-baseline.json` and are computed by `scripts/quality-metrics.ts`; the
guard is `src/tests/quality-ratchet.test.ts`, and `src/tests/interface-ratchets.test.ts` proves each
counter goes up when the old pattern comes back (on a throwaway tree, never on the repository).

`npm run ratchet:update` lowers a number. Nothing here may be raised without an owner decision in
`docs/FOR_YOU.md`.

| Counter | Today | The rule |
|---|---|---|
| `unreachableActions` | **0** | Every registered screen, report and settings tab can be found by typing a word into the search box. Zero is the only acceptable value. Proven in `src/tests/palette-reachability-guard.test.ts`, which searches the real registry, in English and Hebrew. |
| `screensWithManyPrimaryButtons` | **19** | EASE_OF_USE U-2: one filled button per screen. |
| `handTypedApiCalls` | **78** | A screen calls the server through one place, not by typing `/api/…` into a `fetch`. |
| `rawTables` | **184** | A screen uses the shared list instead of drawing its own `<table>`. |
| `directDbWrites` | **93** | A screen, hook or store asks the server; it does not write the books straight from the browser. |

## The sites that remain, and why each is still there

These are the honest reasons, not a promise that they are good. Each PR in the rebuild lowers the
number it can; the rest are listed so the next person starts from the truth.

### `screensWithManyPrimaryButtons` — 19 files

- `ledger/BankFeedImport.tsx` (4), `onboarding/SetupWizard.tsx` (3), `ledger/ReconciliationWizard.tsx` (3):
  a step-by-step flow where each step has its own filled button. One is on screen at a time, so the
  person never sees two; the counter reads the file, not the screen.
- `intelligence/IntelligenceCenter.tsx` (3), `platform/settings/{Billing,Dimensions,Team}Settings.tsx` (3 each),
  `ledger/Ledger.tsx`, `finance/CreditNotesView.tsx`, `common/DimensionValueActions.tsx`: several filled
  buttons in different panels or dialogs of one screen. Each needs reading before one is demoted, and
  demoting the wrong one moves the person's eye off the thing they came to do.
- `auth/AcceptInviteView.tsx`, `common/ViewErrorBoundary.tsx`: two states of one screen (signed in / not).

### `handTypedApiCalls` — 78

`src/lib/runCommand.ts` is now the one place a screen's request goes: it adds the token, sends the
method and body, and raises a `ServerCommandError` that carries the server's own words plus a message a
person can act on (a dead session reads differently from a refused action). The assets group moved
first — `FixedAssetsView`, `ConstructionActions`, `DisposeAssetDialog`, `TransferAssetDialog` now hold
no hand-typed call at all. Each screen that moves loses its own copy of the token header, its own
`res.ok` check and its own guess at the error message.

The counter also stopped counting two things that were never calls: the API documentation's code
samples (`ApiHubCoreDocs`, `ApiHubAnalysisDocs` hold `fetch("/api/…")` inside `<pre>` template strings
that the *reader* copies into their own program) and `runCommand.ts` itself. Counting them made this
ratchet reward deleting the docs. That is 16 of the 170 — so the real starting point was 154, not 170.

### `rawTables` — 184

The codemod moves the most-used screens first: Sales, Purchases and Inventory are on the shared list
(the first slice); Transactions, Bank review, Customers and Vendors are next.

The report screens were the long tail, and the reason was measured before writing the codemod: of the
196 files drawing a table, 91 name each row with `<th scope="row">` and 18 sum their last line in a
`<tfoot>`. The shared list had a footer for a *status* line, not a *totals* row, and it drew every cell
as `<td>` — so a report screen had nowhere to go, and `table-a11y-guard` would have rejected the result.
`TanStackDataGrid` now takes `rowHeaderColumn` (the named column is drawn as a row header, and is never
hidden by the column chooser) and `totals` (a real `<tfoot>` row whose total lines up under the column it
totals, clamped so it can never widen the table). `BankClearanceReportView` was the first report moved onto it, then
`TagBreakdownReportView`, `IncomeBySourceReportView` and `AverageMonthlyReportView` — the four shapes a
report row takes are now covered (a name cell, a share bar, a month, and grouped amounts), so the rest
of the tail is the same edit. Each PR lowers this number, and `shared-list-ratchet.test.ts` locks every
moved file so one screen cannot drift back while another moves forward.

### `directDbWrites` — 93

The first version of this counter read 15 because its pattern expected a leading dot, which the modular
Firestore API never writes; it now matches the bare call and counts each one once (Gitar caught it).
Each site is a write the app has no server route for yet. They are listed in the ledger-door work
(`docs/BUG_PATTERNS.md`, the `unchecked-write` pattern), which is where the route gets built; moving
them before the route exists would only move the problem.
