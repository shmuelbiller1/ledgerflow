# Reporting, historical cutoffs and exports — partial audit

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7faa73705`. Synthetic data only; no customer records, actual emails, authenticated HTTP or real database used. These are scoped findings, not a complete review of these files or a release opinion. Severity is suggested for affected workflows and depends on business usage.

## RP-01 — P1: scheduled aging labels current settlement state as a past balance

**Expected:** An invoice issued 1 January for $100, due 31 January and paid 10 February was outstanding $100 on 31 January, in the current bucket on that date. The period-end report should include it; payment after that date must not change the January snapshot. Similarly, a later partial payment or credit must not reduce the historic amount.

**Observed:** `reporting-probe.ts` feeds the current record (`status: paid`, amount paid $100) into the actual `computePartyAging` and scheduled table for 31 January. The report is titled `Receivables aging on 2026-01-31` and totals $0. The fixture posits a 10 February payment; the record itself carries no payment date. The helper is not passed settlement history, so cannot distinguish a payment made on 10 January from one made on 10 February. `src/lib/aging.ts:47–50,58–75` uses current status and amount due; `src/server/services/scheduledReportService.ts:53–60` filters invoice issue dates to the period end but passes current document states. `src/lib/scheduledReports.ts:154–165` gives the dated title. This is a pure-function reproduction plus code trace, not a test of DB query/send timing.

`/party-aging` accepts arbitrary `asOfDate` and streams all documents without issue-date filtering (`src/server/routes/operationalReportRoutes.ts:57–73`); the pure probe also includes a currently-open $100 invoice dated 10 February in the 31 January result. The authenticated API itself was not exercised. The normal aging screen instead requests **today** and explicitly says current unpaid balances, not a report-period balance (`PartyAgingReportView.tsx:64–76,152`). Accountant pack explicitly says open balances are current, not a period-end snapshot (`accountantExportPack.ts:264,403`); do not equate that disclosed output with a historical aging. Year-end pack filters document dates but uses current balances (`yearEndPack.ts:152–161`); examine its UI wording independently before classifying its disclosure.

**Remedy:** Reconstruct issue, settlement, credit, reversal and void events through the cutoff, or present an unmistakable current-state limitation and do not label it a historic snapshot. Add real-database end-to-end tests for paid/part-paid/credited after cutoff, future documents, reversals and time zones, and reconcile dated aging to relevant control accounts with known reconciling items.

## RP-02 — P1: accountant and scheduled CSV exports use two decimals for non-two-decimal currencies

**Expected:** JPY has zero minor digits: 100 minor units = ¥100. KWD has three: 100 minor units = 0.100 KWD. **Observed:** For balanced synthetic JPY cash/capital entries of 100 minor units, `buildAccountantPack` trial balance labels the columns JPY but outputs debit and credit `1.00`, not `100`. `reportCsv` also outputs `1.00` for numeric 100. The same synthetic accountant pack with KWD also outputs `1.00` rather than the expected `0.100` for 100 minor units. Internal amounts may remain balanced while values in spreadsheets are wrong by 100× for JPY and 10× for KWD.

`src/lib/csvExport.ts:15` defines `csvMoney` as a fixed /100 two-decimal formatter; currency-aware helpers exist separately. Accountant pack uses `csvMoney` for trial balance, GL, aging, tax and README (`accountantExportPack.ts:161–162,182–192,218–219,256–261,302–309,383`). Scheduled attachment uses `reportCsv` without currency (`scheduledReportService.ts:44–49`, `scheduledReports.ts:183–184`). Email HTML uses a currency-aware formatting callback, so do **not** claim the email HTML has the same decimal error without further evidence. Other exporters need independent call-site examination. This issue is separate from the prior documented foreign-currency Israeli VAT conversion issue #928.

**Remedy:** Use the book-currency minor-unit exponent consistently at each export boundary; keep data numeric precision and headers explicit; independently test JPY, USD and KWD across all sections, README, CSV attachments and import into spreadsheets, with reconciliation to statements and currency conversions.

## RP-03 — P2: scheduled P&L omits cost of goods sold

**Expected:** Income $1,000, cost of goods $300, other expenses $200 yields gross profit $700 and net profit $500; the table should show cost of goods (or otherwise reconcile every included charge) so the $500 net is explainable. **Observed:** Actual `computeProfitAndLoss` returns income 100000, COGS 30000, expense 20000 and net 50000 minor units; `profitAndLossTable` emits income $1,000, expenses $200 and net $500 but **no COGS or gross profit line**. Thus its displayed income minus displayed expenses is $800, not the displayed $500. Net profit itself in this worked case is correct; this is a material presentation/completeness defect, not proof that all statement computations are wrong. `scheduledReportService.ts:62–67` passes the calculation to `scheduledReports.ts:126–136`, whose input type and table omit `cogs`; both email and CSV use the same table. Probe is pure computation, not an actual delivered email.

**Remedy:** Include COGS accounts, total and gross profit with correct signs; test all-zero/negative amounts and assert revenue − COGS − operating expenses reconciles to net in the actual delivered table and attachment.

## RP-04 — P1: cash-flow statement includes noncash portions as fictional gross flows

**Independently worked example:** Acquire $10,000 of equipment, paying $2,000 cash directly and owing the seller $8,000 on a loan; assume there is **no separate borrowing cash inflow**. Journal: debit equipment $10,000; credit bank $2,000; credit loan payable $8,000. The cash-flow statement should show **investing outflow $2,000**, financing cash inflow **$0**, and net cash change **−$2,000**, with the $8,000 noncash financing disclosed separately as required by the applicable framework. The IASB states IAS 7 excludes noncash investing and financing from the statement and requires separate disclosure ([IAS 7 paragraphs 43–44](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ias7.html); [IAS 7 overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/)). Other reporting frameworks and particular loan arrangements should be assessed on their facts.

**Observed:** `cash-flow-probe.test.ts` calls the actual `computeCashFlow` with the balanced synthetic journal. It reports **investing outflow $10,000**, **financing inflow $8,000**, and **net −$2,000**. Net cash is correct but both gross sections are overstated by $8,000. `src/server/reports/computeReports.ts:257–291` treats every noncash line in a journal containing any cash as a cash movement, irrespective of the noncash portion. The function is used by the `/cash-flow` report and `CashFlowView`; this probe did not save a journal, call the route or render a real browser. Whether a particular entry represents a real bank loan cash flow or a noncash liability requires economic evidence; the accounting assumption here is expressly noncash seller financing.

**Remedy:** Identify actual cash legs and supported classifications rather than assuming all counter-lines are cash flows; preserve separate noncash disclosure, request additional transaction metadata or flag ambiguity where journal lines alone cannot identify the cash flows. Test mixed cash/noncash acquisitions, disposals, withholding, advances, FX, transfers and gross/net section reconciliation under the applicable reporting framework.

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test audit/accounting-review-2026-11-22/cash-flow-probe.test.ts
```

1 diagnostic passed while asserting the present defective numbers; a correction should cause it to fail until converted into an acceptance test.

## RP-05 — P1: a later payment void retroactively removes prior-period cash-basis revenue

**Worked case and observed result:** Post a $100 invoice on February 1 and receive $100 on February 10. The actual cash-basis P&L route for February reports **$100 income**. Void and reverse the payment effective **March 10**, representing a later reversal; re-request the same February P&L with a fresh report cache key. It now reports **$0 income** even though February's receipt remains dated February 10 and the reversing journal is dated March 10. A later-period void should be reflected according to its effective date and accounting facts, rather than mechanically rewriting the earlier cash-period report. Whether a specific erroneous transaction calls for a prior-period correction is an accounting-policy question; this test models a later effective reversal.

**Mechanism:** The report route fetches transactions through its period end but fetches current payment records without an as-of filter (`src/server/routes/reportRoutes.ts:149–157`). `cashBasisEntries` ignores any payment with current `status === 'void'`, regardless of `voidDate` (`src/server/reports/cashBasis.ts:113–116`). `paymentVoidService.ts:178–190` stores the explicit effective `voidDate` and a dated reversing journal. Thus the prior-period result changes when the later void is recorded. The diagnostic used real document, payment, void and report routers against synthetic isolated PostgreSQL with test-injected identity; no authenticated hosted environment was exercised. This example verifies the February P&L, not March treatment, the balance sheet, all credit/reversal scenarios, or the real browser.

**Remedy:** Derive cash-basis recognition and reversal from dated settlement events, not current status; apply the report cutoff and preserve amount, invoice version and currency at the effective dates. Test later and same-period voids, locked-period reversals, partially applied payments, credits, historical statements and cash/bank reconciliation. Explicitly distinguish valid prior-period corrections from later reversals.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/cash-basis-void-database.test.ts
```

1 diagnostic passed while asserting the current defect; it should fail after a correction until rewritten as an acceptance test. It cleans up its synthetic workspace.

## RP-06 — P1 for affected legacy data: report database query drops timestamped entries on the inclusive end date

**Worked case:** A synthetic legacy database contains two balanced $100 revenue journals dated `2026-05-31` and `2026-05-31T12:00:00Z`. Both belong to the May 31 business date under the program's date-slicing logic. `computeProfitAndLoss` on both entries returns **$200 revenue** for May. The real `/profit-and-loss` route against isolated PostgreSQL returns **$100**, because its database query filters `date <= '2026-05-31'` before the date-aware report function sees the entries (`src/server/routes/reportRoutes.ts:120–122`; `src/lib/txFilters.ts:55–70`). The timestamp sorts after the date-only boundary. This is not a balancing problem: a missing balanced journal can leave the trial balance internally balanced while omitting activity.

**Scope:** The diagnostic directly seeded a synthetic *legacy-format* posted record to test the reader; current `TransactionSchema` requires date-only transaction dates, and this test does not prove a current supported transaction writer emits the timestamp or that any real workspace contains one. The route ran with injected test identity and local Postgres, not hosted production. Identify actual import/legacy formats before measuring exposure; do not assume every report query shares this exact defect. The close-snapshot query uses a next-day exclusive bound, a distinct path.

**Remedy:** Normalize and validate business dates consistently for legacy and new data, or query an appropriately indexed inclusive-day/next-day boundary and apply a common timezone/business-date policy. Test date-only, timestamps with offsets, start/end boundaries, legacy imports, all reports and exports against independently summed journal entries.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/report-timestamp-database.test.ts
```

1 diagnostic passed while asserting current behavior; it removes its synthetic workspace and should be rewritten once corrected.

## RP-07 — P1: advance applied to a later invoice disappears from both monthly cash-basis P&Ls

**Worked synthetic case:** Receive $100 as an unapplied customer advance on February 10; issue the $100 invoice on March 1; apply the advance on March 10. The real cash-basis P&L route shows **February income $0, March income $0, but February–March income $100**. Adjacent monthly figures should add to the same two-month total under a consistent recognition policy. Depending on the applicable tax/accounting framework and treatment of advances, the $100 could be recognized at receipt or later; this finding does not prescribe that legal conclusion. It establishes an internal period-consistency failure regardless of which recognition date is selected.

**Mechanism:** `applyUnappliedPayment` appends the invoice allocation to the payment record while the immutable allocation ledger records the later application date (`src/server/services/paymentService.ts:765–783`). `cashBasisEntries` dates every allocation using the original payment date (`src/server/reports/cashBasis.ts:113–138`), while the report route loads invoice postings only through each report's end date. Thus the February report cannot find the March invoice, the March report finds it but dates the revenue in February, and the combined report happens to include it.

**Scope/acceptance:** Reproduced with synthetic advance, invoice, application, and report routes in isolated PostgreSQL using test-injected identity. No actual hosted auth, customer records or jurisdiction-specific advance treatment was tested. Define the cash-basis recognition policy, use dated allocation/recognition events, and test that disjoint period totals reconcile to their union for advances, partial applications, prepayments, reversals and multiple invoices. Use the allocation ledger's effective dates rather than rewriting prior periods based solely on mutable current state.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/cash-basis-advance-database.test.ts
```

1 diagnostic passed while asserting the present wrong totals and cleaned its synthetic workspace; convert it to an acceptance test after remediation.

## RP-08 — P1: cash-basis P&L follows accrual deferral schedule instead of its stated payment-date rule

**Worked case:** A $100 service invoice is issued February 1 and fully paid February 10. With no schedule, February cash-basis P&L shows **$100 income**. The user then spreads that same $100 revenue over March and April. The February cash-basis P&L becomes **$0**, March becomes **$50**, and April **$50**, despite no cash receipts in March or April. A fresh cache key was used. The cash-basis engine's stated design (`cashBasis.ts:2–14`) says invoices count when paid, and these later noncash journal installments should not silently override that declared rule. Whether a particular advance can be deferred under a specific statutory tax method is a separate legal-policy question; this observation is that the program's selected payment-date policy is inconsistently implemented when a schedule is used.

**Mechanism/evidence:** `cashBasisEntries` drops the accrual and brings in a share at payment date, but treats the prepaid/deferred schedule entries as ordinary journal activity. The original payment recognition is offset by the deferral entry, and scheduled installments then create cash-basis income. `cash-basis-spread-database.test.ts` uses real document, payment, spread and reporting routes and synthetic local Postgres with injected owner identity. No hosted browser/customer record or tax return was tested; only this invoice path was reproduced, not bills, credits or FX.

**Acceptance:** Define the permitted cash-basis policy explicitly, preserve appropriate dated source events and exclude or transform accrual-only adjustments consistently; test paid/unpaid and partial documents, start dates, same- and later-period schedules, undo, tax and full-period totals.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/cash-basis-spread-database.test.ts
```

1 diagnostic passed while asserting the current result.

## Other work and tests

- In-service assets: `placeInServiceService.ts` resets `purchaseDate` to the placed-in-service date; the depreciation engine starts the following month. Therefore, an initial suspicion that construction time was automatically depreciated is **not confirmed** for this path. Placement and reversal tests were skipped in this batch but subsequently passed in the isolated-DB workflow batch; hosted behavior remains untested.
- Inventory: `inventoryAsOf` attempts reconstruction from dated moves and marks unexplained histories unknown instead of substituting current balances; location/lot valuation explicitly limits unsupported lot on-hand figures. These are useful safeguards, not approval of moving-average costing, all stock workflows, negative stock valuation, completeness assumptions or the books tie-out.
- Node 24.22.3 with `NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic`: reporting/accountant/year-end/payment/asset-register batch **29 passed**, inventory/depreciation/construction batch **28 passed**. Component tests use a simulated DOM/mock fixtures, not a real authenticated browser. Several database suites printed explicit `LF_TEST_DATABASE_URL not set` skip lines; summary's zero-skipped figure does not mean they ran. One initially specified nonexistent `depreciation-schedule.test.ts`; corrected to `.tsx` in the second batch. No code behavior failure implied.

Reproduce diagnostic:

```sh
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx audit/accounting-review-2026-11-22/reporting-probe.ts
```

**Further work:** End-to-end historical reconstruction and date/status changes, stock costing and backdating, tax/GL/export tie-outs, distinct currencies, real DB concurrency and rollback, permissions, and complete function/caller coverage remain open. None of the findings is fixed here.
