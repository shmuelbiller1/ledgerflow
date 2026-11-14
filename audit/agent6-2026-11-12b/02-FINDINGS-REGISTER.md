# Agent #6 — verified findings register, second session of 2026-11-12

Pin: upstream `main` **`e33b3f2`** (2026-11-12T22:22:42Z). Every "confirmed" row below was reproduced by running
the product's own code in this sandbox (probe path given) or by reading the exact lines at the pin. Nothing is
carried forward without saying so.

## A. Confirmed defects found in this session and fixed on this branch

### AF6B-001 (P1, financial reporting) — sales-rep commission was 100× (JPY) or 10× (KWD) too small for a foreign payment — issue **#651**, part 1 — **FIXED**

- **Where:** `src/lib/salesReps.ts` `commissionLines` (`:161` at the pin `const paidCents = Math.round(a.amountCents * rate)`), reached by `src/components/reporting/CommissionReportView.tsx:29`.
- **What:** an allocation is in the **payment's own minor units**; the commission report is in the **books'**. The code converted with the exchange rate alone, so a ¥100,000 sale at 0.0067 in USD books (a real $670.00) paid a 10 % commission of **67 cents instead of 6,700 cents ($67.00)**. `paymentService.ts:389` converts the same field with `minorUnitRate` and says so in a comment ("BM-04: … ¥ has none, KWD three") — the two paths disagreed.
- **Why the helper fix did not cover it:** this file inlines the conversion instead of calling `toBaseCents`, so #641/#648's repair of `toBaseCents` left it broken (which is exactly why #651 was filed separately).
- **Reproduction (executed, before the fix):** `audit/function-audit/probes/af008-641-aging-vs-ledger.ts` V7a printed `DEFECT … 67 cents … hand arithmetic 10% of $670.00 = 6700 cents`; the USD control V7b passed, isolating the currency's minor units as the only cause.
- **Fix:** `CommissionPayment.currency?: string`; `commissionLines(..., baseCurrency = 'USD')`; `convertMinorUnits(a.amountCents, rate, p.currency, baseCurrency)` at `:167`; the report screen passes the workspace currency. A row with no saved currency keeps the old rate-only reading (legacy data).
- **Test:** `src/tests/currency-minor-units-reports.test.ts` — JPY (6,700), KWD (3,250), USD control (6,700), legacy row (1,100). After the fix the probe's V7a is OK.
- **Residual risk:** a workspace whose rows predate the `currency` field gets the old figure until those rows are re-saved; the report does not (and cannot reliably) infer the payment currency from the invoice.

### AF6B-002 (P1, financial reporting) — cash-basis revenue recognised **1 %** of a fully paid foreign invoice: the ratio mixed two units — issue **#651**, part 2 — **FIXED**

- **Where:** `src/server/reports/cashBasis.ts:114` at the pin: `const share = Math.min(1, (a.amountCents * rate) / owed)`.
- **What:** the numerator was an un-adjusted document conversion (¥100,000 × 0.0067 = 670) while `owed` came from the accrual's lines, which are **base cents** (67,000). The share was 0.01, so cash-basis profit and the cash-basis balance sheet recognised 1 % of the revenue of every fully paid foreign invoice whose currency has fewer decimals than the books'. Cash-basis figures feed tax reporting.
- **Reproduction (executed, before the fix):** af008 probe V8a `DEFECT … recognised 670 cents … correct is 67000`; USD control V8b passed.
- **Fix:** `CashBasisPayment.currency?: string`, `cashBasisEntries(..., baseCurrency = 'USD')`, `paidBaseCents = convertMinorUnits(a.amountCents, rate, p.currency, baseCurrency)`; `cashBasisBalanceSheet` passes it through; `reportRoutes.ts` (P&L and balance-sheet cash branches) now passes the workspace currency.
- **Test:** the same new suite — full payment 67,000; part payment 33,500; KWD 13,000 of 32,500; legacy row unchanged.

### AF6B-003 (P1, financial reporting — **new**, found while proving AF6B-002) — a *partly* paid foreign invoice recognised its **whole** posting on the cash-basis report — **FIXED**

- **Where:** `src/server/reports/cashBasis.ts:85` and `:112` (the accrual lines are re-valued with `lineAmount` but keep their own `baseAmountCents`).
- **What:** `lineAmount()` prefers `baseAmountCents` (an integer) over `amountCents × rate`. The accrual's base amounts are always written by the posting service for a foreign document, so `shareOfLines(..., share)` scaled `amountCents` while `lineAmount` kept reading the **unscaled** `baseAmountCents`: the paid share was ignored and a 50 %-paid ¥100,000 invoice still recognised all $670.00. Same-currency books were unaffected, which is why existing tests (their fixtures carry no `baseAmountCents`) never saw it.
- **Reproduction (executed):** the first version of `src/tests/currency-minor-units-reports.test.ts` (case "a part payment recognises its share") failed with `67000 !== 33500` on the pre-fix code.
- **Fix:** the re-based lines drop `baseAmountCents` (they are base cents at rate 1 by then), so `lineAmount` reads the scaled value.
- **Test:** the part-payment and KWD part-payment cases in the same suite.

### AF6B-004 (P1, ledger integrity) — the generic entry routes changed or reversed an **invoice's or payment's** entry behind the document — issues **#652**, **#662** — **FIXED on this branch**

- **Where:** `src/server/routes/transactions/crudRoutes.ts` `PUT /:id` (both the `partialUpdate` branch and the full-record branch) and `src/server/routes/transactions/reverseRoutes.ts` `POST /:id/reverse`.
- **What (from #652, reproduced by AI #7 through the real routers against PostgreSQL):** a bookkeeper could `PUT { partialUpdate: { status: 'void' } }` on a payment's entry, rewrite an invoice's entry lines, or `POST /:id/reverse` it, and each answered 200 while the invoice still read `paid` and the payment `posted` — the books and the documents then disagree, with nothing to reconstruct what the entry was.
- **Client side already refused this** (`src/lib/transactionEdits.ts` `isDocumentEntry`, used by `TransactionRow.tsx:466` and `entryActions.ts:41`); the server enforced none of it, so the API was the way around the UI.
- **Fix:** `src/server/services/ledgerEditGuards.ts` — `documentEntryRefusal()` applies the same predicate server-side; `PUT /:id` passes the changed keys so that **flagging, notes and other annotations still save** (the ledger list's flag button PUTs `{ isFlagged }` on every row) while status, figures, date, `metadata`/`metadata.*`, `exchangeRate`, `currency`, the reconciliation locks, `deletedAt`, `uid` and `workspaceId` are refused (409, pointing at the document); a whole-record rewrite and a reversal are refused outright. A platform admin keeps the existing override, exactly as the certified/cleared locks already do.
- **Correction made after a real PostgreSQL run (commit `9824a43`, and a finding in its own right):** the first version reused the browser's `isDocumentEntry`, which counts *any* metadata `type`, so it also refused to reverse a COGS entry (the documented way stock comes back, `reverseRoutes.ts:213`) and a payroll-import entry (how a corrected file is re-imported). `invoice-cogs` and `pay1-payroll-import` failed 200 → 409 against PostgreSQL. The server rule is now `isDocumentPosting()`: a document link (invoice, bill, payment, credit note, vendor credit, estimate, expense, deposit, purchase order) **and** either no `type` or one of the nine posting types the document postings write. System runs stay reversible.
- **Test:** `src/tests/ledger-edit-guards.test.ts` (9/9) — the document shapes, four system-run shapes that must stay reversible, the hand entry / bank line / import batch that stay editable, flag-only and mixed partial updates, ten financial keys, `metadata.*` paths, admin, plus a wiring check that both routes call the guards; and **`src/tests/ledger-edit-guards-db.test.ts` (4/4, PostgreSQL)**, which drives the real router: void/un-post/re-link/rewrite → 409 with the row untouched, flag and note → 200, flag+status → 409, reverse of the document entry → 409 with no `reversalEventId`, reverse of a hand entry → not 409, un-post of a posted hand entry → 409.

### AF6B-005 (P2, ledger integrity — same root) — a posted entry could be **un-posted in place** (`status → failed | draft`), and "Undo" answered 200 — issue **#662** — **FIXED on this branch**

- **Where:** `PUT /api/v1/transactions/:id` accepted `status: 'failed'` on any entry; `isPostable()` (`src/lib/txFilters.ts:34`) drops `failed` and `draft`, so the entry silently left every report and the trial balance.
- **Fix:** `postedStatusRefusal()` — a `completed`/cleared/reconciled entry cannot move to `failed` or `draft` in place; the answer is 409 "post a reversing entry instead". `flagged`/`reviewed` and forward transitions are unaffected. Applied in both PUT branches.
- **Test:** the same suite (un-post refused, flags allowed, cleared/reconciled counted as posted).

### AF6B-006 (P3, audit trail) — the audit row for an in-place entry edit recorded **no before/after** — issue #652(d) — **FIXED on this branch**

- **Where:** `crudRoutes.ts` `TRANSACTION_UPDATED_PARTIAL` / `TRANSACTION_UPDATED` details were `{ description }` only.
- **Fix:** `auditSnapshot()` records status, date, total, description, line count, currency and rate, and both actions now write `before` and `after`. (The rows are still written after the caller's transaction commits, as #652(d) also notes; moving them inside the transaction is an AI #1 design decision and is not claimed here.)

### AF6B-007 (P3, API contract) — the entry route answered every refusal with 400 — **FIXED on this branch**

- **Where:** `src/server/routes/transactions/crudRoutes.ts`, the `PUT /:id` catch-all (`res.status(400).json(...)`).
- **What:** the handler carried the correct status in its `HttpError`s (409 for a version conflict, a locked field, the new document refusal) but the catch mapped everything to 400, so a client could not tell "you sent something invalid" from "this entry is locked by a document". Found while writing the endpoint test, which expected 409 and got 400.
- **Fix:** after the existing `version_conflict` / `Not found` / `Forbidden` branches, an error carrying a 4xx `status` is answered with it. Only the route's own `HttpError`s carry a status, so nothing else changes.
- **Test:** the endpoint test above asserts 409 for each document refusal.

## B. Verified as already fixed at this pin (not re-fixed, evidence given)

| ID | Claim | Evidence in this session |
|---|---|---|
| AF6-641/648 | `toBaseCents` minor units (aging vs ledger, FX revaluation, approval limit) | af008 probe V1–V6 all OK: aging 67,000 = A/R control 67,000; revaluation delta 3,000 ($30.00, not $0.30); a $670 invoice over a $500 limit requires approval and the email gate holds it |
| AF6-651/1–2 | commission + cash-basis minor units | **were still broken** — see AF6B-001/002 (the "verified fixed" list must say *fixed by this branch*, not by `main`) |
| AF6-006 | audit hash chain verifier and cache | `audit/agent6-2026-11-12b/probes/audit-chain.ts` 7/7: a 5-entry stream verifies; a changed `details`, a deleted entry, a reordered stream and a forged `prevHash` are each detected at the right id |
| F-01 (10 Nov) | US state return dropped `taxPlace.region` sales | `usSalesTaxReturn` resolves place from document → invoice → customer → seller (`usSaleDestination`); `sampleBusinessYear` reads `state || region` |
| F-08 (10 Nov) | "one filing marks every state as filed" | `usQuarterJourney` matches filings by `registration`; period-only records are labelled "Period record only (not per state)"; `taxReturnService` writes `kind: 'sales_tax'` |
| AF6-004 | IRS Pub 15-T Step 2 | `2 × Step2(W/2) === Std(W)` holds to the cent across $20,000–$300,000 (probe D1, worst gap 0) |
| Patches 02–07 of 12 Nov | fx revaluation, GL delete/batch/reconcile, copy mark, SQL triggers | the code and migration `20261112100000_close_ledger_and_settlement_trigger_gaps.sql` are on `main` |

## C. Verified invariants (positive evidence; probes kept in `probes/`)

| Probe | Cases | Result |
|---|---|---|
| `probes/invariants.ts` | 26 | all hold — loan schedules close at zero and principal parts sum to the principal (6 shapes incl. 30-year, 0 %, 24 %, 1 month); depreciation sums to cost − salvage and never dips below salvage (5 shapes, both methods); `allocateCents` never loses a cent (5 shapes incl. 1-cent over 3 and a negative credit); withholding is monotone and FICA stops at the wage base; minor-unit conversions match hand arithmetic |
| `probes/statements.ts` | 11 | all hold — trial-balance debits = credits and every row is its own lines; assets = liabilities + equity + profit; P&L net income = balance-sheet net income; cash flow closes to the balance sheet and its sections add to the net change; the general ledger agrees with the trial balance for all 8 accounts; a void entry counts nowhere |
| `probes/audit-chain.ts` | 7 | see AF6-006 above |

## D. Still open after this session (not fixed here, with the reason)

| Item | Severity | State at `e33b3f2` | Why not fixed here |
|---|---|---|---|
| **#653** foreign invoice paid in instalments leaves 0.01 in A/R for ever | P2 | **mechanism present** — `paymentService.ts:389` converts each payment on its own and does not cap the settlement to what the document still carries in home currency | needs the real posting path and PostgreSQL to prove the cent; AI #1's lane; a change here touches how every payment settles |
| **#654** recurring job posts 0.01 out of balance; an entry at a foreign rate cannot be reversed | P2 | not re-executed (needs DB) | AI #1's lane |
| **#646** credit notes/vendor credits writable from the browser; a forged credit applied | P1 | `creditService` refuses a credit whose status is not usable, and migration `20261112100000` blocks client writers from flipping settled documents and from mutating `refundedCents`; whether `creditNotes` inserts are fully server-only at this pin was **not** executed (no PostgreSQL) | requires `npm run test:rules` and a live DB |
| **#650 / #661** review follow-ups of PR #640/#647 | P2 | not re-executed | needs the DB-gated probes those issues carry |
| DB/RLS suites, `supabase/tests/rls.test.sql` | — | **not run** | no PostgreSQL in this sandbox |
| Playwright browser suites | — | **not run** | no browsers in this sandbox |
| Google Drive backup | — | **not done** | the Drive connector is disconnected in this session (see 01-INSTRUCTIONS §3) |
