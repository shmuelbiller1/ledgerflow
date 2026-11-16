# Screen rebuild — PR #725 checklist

The task is unchanged: **every action and report the server offers can be reached, and a new person
still sees only a few things.** Connect and simplify what exists. Do not add features.

#724 closed parts 3, 4 and 5 and landed the acceptance journey. This PR takes what is left, and for each
item names the **fastest honest route** — a codemod where the shape repeats, a hand edit where it does
not. Anything that cannot be done mechanically is marked ✋ and says why.

State is measured, never described: `quality-baseline.json` and the guard tests are the truth. A box is
ticked only when the number moved or the named test passes.

## Where we are

| counter | now | target | what it counts |
|---|---|---|---|
| `rawTables` | **184** | 0 | screens drawing their own `<table>` instead of the shared grid |
| `handTypedApiCalls` | **84** | 0 | `fetch('/api/…')` typed by hand |
| `directDbWrites` | **93** | 0 | the browser writing the books instead of asking the server |
| `screensWithManyPrimaryButtons` | **0** | 0 | ✅ done |
| `unreachableActions` | **0** | 0 | ✅ done |

## How this PR goes fast

| lever | what it does | expected |
|---|---|---|
| `scripts/codemod-run-command.ts` | inventories the one `fetch` + `if (!res.ok)` + `res.json()` shape: **98 calls, 82 mechanical, 16 need a person** (an AbortSignal, no headers object, a raw body) | the batch is chosen, not guessed |
| `scripts/codemod-table-to-grid.ts` | sorts every raw table into mechanical / by hand / stays with the reason | **139 / 31 / 73** |
| `npm run ratchet:update` | moves the baseline after each batch | seconds |
| one commit per **group**, not per file | the commit message carries the batch | ~6 commits, not 60 |

## 1. One list — the shared grid is the only list

- [x] **Split the 184 into buckets before touching any** — `scripts/codemod-table-to-grid.ts` (committed
      here, `npx tsx scripts/codemod-table-to-grid.ts --files`). Measured: **243 tables in 185 files →
      139 mechanical, 31 by hand, 73 stays.** That is the number the rest of part 1 is planned from, and
      it is the reason this PR does not finish part 1: converting 139 screens in one PR is how the PR
      becomes unreviewable.
- [ ] Convert the **short convertible files** first (`≤120` lines, 1 table).
- [ ] Convert the **2–3 table** files.
- [ ] The **4-table** files (`TaxLiabilityView`, `SerialLotLookupReportView`,
      `IsraelMonthJourneyReportView`, `GoodsNotBilledReportView`, `PurchaseOrdersView`).
- [ ] **Bank review** on the grid (`ReconciliationView`, `BankFeedImport`, `InboxView`).
- [ ] Non-report screens: finance, platform, hr, dashboard.
- [ ] Named reasons for whatever stays, in `raw-table-decisions.test.ts` — the ratchet fails on a stale
      or false reason, so "not worth it" has to be written down honestly.

## 2. One record page

The foundation exists and invoices are already on it — this part is **connecting**, not building.

- [ ] `InvoiceRecordPage` takes its next step from the **manifest** (`useCommand('invoice.update').next`)
      instead of a hard-coded `if (isDraft) … else …`. A next step a screen invents can drift from what
      the server will accept; one it reads cannot.
- [ ] A green/handled path that a `viewer` cannot see (the role gate from `paletteRoleFilter`).
- [ ] `CustomerRecordPage`, `BillRecordPage` on the same `RecordPage` shell — same three sections, so the
      second and third are mostly column definitions.

## 3. One way to act

- [ ] **`transactionActions` — nine hand-typed calls, one shape.** All nine do `fetch` → `if (!res.ok)` →
      `res.json()` → `throw new Error(...)`. `runCommand` already returns exactly what they need
      (`ServerCommandError.status` and `.body`) and throws with the server's own words.
      **Route: the codemod, then one commit.** This is the single best mechanical win in the PR.
- [ ] `services/`: 14 calls, several already small wrappers — convert the plain ones (`clearanceActions`,
      `receiptActions`, `depositActions`, `journalTemplateActions`), leave the download/blob ones.
- [ ] The remaining `components/` cluster for `/api/v1/transactions` (23 call sites — the largest group).
- [ ] **Undo on the result**: `deleteWithUndo` wired into `useCommand`'s result where the command's
      inverse exists.
- [ ] The offered next step in the toast ("Invoice saved. Send it · Record a payment · New invoice").

## 4. Forms from the schema

- [ ] `SchemaForm` (zod-driven) and `CommandForm` (schema-driven) are now **two** form systems. Fold the
      one caller of `SchemaForm` onto `CommandForm`, delete the other, keep the tests.
- [ ] The hand-built invoice/bill/journal forms move onto the shared `Field` + validation helpers, so
      there is one field component and one way an error appears under it.

## 5. One box that can do anything

- [x] Role filter — **in `useCommand` and the API hub**, where commands run (a palette entry is a
      navigation action, not a manifest command; the earlier palette-side gate matched nothing).
- [x] A switched-off module appears as "Payroll (off) — turn on in Settings → Modules".
- [x] A phone can open the palette at all (44px trigger; the search bar is `hidden md:flex`).

## 6. Short by default

- [x] `screensWithManyPrimaryButtons` **19 → 0**.
- [ ] Every screen keeps one filled button as new screens move onto the shared list — the ratchet in
      `interface-ratchets.test.ts` already fails on a second one, so this stays ticked on its own.

## 7. Assistant proposals

- [ ] ✋ The only part with no foundation. "Waiting for you" list, one row per proposal with
      Accept / Edit / Reject and "Accept all" per group; a switch showing the books with it applied using
      the server's overlay; high-risk rows accepted one at a time after a two-step confirmation; Undo
      after accepting; the screen says nothing in the list has changed the books yet.
      **This is a build, not a connect — it does not fit in this PR without making it enormous.**

## Done when

- [ ] Every counter at zero, or each remaining site named with a reason a reader accepts.
- [x] A first-time user at 390px, keyboard only: customer → invoice → payment → profit and loss, proven
      in `e2e/first-hour-journey.spec.ts` (green in CI on #724).
- [x] Any command or report findable by typing a plain word into the palette, English and Hebrew.

## Rules for every PR in this list

- CI green, every bot thread answered — not left open.
- A ratchet may go up only when the new number is the **true** one and the commit says why.
- Do not add a feature. Connect what exists.
- Nothing is "done" because the code exists: a test must fail without it.
