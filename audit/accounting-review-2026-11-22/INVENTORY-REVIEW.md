# Inventory and cost of sales — partial audit

**Revision:** `9b815a58ebbe1d0f99c44f908ee77b7faa73705` · **Status:** incomplete, not a release opinion. Evidence below uses synthetic items and documents, the real document-posting HTTP router with an injected owner identity, and a dedicated local PostgreSQL 18.7 database with repository migrations and plain-Postgres auth stubs. No hosted Supabase, genuine authentication, provider or customer data was used. Workspace-specific test records were removed afterward.

## INV-01 — Invoice sale of zero/unknown-cost stock leaves quantity unchanged and no COGS-pending warning (P1)

**Independent worked example and observation:** With workspace stock configured to leave on invoices, 10 units are in stock, their recorded cost is zero, and an invoice sells two units for $20. Expected quantity after shipment: **8**; if zero is a known genuine cost, zero COGS may be correct, but quantity must still change. If cost is unknown rather than truly zero, cost-of-sales also requires an explicit exception/review. The route saved the invoice and balanced $20 receivable/revenue journal, left quantity at **10**, created no cost-of-goods journal, and did not set `cogsPending`. No stock movement is generated for the sold items.

**Mechanism:** `src/services/invoiceCogs.ts:64-73` discards lines whose cost is absent, zero or nonpositive, and also those whose rounded total cost is zero; when none remain it returns no pending reason. `src/services/ledgerPost/invoicePosting.ts:195-209` relies on those entries and only flags a pending COGS reason if provided. `src/server/services/cogsStockService.ts:69-75` derives the sale quantity movement from the COGS entry. Thus a legitimate zero cost and an unknown cost are conflated, and the inventory movement is skipped when no COGS entry is built. The existing `src/tests/invoice-cogs.test.ts` explicitly expects no entries for unknown cost, but does not verify the corresponding stock movement.

**Limitations:** Verified in invoice-driven stock mode, not delivery-driven mode. Does not demonstrate cost misstatement when the correct cost is truly zero; the confirmed discrepancy is physical stock tracking and absence of a warning. Exposure for missing cost and missing line identifiers should be independently assessed. A separate path for delivery movements or explicitly supported freebies may differ.

**Acceptance:** Represent known zero and unknown cost separately. On actual goods delivery, ensure stock quantity moves once even with zero-value stock, or refuse posting with an actionable exception; unknown positive cost must not silently appear settled. Test invoice/delivery modes, zero vs absent vs fractional cost, mixed invoice lines, stock refusal and reversals, and reporting/reconciliation to inventory ledger.

## INV-02 — Whole-cent moving-average unit rounding leaves an inventory ledger remainder after all stock is sold (P1, magnitude-dependent)

**Independent worked example and observation:** Start with zero units and zero inventory value. Buy **3 units for $1.00**; the correct total inventory value is $1.00 and average cost is one-third dollar. The persisted item rounds the unit average to **33 cents**. Sell all 3 units; cost-of-sales is **99 cents**, leaving **zero units** but a **one-cent debit** in the inventory general-ledger account. On complete sale of this isolated lot, expected COGS is $1.00 and remaining inventory $0.00. The defect can accumulate or grow with quantities; impact must be measured on real reconciliation data rather than inferred from one cent.

**Mechanism:** Bill stock movements take the full posted bill value into the ledger and `movingAverageCents` rounds the per-unit cost to whole cents (`src/server/services/cogsStockService.ts:65-66,353-363`); invoice COGS multiplies quantity by that rounded unit cost (`src/services/invoiceCogs.ts:67-70`). The DB test posts a real bill and invoice, reads the item and all inventory-account journal lines, and verifies the persisted mismatch. It does not establish how downstream manual reconciliation, reposting, negative stock, landed costs, returns or other valuation methods handle this residual.

**Acceptance:** Retain total inventory value or sufficient cost precision, carry and allocate residual cents deterministically, and ensure inventory subledger reconciles to its control account after partial and full depletion. Independently check fractional quantities, multiple receipts/sales, rounding up and down, reversals, returns, landed costs, backdated corrections and period close.

## Execution

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/inventory-database.test.ts
```

1 diagnostic passed, asserting the currently observed behavior; it should fail when the defects are corrected and must then be rewritten as an acceptance test. An initial harness run failed on a missing synthetic vendor ID; after providing the required field it passed. Existing isolated database batch also passed invoice COGS and stock adjustment scenarios, but passing those cases does not refute these distinct counterexamples. No product code was changed.
