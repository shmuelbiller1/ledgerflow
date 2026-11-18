# The screen-rebuild ratchets

Four counters may only go down, so the interface cannot drift back to the way it was built. They live
in `quality-baseline.json` and are computed by `scripts/quality-metrics.ts`; the guard is
`src/tests/quality-ratchet.test.ts`, and `src/tests/interface-ratchets.test.ts` proves each counter
rises when the old pattern comes back (on a throwaway tree, never on the repository).

**Search reachability is a separate behavioral gate**, not a numeric counter: the former
`unreachableActions` only counted four identifier strings in `pageIndex.ts` and was always zero even
when a report could not be found. `src/tests/palette-reachability-guard.test.tsx` tests actual registry
entries, English and Hebrew names and plain words, disabled modules, command dispatch and rendered
palette navigation. The import-graph reachability guard is separate and remains enabled.

`npm run ratchet:update` lowers a number. Nothing here may be raised without an owner decision in
`docs/FOR_YOU.md`.

| Counter | Today | The rule |
|---|---|---|
| `screensWithManyPrimaryButtons` | **0** | EASE_OF_USE U-2: one filled button per screen. |
| `handTypedApiCalls` | **5** | A screen calls the server through one place, not by typing `/api/…` into a `fetch`. |
| `rawTables` | **126** | A screen uses the shared list instead of drawing its own `<table>`. |
| `directDbWrites` | **0** | A screen, hook or store asks the server; it does not write the books straight from the browser. |

## The sites that remain, and why each is still there

These are the honest reasons, not a promise that they are good. Each PR in the rebuild lowers the
number it can; the rest are listed so the next person starts from the truth.

### `screensWithManyPrimaryButtons` — 0 files

- `ledger/BankFeedImport.tsx` (4), `onboarding/SetupWizard.tsx` (3), `ledger/ReconciliationWizard.tsx` (3):
  a step-by-step flow where each step has its own filled button. One is on screen at a time, so the
  person never sees two; the counter reads the file, not the screen.
- `intelligence/IntelligenceCenter.tsx` (3), `platform/settings/{Billing,Dimensions,Team}Settings.tsx` (3 each),
  `ledger/Ledger.tsx`, `finance/CreditNotesView.tsx`, `common/DimensionValueActions.tsx`: several filled
  buttons in different panels or dialogs of one screen. Each needs reading before one is demoted, and
  demoting the wrong one moves the person's eye off the thing they came to do.
- `auth/AcceptInviteView.tsx`, `common/ViewErrorBoundary.tsx`: two states of one screen (signed in / not).

### `handTypedApiCalls` — 5

The remaining named exceptions are tracked in `docs/SCREEN_REBUILD_CHECKLIST.md` §3. Browser writes
use registered server commands; the exceptions must not be hidden by loosening this ratchet.

### `rawTables` — 126

The codemod moved the common screens and many reports; the remaining refused shapes and their reasons
are tracked in `docs/SCREEN_REBUILD_CHECKLIST.md` §2.

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

### `directDbWrites` — 0

The first version of this counter read 15 because its pattern expected a leading dot, which the modular
Firestore API never writes; it now matches the bare call and counts each one once (Gitar caught it).

It reaches zero the way the ledger-doors work planned: each site moved once the route existed, never
before. The last three (`useEntityOperations`' generic create/update/delete) became `record.save` and
`record.delete` over an allow-list of ordinary records, and the inline edit and details drawer became
`record.fields`; the sample company keeps its own copy through `localStore`, which the counter counts
separately (`localStoreWrites`). A screen that writes a record by hand again fails the ratchet.
