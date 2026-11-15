# Screen rebuild — the running checklist

This is the same checklist that sits at the top of the open PR, kept in the repo so it survives the PR
being merged (a PR description is read once; this file is read every time).

**The task:** every action and report the server offers can be reached, and a new person still sees
only a few things. Do not add features. Connect and simplify what exists.

**How to read it:** a box is ticked only when the ratchet number moved, or the named test exists and
passes. Every number comes from `quality-baseline.json` and the live counter, never from prose — the
previous version of this file drifted because it repeated a count nobody re-measured.

Source of truth for every number below is `quality-baseline.json` + the live counter (`computeQualityMetrics`), not prose. **A box is only ticked when the number moved or the named test exists and passes.**

Last measured on this branch: `rawTables` **184** · `handTypedApiCalls` **92** · `directDbWrites` **93** · `unreachableActions` **0** · `screensWithManyPrimaryButtons` **0**.

---

## The five ratchets

| counter | start | now | target | state |
|---|---|---|---|---|
| `rawTables` | 195 | **184** | 0 | 🟡 11 moved |
| `handTypedApiCalls` | 170 | **92** | 0 | 🟡 started (real start was 154; 16 were docs) |
| `directDbWrites` | 93 | **93** | 0 | 🔴 not started |
| `unreachableActions` | 0 | **0** | 0 | ✅ **met** |
| `screensWithManyPrimaryButtons` | 19 | **0** | 0 | ✅ **met** |

---

## Part 1 — One list

- [x] Grid: sort, search, column chooser, export, saved views, row keyboard movement, tick boxes with a selected total, cards at 390px, one-sentence empty state that hides the tools
- [x] Report screens can move onto it — `rowHeaderColumn` (`<th scope="row">`, locked in the chooser) and `totals` (`<tfoot>`, one cell per drawn column, no colspans, prints all rows, shows on phones)
- [x] `npm run scaffold:report` emits the shared grid
- [x] Per-screen lock so a moved screen cannot drift back (`shared-list-ratchet.test.ts`)
- [x] **Sales** (customers) · **Purchases** (vendors) · **Inventory** (items) — were already on it
- [x] **Bank review** — bank clearance report
- [x] `BankClearanceReportView` · `TagBreakdown` · `IncomeBySource` · `AverageMonthly` · `TopExpensesIncome` · `ExpenseByCategory` · `AgedInventoryByLot` · `ClosingBalanceCheck` · `ApiHubLogs` · `AccessReviewPanel` · `AccountantQueueView` · `SystemUsersPanel`
- [x] **Transactions — decided, not moved:** it draws no `<table>` at all. It's a CSS grid with 12 editable cells per row, a split editor and paste handling. Moving it would delete in-place editing. Reason recorded in `docs/FOR_YOU.md` + named in `raw-table-decisions.test.ts`
- [ ] Report tail: **~170 files left**, mostly the same edit (the four row shapes are all proven)
- [ ] The 39 multi-table files and 12 `.map()`-column files
- [ ] Non-report: platform, finance, hr, dashboard
- [x] **"zero or named with a reason"** — `raw-table-decisions.test.ts` holds the named list and fails on a stale reason. Verified by pointing it at a migrated file

## Part 2 — One record page

- [ ] Shared single-record layout: editable fields, path at top (Draft → Sent → Paid + next-step button), related records, files, history
- [ ] Invoices on it first

**Not started.** Nothing exists beyond `RecordInlineField.tsx`.

## Part 3 — One way to act

- [x] `src/lib/runCommand.ts` — one place the address, token, method, body and error handling come from; `ServerCommandError` carries the server's own words; `commandErrorMessage` separates a dead session (401) from a refused role (403); reads **both** `{ message }` and `{ error }` because the inventory routes use the latter
- [x] Assets group off hand-typed calls: `FixedAssetsView`, `ConstructionActions`, `DisposeAssetDialog`, `TransferAssetDialog`
- [x] `OrderDeliveryDialog` JSON calls
- [x] Settings group: `ModulesSettings`, `StagesSettings`, `BillingSettings`, `SecuritySettings`
- [x] `ConnectedBanks`, `TimeView`, `SupportView`, `AcceptInviteView`
- [ ] `useCommand(name)` on top: result with **Undo** where an inverse exists + offered next step ("Invoice saved. Send it · Record a payment · New invoice") — needs the command schemas
- [ ] The rest of the **92**, by area:

| area | calls | state |
|---|---|---|
| platform | 47 | started (6 moved) |
| reporting | 17 | — |
| ledger | 13 | — |
| sales | 13 | 1 file done |
| finance | 8 | — |
| collaboration · hr | 12 | — |
| banking · dashboard · common · layout | 18 | — |
| the rest (13 areas) | 19 | — |

- [ ] `directDbWrites` **93** — untouched

## Part 4 — Forms from the schema

- [x] `SchemaForm.tsx` renders a zod object with labels and errors under the field
- [ ] Drive it from the **command input schema**: required first, rest under "More options", labels from the dictionary
- [ ] Hand-built forms (invoices, bills, journal entries) on the same field components

## Part 5 — One box that can do anything

- [x] Palette lists every command and every registered report; searches plain words in English **and** Hebrew
- [x] Reachability test that types each name in both languages and can fail (proved by breaking Hebrew matching: 16 commands went unreachable)
- [ ] Filter by **role**
- [ ] A switched-off module appears as "Payroll — turn on", not nothing

## Part 6 — Short by default

- [x] Menu is Overview, To review, Sales, Purchases, Bank, Reports, Settings
- [x] Each area opens on its most used list, one filled button
- [x] Business type chooses the modules that start on
- [x] `screensWithManyPrimaryButtons` **19 → 0** — one filled button per screen (see the metric note below)

## Part 7 — Assistant proposals

- [ ] "Waiting for you" list with Accept / Edit / Reject + "Accept all" per group
- [ ] Preview switch using the server's overlay
- [ ] High-risk rows one at a time after two-step confirmation; Undo after accepting
- [ ] The screen says nothing there has changed the books yet

**Not started.**

---

## Done when

- [x] `rawTables` names each remaining site that **stays** (the rest is the migration queue)
- [ ] Every ratchet at zero or named
- [x] Every command and report findable by typing a plain word into the palette
- [ ] **A first-time user, 390px wide, keyboard-only: create a customer → send an invoice → record its payment → open the profit and loss, with a browser test proving each** — 🔴 not written

## Order of work (the task's own order)

1. [x] The list component and the first three screens
2. [ ] The record page, on invoices
3. [~] `useCommand` — `runCommand` done, `useCommand` not
4. [x] The palette and the reachability test
5. [~] Remaining screens by use, lowering a ratchet every PR
6. [ ] The proposals list

**Roughly 20% of the task.** Part 1 is the most advanced (the component is finished, ~11 of 195 screens moved). Parts 2 and 7 are untouched.

---

## This PR

`handTypedApiCalls` **170 → 154**, `rawTables` **186 → 184**.

### `runCommand` — why this before more tables

`handTypedApiCalls` and `directDbWrites` are the two ratchets that block nothing else and are blocked by nothing else. Each of the 154 sites currently types its own address, its own `Authorization` header, its own `res.ok` check and its own reading of the error body — and they disagree.

### Two ratchet corrections, both real

1. **16 of the 170 were not calls.** `ApiHubCoreDocs` / `ApiHubAnalysisDocs` hold `fetch("/api/…")` inside `<pre>` template strings that the *reader* copies into their own program. Counting them made the ratchet reward deleting the API docs. Now excluded, along with `runCommand` itself, and `interface-ratchets` pins it.
2. **`rawTables` was one ahead of the code** — `SystemUsersPanel` was already migrated in #723 but the number below it was not lowered. A stale-high baseline hides one real regression.

### Every review finding on this PR, fixed at the source

- **`runCommand` read only `message`** — but every inventory route answers `{ error }`. A delivery refused for stock says *"Only 3 left on that order"*; that sentence is the only thing telling the person what to change, and my helper turned it into "The server answered 409". `refusalMessage` now reads both, first non-empty wins.
- **`DisposeAssetDialog` formatted its own errors** — a 401 there showed raw text where the other three asset screens showed the session/role message. Now uses `commandErrorMessage`.
- **Writing the test caught a third bug in my own code:** `commandErrorMessage` returned the literal string `"undefined"`, the one thing its own doc comment says it must never do (`String(undefined)` is truthy).

### Tests

`run-command` (9), `interface-ratchets`, `quality-ratchet`, `raw-table-decisions`, `shared-list-ratchet`, plus every existing assets/sales screen test — **76 tests, 0 failures**. `tsc --noEmit` clean, `eslint --max-warnings 0` clean.

## Next, in order

1. Continue the 154 by area — **platform (53)** first, it's the largest and it's mostly settings screens
2. `screensWithManyPrimaryButtons` 19 → 0 (part 6's last box, cheap)
3. Part 2's record page on invoices
4. The 390px keyboard-only acceptance test — the only "done when" that needs a whole journey working end to end
