# AI #7 — independent audit report, 11 November 2026

Issue #150 · format of `docs/INDEPENDENT_AUDIT_AGENT.md` · review only: **no application, schema, migration or test-suite code was changed.** Everything this audit added is in this folder.

**Pin:** upstream `shmuelbiller1/ledgerflow` `main` `2708f47cb40711e57032bf6d3d4acc9f10f1061d` (PR #647 and PR #655 merged, 11 Nov 2026 19:33 UTC). Earlier pins of the same session: `ec3ff49`, `39b0012`, `2ac666b`.

## Verdict

| Use | Verdict | Why |
|---|---|---|
| **Real bookkeeping pilot** (stage B of `docs/FIRST_TESTERS_GATE.md`) | **Not ready** | Three P1 findings are open on `main` (#662, #652, #646), all executed against the real routers and a real database. Gates G-03, G-09, G-11 and G-13 are blocked. The other fifteen are unverified: the gate file records no row as passed, and I could produce evidence for none of them. |
| **Invited testers on made-up books** (stage A) | **Not certified; one known blocker** | #662: one click on "Reverse transaction" in the ledger list takes an invoice's or payment's entry out of the books, and "Undo" reports a success that did not happen. Fix it or hide the button first. Gates G-01…G-08 need a browser and the deployed site; this sandbox has neither, so I can neither pass nor fail them. |

This audit is **one deep slice, not the whole product**: how an entry gets into the ledger, how it is changed afterwards, and who may do it. About 2% of the source files were read and 18 of roughly 309 routes were exercised (section 1). Nothing outside that slice is covered by this verdict.

Start with [`FINDINGS.md`](FINDINGS.md) for each finding; [`SCORECARD.md`](SCORECARD.md) for counts and the next batch.

---

## 1. Snapshot and coverage

**What `main` is at this pin**

| | Count |
|---|---|
| Tracked files | 3,641 |
| Source files under `src/`, tests excluded | 1,529 (237,635 lines) |
| of which `src/server/` | 246 (37,645 lines; 114 services, 80 route files) |
| Route registrations with a literal path (text count) | about 309, of which about 210 write |
| Migrations | 54 |
| Unit and database test files · browser specs | 1,000 · 114 |

**The repository's own gates, run unchanged on a clean checkout** (`evidence/main-2708f47c/baseline-gates.txt`)

| Gate | Result |
|---|---|
| Types (`lint:types`) | 0 errors |
| ESLint | 0 errors, 2 warnings (ceiling 12) |
| Unit and database suite, four shards, real PostgreSQL 17.11 | 5,562 tests: 5,561 pass, 1 fail, 0 skipped |
| Build | passes |
| Database rules (`test:rules`) | all pass |
| Browser suites, visual baselines, nightly stability, `npm audit` | **not run** (no Chromium here) |

The one failing test is `report-speed-12m` (A-229), a wall-clock budget: 1,633–2,018 ms against 1,500 ms on this 2-CPU sandbox, also when run alone. Upstream CI passes it on the same commit. Environment, not a defect; the budget was not touched.

**What this audit covered**

| Measure | Covered | Of | Share |
|---|---|---|---|
| Source files read, whole or the relevant part | about 35 | 1,529 | 2% |
| Server files among them | about 14 | 246 | 6% |
| Routes exercised with real requests | 18 (14 writes, 4 reports) | about 309 | 6% |
| Migrations read in full | 2 | 54 | 4% |
| Functions examined | about 30 | not counted | — |

There is no function count because the tool that should supply it is out of date: the Code Atlas describes the tree of 16 October (finding A7-12). No function-by-function pass (Pass A of the instructions) was attempted beyond this slice.

**Also run:** the recurring-entry job; 17 database statements as a signed-in browser session; the app's own Data Health checks and month-end posting check after every finding; the probes against two pull requests at five heads (PR #640 at `4c65103e`, `e3367a9e`, `f4e0b111`; PR #647 at `720fc6d1`, `c2835545`) and against both migrations together; other agents' probes (Agent #6, function audit) before and after PR #647.

**Unknowns** are listed in section 7.

---

## 2. Top verified failures

Every row was executed at `2708f47c`; the screens were read in source, not run in a browser. Reproduction commands, expected values worked by hand, source lines and acceptance tests are in [`FINDINGS.md`](FINDINGS.md).

| # | Issue | Sev. | What happens | Shortest reproduction |
|---|---|---|---|---|
| 1 | #662 | P1 — fix first | The ledger list's "Reverse transaction" button un-posts any entry in an open month, including an invoice's or a payment's; nothing is reversed, the document is not told. "Undo" answers 200 and the entry stays out of the books. Made reachable by PR #647. | `probes/a7-04g-ledger-list-void-button.test.ts` |
| 2 | #662 | P1 | `{ partialUpdate: { exchangeRate: 100 } }` turns a payment of 500.00 into 50,000.00 in every report; its lines and total still read 500.00; the trial balance still balances. | `probes/a7-04e-rate-by-partial-update.test.ts` |
| 3 | #662 | P1 | A posted entry is deleted in two requests (status to draft, then delete), although a single delete is refused. | `probes/a7-04f-unpost-then-delete.test.ts` |
| 4 | #652 | P1 | A bookkeeper voids, rewrites or reverses the entry of an invoice or a payment through the generic routes; the rewrite is offered by the "Edit Transaction Details" window. Audit rows carry no before and after. | `probes/a7-04-system-entries-editable.test.ts` |
| 5 | #646 | P1 | A credit note inserted from the browser, never issued, is applied to an invoice (paid, no money) and refunded from the bank (−300.00). | `probes/a7-06-forged-credit.test.ts` |
| 6 | #654 | P2 | The recurring job posts 10.00 debit against 9.99 credit; the trial balance is out by 0.01 and Data Health reports nothing. A journal with a rate on its lines is refused when created. | `probes/a7-08-recurring-entry.test.ts`, `a7-02b-…` |
| 7 | #653 | P2 | A foreign invoice paid in three parts at one rate leaves −0.01 in Accounts Receivable for good. | `probes/a7-03-fx-installments.test.ts` |
| 8 | #656 | P2 | `POST /workspaces/:id/seed` writes two demo entries into a hard-closed month of real books; they cannot be cleared. | `probes/a7-07-closed-period-sweep.test.ts` |
| 9 | #657 | P2 | The gate that counts ledger writes outside the shared check reports 0; there are 14, three with no shared check. | `probes/a7-01-ledger-door-dataflow.ts` |

Rows 1–4 are one route family: `PUT /api/v1/transactions/:id`, `DELETE`, and `POST …/reverse` do not know which entries belong to a document, and the partial update writes almost any field.

**Closed and verified:** the lead's C-1 (a browser session writing the ledger tables) — all six writes are refused at this pin.

---

## 3. Integration graph

Each capability was walked from the request to the reports and back. "Breaks at" is the missing link.

| Capability | Path walked | Result | Breaks at | Owner |
|---|---|---|---|---|
| Invoice → payment → reports | post route → `documentPostService` → ledger → `/payments` → trial balance, balance sheet, P&L, ageing | **Agrees** with figures worked by hand (single currency) | — | — |
| Change an entry after posting | ledger list → edit window / "Reverse transaction" → `PUT /transactions/:id` | **Broken** | The server has no notion of "this entry belongs to a document"; the partial update has no allow-list | AI #1 |
| Take an entry out of the books | "Reverse transaction" → partial update `failed` + `deletedAt` → "Undo" | **Broken** | No reversing entry; `deletedAt` is unknown to the schema, so "Undo" cannot clear it | AI #1 |
| Credit note → apply → refund | browser insert into `creditNotes` → `/payments/credits/apply`, `/refund` | **Broken** | The server does not require the credit's own posted entry; the table accepts browser inserts of open credits | AI #1 |
| Foreign invoice paid in parts | post → three `/payments` → ledger vs ageing | **Off by a cent** | Each payment is converted alone; nothing settles the remainder | AI #1 / AI #9 |
| Foreign-currency journal, from the screen | `JournalEntryModal` → `POST /transactions` → reverse | **Agrees**, reverses exactly | — | — |
| Foreign-currency journal, from the API | `POST /transactions` with a rate on the lines | **Refused** (400) | Validator and ledger door disagree on what the total means | AI #1 / AI #9 |
| Recurring entry | browser insert into `recurring` → daily job → ledger | **Out of balance by 0.01** | The job writes outside the validator; the database trigger and Data Health check the entry's own currency only | AI #1 |
| Closing a month | close route → 14 writers sent a date in it | **12 refused by the lock**, 1 by another rule | `POST /workspaces/:id/seed` has no check at all | AI #1 |
| Demo data → clear | seed route → `/transactions/reset` | **Cannot be cleared** | The seed route does not mark the books as demo; no screen calls it | AI #1 |
| File a state sales-tax return | `fileTaxReturn` → kept copy | **Not verified** | No test compares the kept figures with what the screen shows | AI #9 |
| Know what the code is | Code Atlas → workflow traces | **Stale** | Atlas revision is 16 October; 2,590 changes since | lead |

---

## 4. Beta readiness matrix

Status words are those of `docs/FIRST_TESTERS_GATE.md`. "Unverified" means no real execution was shown — by me or, as far as I found, by anyone. I did not review other agents' evidence for gates outside my slice.

| Gate | Promise | Status | Basis |
|---|---|---|---|
| G-01 | Setup once; same books after refresh | Unverified | Needs a browser |
| G-02 | One simple book usable, no dead ends | Unverified | Needs a browser. Server side of invoice → payment → reports agrees (probe A7-10) |
| G-03 | Every change persists or is visibly refused | **Blocked** | #662: "Undo" answers 200, says restored, and the entry stays out of the books |
| G-04 | Access boundaries between workspaces | Unverified | Partial: the rules suite passes on real PostgreSQL; six browser writes to ledger tables refused; viewer and outsider inserts refused. No two-workspace route test by me |
| G-05 | Test and real records cannot be confused | Unverified | Code exists per the gate file; needs the deployed site |
| G-06 | Tester can report a problem and recover | Unverified | Same |
| G-07 | Screens work at desktop and phone, both languages | Unverified | Needs a browser |
| G-08 | Invited use complies with the licence | Unverified | Owner's decision |
| G-09 | Entries cannot be unbalanced or posted twice; no bypass | **Blocked** | #654 (posted 0.01 out of balance), #662, #652, #657 (three writers outside the shared check). Retries and concurrent requests were not tested |
| G-10 | Bank sync loses nothing | Unverified | Not examined |
| G-11 | Billed once; authoritative server checks | **Blocked** | #646 |
| G-12 | Totals agree across labels and entities | Unverified | Not examined |
| G-13 | Cash, receivables, payables and reports agree | **Blocked** | #653, #652, #662 — each leaves the ledger and the documents disagreeing. Stock not examined |
| G-14 | Screen, PDF and CSV agree | Unverified | Not examined |
| G-15 | A backup can be restored | Unverified | Not examined |
| G-16 | Tax results can be explained and reproduced | Unverified | Not examined. A7-09: kept figures of a filed return are untested |
| G-17 | Production configuration is trusted | Unverified | Not reachable from here |
| G-18 | Testers can leave with their data | Unverified | Not examined |
| G-19 | Survives realistic load | Unverified | Not examined. The speed test's failure here says nothing about production |

Open issues filed by other sessions that bear on these gates and that **I did not verify**: #641, #648, #651 (currencies without two decimals), #643 (posting check does not cover credit notes), #645 (report cache never evicts), #642 (report speed).

---

## 5. Architecture shortcuts

Five shared rules, each of which closes a family of the findings above without rebuilding a module.

1. **One allow-list for changing a posted entry.** `ledgerDoor.ts` already has `ledgerMark` and `LEDGER_MARK_FIELDS`. Use them in the partial-update branch and define the allowed status changes once. Closes rows 1–3.
2. **One server-side "belongs to a document" check**, the same predicate the browser has (`isDocumentEntry`), in `PUT`, `DELETE` and `…/reverse` for entries. Closes row 4 and the document half of row 1.
3. **Money documents are issued by the server only**, as payments already are: the database refuses a browser insert or status change of an open or issued credit, invoice or bill, and the server applies only a credit that has a posted entry. Closes row 5 and the rest of #646.
4. **One meaning for a rate.** Store the home-currency amount on every line at posting time and have every reader — reports, the database trigger, Data Health — use only that. Closes rows 2 and 6 and makes row 7 a one-line settlement.
5. **A ledger gate that sees the writes.** Move the three unchecked writers through `ledgerWrite`, then teach the scanner to follow one assignment (60 lines, in `probes/a7-01-…`). Closes rows 8 and 9 and keeps 1–4 from coming back through a new writer.

---

## 6. Three work queues

**Blocking now — before anyone is invited**

1. #662, result 1 and 2: make "Reverse transaction" post a reversal or hide it on document entries; make "Undo" restore or say it could not.

**Before real bookkeeping**

2. #662 results 3 and 4, and #652: shortcuts 1 and 2.
3. #646: shortcut 3.
4. #654 and #653: shortcut 4.
5. #656: refuse the seed route on books with real data, or remove it.
6. #657: shortcut 5; the order (move writers, then raise the gate) is the lead's.
7. Audit rows with before and after values, written inside the same transaction (#652 d).
8. A test that pins the figures of a filed tax return (A7-09).
9. Evidence for gates G-01…G-08 on the deployed site, then G-09…G-19 one by one.

**Parked until first feedback**

10. The ESLint ratchet workflow (A7-11) and the Code Atlas refresh (A7-12).
11. The speed budget on small machines.
12. Letting the audit integration comment on issues and open pull requests upstream (section 7).

---

## 7. Status: tested, inferred, inaccessible

**Tested** (real routers and services, real PostgreSQL, nothing mocked; output in `evidence/main-2708f47c/`): every server answer and every balance quoted in this report and in `FINDINGS.md`; the repository's gates in section 1; the database rules as a browser session.

**Inferred from source, not executed**

- Everything about what a screen shows or sends: the "Reverse transaction" and "Edit Transaction Details" buttons, the "Undo" toast, the journal screen's payload. The requests those screens build were then sent to the server by the probes.
- A7-09 (filed tax-return figures): a missing test, no wrong figure shown.
- Closed-period checks in the 24 other server files that write ledger entries (depreciation, payroll, FX revaluation, landed cost, asset disposal and transfer, stock, imports, payment void and others): each file mentions a check; none was sent a request.
- "No longer reproduced" for other agents' findings means their probes say so; the fixes were not reviewed.

**Inaccessible from this sandbox**

- Browsers: no Chromium, so no Playwright suite, no screenshots, no gate that needs a screen.
- The deployed site, its configuration, its database and its applied migrations.
- CI job logs: conclusions and step names only.
- Upstream write access beyond opening issues: commenting on an issue, editing one, and opening a pull request on `shmuelbiller1/ledgerflow` are all refused for this integration (403). Corrections to my own issues therefore had to be filed as new issues (#661, #662).

**Not examined at all:** bank sync, imports and reconciliation; inventory and stock valuation; consolidation and dimensions; tax calculation; payroll; PDFs, CSV and email; backup and restore; notifications and the job queue; admin, billing and invitations; performance; anything in a browser.

---

## Handoff

| What | Where |
|---|---|
| Findings, one section each | [`FINDINGS.md`](FINDINGS.md) |
| Counts, gates, next batch | [`SCORECARD.md`](SCORECARD.md) |
| Probes (15) and the harness | `probes/` — `run-all.sh` runs all of them |
| What each probe printed | `evidence/main-2708f47c/` (this pin); files directly under `evidence/` are the pin `2ac666b`; `pr640-*`, `pr647-*` are the pull-request heads |
| Text of every issue filed | `issues/` (00 = #646, 01 = #650, 02 = #652, 03 = #653, 04 = #654, 05 = #656, 06 = #657, 07 = #661, 08 = #662) |
| Branch | `arena/a91ccf77-ledgerflow` on the fork `Chaim-Richard/ledgerflow` |

**To reproduce everything:** Node 24, a disposable PostgreSQL 17 database in `LF_TEST_DATABASE_URL` (UTF-8), `npm ci --ignore-scripts`, `npm run db:test-setup`, then `bash audit/agent7-2026-11-11/probes/run-all.sh`. Each probe's header gives its own command and what a correct system would answer. The probes assert today's behaviour; with the expectations turned round they are the regression tests.

**For the next auditor:** re-run `run-all.sh` on the new `main` first — `main` moved three times during this session, and one of the merges changed a finding's reach. Then take the batch in `SCORECARD.md`.
