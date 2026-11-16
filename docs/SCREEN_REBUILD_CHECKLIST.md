# Screen rebuild — PR #730 checklist

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
| `handTypedApiCalls` | **5** (was 84) | 5, each named | `fetch('/api/…')` typed by hand |
| `directDbWrites` | **93** | 0 | the browser writing the books instead of asking the server |
| `screensWithManyPrimaryButtons` | **0** | 0 | ✅ done |
| `unreachableActions` | **0** | 0 | ✅ done |

## How this PR goes fast

| lever | what it does | expected |
|---|---|---|
| `scripts/codemod-run-command.ts` | `--report` inventories every hand-typed call and names the blocker — including **its own header**: any key other than `Content-Type`/`Authorization` (an idempotency key above all) is a decision for a person, pinned by `codemod-run-command-classification.test.ts`. `--write` applies only blocker-free calls and **reverts a file it cannot finish** | done the boring half, not guessed it |
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

- [x] **`transactionActions` — nine hand-typed calls, one shape.** Done; `integrityActions`, `ruleActions`,
      `entryActions` (6) and `importActions` send through `runCommand`. The 409 version conflict and the
      budget warnings survive because `ServerCommandError` carries `.status` and `.body`.
- [x] `services/` — `clearanceActions`, `receiptActions`, `depositActions`, `journalTemplateActions`,
      `clientQueryActions`, `documentNumbers`, `spreadActions`, `attachmentActions`, `workspacePriceLists`,
      `stockRequests`, `postingKit` (2). The download/blob ones stay, by name (below).
- [x] The `/api/v1/transactions` cluster across `components/` — entry, petty cash, bank-line, inbox, import,
      intercompany, QBO migration, forensic scan, vault injection.
- [x] The report views (six, by codemod), the settings screens (eleven), the customer-facing pages (three),
      the export snapshots (five), the plumber hooks (`useServer*`, `useLedgerData`, `useHandOvers`).
- [ ] **Undo on the result**: `deleteWithUndo` wired into `useCommand`'s result where the command's inverse
      exists. (Not started — it needs the command schemas, part 3's second half.)
- [ ] The offered next step in the toast ("Invoice saved. Send it · Record a payment · New invoice").

### What the sweep learned, in the order it learned it

These are the findings that decide how the rest of the list gets done. Each cost a failing test or a wrong
first attempt, so they are cheaper to read than to rediscover.

1. **`rawBody` exists for a reason.** `DrillDownModal` passed a JSON *string* as `body`; `runCommand` encoded it
   again and the endpoint received a quoted string. A caller that already holds the request text passes
   `rawBody`. The same applies to the payment modals: their idempotency key is a hash **of the serialized body**,
   so re-serializing an object can change the key and record a second payment.
2. **A refusal body is sometimes the feature.** The landed-cost 409 carries the *new plan* so the panel can show
   it; the credit-limit 409 carries `canOverride` so the screen can offer "post anyway"; a dead public invoice
   link carries a sentence written for the customer. `ServerCommandError.body` keeps all three, and each caller
   says which one it needs.
3. **"Not an exception" is not "success".** `handleToggleFlag` toasted the error and returned normally; the
   per-function ratchet in `bug-patterns.test.ts` flagged it as a *new* risk location. It returns `false` now.
4. **Ordering around the token is load-bearing.** `TaxProfilesSettings` re-checks the role *after* the token
   arrives; `PlaidConnectButton` aborts *after* it arrives. Both had tests. A conversion that lets `runCommand`
   fetch the token silently moves the check earlier.
5. **`token: null` is a security boundary, not a default.** The public invoice and portal pages must not send
   the signed-in person's credentials to a public route. `runCommand` attaches a token unless told not to.
6. **Two AbortSignal cases were not problems.** `runCommand` takes a `signal`; the codemod was over-reporting 6
   calls as "needs a person". Correcting the tool changed the plan from 14 hand edits to 8.
7. **The test fixture was signing in the wrong place.** `setComponentWorkspace` set the store user but not the
   auth singleton that `runCommand` reads, so ~271 tests exercised screens that sent no `Authorization` header.

### What stays hand-typed, by name — and why

Five calls. Each one is a case where `runCommand`'s contract does not fit the answer or the question the screen
is asking, so converting it would lose something:

| where | what the call does | why it cannot move |
|---|---|---|
| `documentDownloads.ts` (×2) | payslip, invoice and delivery-note **PDFs**, and the ZIP batch | the answer is bytes. `runCommand` reads JSON; a blob passed through it would have to be base64'd and decoded again to no benefit |
| `PayRunHistory.tsx` | one payslip PDF | same |
| `BrandingSettings.tsx` | `POST /branding/preview` | answers with a rendered image, not JSON |
| `OrderDeliveryDialog.tsx` | the delivery note | opens a blob URL in a new tab |
| `useApiHubModel.ts` sandbox | any endpoint, and it **reports the status code as a result** | "HTTP Status 503" is the point of a sandbox. `runCommand` turns a status into an exception, which is exactly the information this screen exists to show |

### A rule this sweep produced, now enforced by a test

**A committed write whose answer was cut off is not a failure.** Two bots found this in five places, all of them
mine: the hand-typed calls read a success body with `res.json().catch(() => ({}))`, so a 2xx whose body was cut
mid-flight counted as saved. `runCommand` throws `ServerCommandError(accepted: true)` there, and every caller I
had converted treated any throw as failure — telling the person "Failed to add transaction" over an entry that was
already recorded, and inviting the second click that records it twice.

It is now the library's job, not each caller's: `writeWasAccepted(error)` and `runWrite(request)` in
`runCommand.ts`, pinned by three tests in `run-command.test.ts`. **Every future conversion of a write should use
one of those two, not `runCommand` directly.**

### The measurement itself was wrong once

`scripts/codemod-run-command.ts` walked `components`, `hooks`, `services`, `stores` — so `src/lib`, `src/modules`
and `src/core` were invisible to every report it printed while `quality-metrics.ts` counted them. Seven calls sat
in that blind spot. If a number and the tool that is supposed to explain it disagree, the tool is the first thing
to check.
