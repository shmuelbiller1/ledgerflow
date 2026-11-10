# LedgerFlow vs ERPNext — atomic-level gap comparison

**Date:** 22 Oct 2026
**LedgerFlow snapshot:** `origin/main` `5b04486` (same-day moving tree)
**ERPNext snapshot:** current `HEAD` tarball fetched 22 Oct 2026
**Method:** full file-tree inventories of both projects; module/DocType inventories for ERPNext; LedgerFlow `docs/CAPABILITIES.md` (216 rows), `docs/COORDINATION.md`, `docs/TRACKER.md`, `docs/PLAN.md`, component/service/route inventories and test inventories. No ERPNext code, comments, tests or text were copied into this document — only feature names, module names and independently-worded behaviour descriptions. This is not legal advice.

## 0. Verdict

LedgerFlow is **not missing "an ERP"**. It is missing a small set of *atomic accounting machinery* that ERPNext has refined for 15 years:

1. an authoritative **reposting/repair engine** for accounting and stock history,
2. a durable **Payment Ledger / advance-allocation ledger** separate from the GL,
3. **budget control that can stop or warn at posting time**, not just report variance,
4. an enforced **credit-limit and pricing-rule layer** at document time,
5. posted **landed-cost allocation** (today: preview only),
6. **stock reservation, batch/serial valuation truth and a stock-closing snapshot**,
7. a visible **period-closing voucher equivalent** (retained earnings as a document, not only a checklist/lock state),
8. **health/invariant checkers with repair paths** (ERPNext ships whole families of "incorrect …" reports),
9. platform tools ERPNext gets from Frappe: a generic **workflow engine, custom-field/report builders, print-format system, scheduler/job queue, data-import framework**.

Everything else large in ERPNext (manufacturing, HR, CRM, helpdesk, ecommerce, POS, quality, subcontracting) is **out of LedgerFlow's declared strategy** (`PLAN.md` §17: bookkeeping first). Those are listed as *do not build*, not as gaps.

LedgerFlow also has things ERPNext does **not** centre: the dimension/fact/rule-graph model (§10), label accounting roles (DIM‑3), per-label balance sheet with an honest "not labelled" remainder, Israeli VAT/PCN874 and US-state golden-year worked-figure suites, and an unusually strict AI-suggests/human-confirms/server-posts discipline.

Status words below: **Have** (working, tested path), **Partial** (exists with a stated limit), **Missing** (no equivalent found), **Different** (solved another way), **Skip** (deliberately out of strategy).

## 1. Size and shape snapshot (for orientation only — lines are not value)

| | LedgerFlow | ERPNext core |
|---|---|---|
| Files in tree | 2,815 | 5,854 |
| Main code files | ~2,184 TS/TSX | ~3,885 Python/JS/TS |
| Counted code lines | ~293k (incl. tests) | ~621k (incl. tests) |
| Structured document types | Generic collections + typed models; 39 migrations | **534 DocTypes** (Accounts 191, Stock 78, Manufacturing 49, Setup 40, CRM 28, Assets 26…) |
| Built-in reports | 126 reporting components; ~105 registered report tabs | ~210 report directories |
| Screens/pages | One React SPA registry | 15 workspaces, 44 dashboard charts, 47 number cards, 133 print formats |
| Server API surface | 292 endpoints in 68 route files | Frappe-generated REST per DocType + whitelisted methods |
| Self-declared capabilities | 216 rows: 89 Available, 106 Available-with-limits, 7 Partial, 1 Planned, 13 internal/demo | — |

ERPNext's count excludes the Frappe framework that supplies its metadata engine, permissions, workflow, scheduler, file handling and REST layer. LedgerFlow re-implements those pieces itself, so the functional gap is larger than the line ratio (≈52%) suggests.

## 2. Accounting core / general ledger

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Balanced double-entry posting through one server door | Have (`LedgerPostService`, server validation, golden-path tests) | Have (GL Entry + validators) | **Have** |
| Reverse-and-correct instead of editing posted entries | Have, idempotent reversals | Have (cancellation/amend) | **Have** |
| Period locks, soft/hard close, close checklist, close package | Have | Have (Accounting Period, Period Closing Voucher) | **Have**, but see closing voucher below |
| **Period Closing Voucher as a posted document** (P&L → retained earnings, per finance book/company, restartable process) | Checklist + lock + opening balances; no single auditable closing-voucher document found | Dedicated DocType + background `Process Period Closing Voucher` | **Partial → add (Stage B)** |
| **Repost Accounting Ledger** (recompute GL for a voucher range after a fix, with allowed-type list and audit) | `TRACKER.md` CA‑03 "repost check in Month-End Close" exists as a task; no general repost engine | `Repost Accounting Ledger`, `Repost Payment Ledger` DocTypes | **Missing — highest-value ERP import of an idea** |
| GL validator / ledger-health monitors | `ledgerHealth.ts`, nightly check (CA‑32) | `Ledger Health`, `Ledger Health Monitor`, plus report family: *Invalid Ledger Entries*, *General and Payment Ledger Comparison*, *General Ledger* | **Partial** — health exists; add GL↔Payment-Ledger comparison and invalid-entry report |
| **Bisect-style diagnosis** (find which entry/date broke a statement) | Explain-this-number drill-down exists | `Bisect Accounting Statements` + `Bisect Nodes` | **Missing** (nice diagnostic; P2) |
| Chart-of-accounts merge / account merge | Have (`accountMerge.ts`, CA‑33) | `Ledger Merge` | **Have** |
| Ledger/account freeze, closing balances snapshot | Opening balances one-rule; closing-period columns | `Account Closing Balance`, `Stock Closing Balance` snapshots | **Partial** — add explicit closing-balance snapshot for fast, provable period reports |
| Multi-book ("Finance Book") reporting views | Groups of books + group summary; consolidation endpoint returns "not available" | Finance Book on every GL entry; consolidated financial statements | **Partial** — group report exists; formal consolidation/closing per book missing |
| Journal templates | Have (`journalTemplates.ts`) | Journal Entry Template | **Have** |
| Internal transfer between dimensions/companies | Stock transfers + intercompany elimination in group report | Dedicated internal-transfer GL composers | **Partial** |

## 3. Receivables, payables, payments

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Payment allocation to invoices, atomic persistence | Have (`paymentService`, allocation + atomicity tests) | Payment Entry + references | **Have** |
| **Durable Payment Ledger Entry** (allocation history independent of GL; every partial payment, advance, write-off reconcilable later) | Allocations stored on payment path; no separate payment-ledger concept or report found | `Payment Ledger Entry`, `Advance Payment Ledger Entry`, Payment Ledger report | **Missing — core Stage B item** |
| **Payment Reconciliation workbench** (load unreconciled payments+invoices, allocate many-to-many, log the run) | Receive-payment modal + auto-match suggestions; no standalone reconciliation tool/log | `Payment Reconciliation`, `Process Payment Reconciliation` + log DocTypes | **Partial → add tool (Stage B)** |
| Advance payments / customer deposits | Have (`depositService`, advances) | Advances service + advance ledger | **Have**, but tie into payment ledger |
| **Payment schedule / instalments per invoice** (due-date rows; overdue computed from schedule) | Payment terms exist as text/defaults (CC‑08 task) | Payment Schedule child rows on documents | **Partial** — no enforced schedule model |
| Exchange gain/loss on settlement | FX posting + rounding tests | Dedicated exchange-gain-loss service | **Have (verify multi-currency allocation edge cases)** |
| **FX revaluation run at period end** (per-account unrealised gain/loss document with reversal) | `planFxRevaluation`, `fxRevaluationService` exist | `Exchange Rate Revaluation` DocType with per-account rows | **Have (check it is a first-class document, not only a plan)** |
| Dunning | Preview + letters (EN/HE); **sending/log/schedule not connected** (CAP 169) | Dunning DocType with letter texts/types and process | **Partial → finish send path (already in your lists as A‑70)** |
| Customer credit limit | Over-limit **report**; warning inside invoice form not wired (CAP 164) | Credit limit enforced at Sales Invoice/Order time | **Missing enforcement — add server-side check (small, high value)** |
| Bad debt write-off/reversal | Have | Handled via journal/credit | **Have** |
| Invoice discounting / finance against receivables | Absent | `Invoice Discounting` | **Skip** (niche finance) |
| Cheque printing / bank guarantee | Bank clearance summary exists; no cheque print/guarantee | Cheque Print Template, Bank Guarantee | **Skip unless a pilot user asks** |
| Loyalty points, coupon codes, sales-partner commission | Commission report exists; no loyalty/coupons | Full loyalty/coupon machinery | **Skip** |

## 4. Banking

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Bank feed + statement import (CSV/OFX/CAMT/QBO) | Have (incl. Plaid, Israeli/US bank formats) | Bank Statement Import + Bank Transaction | **Have** |
| Auto-match suggestions, human confirms | Have (global optimiser, learned patterns) | Bank Reconciliation Tool + Bank Transaction Rules | **Have** |
| **Durable bank-transaction rules engine** (ordered rules with account + description conditions, applied server-side) | Auto-rules persisted client-side (CAP 51) | `Bank Transaction Rule`, mapping DocTypes | **Partial → move rule application server-side (Stage B)** |
| Bank clearance date tracking | Have (Bank Clearance report) | Bank Clearance DocType/report | **Have** |
| Reconciliation statement report (book vs bank, uncleared) | Have within reconcile flow | Bank Reconciliation Statement report | **Have (verify a printable statement exists)** |

## 5. Tax

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Dated rate tables with sources | Have (stronger provenance discipline than most ERPs) | Item Tax Templates, tax categories | **Have — LedgerFlow ahead on provenance** |
| Item-wise tax detail stored per line | Tax codes with parts/compounding; line tax resolution | `Item Wise Tax Detail` persisted per document | **Partial — confirm every posted line keeps its tax breakdown for returns** |
| Tax withholding (vendor) | Have (certificates, Form 856 report) | TDS computation (India-centred) | **Have for IL; ERPNext concept equivalent** |
| Per-registration returns (IL VAT, US states) | Have with golden years; PCN874 draft not filing-ready | Regional modules (India GST etc.) | **Have for IL/US; Stage C for filing** |
| Tax on stock/landed items, purchase tax templates | Israeli import-services review; use-tax review | Taxes and Charges templates on purchase docs | **Partial** |
| Deferred tax / tax on advances | Advance payments exist; tax point on advances unclear | Handled in tax engine | **Unknown — add a probe test** |

## 6. Dimensions, entities, groups

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Analytical dimensions | Labels on lines, documents, payments, stock | Accounting Dimension + Cost Center + Project | **Have — different design centre** |
| Dimension accounting roles (informational / fully-attributed / self-balancing) | Designed (DIM‑3), label-role code exists | No direct equivalent; dimensions are filters, company carries the balance | **LedgerFlow ahead — finish enforcement everywhere** |
| Balance sheet by dimension with honest unallocated remainder | Have (by-label BS; "balance sheet by label not yet" note conflicts in CAP 106 — reconcile) | Dimension-wise balance report | **Have/verify** |
| Tax facts + rule graph over dimensions | Have (unique) | Tax rules are template-based | **LedgerFlow ahead** |
| Multi-company consolidation with eliminations | Group summary with eliminations; goodwill + associates partial | Consolidated Financial Statement | **Partial (Stage B W12)** |
| Dimension restrictions ("allowed dimensions") | Required-labels by account only (CAP 80 limit) | `Allowed Dimension`, dimension filters | **Partial → extend required-label rules beyond account** |

## 7. Stock / inventory — the largest real gap

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Stock movement history with source/destination | Have (`stockMoves`, DIM‑2 phases 1–4) | Stock Ledger Entry (authoritative, immutable) | **Have**, architecture differs |
| Valuation: moving average | Have | Moving average + FIFO | **Have (MA only)** |
| **FIFO / batch / lot costing** | Received-value by lot reported; on-hand per lot *not tracked* (CAP 209) | FIFO queues, Serial/Batch Bundle with valuation | **Missing — owner decision already parked (DIM‑2 phase 5). Decide before Stage B stock promise** |
| **Repost Item Valuation** (fix future stock values after backdated entry; settings + queue) | Revaluation route exists (ISS‑130); no future-history repost engine | `Repost Item Valuation`, `Stock Reposting Settings` | **Missing — pair with §2 repost engine** |
| **Stock Closing Entry / closing balance snapshot** | As-of valuation computed from history | `Stock Closing Entry`, `Stock Closing Balance` | **Partial → snapshot makes period stock provable & fast** |
| Serial/batch identity as first-class stock objects | Numbers recorded on documents + lookup; not stock-ledger objects | Serial No, Batch, Serial & Batch Bundle | **Partial** |
| **Stock reservation** (reserve qty for an order without issuing) | Backorders report read-only; "nothing reserved" (CAP 129) | `Stock Reservation Entry` | **Missing (add when order workflow deepens)** |
| Putaway rules / bin-level stock | Bin labels only, no allocation (CAP 182) | Putaway Rule, Bin | **Partial (labels only)** |
| Landed cost **posting** | Preview only (CAP 174); BF‑04 pending | Landed Cost Voucher posts into stock value + GL | **Partial → post it (in your lists as BF‑04)** |
| Item variants / attributes / barcodes / manufacturers / item defaults per warehouse-company | Units + bundles partial; customer/vendor item codes partial | Full item-master machinery | **Partial — variants/attributes missing; add only if pilot needs** |
| Reorder rules per warehouse | Have (location levels, suggestions) | Item Reorder per warehouse | **Have** |
| Quality inspection linked to receipt/delivery | None found | Quality Management module (16 DocTypes) | **Missing — Skip until a stock pilot demands it** |
| Stock health reports (*Incorrect Balance Qty*, *Stock Ledger Invariant Check*, *Stock & Account Value Comparison*, FIFO-queue comparisons) | Inventory-details + valuation-vs-books checks | Whole report family | **Partial → port the *ideas* as invariant tests (cheap, high trust)** |

## 8. Sales / buying lifecycle

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Quotation → order → invoice → delivery chain | Have (estimates, orders, part-invoicing, deliveries) | Have, deeper status machinery | **Have** |
| Pricing rules (discount by item group/customer/qty/date, promotions) | Price lists per customer/currency; no rule engine | Pricing Rule engine | **Missing — add small rule set only if pilot needs** |
| Payment terms templates + schedules | Terms as defaults; CC‑08 open | Payment Terms Template | **Partial** |
| Supplier quotation / RFQ / scorecard | Vendor scorecard report exists | RFQ + Supplier Scorecard system | **Partial/Skip depth** |
| Three-way match (PO–receipt–bill) | Review report exists | Built into buying flow | **Have (verify enforcement, not just review)** |
| Blanket orders | Have | Blanket Order | **Have** |
| Subscriptions / recurring billing | Recurring documents + MRR reporting | Subscription module | **Partial — check auto-invoice + dunning chain** |
| Sales returns / RMA | Returns have; RMA approval not server-enforced (CAP 184) | Return flows + RMA patterns | **Partial (already ISS‑143/AUD‑03)** |
| Customer/supplier portals | Token public pages; not full portals | Portal module | **Partial (G‑16/G‑17 in lists)** |
| POS | None | POS Invoice/Profile/Closing | **Skip** |
| Shipment/carrier tracking | Tracking annotation only | Shipment, Delivery Trip | **Partial/Skip depth** |

## 9. Assets

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Asset register, depreciation schedules, ledger | Have | Have, deeper (finance books) | **Have** |
| Asset capitalisation from stock/service items | Asset-from-bill exists | Asset Capitalization | **Partial (verify)** |
| Asset movement between locations/custodians | Asset transfer exists | Asset Movement | **Have** |
| Asset value adjustment / shift allocation ( depreciation method changes) | Disposal exists; shift allocation absent | Asset Value Adjustment, Shift Allocation | **Partial/Skip** |
| Maintenance teams/tasks, repair with consumed stock + purchase invoice | Maintenance log exists | Full maintenance/repair system | **Partial (enough for now)** |

## 10. Projects, time, people

| Atomic capability | LedgerFlow | ERPNext | Verdict |
|---|---|---|---|
| Projects, tasks, timesheets, billing from time | Have | Have (Projects module) | **Have (check task dependencies/templates — Partial)** |
| Payroll processing | Demo/internal only by design (Stage C) | Separate HRMS app today; ERPNext historically payroll | **Skip now (already decided)** |
| Expense claims | Have with receipt checklist | Expense Claim in HRMS | **Have** |
| Loans to business / loan schedules | Have (business loans) | Lending app | **Have for your scope** |

## 11. Whole ERPNext worlds LedgerFlow does not have (Skip list)

Manufacturing (BOM, Work Order, Job Card, Production Plan — your A‑168/A‑169 "manufacturing light" is the right ceiling), Quality Management, Subcontracting, CRM (leads/opportunities/campaigns), Support/helpdesk, Maintenance visits, Telephony, EDI, shopping cart/website, POS. **Do not add these to any queue.** Each is 15–50 DocTypes plus workflows in ERPNext; adding them would multiply LedgerFlow's remaining work without moving W1–W14.

## 12. Platform / framework layer (what Frappe gives ERPNext for free)

| Platform tool | LedgerFlow | Gap |
|---|---|---|
| Metadata-driven CRUD/permissions per document type | Hand-written routes (292 endpoints); route-guard test D‑30 pending | **Partial — finish D‑30 route-policy enumeration** |
| Generic workflow engine (states, transitions, approvals per doctype) | Approval pieces (invoice approval, two-person rule, PO approval); no generic engine | **Partial — do not build a generic engine; finish per-document state machines** |
| Custom fields on any record | Have for customers/vendors/items (CAP 173 limit) | **Have (extend cautiously)** |
| Custom/print formats per document (133 in ERPNext) | PDF service + branding per label; no user print-format designer | **Partial/Skip designer** |
| Report builder / query reports for users | Fixed registered reports (~105) | **Skip builder; your fixed-report discipline is safer for money** |
| Scheduler, background jobs, job queue with retries | Recurring/scheduled pieces; AUD‑04/AUD‑05 problems already logged (outbox/claim) | **Partial → durable outbox (already in lists)** |
| Data import framework (template, validation, background import) | Import screens + AU‑4 acceptance | **Partial (Stage B W11)** |
| Email queue, notifications, SMS | Mail/reminder services; provider config owner-side | **Partial** |
| Audit trail / version history per document | Audit log + UI; RMA events not immutable (CAP 184) | **Partial** |
| Multi-tenancy/site management, backups ops, monitoring | Supabase/Vercel-based; restore drill exists (fork PR pending) | **Partial — Stage B production gates** |
| API keys / developer API | Have (developer routes) | **Have (verify scopes)** |
| Global search / linked-record navigation | Command palette (loaded-data only, CAP 57) | **Partial → server search index later** |

## 13. The concrete "not in your lists" additions

Checked against `COORDINATION.md`, `TRACKER.md`, `PLAN.md`, `CAPABILITIES.md`. Items marked ◆ were not found as tasks anywhere in those lists.

| # | Add / change | Why (atomic reason) | Stage |
|---|---|---|---|
| ◆EG‑1 | **Repost engine for accounting + payment + stock history**: one service that recomputes a voucher/date range after a correction, refuses locked periods, writes an audit record of what changed | Every mature ledger needs a repair path; today a backdated fix has no supported recompute | B (design in A) |
| ◆EG‑2 | **Payment Ledger**: durable allocation entries (payment ↔ invoice, amount, currency, gain/loss, write-off) + Payment Ledger report; statements/aging read from it | AR/AP truth currently lives inside payment flows; disputes and partials need an inspectable ledger | B |
| ◆EG‑3 | **Period Closing document**: posted closing voucher per books (and per self-balancing label kind), restartable, linked to the close checklist | Makes retained-earnings closing auditable as a document, not only a state | B |
| ◆EG‑4 | **Budget control at posting**: warn/stop when a bill/journal would exceed period budget for account(+label) | Budgets today report; ERPNext can act. Small change, big accountant value | B |
| ◆EG‑5 | **Credit-limit enforcement on invoice save/issue** (server refuses or requires override with reason) | CAP 164 has detection without prevention | A/B (small) |
| ◆EG‑6 | **Landed-cost posting** (allocate freight/duty into stock value + GL on receipt) — BF‑04 exists as a reference but no atomic task sequence | Preview without posting leaves stock value wrong | B |
| ◆EG‑7 | **Stock closing snapshot** at period close (qty+value per item/warehouse) + invariant checks (stock ledger vs GL, negative-stock, FIFO/serial consistency reports as tests) | Provability and speed for W13; cheap trust | B |
| ◆EG‑8 | **FIFO/lot costing decision + implementation or explicit permanent refusal** (already parked as DIM‑2 phase 5) | W13 cannot be "dependable" for batch businesses on received-value tables | B decision |
| ◆EG‑9 | **Bank rules engine server-side**: ordered rules (description/account/amount conditions) applied during import, with per-rule hit log | Moves CAP 51 from browser memory to durable behaviour | B |
| ◆EG‑10 | **Ledger comparison + invalid-entry reports**: GL vs Payment Ledger totals; entries failing invariants listed with repair action | Extends Ledger Health into an accountant's repair screen | B |
| EG‑11 | Finish already-listed: D‑30 route-policy enumeration, AUD‑04 durable outbox, AUD‑03/ISS‑143 server RMA transitions, A‑70 dunning send, BF‑04 (see EG‑6), AU‑4 import acceptance | These are in your lists — do not duplicate | A/B |
| ◆EG‑12 | **Item tax-detail persistence audit**: every posted invoice/bill line keeps the exact tax breakdown (template, rate, amount) used, immutable after posting | Returns and disputes need the historical breakdown, not a recompute | A (probe test first) |
| ◆EG‑13 | **Tax-point on advances probe**: decide and test whether deposits/advances create tax liability at receipt in IL/US scopes you support | Silent wrongness risk; ERPNext handles advances inside tax engine | B |
| ◆EG‑14 | **Opening-invoice creation tool**: import open AR/AP invoices at migration with original numbers/dates, tied to AU‑4 totals | Migration completeness for Stage B pilots | B |
| ◆EG‑15 | **Server-side global search index** for records/notes (CAP 57/151 limits) | Bookkeeper speed at 10k+ records | B/C |

Explicitly **not** recommended to add: pricing-rule engine depth, loyalty, POS, invoice discounting, cheque/guarantees, quality module, portals beyond token pages, a generic workflow/report/print designer. Revisit only from a named pilot user's workflow.

## 14. Suggested order (fits your Stage A/B/C)

1. **Now (Stage A finish):** EG‑5 (small), EG‑12 probe, finish EG‑11 items already queued (D‑98/D‑99 browser journeys first).
2. **Stage B hardening (the ERPNext-depth sprint):** EG‑1 design → EG‑2 → EG‑3 → EG‑7 → EG‑6 → EG‑4 → EG‑9 → EG‑10 → EG‑14.
3. **Decisions you must make personally:** EG‑8 (FIFO/lot costing), whether self-balancing label kinds get their own closing vouchers (EG‑3 scope).
4. **Later/never:** §11 worlds and §13 exclusions.

Each EG item should land the LedgerFlow way: server-side, one transaction, idempotent, with a worked-figure test whose expected cents are written by hand before the code.

## 15. Honest closing note

ERPNext's deepest advantage is not any single feature above. It is that its atomic pieces — GL, Payment Ledger, Stock Ledger, reposting, closing — were designed as **one ledger architecture** and then survived 15 years of production corrections. LedgerFlow has strong pieces and, in dimensions/tax provenance, a more modern design centre. The fastest way to close the real gap is not more screens: it is §13's EG‑1…EG‑10, which convert several of your "Available with limits" rows into machinery an accountant can rely on when history goes wrong — because in real books, history always eventually goes wrong.
