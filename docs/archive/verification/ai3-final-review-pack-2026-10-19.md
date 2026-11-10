# AI #3 (Arena) — final review pack: every A-task, what a user reaches, and the evidence

**19 October 2026 · branch `arena/aa2ebf13-ledgerflow` · base `568f478` (main) · AI #3 (Arena)**

This is task **A-209** (the review pack) together with the reconciled answers to **A-207** (waiting-room
libraries) and **A-208** (every partial task gets its remaining step written down). It is a map of the work
in this lane, not a new claim about money: nothing here posts, files, pays or closes, and no financial
calculation, server route, migration, screenshot baseline or quality budget was changed.

What the pack contains:

1. the checks run on this revision, with the exact commands;
2. every report screen this lane built — the tab a user opens, its component, its pure library, its tests
   and its browser test;
3. the panels this lane built outside the Reports tab;
4. the tasks that are **partial**, each with the one concrete step that remains and who owns it;
5. the answer to A-207: every library in the waiting room (`workspaceExports.ts`) checked for a screen;
6. which release-gate workflows this evidence touches, and which it deliberately does not move;
7. the complete A-task list with its state (187 items).

**Honest scope.** The new browser audit (`e2e/ai3-report-audit.spec.ts`) proves the *empty state* of each
report: it draws, it fits a phone, it holds in right-to-left layout and it has no serious accessibility
finding. It does **not** prove any figure. Figures are proved by the worked-figure tests named in the tables
(`israel-month-journey`, `us-quarter-journey`, `close-journey`, the golden fixtures, and each report's own
unit tests). Passing this audit is not a statement that a report is filing-ready.

## 1. Checks run on this revision

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | clean |
| ESLint | `npm run lint:eslint` | 0 errors, 210 warnings (cap 210, unchanged) |
| Production build | `npm run build` | passes |
| Unit + component suite | `npm test` | see the CI block below |
| Browser audit | `npx playwright test e2e/ai3-report-audit.spec.ts` | 29 tests (27 report tabs + Loans + Petty cash), green on GitHub CI shards 1/2 and 2/2 (no browser binary in this sandbox; see the history table) |
| New browser audit, static check | `npx tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target esnext --lib DOM,DOM.Iterable,ESNext --types node --esModuleInterop e2e/ai3-report-audit.spec.ts` | clean (the repository's `tsconfig.json` includes only `src` and `server.ts`, so the browser specs need their own check) |
| Full unit suite (local, this sandbox) | `npm test` | 2,930 tests: 2,929 pass, 0 fail, 1 skipped (needs `LF_TEST_DATABASE_URL`); 731 suites; 27m44s |

### The browser audit's own history (nothing hidden)

| Attempt | What happened | What was done |
|---|---|---|
| PR #190 CI run 39288681099, shard 1/2 | One test failed: the check for the word `undefined` matched **prose** — Gross Profit by Customer explains "margin percent = margin ÷ sales, undefined when sales are zero" | The token check now looks for `undefined` only inside table cells; `NaN`, `Infinity` and `Invalid Date` stay whole-region checks. The same run's "Playwright E2E Smoke Suite" failure was only its roll-up step ("require every shard to succeed"), not a separate failure |
| PR #190 CI run 39291426442, shard 1/2 | Ten tests stopped on `ReferenceError: report is not defined` — a variable name left over from an edit, which the repository typecheck did not catch because `tsconfig.json` does not include `e2e/` | The name is now the destructured `selector`; the spec is typechecked with its own `tsc` command (row above). The other 17 tests already reached the axe, overflow and right-to-left checks and passed |
| **Run 39294040889** at `3935984` (report tabs only) | **All green:** Lint/Typecheck/Test (with `test:rules` on a real Postgres, every migration applied), unit tests in America/Los_Angeles and Pacific/Auckland, Browser shard 1/2 and 2/2, Playwright E2E Smoke Suite, production build. 27 report tests × 4 checks + 81 screenshots attached to the run | — |
| **Run 39296559701** at `8befe52` (report tabs + Loans and Petty cash screens) | **All seven jobs green**, both browser shards | — |
| **Final run 39299198528** at `b91b20b` (this pack's own text) | **All seven jobs green**, both browser shards | final head for review |

## 2. Report screens this lane built (the tab a user opens)

Every row is a report tab on **Reports**. `id` is the address parameter (`/?report=<id>#reports`), which is
how a shared link opens it and how the browser audit reaches it. The browser spec
`e2e/ai3-report-audit.spec.ts` covers **27 reports** — each one opened at 390 px and then in right-to-left
layout, with an axe scan of the report's own region for serious/critical findings and a check that no
`NaN`, `Infinity`, `Invalid Date` is printed in the report and no table cell reads `undefined`.

| Report tab (id) | Component | Pure library | Unit/component tests | Browser spec |
|---|---|---|---|---|
| customer-credit-limits | CustomerCreditLimitReportView | `src/lib/customerCreditLimits.ts` | `customer-credit-limits-view.test.tsx` | `ai3-report-audit.spec.ts` |
| customer-quotes | CustomerQuotesReportView | `src/lib/customerQuotes.ts` | `customer-quotes-view.test.tsx` | `ai3-report-audit.spec.ts` |
| customer-tax-certificates | CustomerTaxCertificatesView | `src/lib/taxExemption.ts`<br>`src/lib/tax/usExemptionCertificates.ts` | `customer-tax-certificates.test.tsx` | `ai3-report-audit.spec.ts` |
| delivery-notes | DeliveryNotesReportView | `src/lib/deliveryNoteDocument.ts` | `delivery-notes-view.test.tsx` | `ai3-report-audit.spec.ts` |
| dunning-letters | DunningLettersReportView | `src/lib/dunningLetters.ts` | `dunning-letters-view.test.tsx` | `ai3-report-audit.spec.ts` |
| golden-tax-fixtures | GoldenTaxFixturesReportView | `src/lib/goldenTaxFixtures.ts` | `golden-fixtures-view.test.tsx` | `ai3-report-audit.spec.ts` |
| cycle-count | CycleCountReportView | `src/lib/cycleCounts.ts`<br>`src/lib/barcodeScan.ts`<br>`src/lib/cycleCountApi.ts` | `cycle-count-view.test.tsx`<br>`warehouse-operations-view.test.tsx` | `ai3-report-audit.spec.ts` |
| il-month-journey | IsraelMonthJourneyReportView | `src/lib/israelMonthJourney.ts` | `israel-month-journey-view.test.tsx` | `ai3-report-audit.spec.ts` |
| landed-cost-preview | LandedCostPreviewReportView | `src/lib/landedCostPreview.ts`<br>`src/lib/barcodeScan.ts` | `landed-cost-preview-view.test.tsx` | `ai3-report-audit.spec.ts` |
| milestone-billing | MilestoneBillingReportView | `src/lib/milestoneBilling.ts` | `milestone-billing-view.test.tsx` | `ai3-report-audit.spec.ts` |
| purchases-from-abroad | ImportServicesReportView | `src/lib/tax/ilImportServices.ts` | `import-services-view.test.tsx` | `ai3-report-audit.spec.ts` |
| quote-versions | QuoteVersionsReportView | `src/lib/quoteVersions.ts` | `quote-versions-view.test.tsx` | `ai3-report-audit.spec.ts` |
| record-notes | RecordNotesReportView | — | `record-notes-view.test.tsx` | `ai3-report-audit.spec.ts` |
| reorder-suggestions | ReorderSuggestionsReportView | `src/lib/reorderSuggestions.ts` | `reorder-suggestions-view.test.tsx` | `ai3-report-audit.spec.ts` |
| sales-tax-holidays | SalesTaxHolidaysReportView | `src/lib/tax/usSalesTaxHolidays.ts` | `sales-tax-holidays-view.test.tsx` | `ai3-report-audit.spec.ts` |
| serial-lot-lookup | SerialLotLookupReportView | — | `serial-lot-lookup-view.test.tsx` | `ai3-report-audit.spec.ts` |
| rule-pack-coverage | RulePackCoverageReportView | `src/lib/rules/coverage.ts` | `rule-coverage-view.test.tsx` | `ai3-report-audit.spec.ts` |
| us-quarter-journey | UsQuarterJourneyReportView | `src/lib/usQuarterJourney.ts` | `us-quarter-journey-view.test.tsx` | `ai3-report-audit.spec.ts`<br>`tax-journeys-browser.spec.ts` |
| use-tax-review | UseTaxReportView | `src/lib/tax/usUseTax.ts`<br>`src/lib/tax/usStateSalesTax.ts` | `us-use-tax-view.test.tsx` | `ai3-report-audit.spec.ts` |
| slow-moving-stock | SlowMovingStockView | — | `slow-moving-stock-ui.test.tsx` | `ai3-report-audit.spec.ts` |
| profitability-by | ProfitabilityByView | `src/lib/projectProfitability.ts` | — | `ai3-report-audit.spec.ts` |
| vendor-scorecard | VendorScorecardReportView | `src/lib/vendorScorecard.ts` | `vendor-scorecard-view.test.tsx` | `ai3-report-audit.spec.ts` |
| vendor-price-history | VendorPriceHistoryReportView | `src/lib/vendorPriceHistory.ts` | `vendor-price-history-view.test.tsx` | `ai3-report-audit.spec.ts` |
| by-label | LabelProfitReportView | — | `by-label.test.tsx` | `ai3-report-audit.spec.ts` |
| blanket-orders | BlanketOrdersReportView | `src/lib/blanketOrders.ts` | `blanket-orders-view.test.tsx` | `ai3-report-audit.spec.ts` |
| form-856 | Form856ReportView | — | `form-856-view.test.tsx` | `ai3-report-audit.spec.ts` |
| gross-profit-by-customer | CustomerGrossProfitView | — | — | `ai3-report-audit.spec.ts`<br>`everyday-reports.spec.ts` |
| purchase-trends | PurchaseItemTrendsView | — | `purchase-item-trends.test.tsx` | `everyday-reports.spec.ts` |

## 3. Panels this lane built outside the Reports tab

| Where | Component | Pure library | Tests | Browser |
|---|---|---|---|---|
| Month-End Close → **Compare month** | `src/components/ledger/CloseComparisonPanel.tsx` | `src/lib/closeComparison.ts` | `close-comparison.test.ts`, `close-comparison-ui.test.tsx` | `month-end-close-journey.spec.ts` |
| Month-End Close → **Workpapers** | `src/components/ledger/WorkpapersPanel.tsx` | `src/lib/workpapers.ts` | `workpapers.test.ts`, `workpapers-ui.test.tsx` | `month-end-close-journey.spec.ts` |
| Month-End Close → **Close journey** | `src/components/ledger/CloseJourneyPanel.tsx` | `src/lib/closeJourney.ts` | `close-journey.test.ts` (7), `close-journey-panel.test.tsx` (5) | `month-end-close-journey.spec.ts` |
| Data Health → **Since when don't the books balance?** | `src/components/ledger/ClosingBalanceCheck.tsx` | `src/lib/balanceBreak.ts` | `balance-break.test.ts` | `forensics-and-audit.spec.ts` |
| Ledger → chart of accounts → **account groups** | `src/components/ledger/AccountGroupControls.tsx` | `src/lib/accountGroups.ts` | `account-groups.test.ts` (23), `account-groups-ui.test.tsx` (10) | `chart-comforts.spec.ts` |
| Month-End Close → loans | `src/components/finance/LoansView.tsx` | `src/lib/loans.ts`, `src/lib/loanSchedule.ts` | `loans.test.ts`, `loans-view.test.tsx` | `accounting-lifecycle.spec.ts` |
| Month-End Close → petty cash | `src/components/finance/PettyCashView.tsx` | `src/lib/pettyCash.ts` | `petty-cash.test.ts`, `petty-cash-view.test.tsx` | `accounting-lifecycle.spec.ts` |
| Inventory → warehouse operations | `src/components/reporting/CycleCountReportView.tsx`, `WarehouseBinLocationsPanel.tsx`, `PickPackShipPanel.tsx`, `ReturnAuthorizationsPanel.tsx` | `src/lib/warehouseWorkflows.ts`, `warehouseRecords.ts`, `cycleCounts.ts` | `warehouse-metadata-persistence.test.ts`, `warehouse-operations-view.test.tsx`, `cycle-counts.test.ts` | `warehouse-operations.spec.ts` |
| Settings → **Custom fields** | `src/components/platform/settings/CustomFieldsSettings.tsx` | `src/lib/customFields.ts` | `custom-fields-settings.test.tsx` | `report-settings-words.spec.ts` |
| Settings → **Price lists** / **Price list import** | `src/components/platform/settings/PriceListsSettings.tsx`, `PriceListImportView.tsx` | `priceListImport.ts` | `price-lists.test.tsx` | `view-registry-coverage.spec.ts` |
| Customer portal → open quotes with Accept | `src/components/sales/CustomerPortalPage.tsx` | `src/lib/customerQuotes.ts`, `proposals.ts` | `customer-quotes.test.ts`, `customer-quotes-view.test.tsx` | no spec of its own (the accept page is exercised in component tests; server token generation is AI #1's) |
| Item form / record pages → **notes** | `src/components/common/RecordNotesPanel.tsx` | `src/lib/recordNotes.ts`, `commentThreads.ts` | `record-notes-and-custom-fields.test.ts`, `record-notes-view.test.tsx` | `record-details.spec.ts` |

## 4. Partial tasks: the one step that remains, and whose step it is

These are the `[~]` items in this queue. Each is partial for one reason only; the rest of the task is on a
screen and tested. Nothing here is silently claimed as done.

| Task | What is already on a screen | The step that remains | Owner of that step |
|---|---|---|---|
| **A-19** Item bundles | Item can be a bundle; bundle contents in the item screens | The bundle must expand into component lines inside the invoice/bill form — `InvoiceModal.tsx` is reserved | AI #1 (reserved document forms); screen task C-128 is AI #2 |
| **A-32** Units on items | Units of measure per item, conversions shown | Showing the converted quantity on a document line lives in the reserved forms | AI #1 |
| **A-33** Serial and lot numbers | Lookup report, lots, duplicates, CSV | Recording a serial/lot on a receipt or invoice line lives in the reserved forms | AI #1 |
| **A-66** Return authorisations | RMA document, approval screen, receive/link, closure rules | Server-enforced transitions and a revision (CAS) for two-person approval; today only the screen and metadata notes enforce it | AI #1 (server transition contract) |
| **A-69** Customer credit limits | Limit per customer, over-limit report, in-place edit | The warning inside the invoice form (`InvoiceModal.tsx`, reserved) | AI #1 |
| **A-70** Dunning letters | Three-step letters, preview, CSV, nothing sent | Actually sending through the email path and writing the once-per-step log (server) | AI #1 |
| **A-203** Accessibility | Warehouse panels (16 Oct) | **Closed:** all 27 report tabs scanned with axe over their own region, green on CI `39294040889`; every screen is also covered by `layout.spec.ts` at 1280 px | AI #3 (done) |
| **A-204** Phone at 390 px | Warehouse panels at 390 and 320 (16 Oct), Close journey at 390 | **Closed:** all 27 report tabs at 390 px, green on CI `39294040889` | AI #3 (done) |
| **A-205** Hebrew / right-to-left | Warehouse panels with Hebrew branding (16 Oct) | **Closed:** the 27 report tabs are green in a right-to-left page, and the **Loans** and **Petty cash** screens get the same 390 px pass with axe over the screen (`#main-content`); green on CI `39299198528` | AI #3 (done) |
| **A-208** Reconcile partial tasks | This table | Closed by this pack: every `[~]` item now names its remaining step and owner (the only two left in this lane are A-205's two panels and the five items blocked on AI #1) | AI #3 (done here) |

## 5. A-207: the waiting room, checked library by library

`src/lib/workspaceExports.ts` exists so that a finished library is not lost while its screen is being built.
It is a waiting room, not a finish line, so every module it exports was traced to a screen at this revision
(directly, or through another library that a registered screen imports):

**50 modules exported. 45 are reached from a screen. 5 are still waiting, and each one is a Codex screen
task in the current queue:**

| Waiting module | Screen task that will reach it |
|---|---|
| `src/lib/tax/entityFilings.ts` | C-115 |
| `src/lib/tax/israeliDocumentTypes.ts` | C-117 |
| `src/lib/tax/taxSuggestions.ts` | C-120 |
| `src/lib/tax/vatNumberFormat.ts` | C-125 |
| `src/lib/usAddressStateZip.ts` | C-126 |

No library was deleted. Every library this lane built for a task that has a screen (credit limits, quotes,
proposals, delivery notes, dunning, cycle counts, barcode scan, serial numbers, record notes, comments,
custom fields, reorder suggestions, vendor scorecard, price lists, landed cost, milestone billing, use tax,
exemption certificates, rule coverage, the three journeys, the golden fixtures) is reached from that screen.

## 6. Release gate

| Workflow | What this lane adds | Does the column move? |
|---|---|---|
| **W7** Israel VAT month | A-152 journey on Reports, A-198 whole golden year, browser coverage of the journey's empty and filled states | No — the PCN874 step is still a historical draft and CON-3/CON-4 remain open |
| **W8** US quarter | A-153 journey, A-199 whole golden year, browser coverage | No — CON-1/CON-2 (the state return screens themselves) remain open |
| **W9** Month-end close | A-151 close journey panel, browser close/reopen test | Only AI #1 decides a column; the evidence is recorded |

## 7. What this pack does not claim

- The browser audit is an **empty-state** audit. It proves a report draws, fits, holds in RTL and has no
  serious accessibility finding. It says nothing about a figure with real records.
- No screen here files, signs, pays or closes anything. The PCN874 draft is explicitly not filing-ready, and
  the US return figures are the state base rate only.
- UK/EU/Canada tax packs remain calculation-only and parked under PLAN §15 (`[P]`); no rate was invented.
- A passing run of this spec is not permission to invite testers; `docs/FIRST_TESTERS_GATE.md` decides that.

## 8. The complete A-task list

State is the queue's own state at this revision: **Done** (ticked with its evidence note in
`docs/COORDINATION.md`), **Partial** (the table above), **Open** (not started, parked, or owned by another
lane).

| Task | Status | Title |
|---|---|---|
| A-1 | Done | R-09 Close comparison |
| A-2 | Done | K-30 Loans with amortisation |
| A-3 | Done | K-31 Petty cash |
| A-4 | Done | CA-34 Since when don't the books balance? |
| A-5 | Done | K-14 Account groups (sub-accounts) |
| A-6 | Done | BD-04 Workpapers |
| A-7 | Done | CA-16 Item tax template |
| A-8 | Done | X-06 + X-07 Asset maintenance log and asset tags |
| A-9 | Done | W-09 Inventory aging and slow-moving items |
| A-10 | Done | DA-05 What works today: one truth table |
| A-11 | Done | DA-06 Workflow pages for the main path |
| A-12 | Done | CB-25 Report by label |
| A-13 | Done | CB-08 Profitability by customer, item or project |
| A-14 | Done | CB-17, CB-18, CB-19 Received-not-billed, billed-not-received, ordered-not-received |
| A-15 | Done | V-07 Project budget against actual |
| A-16 | Done | BF-02 Customer price overrides |
| A-17 | Done | Y-19 Print stylesheet |
| A-18 | Done | Recurring estimates |
| A-19 | **Partial** | Item bundles |
| A-20 | Done | Purchase trends by item |
| A-21 | Done | Comments on customers and projects |
| A-22 | Done | US state sales tax table |
| A-23 | Done | Form 856 report (Israel) |
| A-24 | Done | Canada GST/HST/PST table |
| A-25 | Done | EU VAT standard and reduced rates table |
| A-26 | Done | UK VAT rates table |
| A-27 | Done | US state nexus thresholds table |
| A-28 | Done | US state sales tax filing frequencies and due dates table |
| A-29 | Done | Israel VAT special areas table |
| A-30 | Done | Item tax categories |
| A-31 | Done | US state product taxability table |
| A-32 | **Partial** | Commodities / units on items |
| A-33 | **Partial** | Serial and lot numbers |
| A-34 | Done | Consignment stock list |
| A-35 | Done | Proposals |
| A-36 | Done | Notes on any record |
| A-37 | Done | Custom fields |
| A-38 | Done | Tables become rule packs (PLAN §10) |
| A-39 | Done | Registration thresholds as rules |
| A-40 | Done | US local rates as rule packs |
| A-41 | Done | Marketplace facilitator rules |
| A-42 | Done | Digital goods and SaaS taxability |
| A-43 | Done | Israeli withholding default rates |
| A-44 | Done | Purchase requisitions |
| A-45 | Done | Inventory cycle counts |
| A-46 | Done | Delivery notes |
| A-47 | Done | Vendor scorecard |
| A-48 | Done | Price lists per currency |
| A-49 | Done | Customer quote acceptance list |
| A-50 | Done | Reorder suggestions |
| A-42 | Done | Digital goods and SaaS taxability |
| A-43 | Done | Israeli withholding default rates |
| A-44 | Done | Purchase requisitions |
| A-45 | Done | Inventory cycle counts |
| A-46 | Done | Delivery notes |
| A-47 | Done | Vendor scorecard |
| A-48 | Done | Price lists per currency |
| A-49 | Done | Customer quote acceptance list |
| A-50 | Done | Reorder suggestions |
| A-51 | Done | Canada provincial filing calendar |
| A-52 | Done | EU reverse-charge rules |
| A-53 | Done | UK VAT special schemes |
| A-54 | Done | US use tax rules |
| A-55 | Done | US exemption certificate types |
| A-56 | Done | Israeli VAT on imports and services from abroad |
| A-57 | Done | Israeli VAT reporting frequency |
| A-58 | Done | Sales tax holidays |
| A-59 | Done | Rule pack source checker |
| A-60 | Done | Rule pack diff report |
| A-61 | Done | Quote versions |
| A-62 | Done | Blanket purchase orders |
| A-63 | Done | Landed cost preview |
| A-64 | Done | Bin locations |
| A-65 | Done | Pick, pack and ship lists |
| A-66 | **Partial** | Return authorisations (RMA) |
| A-67 | Done | Warranty tracking |
| A-68 | Done | Subscription plans list |
| A-69 | **Partial** | Customer credit limits |
| A-70 | **Partial** | Dunning letters |
| A-71 | Done | Vendor price history |
| A-72 | Open | Customer statements by entity |
| A-73 | Done | Project milestones billing view |
| A-74 | Done | Expense policy checks |
| A-75 | Open | Mileage claims |
| A-76 | Open | Per diem tables |
| A-77 | Open | Document templates per entity |
| A-78 | Open | Item images |
| A-79 | Done | Barcode scanning for items |
| A-80 | Done | Import price lists from CSV |
| A-99 | Open | Israel: Eilat VAT-exempt area facts and rule |
| A-100 | Open | Israel: osek patur yearly threshold history (validFrom per year) |
| A-101 | Open | Israel: advance income-tax payment (mikdamot) rate field per entity and a reminder calendar |
| A-102 | Open | Israel: National Insurance (Bituach Leumi) self-employed rate table by income band (calculation status) |
| A-106 | Done | US 1099-NEC/MISC thresholds by year, including the 2026 change |
| A-107 | Open | US federal per diem (GSA) table import for A-76 |
| A-108 | Open | US mileage rate table by year (IRS standard mileage) for A-75 |
| A-109 | Open | Sales-tax holiday calendar for the states that have them (A-58 data) |
| A-110 | Done | Tax rule pack linter: every Rule has id, validFrom, source URL, status; CI fails otherwise |
| A-111 | Done | Rule pack coverage report: which countries/states have rate, nexus, filing and threshold rules; a screen for AI #1 |
| A-112 | Open | Inventory: serial numbers per item (capture on receipt, show on delivery note) |
| A-113 | Open | Inventory: lot numbers and expiry dates, with an expiring-lots report |
| A-114 | Open | Inventory: stock transfers between locations (document + report; postings stay AI #1's) |
| A-115 | Open | Inventory: minimum/maximum per location feeding reorder suggestions |
| A-116 | Open | Inventory: kits assembled on demand (uses A-19 bundles) |
| A-117 | Open | Inventory: stock valuation report by location and lot |
| A-118 | Done | Purchasing: three-way match check (PO, receipt, bill) as a review report |
| A-119 | Open | Purchasing: vendor quotes compare screen (several vendors per item) |
| A-120 | Open | Purchasing: approval thresholds per amount for purchase orders |
| A-121 | Open | Sales: back-order release list when stock arrives |
| A-122 | Open | Sales: customer-specific item codes |
| A-123 | Open | Sales: commission plans by item group (data + report) |
| A-124 | Open | Sales: shipping methods and rates table |
| A-125 | Open | Projects: timesheet approval queue |
| A-126 | Open | Projects: project templates (tasks, budgets) |
| A-127 | Open | Projects: retention (holdback) tracking on milestone bills (report only) |
| A-128 | Open | Fixed assets: asset disposal register (report; postings AI #1) |
| A-129 | Open | Fixed assets: asset transfers between locations |
| A-130 | Open | Fixed assets: maintenance schedule and log |
| A-131 | Open | Documents: Hebrew/English document numbering rules per entity and series |
| A-132 | Open | Documents: e-mail templates per document type and language |
| A-133 | Done | Expenses: receipt capture checklist (missing receipt report by employee) |
| A-134 | Open | Expenses: corporate card statement import to expense claims (CSV) |
| A-135 | Done | Contacts: duplicate-contact finder across entities |
| A-136 | Open | Contacts: contact roles (billing, shipping, accounts payable) per company |
| A-137 | Open | Banking data: bank holiday calendars (US, IL, UK, EU) for due-date moves |
| A-138 | Open | Banking data: Israeli bank and branch code table |
| A-139 | Open | Banking data: US routing number checksum and IBAN validator per country |
| A-140 | Open | Reports: aged inventory by lot |
| A-141 | Done | Reports: purchase price variance by vendor |
| A-142 | Done | Reports: sales by territory (uses a Location label) |
| A-143 | Done | Reports: customer lifetime value (library + report) |
| A-144 | Done | Compliance: record-retention periods by country (IL 7 years, US 7, UK 6) as a table and a report of documents due for review |
| A-145 | Open | Compliance: data-export pack for an auditor (list of what goes in; AI #1 builds the export) |
| A-146 | Done | Golden test set: 50 real-world-shaped invoices across IL/US/UK/EU with expected tax per line (fixtures for AI #1's tax engine) |
| A-147 | Done | Golden test set: 30 purchase bills with withholding cases (IL) and 1099 cases (US) |
| A-148 | Open | Fixture generator: a realistic small business year (12 months of documents) for performance tests |
| A-149 | Open | Help text: plain-language help for every screen you added (screenHelp), English and Hebrew |
| A-150 | Open | Journey: first hour — e2e that signs up (guest), sets company details, picks a chart of accounts, imports a sample bank CSV, makes and sends a first invoice, opens the P&L; fix eve |
| A-151 | Done | Journey: month-end close checklist screen — reconcile each bank, uncategorised entries, open bills/invoices, accruals reminder, lock month, report pack; each step links to its scre |
| A-152 | Done | Journey: Israeli month — one path from invoice with allocation number to VAT report to PCN874 file to month close, with a checklist screen (P2-3) |
| A-153 | Done | Journey: US quarter — sales tax by state → return screens → 1099 preview → quarter close checklist (P2-4) |
| A-154 | Open | Journey: migration — QuickBooks/Xero/CSV import → source vs LedgerFlow totals table (trial balance, A/R, A/P, cash) → 'you are ready' (P2-6, AU-4 screen) |
| A-155 | Open | Journey: accountant queue — one screen listing what needs an accountant (questions, approvals, adjustments, locked-period requests) with links (P2-7) |
| A-164 | Open | Israel: VAT on services to foreign residents (zero-rated conditions) as facts + rule, status calculation |
| A-165 | Open | Israel: withholding on payments abroad (Form 2513/2) — research note and table |
| A-166 | Open | US: state nexus thresholds verification pass — every state row has a source link checked this month |
| A-168 | Open | Manufacturing light: bill of materials on an item (components and quantities), with a 'can we build N?' check |
| A-169 | Open | Manufacturing light: work order screen (build N kits: components reserved, finished goods shown; posting stays AI #1's) |
| A-170 | Done | Inventory: landed cost screen on receipts (A-63 library) — preview only, posting via AI #1 |
| A-171 | Done | Inventory: barcode scanning wired into count sheets and receipts (A-79 library) |
| A-172 | Done | Inventory: delivery notes printable from the invoice and sales order screens (A-46 library), EN/HE |
| A-173 | Done | Inventory: reorder suggestions screen with 'create draft purchase orders' (A-50 library) |
| A-174 | Done | Purchasing: price-list CSV import screen (A-80 library) with preview and error rows |
| A-175 | Done | Sales: quote acceptance list wired to the customer portal accept link (A-49 library) |
| A-176 | Done | Sales: dunning letters screen with preview and the 7/21/45-day schedule (A-70, FOR_YOU 48) |
| A-177 | Done | Projects: milestone billing screen on a project (A-73 library) |
| A-178 | Open | Projects: profitability by project with budget vs actual chart (uses existing reports) |
| A-179 | Open | Projects: resource view — who logged time on which project this month |
| A-180 | Open | Contacts: activity timeline per customer (invoices, payments, emails, notes) on the customer page |
| A-181 | Done | Contacts: customer notes with @mentions to team members (notification only) |
| A-182 | Open | Contacts: import contacts from vCard / Google CSV with duplicate check |
| A-183 | Open | Documents: attach files to any entry/document with drag-and-drop and preview |
| A-184 | Done | Documents: document number gaps report (missing numbers in each series) |
| A-185 | Open | Documents: credit note from invoice in one click (draft; posting AI #1) |
| A-186 | Done | Reports: cash forecast 13 weeks from open invoices, bills and recurring items (read-only) |
| A-187 | Open | Reports: aged receivables by salesperson |
| A-188 | Done | Reports: vendor 1099 readiness report (missing TIN, W-9, address) |
| A-189 | Open | Reports: Israeli annual summary per customer/vendor (for the accountant) |
| A-190 | Open | Reports: top 20 customers and vendors with trend sparkline |
| A-191 | Open | Reports: expense by employee (expense claims) with receipt status |
| A-192 | Open | Reports: inventory turnover by item |
| A-193 | Open | Reports: gross margin by item group over time |
| A-194 | Open | Data quality: entries without labels where a label is required (uses requiredLabels) |
| A-195 | Done | Data quality: duplicate bills finder (same vendor, amount, date ±3 days) |
| A-196 | Open | Data quality: customers/vendors missing tax IDs or addresses needed for filings |
| A-197 | Open | Data quality: items without cost or price |
| A-198 | Done | Golden fixtures: a full Israeli small business year (VAT bi-monthly) with expected VAT reports |
| A-199 | Done | Golden fixtures: a full Texas business year with expected sales-tax returns |
| A-201 | Open | Help: plain-language help (EN/HE) for every report on the Reports tab that has none |
| A-202 | Open | Help: 'what does this number mean?' explanations for the 10 main report totals |
| A-203 | **Partial** | Accessibility: every report you built passes axe with no serious issues; fix what fails |
| A-204 | **Partial** | Phone: every report you built is usable at 390px (table scroll, filters fold) |
| A-205 | **Partial** | Hebrew: every screen you built shown in Hebrew documents mode; fix reversed numbers/dates |
| A-206 | Open | Performance: your five heaviest reports load under 1 s on the 12-month fixture (A-148) |
| A-207 | Open | Cleanup: remove any of your libraries still not reachable from a screen after their screen task, or wire them |
| A-208 | **Partial** | Cleanup: tick or close every [~] A-task above with what is missing written down |
| A-209 | Open | Review pack: one PR at the end listing every A-task with a screenshot of its screen (for the owner) |
