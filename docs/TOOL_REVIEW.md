# LedgerFlow: tool-by-tool review and comparison

Reviewed against the implemented code and automated evidence, not the README or menu names. Initial baseline: main `5bce9cb`, including merged C-13, plus the Codex screen-comforts and contextual-workflow branches. Integration update: main `9f464ad` includes Claude’s completed tax/sticky-total handoffs and shared InlineEdit refusal fix; historical findings below identify that resolution explicitly. This is an internal product/engineering review, not a claim that LedgerFlow beats every version of QuickBooks, Sage, Xero or an ERP. Established products often have mature equivalents. The comparison is with common older workflows: separately maintained spreadsheets, manual exports, desktop-only navigation, duplicate data entry and disconnected add-ons. A benefit applies when the user's current system requires those extra steps.

**Evidence labels:** implemented = a concrete code path exists; tested = the named automated test covers part of that path; operational = needs a configured external service and live acceptance. A passing mocked test is not operational proof. Financial features still need jurisdiction/business-specific acceptance before relying on them.

## 70 useful capabilities and where the advantage comes from

Paths below are relative to the repository. Test filenames refer to `src/tests/` unless prefixed `e2e/`. Each row describes the actual capability and a practical comparison, not guaranteed superiority over a named vendor.

| # | Actual capability | Practical benefit over the older/manual workflow | Implementation and evidence | Limit |
|---|---|---|---|---|
| 1 | Shared double-entry posting for financial documents | Avoids separately updating invoices and ledger entries | `src/services/LedgerPostService.ts`, `src/services/ledgerPost/`; `golden-path-ledger.test.ts`, `integration-ledger.test.ts` | Use this path; a new direct write can break the guarantee |
| 2 | Server validation of balanced journal entries | Catches invalid entries before persistence | `src/server/routes/transactions/`; `validation-guard.test.ts`, `property-invariants.test.ts` | Validation is more than a UI success toast |
| 3 | Role-based write restrictions | Browser users cannot gain write rights by revealing a button | `src/server/auth/`, transaction routes; `server-write-roles.test.ts`, `rbac-invites.test.ts` | Requires correct policies for every added collection/route |
| 4 | Workspace-scoped database access | Separates companies without separate desktop files | `src/server/db/`, `supabase/migrations/`; `pg-firestore.test.ts`, RLS suite | Test cross-workspace records as well as queries |
| 5 | Period locks and close checks | Reduces accidental edits to closed books | `periodCloseService.ts`, `periodRoutes.ts`; `period-close.test.ts` | New mutation paths must retain the lock guard |
| 6 | Reverse-and-correct workflows | Keeps a trace of correction instead of silently replacing history | `src/server/routes/transactions/reverseRoutes.ts`; `reverse-and-correct.test.ts` | Reversals must remain idempotent |
| 7 | Opening balances | Brings existing books into a new workspace | `openingBalanceService.ts`, `src/lib/openingBalances.ts`; `opening-balances.test.ts` | Import acceptance must check signed account nature |
| 8 | FX-aware posting | Keeps document and base-currency treatment in the same workflow | `FxService.ts`, posting modules; `fx-posting.test.ts`, `fx-rounding.test.ts` | External rates/configuration and transaction date still matter |
| 9 | Currency-specific display precision | Correctly displays currencies with different minor units | `src/lib/utils.ts`; `currency-decimal.test.ts`, `formatDecimal.test.ts` | CSV currently has a separate two-decimal contract; finding F3 below |
| 10 | Shared postable filtering | Keeps drafts/voids out of actual reports | `src/lib/txFilters.ts`; `postable-adoption-guard.test.ts` | Legacy secondary endpoints need the same discipline |
| 11 | Full-history server statements | Avoids treating a capped browser list as all company activity | `src/server/routes/reportRoutes.ts`; `report-routes.test.ts`, `truncation-guard.test.ts` | Server failure means a local fallback may be incomplete |
| 12 | P&L period columns | Removes repeated monthly export/reassembly | `src/lib/reportColumns.ts`, `StatementColumns.tsx`; `report-columns.test.ts`, `e2e/report-columns.spec.ts` | Current selected range is clipped |
| 13 | Balance-sheet closing-period columns | Shows snapshots without reusing P&L-style activity sums | Same helper plus pure `computeBalanceSheet`; hand-number tests | Opening and earlier activity must be retained |
| 14 | Percentage of income/assets | Removes spreadsheet ratio formulas per report row | `statementFigures`, `percentageOfTotal`; component/pure tests | Zero denominator is undefined and displayed as a dash |
| 15 | Comparative amount and percent variance | Shows changes beside current/previous amounts | `reportVariance`; hand-number/component/browser tests | Zero previous amount has no valid growth percentage |
| 16 | Fiscal-year-aware quarter bounds | Handles April-start businesses without manual quarter regrouping | `src/lib/fiscalCalendar.ts`, `reportColumns.ts`; leap/fiscal tests | Verify workspace calendar configuration |
| 17 | General ledger and account register | Connects balances to account activity in the same app | `computeReports.ts`, `AccountRegisterView.tsx`; `accountRegister.test.ts`, `account-register-view.test.tsx` | Drill-down can only show loaded detail unless fetched |
| 18 | Customer/vendor outstanding balances | Measures what remains due after payment/credit | `src/lib/aging.ts`, `src/server/reports/partyReports.ts`; `aging.test.ts`, `contact-reports.test.tsx` | Needs correct as-of date and FX |
| 19 | A/R and A/P aging | Avoids separate overdue spreadsheets | aging report views; `aging-views.test.tsx`, `e2e/accounting-lifecycle.spec.ts` | Business collection practice is not automated by the chart |
| 20 | Customer statements with credits | Presents balances and activity together | `StatementView.tsx`, statement helper; `statement-view.test.tsx`, `statement-credits.test.ts` | Bulk statement delivery is a separate workflow |
| 21 | Customer/vendor combined contact reports | Helps inspect both sides of a trading relationship | `ContactBalanceSummaryView.tsx`; `contact-balance-summary.test.tsx` | Matching/reporting does not authorize automatic debt offset |
| 22 | Item/reference-based report views | Finds document/item activity without assembling exports | `src/server/reports/itemReports.ts`, `referenceReport.ts` and registered views | Inspect the route and fixture for the report actually used |
| 23 | Safe shared CSV export | Preserves commas, hashes, quotes and Hebrew labels | `src/lib/csvExport.ts`; `csv-export.test.ts` | F3: currency exponent must be checked for exports |
| 24 | Shareable report/list dates and filters | Shares a reproducible view instead of screenshots | `reportPermalink.ts`, `listPermalink.ts`; `list-permalink.test.ts`, report tests | URLs do not grant workspace access |
| 25 | Page/report date synchronization | Avoids stale report requests after changing page dates | `usePageSyncedState.ts`; `report-date-sync.test.tsx` | New report components must use the synchronization contract |
| 26 | Estimates and conversion | Moves a quote to an invoice without retyping | Estimates view and entity operations; `estimate-conversion.test.ts`, `estimates-view.test.tsx` | Confirm desired status and ledger timing |
| 27 | Invoice item/SKU resolution | Links typed line items to catalogue data | `src/lib/invoiceLines.ts`; `invoice-lines.test.ts` | Free text remains an unlinked line |
| 28 | Payments and allocations | Applies receipts to outstanding invoices in one flow | `paymentService.ts`, receive-payment modal; `allocation.test.ts`, `receive-payment-modal.test.tsx` | Repeated or over-allocated requests need server refusal |
| 29 | Atomic payment persistence | Avoids a paid document with a failed/missing ledger entry | `paymentService.ts`; `payment-atomicity.test.ts` | Test real transaction adapter behavior too |
| 30 | Credit notes/vendor credits | Retains credit allocation and posting history | credit posting/service modules; `credits.test.ts`, party-action tests | Not every refund/payment-run integration is established |
| 31 | Customer deposits | Separates prepayments and application to invoices | `depositService.ts`; `deposits.test.ts`, `invoice-deposit.test.ts` | Requires the correct liability account |
| 32 | Bad-debt write-off and reversal | Tracks a later recovery without manual ledger repair | `badDebtService.ts`, write-off modal; `period-close.test.ts`, `write-off-modal.test.tsx` | Accounting policy/jurisdiction acceptance remains necessary |
| 33 | Purchase orders | Reduces retyping between purchasing documents | PurchaseOrders view and conversion helpers; `purchase-orders.test.ts` | Requisition/approval/three-way matching depth is separate |
| 34 | Recurring jobs | Generates expected entries through a service path | `recurringService.ts`, cron routes; `recurring-job.test.ts` | Deployment scheduler/auth and retries need operational checks |
| 35 | Document PDF generation | Avoids manually recreating invoice output | `pdfService.ts`, document routes; `pdf-generation.test.ts`, `document-pdf-route.test.ts` | Branding and script/font layout need representative outputs |
| 36 | Invoice public page/payment entry | Makes a specific document reachable outside the workspace | public-invoice routes/page; `public-invoice-page.test.tsx`, Hebrew companion | Token rules are not a complete customer portal |
| 37 | Mail/reminder service paths | Consolidates reminders with document data | `documentEmailService.ts`, `reminderService.ts`; `emails.test.ts`, `reminders-job.test.ts` | Operational mail requires configured credentials/provider |
| 38 | Invoice-linked COGS stock movement | Connects sales ledger and quantity changes atomically | `cogsStockService.ts`, `src/services/invoiceCogs.ts`; COGS/stock tests | Missing items and negative stock have warning paths |
| 39 | Stock adjustments and counts | Provides controlled quantity correction | `stockAdjustmentService.ts`, inventory dialogs; `stock-adjustments.test.ts`, `stock-dialogs.test.tsx` | Do not claim serial/lot/location tracking from this alone |
| 40 | Direct stock-quantity protection | Prevents a browser item edit from bypassing the stock workflow | quantity-protection migration; RLS tests | All future endpoints must retain it |
| 41 | Stock reversal once | Reduces duplicate restoration of quantity on retry | `prepareStockMoves`; invoice COGS/adjustment tests | Cross-workspace and repeated targets must be tested |
| 42 | Fixed-asset/depreciation workflow | Avoids a disconnected depreciation schedule spreadsheet | `depreciationService.ts`, asset views; `period-close.test.ts` | Specific methods and statutory handling require acceptance |
| 43 | Tax codes with parts/compounding | Reuses document rules instead of form-specific formulas | `src/lib/taxCodes.ts`, `documentMath.ts`; `tax-codes.test.ts`, `document-math-tax.test.ts` | Confirm actual tax jurisdiction definitions |
| 44 | Inclusive/exclusive tax treatment | Prevents a line price and invoice total from disagreeing | same helpers; document/tax tests | Legacy input migration is separate from arithmetic |
| 45 | Tax returns and reverse-charge boxes | Builds defined return figures from shared code | `taxReturnService.ts`; `tax-return.test.ts`, `tax-return-view.test.tsx` | Does not prove direct authority submission or every locale |
| 46 | Bank statement formats/import | Reduces bank-row entry by hand | format/import helpers, bank screens; `ofx.test.ts`, `integrations-formats.test.ts` | Verify source dates, currency and duplicate fingerprints |
| 47 | Record spreadsheet import previews | Reports row problems before saving customers/vendors/items/accounts | `src/lib/recordImport.ts`, `recordImportService.ts`; `record-import.test.ts` | Limits and transaction failure behavior matter |
| 48 | Hebrew spreadsheet headings | Recognizes mixed-language column names without renaming data | `HEBREW_HEADERS` in `recordImport.ts`; `hebrew-data.test.ts` | Not proof of every possible header synonym |
| 49 | Global optimal match suggestions | Avoids greedy matches stealing another row's better candidate | `algorithmInternals/optimization.ts`; `global-match.test.ts` | Suggestion still requires durable reconciliation action |
| 50 | Reconciliation service/history | Keeps confirmed matches in a durable workflow | reconcile routes and screen; `reconcile-endpoint.test.ts`, browser banking tests | Test unusual statement/reversal combinations |
| 51 | Persisted auto-rules | Saves matching rules and applies through API | `src/hooks/useAutoRules.ts`; `rules-saving.test.ts` | In-memory rule mutation alone is not enough |
| 52 | Natural-language entry/query tools | Speeds supported instructions without separate forms | `algorithms/nl-parser.ts`, command palette; `algorithms.test.ts`, Hebrew data tests | Parsing requires preview/validation; not unlimited understanding |
| 53 | Cross-dimension classification | Uses labels/classes/projects together | `cross-dimension-inference.ts`, dimension resolver; `deep-labeling.test.ts`, `dimension-identity.test.ts` | Preserve original identifiers and nested structure |
| 54 | Mixed-script merchant matching | Reduces false matches caused by stripping Hebrew characters | similarity/merchant-identity modules; `hebrew-data.test.ts` | Persistence hook still has F1; pure matching is narrower evidence |
| 55 | Query engine/directives | Filters complex conditions without a new export | `TransactionQueryEngine.ts`; `query-engine-matrix.test.ts` | UI interpretation summaries may have older ASCII patterns |
| 56 | Saved views | Reuses a working search/filter setup | saved-view store/bar; transaction-templates.test.ts | Workspace sharing/permissions need explicit behavior |
| 57 | Command palette across entities | Moves between related tools without menu hunting | `CommandPalette.tsx`; registry and browser navigation evidence | Loaded data search is not a full server search index |
| 58 | Record links | Opens a typed record in its correct screen | `src/lib/recordLinks.ts`, `useRecordFocus.ts`; `data-checks.test.ts` | A plain tab navigation is not equivalent |
| 59 | Data-health checks | Surfaces ledger/reference problems in one place | `src/lib/dataChecks.ts`, DataHealth view; `data-checks.test.ts`, forensic tests | Findings do not authorize silent financial repair |
| 60 | Audit log UI/formatting | Makes changes inspectable without database access | audit viewer and audit service; `audit-log-viewer.test.tsx`, `audit-format.test.ts` | Audit presence alone is not external certification |
| 61 | Anomaly/duplicate analytical tools | Adds investigative leads beyond a standard list | algorithm registry, anomaly/duplicate modules; `algorithms.test.ts`, `forensic-checks.test.ts` | Scores are not proof of error or fraud |
| 62 | Cash runway/liquidity stress tools | Runs explicit scenarios inside the workspace | `cash-runway.ts`, `liquidity-stress.ts`; algorithm tests | Depends on assumptions and data completeness |
| 63 | Monte Carlo forecast | Explores a distribution instead of one spreadsheet projection | `monte-carlo.ts`; algorithm tests | Model/seed/history quality matter; no guaranteed prediction |
| 64 | Budget/actual and profitability tools | Reuses ledger dimensions for operating analysis | `budget-vs-actual.ts`, `profitability-heatmap.ts` | Budget versions/phasing and full ledger coverage need review |
| 65 | Pure algorithm sandbox/registry | Adds a calculation with standardized controls and result shapes | `src/lib/algorithms/types.ts`, `index.ts`, ToolSandbox | Registration is not proof that a formula is correct |
| 66 | Lazy workspace collections | Avoids loading every module's data on workspace entry | `ledgerCollections.ts`, `useLedgerCollections.ts`; guard/workspace tests | Callers must request what they read and handle truncation |
| 67 | Native dialog/keyboard behavior | Supports keyboard navigation and predictable focus | `useDialog.ts`, native buttons; `use-dialog.test.tsx`, role/browser tests | Every new overlay/control still needs verification |
| 68 | Disabled-role action capture | Prevents keyboard/direct activation of restricted children | `RequireRole.tsx`; UI/browser role checks | Server authorization remains the final boundary |
| 69 | Quality, money and accessibility guards | Catches repeat mistakes before a change lands | ratchet, money-format, CSV, collection/dialog/key guards | Some guards are static heuristics, not full proofs |
| 70 | Backup/restore/retention service paths | Keeps data-management workflows near the business data | restore/retention/purge services; `backup-restore.test.ts`, `workspace-restore.test.ts`, `retention.test.ts` | A backup is useful only after a tested restore and access review |

## Concrete findings from reading the implementation

### F1 — Hebrew learned-pattern persistence can collide (high; reproduction confirmed by the key expression)

`src/hooks/useEntityOperations.ts`, `recordLearnedPattern`, uses `cleanDesc.replace(/[^a-z0-9]/g, '_')` for both `rulePatterns` and `learnedDeltas` document IDs. Different Hebrew-only labels of the same length collapse to the same underscore sequence: `שלום` and `תודה` both become `____`. The normalized search/classification algorithms are Unicode-aware, but this persistence boundary is not.

A follow-up needs a stable collision-resistant identity from the complete original/normalized comparison text, a compatibility/migration decision for existing keys, and an integration test that saving both Hebrew descriptions preserves two records. Do not change bank import fingerprints or overwrite existing learned history as a shortcut. The second producer in `src/hooks/transactionActions/postingHelpers.ts` uses the same transform; update both producers together with compatibility coverage. The hooks are outside the pure Hebrew algorithm tests.

### F2 — A secondary metrics endpoint diverges from the main report rules (high; code finding, targeted regression still needed)

`src/server/routes/metricsAuditRoutes.ts`, `/api/v1/metrics/summary`, adds raw `line.amountCents`, skips only `void`, tests account type `revenue`, and builds assets without opening balances. Main statements use `isPostable`, `lineAmount`, `income`/COGS and opening-balance handling through `computeReports.ts`. Draft entries, modern income accounts, FX and opening balances can therefore produce different answers between tools.

Claude owns server files. Reuse the approved shared functions in that lane, and add a hand fixture with cash opening balance 100.00, an `income` sale 20.00, a COGS expense 5.00 and a draft sale 99.00. Expected actual assets 115.00 and net income 15.00 before any other activity; add an FX case. Verify every metrics consumer's contract before changing field semantics.

### F3 — CSV and displayed currency precision have different contracts (medium; code reproduction)

`formatCurrency` uses the currency's fraction digits, while `csvMoney` delegates to `formatDecimal`, which divides by 100. For example `csvMoney(1234)` is `12.34`; the display treats 1234 minor units in a three-decimal currency as 1.234 and in a zero-decimal currency as 1234 whole units according to Intl. C-13 deliberately uses the required existing `csvMoney` contract rather than silently changing all exports.

A separately reviewed change should define CSV units/currency explicitly and test zero-, two- and three-decimal currencies across all export consumers. Include negative values, formula-safe quoting and a round trip; preserve financial stored values.

### F4 — Cached statement authorization/freshness needs an explicit policy (review question; do not infer a proven exploit)

In `reportRoutes.ts`, a cache hit is returned before `getReportContext()` revalidates workspace membership. Cache keys include requesting user and request query; TTL is 60 seconds. This does not imply cross-user cache sharing, but membership revocation can have a different freshness policy on a hit than on a miss. There is also a potential stale-report window after posting.

Decide the intended revocation/invalidation policy in the server lane. Add a cache-hit test after revoking membership and after a ledger write. Do not describe the report as immediately current until that policy is proven.

### F5 — The old generated status document is stale (confirmed)

`docs/STATUS.md` still marks period close, credit notes, bad debt, deposits, customer details and other features as missing or engine-only despite their current services/screens/tests. It is useful historical output, not the current readiness source. This review and `docs/TRACKER.md` should be reconciled by actual code evidence; future status generation needs a timestamp/commit and a reliable rule for end-to-end status.

### F6 — Command-palette search and record opening have distinct contracts (C-14 work)

Data-result actions previously used `switch-tab` payloads rather than a typed `openRecord` reference. C-14 now opens transactions, accounts, invoices and bills through typed links, scopes recent history by user/workspace, groups results and uses Unicode comparison. Its browser check also exposed two simultaneously mounted palettes; the duplicate is removed and the remaining palette is a named dialog. Recent records should subscribe to `focusRecord`/workspace transitions without editing Claude's reserved `useUIStore`/record-link implementation. Search grouping must not interfere with the natural-language execution path. Search remains based on loaded browser collections; it should not be marketed as complete history search.

### F7 — Report totals and period snapshots have legacy compatibility differences (C-13 boundary)

The existing balance-sheet view and shared server calculation differ in legacy opening-credit handling. C-13 preserves the existing Total figures and uses the assigned shared pure server functions for period snapshots. Do not silently alter Total bookkeeping while adding display features. Reconcile the legacy contract with independent hand-number fixtures in the accounting lane.

## 25 follow-up opportunities, ordered by usefulness

These are review suggestions, not claims that every item is absent from every path. Inspect the owning implementation/coordination before scheduling work.

1. Fix F1 learned-pattern identity without losing existing learned records.
2. Converge F2 secondary metrics with authoritative statement functions.
3. Define/export all currency exponents consistently (F3).
4. Define cache invalidation and membership-revocation behavior (F4).
5. Replace stale/generated status claims with commit-linked evidence (F5).
6. C-14 covers typed transaction/account/invoice/bill results; extend remaining result types and trace every result to the intended record, not only its tab.
7. C-14 adds last-ten recent records scoped to person and workspace; discard stale/deleted references safely.
8. C-14 groups search results and tests mixed-language queries across records and commands.
9. C-14 completes persisted transaction widths/order/visibility; extend the same contract to other lists where useful.
10. Verify invoice/bill sticky headers and filtered totals as layouts evolve; Claude completed this handoff on main `9f464ad`.
11. C-14 verifies individual/zero-amount filter chips; extend coverage to nested labels, amount/date criteria and column filters.
12. C-14 checks 44 px targets on phones for icon buttons, checkboxes and chips, not only main buttons.
13. Add full-ledger/server search with visible completeness and pagination if large-workspace search is required.
14. Test an authenticated, realistic multi-company production acceptance path beyond guest/stubbed screens.
15. Run live Plaid sandbox connect/sync/webhook/retry acceptance with configured credentials.
16. Run Stripe sandbox payment/webhook/idempotency acceptance and settle invoice/ledger together.
17. Run actual mail-provider delivery, failure, retry and template rendering acceptance.
18. Document statutory tax-country coverage; distinguish preparing return figures from filing them.
19. Document payroll country/method/output coverage; a payroll model is not an entire payroll service.
20. Define inventory costing/negative-stock policy, lots/serials/locations and adjustment audit expectations.
21. Review purchase requisitions, approval thresholds and goods-receipt/three-way matching requirements.
22. Review consolidated/intercompany elimination and multi-currency acceptance for real company structures.
23. Measure large-workspace performance: initial load, period-report fan-out, virtualization, server queries and cache behavior.
24. Add restoration drills, recovery-time expectations and least-privilege operational runbooks.
25. Produce user workflow instructions with representative Hebrew/mixed labels, document items and nested dimensions while retaining English menus.

## Positioning that the evidence supports

The strongest product story is a connected accounting workspace: controlled posting, related documents, full-history statement endpoints, deep labels, imports, investigation tools and an extensible algorithm/UI registry. The emerging benefit over disconnected spreadsheet workflows is less repeated entry and easier tracing from an operational record to ledger/report evidence.

Avoid claims of universal ERP superiority, guaranteed AI accuracy, fraud detection certification, tax compliance everywhere, complete production integrations or lossless migration from every legacy application. Read the exact tool's formula, route, persistence and evidence. The developer workflow guide explains how to do that for new work.

## New contextual workflow work

Claude’s main supplies persistent page buttons with Alt+P and Alt+1–9, shared inline editing and inline creation, document bulk actions, automatic credit application and statement emailing. The accompanying branch adds side-drawer metadata editing for vendors, customers, projects and items, plus typed numeric algorithm controls with explanatory help. See docs/DEVELOPER_WORKFLOWS.md for the integration standard. Financial document amounts, stock quantities and posting status continue through their existing services. Contact merging on main is a separate owner/accountant workflow (`contactMergeService.ts`, `MergePartyDialog.tsx`; `contact-merge.test.ts`, `merge-party-dialog.test.tsx`). Drawer metadata saving does not replace merge authorization or financial validation.

### F8 — Shared inline refusal handling was incomplete (resolved on integrated main)

The original review found that `InlineEdit.tsx` closed before awaiting persistence and allowed reopening while saving. Claude fixed the shared component on main: rejected saves retain the typed value and reason, and pending saves cannot reopen. Its new `reopenOnFailure` option is false for RecordInlineField, which already provides a retained-value Retry, preventing duplicate alerts. The integrated branch preserves that fix. The drawer independently retains refused drafts, blocks repeats and refreshes unedited fields after confirmed partial saves so a later save does not undo another editor's changes.

Existing main pins are device-local main/subview references; they do not yet capture report dates or isolate preferences by workspace. These remain enhancement boundaries.

### F9 — Legacy project references can use the display name

`Projects.tsx` and `ProjectPipeline.tsx` still match some entries by `project.name`, alongside stable project IDs. A rename through the older modal could drop those legacy entries from that project's figures. The new inline path refuses a rename when the loaded history contains those name links or its transaction history is unloaded, failed or capped; it does not rewrite posted entries. The drawer uses the same protection. A complete migration/alias policy belongs with the accounting/reference contract. Client-side observation is not a server transaction guarantee.

### F10 — The old cache-only pay-run action is resolved on integrated main

**Historical finding; resolved by AI #1, verified on main `135fb91`.** `PayrollView` now posts to the workspace `/pay-runs` endpoint, confirms the response before updating its cache, and supports server-backed approval/undo. `payRunService`, `pay-run-posting.test.ts`, `pay-run-ui.test.tsx` and `hourly-pay.test.ts` provide durable posting/lifecycle evidence. The same-person hourly allocation boundary is separately documented in F13.

Original observation: `PayrollView.tsx`, `handlePostPayRunToLedger`, calls `setTransactions` and `setPayRuns`; it does not call durable posting/document services. The pure payroll engine's tests establish calculation behavior, not persistent pay-run processing. Do not market this action as a completed payroll service or assume the success message survives reload. Employee creation now confirms a database save and retains its draft/identity on retry; that does not fix pay-run posting. Preserve its current calculation during metadata work; schedule a server-backed, balanced/idempotent pay-run workflow with period locks, role checks and a reload test in the accounting lane.

### F11 — Shared inline creation needs a handled failure contract

`InlineAdd.tsx` starts `void submit()` from its key handler. A rejecting `onAdd` retains the typed text but rejects without a local catch/error message. Callers that swallow errors instead make the component clear the text as if creation succeeded. The owning lane should catch refusal, retain the name and display a retryable error. Creation that requires accounts, salary, target/period or document lines should retain its existing in-page form instead of inventing financial defaults from a name.

### F12 — Current coverage is based on the executed import graph

Node test coverage reports modules loaded by tests; the package include pattern does not by itself instrument every source file. A presentation test that unnecessarily imported the whole algorithm registry exposed 71.98% line coverage, despite all 1,071 tests passing. The help test now imports the actual Monte Carlo definition directly because it checks that tool’s explanation, not every calculation. Gates remain unchanged. This means the normal passing percentage must not be advertised as whole-catalog mathematical coverage. A separate coverage inventory should name untested registered calculations and add independent fixtures for them; do not count registration or help rendering as formula tests.

## A finish line for a first release

The tracker combines defects, launch work and later product ideas. Counting every unchecked item as a release blocker makes the finish line grow. Choose and validate a bounded workflow before treating the entire roadmap as required.

For an accounting release, prioritize saved and correct records, authorization, currency/tax handling, reconciliation, period locks, audit and recoverability. Validate an authenticated company flow with representative Hebrew/mixed data: create an invoice and bill, receive/pay partially, verify balanced ledger entries and remaining amounts, reconcile bank activity, compare statements, close a period and confirm refused writes. Repeat meaningful cross-workspace/retry/reload boundaries. Existing mocked/guest tests establish narrower contracts; configured provider and production acceptance remain separate evidence.

Resolve relevant F1/F2/F3/F7 findings or explicitly constrain the affected release contract. Do not advertise durable pay-run posting while F10 remains cache-only; finish its server service or defer that workflow. Define F4 authorization freshness. These decisions affect trust in saved data and displayed figures. Cosmetic adjustments, more analytical models, optional templates, full server search, three-way purchasing depth and consolidated ERP features can follow a release when they are not part of its agreed workflows.

Keep focused checks during development and the coordination-required combined checks at review/push checkpoints. Existing owner requirements still govern the current commits; changing their frequency needs an explicit coordination update. Avoid repeated full runs after a successful, unchanged tree. Parallel preparation in isolated worktrees reduces waiting without modifying a running test's source. Do not trade away money, permission or persistence verification to shorten a cosmetic change.

## 6 Oct follow-up: calculation previews, phone use and team editing

Code review includes main `9ad7657` and AI #2's C-21–C-23 work. These are concrete benefits over a workflow that sends the user to a spreadsheet or another page; they are not claims that established accounting products lack equivalent features.

| Capability | What the implemented tool saves | Actual contract and evidence |
|---|---|---|
| Units-of-production depreciation | Calculates each usage period without accumulating repeated rounding drift | `production-depreciation.ts`; a 1,000-cent basis over three units charges 333/334/333. Whole usage units, read-only; `calculation-previews.test.ts`. |
| Four depreciation conventions | Compares first/final planning years without four separate spreadsheet formulas | `depreciation-conventions.ts`; full month, half month, half year and mid-quarter preserve total depreciable cents. Straight-line calendar-year assumptions, not statutory MACRS. |
| Graduated versus volume pricing | Shows why charging each band differs from applying one selected rate to every unit | `pricing-preview.ts`; inclusive cumulative thresholds, three bands and whole quantities. No tax/discount calculation or saved price plan. |
| Percentage/driver allocation | Splits a scenario amount without losing or creating cents | `allocation-preview.ts`; floor shares, residue to the last positive weight, exact 100% validation and preserved account labels/IDs. Three recipients; reusable saved rules and posting remain separate. |
| Standard material-cost variance | Explains the price and quantity contributions rather than showing only a difference | `standard-cost-variance.ts`; price plus quantity equals actual minus allowed standard cost. Whole quantities; labor/overhead excluded. |
| Seasonal budget distribution | Reuses supplied prior-year expense patterns rather than typing twelve budget values | `seasonal-budget.ts`; posted expense/COGS lines, shared FX and refunds, exact annual total. It does not save a budget or establish complete history from a capped browser list. |
| Customer activity cohorts | Compares repeat invoice activity by first observed invoice month | `customer-cohorts.ts`; stable customer IDs, one customer per monthly count, future cells null. This preview does not measure revenue, payment retention or lifetime churn; the full report remains AI #5 E-2. |
| In-place tool help and screen directory | Explains the current calculation or screen while keeping its form mounted | Algorithm-specific scope/method/example/limits plus C-20 screen help/search. English controls retain Hebrew/mixed data. Registry guards and sandbox/help browser tests cover these boundaries. |
| Phone home-screen assets | Supplies a branded entry that launches Overview instead of a missing favicon | Production manifest, 192/512px PNGs, 180px Apple touch icon and service worker verified. All six main screens have 390px action/overflow browser checks. Physical iOS/Android installation remains untested. |
| In-place team changes | Changes a row's role or invites by typing an email without leaving Settings | `TeamSettings.tsx` uses `InlineEdit` and existing workspace routes. Named removal confirmation, failed-save retry, pending-request guard, workspace cancellation and owner restrictions have component tests; phone keyboard/focus has a Chromium test. Mocked client requests do not prove live invitation delivery. |
| Bank-feed last successful sync | Replaces a permanently unknown timestamp with the server's actual stored success time | Dashboard reads `lastSyncedAt`: canonical ISO, null = never successfully synced, omission = unknown. An expired connection can still show its historical last success; status alone never establishes freshness. Dedicated history/error reporting remains AI #5 E-4. |

API-key rename is still a server-owner handoff: `apiKeysRoutes.ts` offers provision/revoke, without a label PATCH/PUT contract. Do not make a local-only label edit look durable. The existing lossless JSON restore remains distinct from Settings CSV imports, which currently add records; exact CSV identity restoration stays with AI #1.

## Further tools reviewed in the C-24…C-27 batch (6 Oct)

These are workflow benefits verified against the actual implementation, not claims that every older accounting product lacks them.

| Tool | What reduces work | Implementation and evidence | Practical limit |
|---|---|---|---|
| Budget vs Actual report | Uses the report's dates, changes between period/month columns and opens the account movements from the actual; no second search with manually copied dates | `BudgetActualReportView.tsx`, `budgetActual.ts`, existing `computeGeneralLedger`; hand checks for openings, credits, FX, duplicate account lines, drafts/void/ghost exclusions and remainder cents; browser keyboard/phone checks | The saved budget model has one account target per objective. Flat caps are allocated by month, partial months retain a month cap. Full history is an explicit paginated read; cached figures are marked provisional. It is not a daily accrual or posting schedule. |
| Shared locale money display | Reports/lists using the shared helper receive native separators/symbol placement; accounting negatives and Hebrew direction marks avoid hand-written currency strings | `moneyFormat.ts`, `formatCurrency`, `Money`; en-US/de-DE/he-IL/ja-JP and three-decimal tests. Numeric budget/payroll/tax charts no longer parse formatted strings; hand-checked locale chart invariance | Workspace settings persistence awaits AI #1's model/rules support. Existing browser-default formatting remains until preferences are supplied. CSV keeps machine-readable values; the formatter does not alter stored cents. |
| Project Undo | A 10-second action restores the original saved ID and fields, rather than retyping a project or creating a replacement identity | `projectUndo.ts`, Projects delete handler; exact nested Hebrew snapshot, expiration, workspace/role checks, occupied-ID refusal and repeated Undo tests | Project metadata only. Contact/item/draft-document paths and guarded server restoration await AI #1; a posted document is not restored through a metadata write. Undo is a temporary in-session action. |
| Feedback from the current screen | Report a problem without navigating away; screen name/path and app version are supplied automatically, reducing manual context copying | `FeedbackWidget.tsx`, Help action, `feedbackTicket.ts`; atomic existing support ticket/message batch, failure/draft retention, duplicate-submit and workspace-change tests; browser dialog focus/cancel/Help checks | Sign-in and workspace access are required. Optional screenshots now use the existing attachment target/viewer (11 Oct follow-up below); no image is hidden in a plain-text message. |

| Implemented workflow (11 Oct, AI #2) | Concrete benefit | Evidence and limit |
|---|---|---|
| Keyboard column reordering in rectangular shared report tables | Put frequently compared fields beside the record name without exporting/rebuilding the table elsewhere. Header, body, footer and keyboard order stay together; preferences are local and scoped. | `ReportTableScroll`, `orderReportCells`, column chooser DOM test, phone Chromium test. Spanning/custom-component tables retain their prior layout. |
| P&L/balance-sheet period groups | Hide an irrelevant month or place two periods next to each other; the associated percentage/prior/variance cells travel with the period and financial CSV follows that selection. | `StatementColumns`, `reportPeriodLayout`, hand-number tests and both statement browser cases. Read-only; figures/postings unchanged. |
| Explicit displayed-row export | Download exactly the visible columns in their chosen order, with Hebrew labels intact and formula-safe UTF-8. | Shared CSV writer, real phone download/print test. Includes displayed localized strings and only rendered rows; financial numeric exports retain their separate contracts. |
| Hebrew money beside mixed names | Currency signs, negatives and accounting brackets retain the locale's meaning without surrounding Hebrew text affecting their direction. | Isolated existing strings in statement/aging rows, totals and actual document drawer; three he-IL DOM cases and phone print/export check. Primary sales/purchase lists are reserved to AI #1; no claim that every screen has been migrated. |
| Optional feedback screenshot with retry | Send visual context from the current screen while keeping the draft; a failed image upload can be retried without duplicate tickets. | `FeedbackWidget`, `feedbackScreenshotProblem`, existing `attachFiles`; eight unit cases and actual phone PNG/preview/refusal/keyboard-retry browser case. Manual PNG/JPEG/WebP selection, shared 700 KB limit, signed-in workspace access; text is already saved before image retry. |

### F13 — One approved hour can appear in two employee lines (AI #1 hourly-pay handoff)

Confirmed on main `135fb91` in the pure selector/totals path: two active bi-weekly hourly employee records with different employee IDs, the same `timeUid: 'same-person'`, and `hourlyRateCents: 2500`; one approved time entry `approved-hour`, dated 2026-10-01, 60 minutes, that person; pay date 2026-10-11. `hoursToPay` returns 60 minutes and the same entry ID for both employees. Passing it to `payRunTotals(..., 2026, 'all', hours)` yields two 2500-cent lines and gross 5000 cents. This reproduction makes no database write.

The shared person picker in `HourlyPayCell` has no duplicate-link guard. `payRunService` computes this selector and writes `paidRunId` for each selected entry: that protects later runs, but does not deduplicate employee lines inside one run. AI #1 owns payroll/time posting. Define whether a person must have one hourly employee record or how their time is allocated; enforce that on the server, not only in the picker, and add a duplicate-entry endpoint regression plus approval/release checks. Existing `hourly-pay.test.ts` covers one employee, repeat runs and undo, not this duplicate-link case. Server duplication itself still needs that targeted regression; the confirmed evidence here is selector/totals behavior.

The implemented approved-time/pay-run link removes manual re-entry of hours and locks paid time against subsequent editing. It should not be described as a universal double-payment guarantee until this same-run boundary is resolved.

### C-30 report pack: less assembly work, explicit time boundaries

Reports now offers one server-backed printable pack with cover, workspace, chosen period, UTC preparation timestamp, numbered pages and selectable financial sections. The benefit over manually combining separate legacy exports is a reviewable preview and a single print/PDF step. It refuses to print an incomplete pack instead of silently substituting cached numbers. Existing single-report totals are retained and checked against those functions; mixed Hebrew labels and locale money survive actual PDF extraction.

Scope: accrual P&L and balance sheet, current receivables aging, optional trial balance, cash flow and current payables aging. Current aging is dated independently of historical periods, as explicitly authorized by owner/AI #1; it is not historical aging. Individual report reads can observe intervening edits, so this is not an atomic close snapshot. Other specialized reports still print separately; C-30/BD-06 remains partial for arbitrary shell-report inclusion. Browser Save as PDF and Chromium numbered pages are verified; universal browser pagination is not claimed. See `reportPack.ts`, `ReportPackDialog.tsx`, report-pack pure/DOM tests and `e2e/report-pack.spec.ts`.
## Page bookmarks (C-37)

The sidebar can remember the pages a user returns to, including an exact report or settings subview. This reduces repeated menu searches while leaving the current report’s date context available. Existing header pins continue to provide their global shortcuts.

`BookmarksGroup.tsx` consumes the registered navigation helper and `bookmarks.ts` validates saved targets, drops duplicate/obsolete entries and preserves exact user/workspace IDs. Native buttons support keyboard reorder with focus retained, and phone navigation closes the sidebar. Preferences are local to the browser and scoped to user and workspace; blocked storage produces a visible warning and keeps changes for this visit. Bookmarks do not capture filters, financial data or a historical report snapshot. Five pure/DOM checks pass; browser geometry and final integrated checks remain pending.
## Named export templates (C-38)

Reports can remember several named column selections and orders rather than making users repeat them for each CSV. `ReportTableScroll` reuses its displayed-cell export, and `StatementColumns` retains its period/amount writer. `exportTemplates.ts` validates device-local records per user/workspace/report; incompatible headings or statement periods cannot apply an old layout. Dates, filters, financial rows and historical values are outside the saved choice. Fifteen targeted tests cover actual order/visibility, statement figures, corrupt storage, duplicates and refusal; a phone Chromium case parses an actual CSV containing Hebrew and verifies exact columns, amount, keyboard access and geometry. Integrated gates remain pending.
## Current invoice price review (C-39, partial)

A bookkeeper can find invoice lines whose stored unit rate differs from the customer’s current list or item price, and open the exact invoice without searching again. Existing list-price logic supplies the expectation; missing references and foreign currency are excluded explicitly. Complete CSV requires successful full invoice/item reads; cache-only rows remain visibly provisional. The feature helps investigate current price differences, but cannot establish what discount was agreed historically: line agreements, dated list versions and separate item discount rules are not stored. Nine targeted tests/guards and a registered phone/axe case pass; integrated gates are pending.
