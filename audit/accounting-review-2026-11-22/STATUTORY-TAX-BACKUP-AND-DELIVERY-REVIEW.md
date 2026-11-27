# Backup/Restore, Israeli Form 856, Export/EU VAT, Deliveries & Recurring Review

Date: 2026-11-22  
Pinned HEAD: `9b815a58ebbe1d0f99c44f908ee77b7fbaa73705`  
Diagnostic evidence:
- `audit/accounting-review-2026-11-22/backup-restore-stock-database.test.ts`
- `audit/accounting-review-2026-11-22/form856-void-and-exempt-database.test.ts`
- `audit/accounting-review-2026-11-22/export-tax-and-eu-vat.test.ts`
- `audit/accounting-review-2026-11-22/delivery-location-balance-sheet-database.test.ts`

All examples use synthetic entities and figures only.

---

## BK-01 — P1: Restoring an official signed workspace backup scrambles same-day `stockMoves.dbSeq` chronological order and re-dirties `repostQueue`

- **Files**:
  - `src/server/services/workspaceRestoreService.ts:353–358, 399`
  - PostgreSQL triggers `lf_stock_move_db_seq` (`BEFORE INSERT ON public."stockMoves"`) and `lf_repost_mark` (`AFTER INSERT ON public."stockMoves"`)
  - `src/lib/stockMoves.ts:94–97` (`compareMoves`)
- **Accounting / audit rule (`docs/RELEASE_GATE.md` "Never postponed, at any stage")**: Exporting and restoring an unchanged server backup must be state-preserving for moving-average stock history and derived repost state. Same-day stock receipts and issues must preserve their chronological tie-break sequence (`dbSeq`), and restoring an already-clean workspace must not create spurious dirty repost entries.
- **Actual behavior**:
  1. `exportWorkspaceBackup` (`workspaceRestoreService.ts:399`) reads `stockMoves` with `db.collection('stockMoves').where('workspaceId', '==', workspaceId)` (ordered by random/document `id`, not `dbSeq`), and `restoreWorkspaceBackup` (`workspaceRestoreService.ts:356–358`) inserts them in that order while `lf_stock_move_db_seq` unconditionally overwrites `new.data.dbSeq` (`new.data || jsonb_build_object('dbSeq', nextval(...))`).
  2. `restoreWorkspaceBackup` (`workspaceRestoreService.ts:354`) deletes `staleDerivedDocs` (`repostQueue`) **before** inserting `stockMoves` (`:356`), so whenever an earlier-dated stock move has an `id` sorting after a later-dated stock move, `lf_repost_mark` fires during restore and writes a new `status: 'dirty'` row into `repostQueue`.
  3. In addition, `loans`, `taxReturns`, and `fixedAssets` are configured with `onlyIfInBackup: true` (`workspaceRestoreService.ts:99–101`), so restoring an older pre-BK-10 backup wipes `transactions` while leaving post-backup `loans` and `taxReturns` behind referencing deleted entries.
- **Worked synthetic example** (`backup-restore-stock-database.test.ts`, isolated PostgreSQL 18.7):
  - Multi-day item `Control Valve`: `a_mar20` (`2026-03-20`) and backdated `z_mar05` (`2026-03-05`), followed by `runRepost` -> `repostQueue` has **`0`** dirty rows (`status: 'clean'`).
  - Same-day item `Precision Bearing` on `2026-03-10`: `z_buy10` (`+10 @ $10`, `dbSeq 1`) -> `a_sell10` (`-10 @ $10`, `dbSeq 2`) -> `m_buy30` (`+10 @ $30`, `dbSeq 3`).
  - Export official signed backup via `exportWorkspaceBackup` and immediately restore it via `restoreWorkspaceBackup`:
    - **Expected**: `0` dirty `repostQueue` rows; same-day `compareMoves` order remains `["z_buy10", "a_sell10", "m_buy30"]`.
    - **Actual**: **`1`** dirty `repostQueue` row is created during restore, and same-day `compareMoves` order is scrambled to **`["a_sell10", "m_buy30", "z_buy10"]`** (selling 10 units before buying any, then buying at `$30`, then buying at `$10`).
- **Remediation**: Sort `stockMoves` by `dbSeq` (then `date`, `seq`, `id`) during export/restore or preserve existing `new.data.dbSeq` when restoring; clear/restore `repostQueue` **after** `stockMoves` are written (or suppress `lf_repost_mark` inside restore transactions).

---

## IL-01 — P1: Israeli Form 856 (`Form856ReportView`, `form856Rows`, `form856AuthorityPayees`) includes voided vendor payments in totals while `form856ReviewExport` permanently blocks CSV export for the year

- **Files**:
  - `src/lib/tax/form856.ts:69–75` (`isForm856Payment`, `form856Rows`)
  - `src/lib/tax/form856AuthorityCsv.ts:289–317` (`form856AuthorityPayees`)
  - `src/lib/tax/form856ReviewExport.ts:78–83` (`form856ReviewExport`)
  - `src/components/reporting/Form856ReportView.tsx:41–68`
- **Accounting / statutory rule (Israeli Income Tax Ordinance §166, Form 856)**: Voided payments (`status: 'void'`, whose GL cash and withholding-liability lines have been reversed by `voidPayment`) are not payments made or tax withheld and must be excluded from Form 856 totals and exports.
- **Actual behavior**:
  - `voidPayment` (`paymentVoidService.ts`) sets `payment.status = 'void'` while preserving `withheldCents` on the payment record.
  - Neither `Form856ReportView.tsx:41–44`, `isForm856Payment` (`form856.ts:69–71`), `form856Rows` (`:74`), nor `form856AuthorityPayees` (`form856AuthorityCsv.ts:290`) filters out `status === 'void'`, so voided payments remain in the on-screen Form 856 summary and Tax Authority record-60 payee aggregation.
  - Meanwhile, `form856ReviewExport` (`form856ReviewExport.ts:78–83`) selects the voided payment and pushes `'A draft, void or unverified-status payment has withholding in this year'` into `blockers`, permanently disabling **both** CSV download buttons (`canDownloadWorksheet` and `canDownloadAuthority`) for the entire tax year once any withholding payment has ever been voided.
- **Worked synthetic example** (`form856-void-and-exempt-database.test.ts`, real `/api/v1/payments` + `/api/v1/payments/:id/void` routes):
  - Post `PMT-1` of `₪10,000` (`1,000,000` agorot) with `₪3,000` (`300,000` agorot) withheld, then void `PMT-1` via `POST /api/v1/payments/:id/void`.
  - Post live `PMT-2` of `₪5,000` (`500,000` agorot) with `₪1,500` (`150,000` agorot) withheld.
  - **Expected**: Form 856 paid `500,000` (`₪5,000`), withheld `150,000` (`₪1,500`), review CSV downloadable.
  - **Actual**: Form 856 summary & authority CSV payees report paid **`1,500,000` (`₪15,000`)** and withheld **`450,000` (`₪4,500`)** (`₪3,000` overstated), while `canDownloadForReview` is **`false`**.
- **Remediation**: Exclude `payment.status === 'void'` (while still flagging `draft` or unknown statuses in `form856ReviewExport`) across `Form856ReportView`, `form856Rows`, `form856ReviewExport`, and `form856AuthorityPayees`.

---

## IL-02 — P2: Form 856 omits covered vendor payments made under a 0% withholding exemption certificate and subtracts VAT from `baseCents`

- **Files**:
  - `src/lib/tax/form856.ts:24, 69–71, 79, 93`
  - `src/lib/tax/form856AuthorityCsv.ts:45, 290, 299`
- **Statutory rule (Israeli Income Tax Regulations — Deduction from Payments for Services or Assets; SHAAM Record-60 Field 11)**:
  1. Covered supplier payments must be reported on annual Form 856 even when 0% tax was withheld pursuant to a valid exemption certificate (`פטור מניכוי מס במקור`, `withholdingRatePercent = 0`).
  2. Withholding at source on supplier payments applies to the **VAT-inclusive gross payment** (`סה״כ תשלומים ששולמו ברוטו (כולל מע״מ)`, as `form856AuthorityCsv.ts:45` itself labels Field 11), not `payment - VAT`.
- **Actual behavior**:
  1. `isForm856Payment` (`form856.ts:69–71`) requires `Number(payment.withheldCents) > 0`, dropping all `0%`-certificate vendor payments (`withholdingRatePercent: 0, withheldCents: 0`) and making the `rawRate >= 0` handling in `form856AuthorityCsv.ts:299` unreachable for `0%`.
  2. `form856.ts:79` computes `base = payment.amountCents - (payment.vatCents || 0)`, so a statutory 3% deduction of `₪6,318` on `₪210,600` (`₪180,000 + ₪30,600` VAT) reports `effectiveRatePercent = 3.51%` instead of `3.00%` (`form856-void-and-exempt-database.test.ts`).

---

## TX-01 — P1: `resolveLineTax` + `taxChoiceFor` classifies non-Israeli exports (UK, Canada, EU) as `exempt` (Box 9) instead of `zero_rated` (Box 8) and treats intra-EU sales as unconditional 0% exports

- **Files**:
  - `src/lib/tax/resolveLineTax.ts:150–153, 176–182`
  - `src/components/sales/TaxPlaceSuggestion.tsx:86–95`
  - `src/components/sales/InvoiceModal.tsx:459`
- **Statutory rule**:
  1. Exports of goods from the UK (VATA 1994 s.30(6)), EU (VAT Directive Art. 146), and Canada (ETA Sched. VI Part V) are **zero-rated taxable supplies** (`zero_rated`, reported in Box 6 and Box 8, with input VAT recoverable), not **exempt supplies** (`exempt`, Box 9, restricting input VAT recovery).
  2. Intra-EU cross-border supplies (`DE -> FR`) are **not** exports outside the EU VAT territory: B2C sales remain taxable (domestic VAT below the €10,000 OSS threshold or destination VAT via OSS), and intra-Community B2B zero-rating requires a verified buyer EU VAT ID.
- **Actual behavior**:
  1. `resolveLineTax` (`:150–153`) sets `treatment: 'zero_rated'` **only** when `sellerCountry === 'IL'`, returning `treatment: undefined` for `GB`, `CA`, and all EU member states.
  2. When the user clicks "Use no tax" in `TaxPlaceSuggestion`, `InvoiceModal.tsx:459` calls `taxChoiceFor(0, salesCodes, effectiveRate, undefined)` (`resolveLineTax.ts:181`), which prefers `codes.find(c => c.treatment === 'exempt')` over `zero_rated`, placing a `£1,000` UK export into **Box 9 (`Exempt sales = 100,000`)** with **Box 8 (`Zero-rated sales = 0`)** (`export-tax-and-eu-vat.test.ts`).
  3. A German VAT seller (`DE`) billing a consumer in Paris (`FR`) receives `reason: 'export', rate: 0` (`"no tax: sold to another country"`).

---

## DL-01 — P1: `deliverOrder` with `locationId` omits the location dimension on the Inventory credit leg (unbalancing Balance Sheet by Location) and `undoDelivery` accepts pre-delivery dates

- **Files**:
  - `src/server/services/deliveryService.ts:74–82, 168–170, 207–235`
- **Accounting rule (Workflow W5 Balance Sheet by Label & Perpetual Inventory)**:
  1. Every double-entry journal posted for a single warehouse/location must carry matching location labels on both legs (or balance via inter-location clearing) so Balance Sheet by Location (`Assets = Liabilities + Equity + Net Income`) stays in balance.
  2. A delivery reversal cannot be dated earlier than the delivery it reverses, and `prepareDeliveryAccounts` must verify asset/expense account types.
- **Actual behavior & worked synthetic example** (`delivery-location-balance-sheet-database.test.ts`):
  - Opening stock in `warehouse_east`: `+$2,500` Inventory / `-$2,500` Equity (`250,000` cents).
  - Deliver 2 units (`$500` / `50,000` cents cost) from `warehouse_east` on `2026-03-20`: `deliverOrder` tags COGS (`+50,000`) with `dimensions: { location: 'warehouse_east' }` (`:168`) while leaving the Inventory credit (`-50,000`) **unlabeled** (`:169`).
  - **Expected `warehouse_east` Balance Sheet**: Assets `200,000` (`$2,000`), Claims `200,000` (`$2,000`), `isBalanced: true`.
  - **Actual `warehouse_east` Balance Sheet**: Assets **`250,000` (`$2,500`)**, Claims **`200,000` (`$2,000`)**, **`isBalanced: false`** (`$500` out of balance).
  - Calling `undoDelivery` with `date: '2026-01-15'` (`2` months before the `2026-03-20` delivery!) succeeds (`reversed.length === 1`).

---

## RC-01 — P3: `recurringService.generateInvoice` allocates sequential invoice numbers outside its database transaction

- **File**: `src/server/services/recurringService.ts:95` (compare `generateEstimate` at `:199`)
- **Behavior**: `generateEstimate` allocates inside `db.runTransaction` via `allocateInTransaction(db, tx, rule.workspaceId, 'estimate')` (`"so a skipped draft leaves no gap"`), whereas `generateInvoice` calls `allocateNextNumber(db, rule.workspaceId, 'invoice')` **before** `db.runTransaction` (`:95`). If the schedule was paused concurrently or another worker already generated that occurrence (`RecurringSkip` at `:113–114`), the allocated invoice number is permanently burned, creating a sequential numbering gap.
