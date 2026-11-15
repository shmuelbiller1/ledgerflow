# Screen rebuild — the running checklist

The task: **every action and report the server offers can be reached, and a new person still sees only
a few things.** Do not add features. Connect and simplify what exists.

State is measured from `quality-baseline.json` and the guard tests, not from prose. A box is only
ticked when the ratchet number moved or the named test exists and passes.

## Where we are (measured 2026-11-15, after #722 and #724)

| counter | now | target | meaning |
|---|---|---|---|
| `rawTables` | **184** | 0 | screen files drawing their own `<table>` instead of the shared list |
| `handTypedApiCalls` | **84** | 0 | `fetch('/api/…')` typed by hand in `src/components` |
| `directDbWrites` | **93** | 0 | direct database writes in `src/components`, `src/hooks`, `src/stores` |
| `unreachableActions` | **0** | 0 ✅ | commands/reports no palette search can find |
| `screensWithManyPrimaryButtons` | **0** | 0 ✅ | screens with more than one filled button |

## 1. One list — the shared grid is the only list

- [x] The grid has sort, search, column chooser, export, saved views, row keyboard movement, tick
      boxes with a total of the selected rows, cards at 390px, and the one-sentence empty state that
      hides the tools.
- [x] Report screens can move onto it: `rowHeaderColumn` (`<th scope="row">`) and `totals`
      (`<tfoot>`, one cell per drawn column so the chooser hides it in step).
- [x] `npm run scaffold:report` emits the shared list, not a hand-drawn table.
- [x] `Sales.tsx` (customers), `Purchases.tsx` (vendors), `Inventory.tsx` (items) on it.
- [x] `BankClearanceReportView` on it — the first report, proving the path (195→192 across four).
- [x] **Transactions**: decided it stays. It draws no `<table>` at all — it is a CSS grid with twelve
      editable cells per row, a split editor and paste handling. Moving it would delete in-place
      editing, so it is out of this ratchet and the reason is in `docs/FOR_YOU.md`.
- [ ] **Bank review** on it (`ReconciliationView`, `BankFeedImport`, `InboxView`).
- [x] `TagBreakdownReportView`, `IncomeBySourceReportView`, `AverageMonthlyReportView` (192).
- [x] `TopExpensesIncomeReportView`, `ExpenseByCategoryReportView` (190).
- [ ] Report tail, the rest of the 195, each PR lowering `rawTables`.
- [ ] The 39 files with more than one table, and the 12 with columns built by `.map()`.
- [ ] Non-report screens: finance (10), platform (15), hr (4), dashboard (2).

## 2. One record page

- [ ] A shared single-record layout: fields editable in place, path at the top
      (Draft → Sent → Paid with the next-step button), related records, files, history.
- [ ] Invoices on it first.

## 3. One way to act — `useCommand(name)`

- [x] The generated client exists (`sdk/ledgerflowClient.ts`).
- [x] `runCommand` is the one send: one place reads the answer, so a 200 with no body is not a cut
      connection, and a 2xx whose answer could not be read is marked `accepted` so a committed write is
      never reported as failed and submitted twice.
- [x] `useCommand(name)` over the generated manifest (`src/hooks/useCommand.ts`): the address is never
      typed, the refusal sentence and the next step come from the command's own `description.refusals`,
      a second press while one is in flight sends nothing, and a request that never reached the server
      says so. 5 tests in `src/tests/use-command.test.tsx`.
- [x] First screen on it: `PartyLinkPanel` shows the manifest's own next step ("unlink the other
      customer first") when the vendor is already linked.
- [ ] Undo on the result, and the offered next action in the toast ("Invoice saved. Send it · Record a
      payment · New invoice"). `deleteWithUndo` exists for records holding no postings; wiring it into
      `useCommand`'s result is the remaining piece.
- [ ] Replace hand-typed `fetch('/api/…')` (84) and direct database writes (93), screen by screen.

## 4. Forms from the schema

- [x] `SchemaForm.tsx` renders a zod object: labels, errors under the field.
- [ ] Drive it from the **command input schema**, required fields first, the rest under
      "More options", labels from the dictionary.
- [ ] Hand-built forms stay for invoices, bills and journal entries, on the same field components.

## 5. One box that can do anything — the palette

- [x] Lists every command and every registered report; searches plain words in English and Hebrew.
- [x] Reachability test that types each name in both languages and can fail (proved by breaking it).
- [ ] Filter the list by **role**, so it offers what the person may actually run.
- [ ] A switched-off module appears as "Payroll — turn on", not as nothing.

## 6. Short by default

- [x] Menu is Overview, To review, Sales, Purchases, Bank, Reports, Settings.
- [x] Each area opens on its most used list, one filled button.
- [x] Business type chooses the modules that start switched on.
- [ ] `screensWithManyPrimaryButtons` 19 → 0.

## 7. Assistant proposals

- [ ] "Waiting for you" list, one row per proposal with Accept / Edit / Reject, "Accept all" per group.
- [ ] A switch showing the books with it applied, using the server's overlay.
- [ ] High-risk rows accepted one at a time after a two-step confirmation; Undo after accepting.
- [ ] The screen says nothing in the list has changed the books yet.

## Done when

- [x] **`rawTables` names each remaining site that stays** — `raw-table-decisions.test.ts` holds the
      list and fails on a stale or false reason. The rest of the count is the migration queue.
- [x] `screensWithManyPrimaryButtons` and `unreachableActions` at **0**. `handTypedApiCalls` (84) and
      `directDbWrites` (93) are each down to the sites named in `docs/UI_REBUILD_RATCHETS.md`.
- [x] A first-time user, at 390px wide and by keyboard, can create a customer, send an invoice, record
      its payment and open the profit and loss — `e2e/first-hour-journey.spec.ts` proves each step with
      no `click()` and the real server behind it. Writing it exposed that the palette had no phone
      trigger at all (`hidden md:flex` search bar, ⌘K only); the header has one now, and a second test
      guards it.
- [x] Every command and report can be found by typing a plain word into the palette.

## Order of work

1. [x] The list component and the first three screens.
2. [ ] The record page, on invoices.
3. [ ] `useCommand` and the Sales screens.
4. [x] The palette and the reachability test.
5. [ ] Remaining screens by use, lowering a ratchet in every PR.
6. [ ] The proposals list.

## Rules for every PR in this list

- A branch and a pull request per step, CI green. Never skip or loosen a test to get green.
- No change to how money is calculated or posted. Screens call commands; they do not build postings.
- Every touched screen: light and dark, 1280 and 390, keyboard only, English and Hebrew from the
  dictionary, existing axe checks passing. Visual baselines refreshed and looked at.
- Words follow `docs/EASE_OF_USE.md` Part 4 (U-5). Owner decisions go in `docs/FOR_YOU.md` with the
  default used.
