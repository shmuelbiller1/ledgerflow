# AI #7 — findings register (independent audit, issue #150)

Review only. No application, schema, migration or test-suite code was changed by this audit.

- **Pin:** upstream `shmuelbiller1/ledgerflow` `main` `2708f47cb40711e57032bf6d3d4acc9f10f1061d` (PR #647 and PR #655 merged, 11 Nov 2026 19:33 UTC).
- **How each result was produced:** the real routers and services run in-process against a disposable local PostgreSQL 17.11 that holds `main`'s 54 migrations; browser-session writes are SQL run as the `authenticated` database role with the user's claims. Node 24.22.2. Nothing was mocked.
- **Where:** probes in `probes/`, what each printed in `evidence/main-2708f47c/` (the files directly under `evidence/` are the same probes at the earlier pin `2ac666b`). One command runs all of them: `LF_TEST_DATABASE_URL=… bash audit/agent7-2026-11-11/probes/run-all.sh`.
- **Severity:** the scale of `docs/INDEPENDENT_AUDIT_AGENT.md` — P0 stop invitation, P1 before real bookkeeping, P2 usable with clear limits, P3 later.
- **Duplicate search:** before each issue was filed, the open and closed upstream issues and the lead's audit (`audit/claude-2026-11-11/README.md`, C-1…C-3, M-1…M-9) were searched; A7-05 turned out to be the lead's C-1 and was not filed.

## Summary

| ID | Issue | Severity | Finding | At `2708f47c` |
|---|---|---|---|---|
| A7-04 | [#652](https://github.com/shmuelbiller1/ledgerflow/issues/652) | **P1** | A bookkeeper voids, rewrites or reverses the ledger entry of an invoice or a payment; the document is not told | Open, unchanged |
| A7-06 | [#646](https://github.com/shmuelbiller1/ledgerflow/issues/646) | **P1** | A credit note that was never issued is applied to an invoice and refunded from the bank | Partly closed; the core is open |
| A7-02 / A7-08 | [#654](https://github.com/shmuelbiller1/ledgerflow/issues/654) | P2 | Entries at a foreign rate: refused, valued one for one, or posted 0.01 out of balance, depending on the door | Changed, not closed |
| A7-03 | [#653](https://github.com/shmuelbiller1/ledgerflow/issues/653) | P2 | A foreign invoice paid in instalments leaves −0.01 in Accounts Receivable for good | Open, unchanged |
| A7-07 | [#656](https://github.com/shmuelbiller1/ledgerflow/issues/656) | P2 | `POST /workspaces/:id/seed` writes demo entries into a hard-closed month of real books | Open; two details fixed |
| A7-01 | [#657](https://github.com/shmuelbiller1/ledgerflow/issues/657) | P2 (tooling) | The ledger-door ratchet counts 0 direct writes; there are 14 | Open |
| A7-09 | [#661](https://github.com/shmuelbiller1/ledgerflow/issues/661) | P2 (test gap) | No test compares the figures of a filed tax return with anything | Open; not executed |
| A7-11 | [#661](https://github.com/shmuelbiller1/ledgerflow/issues/661) | P3 (operations) | The ESLint warning-ratchet workflow fails on `main` | Open |
| A7-12 | this report | P3 (tooling) | The Code Atlas describes the tree of 16 October | Open |
| A7-05 | lead's C-1 | — | A browser session writes the ledger tables | **Closed** by PR #647 (verified) |

Status of every issue after the merge is also in [#661](https://github.com/shmuelbiller1/ledgerflow/issues/661); the review of PR #647 and PR #640 is in [#650](https://github.com/shmuelbiller1/ledgerflow/issues/650).

---

## A7-04 — entries of invoices and payments can be changed behind the document · P1 · #652

**What happens.** Invoice INV-9 for 500.00, paid in full: Bank +500.00, Accounts Receivable 0.00, Sales −500.00. Then, as a bookkeeper:

| Request | Answer | Ledger | Documents |
|---|---|---|---|
| `PUT /api/v1/transactions/<payment's entry>` `{ partialUpdate: { status: "void" } }` | 200 | A/R 500.00, Bank 0.00 | invoice `paid`, payment `posted` |
| `PUT /api/v1/transactions/<invoice's entry>`, lines rewritten to 100.00 | 200 | Sales 100.00 | invoice still 500.00 |
| `POST /api/v1/transactions/<invoice's entry>/reverse` | 200 | nothing left | invoice still issued and `paid` |

The audit rows for the first two say only "Full update on transaction ref [id]" — no before, no after — and are written after the database transaction commits (`crudRoutes.ts`, partial update at `:307`, full update at `:370`).

**Expected.** Each refused (409) with a pointer to the document, as `revaluationEntryLock` already does for stock-revaluation entries.

**Reachable by clicking (read in source, not run in a browser).** The rule exists only in the browser, and only for the inline cells of a ledger row (`TransactionRow.tsx:135`, `:146`). The "Edit Transaction Details" button on the same row (`:422`) opens `TransactionEditModal` for any entry in an open period; its save (`TransactionEditModal.tsx:156-249`) checks the period, the description, the accounts and that the lines sum to zero, then sends the second request above.

**Controls that hold.** `DELETE` of a posted entry is 403 for every role. Edits must balance and stay out of closed months. Data Health reports the void as *high* "Payment … has no entry in the ledger"; the month-end posting check reports the rewrite as an amount difference and the reversal as missing, and "Repost" repairs them.

**Direction (AI #1).** One server-side predicate equal to the client's `isDocumentEntry`, checked in `PUT /transactions/:id` (both branches) and `POST /transactions/:id/reverse`; before and after values in the audit row, inside the same transaction.

**Acceptance test.** `probes/a7-04-system-entries-editable.test.ts` with the three expectations turned round (409, balances unchanged).

---

## A7-06 — a credit that was never issued is applied and refunded · P1 · #646

**What happens.** A bookkeeper's browser session (the app's own database connection, not the server) inserts a row into `creditNotes`: open, 9,000.00, no ledger entry. The server then trusts it:

- `POST /api/v1/payments/credits/apply` → 200: the invoice becomes paid; Accounts Receivable in the ledger still shows 500.00; the ageing report shows 0.00.
- `POST /api/v1/payments/credits/refund` → 200: the bank is credited 300.00 against a credit note that was never issued.

Data Health afterwards: *medium* "Accounts receivable is $800.00, the open invoices add up to $0.00".

**Nine browser writes, tested one by one** (`probes/a7-06-residual-browser-writes.sql`):

| # | Write | `2ac666b` | `2708f47c` |
|---|---|---|---|
| 1 | insert an open credit note of 9,000.00 | accepted | **accepted** |
| 2 | raise what is left on a credit note from 40.00 to 4,000.00 | accepted | refused |
| 3 | insert an open vendor credit of 7,000.00 | accepted | **accepted** |
| 4 | lower the total of an issued invoice from 500.00 to 5.00 | accepted | **accepted** |
| 5 | set an issued invoice to void (its entry stays) | accepted | **accepted** |
| 6 | insert an issued invoice of 12,345.00 with no entry | accepted | **accepted** |
| 7 | raise the total of an approved bill from 300.00 to 3,000.00 | accepted | **accepted** |
| 8 | set `settledByRecordsCents` on an invoice | accepted | refused |
| 9 | set `depositAppliedCents` on an invoice | accepted | refused |

**Expected.** The server applies or refunds only a credit that has its own posted ledger entry; the database refuses a browser insert of an issued or open money document and a change to the total or status of an issued one.

**Scope.** Needs a signed-in writer of that workspace sending a request the screens do not send. It is that member's own books that become wrong; other workspaces are not reachable this way (viewer and outsider inserts are refused in the same probe).

**Direction (AI #1).** In `creditService`, require the credit's posted entry before applying or refunding. In the database, extend the settlement guard to inserts and to `amountCents` / `status` of issued documents, or move issue and void behind server routes as was done for payments.

**Acceptance test.** `probes/a7-06-forged-credit.test.ts` (expect 409 twice, bank unchanged) and rows 1, 3–7 of the SQL probe refused.

---

## A7-02 / A7-08 — entries at a foreign rate · P2 · #654

Five shared pieces disagree about an entry that carries an exchange rate: the line schema gives every line rate 1 (`src/schemas.ts:16`); `lineAmount` uses a line's own rate first, else the entry's; the validator writes `totalAmountCents` in the books' currency (`TransactionValidator.ts:58-64`); `checkLedgerEntry` compares that total with the debit lines in the entry's own currency (`ledgerDoor.ts:40-44`); `buildReversalLines` negates `amountCents` and copies `baseAmountCents` as it was.

Books in ILS, a USD journal at 3.7 (24.70 / 12.35 / 12.35; by hand 91.39 ILS):

| Case | `2ac666b` | `2708f47c` |
|---|---|---|
| Rate on every line — `POST /transactions` | created; "Reverse & Correct" refused (400) | **refused when created**: `400 The entry total (9139) does not match its lines (2470)` |
| Currency and rate on the entry only | 200, counted as 24.70 ILS | unchanged |
| Recurring job, template in EUR at 1.5, lines 3.33 + 3.33 / 6.66 (USD books) | posts 10.00 debit against 9.99 credit | unchanged: trial balance 3000 / 2999, `isBalanced: false`; Data Health reports nothing |

The recurring job writes its entry itself (`recurringService.ts:261`), outside the validator. The database trigger added by PR #647 (`lf_transactions_ledger_integrity`) adds the lines up in the entry's own currency, so it lets the entry in. Data Health's "Entries whose debits and credits differ" accepts an entry that balances in either currency (`src/lib/dataChecks.ts:105-112`).

**Scope.** No screen produces these entries. The journal screen converts every line to the books' currency in the browser and posts a home-currency entry; that payload is accepted, valued as worked by hand and reversed exactly at both pins (control probe A7-02d). The Recurring screen never gives a template a rate, but a bookkeeper's browser session can save one (accepted by the database rules). So: API callers, imports, restores, and a hand-made recurring schedule.

**Direction (AI #1 / AI #9).** Decide once what `totalAmountCents` and a rate on the entry mean, and make the five pieces agree. Refuse an entry whose own rate is not 1 while its lines carry none, or apply the rate. Post the recurring entry through the validator. Make the trigger and the Data Health check require the home-currency sum to be zero.

**Acceptance tests.** `probes/a7-02b-fx-reversal-route.test.ts`, `probes/a7-08-recurring-entry.test.ts`; `probes/a7-02-fx-reversal-residue.ts` shows why a reversal must negate the stored home amounts (re-converting leaves up to 2 cents per account).

---

## A7-03 — a foreign invoice paid in instalments leaves a cent · P2 · #653

Books in USD. Invoice 100.00 EUR at 1.0842 → 108.42 into Accounts Receivable. Paid 33.33 + 33.33 + 33.34 at the same rate → 36.14 + 36.14 + 36.15 = 108.43. Afterwards the invoice is paid, the ageing report shows 0.00, the bank holds 108.43 and **Accounts Receivable holds −0.01, permanently**. Data Health: *medium* "Accounts receivable is -$0.01, the open invoices add up to $0.00"; no screen offers to clear it.

**Cause.** `paymentService.ts:389` converts each payment on its own; nothing compares with what the document still carries in the books' currency.

**Expected.** Accounts Receivable ends at 0.00 — either the closing payment takes what is left of the document in the books' currency, or the entry carries a rounding line. A product choice for the lead.

**Scope.** Multi-currency books; every foreign invoice or bill settled in more than one part can leave a cent in either direction.

**Acceptance test.** `probes/a7-03-fx-installments.test.ts` with the expected value 0.

---

## A7-07 — the demo-data route writes into a closed month · P2 · #656

September is hard-closed through the app's own route. Fourteen writers are then sent a September date as a bookkeeper: **twelve are refused by the period lock** (each answer names the closed period), one by the never-delete rule, and `POST /api/v1/workspaces/:id/seed` answers **200**. It writes two entries dated 2026-09-01 and 2026-09-05 with no validator (`workspaceRoutes.ts:724`), leaves the demo invoice and bill without entries (Data Health: "Accounts receivable is $200.00, the open invoices add up to $5,200.00"), does not mark the books as demo so `POST /transactions/reset` answers 409, and a second call adds a second INV-DEMO-001.

No screen calls the route and no test covers it. PR #647 made the demo accounts' ids match and added one audit row; the rest is unchanged.

**Expected.** Refused on books that hold real data or a closed period — or the route removed.

**Acceptance test.** `probes/a7-07-closed-period-sweep.test.ts` (the seed row refused; the other thirteen stay refused).

---

## A7-01 — the ledger-door ratchet does not see the writes · P2, tooling · #657

`ledger-door-baseline.json` is 0 and the gate test passes. The scanner (`scripts/bug-patterns.ts`) recognises a write only when the call text itself contains `collection('transactions')`; the server code first assigns the reference and then writes through it. Following that one assignment with the TypeScript binder finds **14 direct writes in 11 files** (18 in 14 before PR #647):

| Kind | Count | Where |
|---|---|---|
| Written as the validator returned it | 4 | `crudRoutes.ts:370`; `reconcileRoutes.ts:169`, `:191`; `ledgerBulkCommit.ts:379` |
| Mark-only (void, reversed-by) | 6 | `reverseRoutes.ts:219`; `assetDisposalService.ts:173`, `:188`; `assetTransferService.ts:126`; `fxRevaluationService.ts:353`; `placeInServiceService.ts:115` |
| Generic partial update | 1 | `crudRoutes.ts:307` (see A7-04) |
| **No shared check** | **3** | `workspaceRoutes.ts:724` (A7-07), `recurringService.ts:261` (A7-08), `paymentService.ts:493` (balances by construction; read and exercised by the payment probes) |

File level: 31 files under `src/server` write ledger entries; `workspaceRoutes.ts` is the only one that mentions no closed-period check.

**Why an issue and not a patch.** A scanner that follows the assignment reports 14, so the baseline would have to be raised, and raising a baseline is not an agent's decision (`docs/COORDINATION.md` rule 4). The order is the lead's: move the three unchecked writers through `ledgerWrite`, then tighten the scanner at the true count. The detection code (about 60 lines) is in `probes/a7-01-ledger-door-dataflow.ts`.

---

## A7-09 — no test pins the figures of a filed tax return · P2, test gap · #661

PR #647 removed `assert.deepEqual(filed.body.return.boxes, r.boxes)` from `src/tests/w8-gold.test.tsx`; the replacement checks only `kind` and `jurisdiction`. At `2708f47c` no test compares the figures of a filed (kept) return with anything. `fileTaxReturn` builds a state permit's kept copy from `usSalesTaxReturn(… order: [worldId] …)` (`taxReturnService.ts:103-112`); nothing pins that this equals what the US quarter screen shows for that permit.

**Status: inferred, not executed.** This is a missing test on new tax code, not a demonstrated wrong figure. Tax belongs to AI #9.

---

## A7-11 — the ESLint warning-ratchet workflow fails on `main` · P3, operations · #661

Runs 43089086556 and 43089753807 on `2708f47c` failed at "Propose change in a reviewable PR". ESLint itself passes: 0 errors, 2 warnings against a ceiling of 12 (run locally). The workflow succeeded on earlier commits, when there was nothing to lower. Job logs cannot be read from this sandbox; the usual cause is the repository setting that lets Actions open pull requests. Owner action.

---

## A7-12 — the Code Atlas describes the tree of 16 October · P3, tooling · reported here only

`node scripts/code-atlas.mjs stats` at `2708f47c`: source revision `74b8318bfba0983ecba05bfbe4c41494ff57a36e` (16 Oct 2026), 2,141 files, 126 annotated, 54 manually inspected. `validate` passes against that revision. `changes --check` exits 1: 2,590 source changes since (1,603 added, 909 modified, 66 renamed, 12 deleted) and all 18 workflow traces flagged for review. `main` has 3,641 tracked files. `docs/INDEPENDENT_AUDIT_AGENT.md` tells the auditor to build the capability map from these traces; they predate 19 of the 54 migrations. The atlas workflow last ran in CI on 16 October.

---

## Closed and verified

- **A7-05 / lead's C-1.** At `2708f47c` all six browser writes to the ledger tables are refused: inserting, rewriting, deleting or un-posting an entry (`permission denied for table transactions`), inserting a payment, setting an invoice to paid. Viewer and outsider controls refused too. `evidence/main-2708f47c/a7-05-browser-writes-ledger.txt`.
- **Other agents' findings, re-run with their own probes** (`evidence/reverify-prior-findings.txt`): #161, #517, #518, #519, #628 fixed at `2ac666b`. On the merged PR #647 code Agent #6's F-01, F-08 and S7 no longer reproduce and audit-row coverage of money-writing handlers went from 30.3% to 69.7% by the probe's own count; the probes for F-09b and F-10 match source text that has changed and are not conclusive. "No longer reproduced" is what the probes print — the fixes were not reviewed.

## Checked and found in order (no finding)

- Twelve of fourteen writers refuse a date in a hard-closed month, each naming the period; a thirteenth is refused by the never-delete rule (A7-07 probe).
- A plain invoice, its payment, and the trial balance, balance sheet, profit and loss and A/R ageing routes agree with figures worked by hand (`probes/a7-10-smoke.test.ts`).
- The journal screen's foreign-currency payload posts, is valued as worked by hand and reverses exactly (`probes/a7-02d-fx-journal-screen-shape.test.ts`), before and after PR #647.
- A reversal of a document entry at rate 1 is exact (A7-04 probe).
