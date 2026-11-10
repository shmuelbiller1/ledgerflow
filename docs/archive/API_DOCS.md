> **Archived 10 Nov 2026 (AI #13 repo cleanup).** This document describes `/api/v1/...` endpoints
> (forensics worker pools, revaluation, approvals, manufacturing, treasury, …) that do **not exist**
> in `src/server/` — checked 10 Nov 2026 against the route mounts in `server.ts` and
> `src/server/routes/` (a 20-endpoint sample matched nothing). The live API surface is described by
> the generated OpenAPI document in `src/server/openapi.ts` (`GET /api/v1/openapi.json`). Kept here
> as a historical record only; do not build against it.

# LedgerFlow Enterprise API Documentation

This document outlines the newly upgraded server-side API endpoints that power LedgerFlow's enterprise capabilities, offloading heavy computational tasks to Node.js worker pools and enforcing database-level integrity.

## 1. Multi-Threaded Forensic Processing

To prevent client-side performance bottlenecks when running forensic audit checks, intensive calculations are moved from the UI thread to server-side Node.js worker pools.

### `POST /api/v1/forensics/anomaly-scan`

Scans a batch of transactions for statistical anomalies using historical mean, standard deviation, and Z-Score outlier detection.

**Request Body:**
```json
{
  "transactions": [
    {
      "id": "tx-123",
      "totalAmountCents": 50000,
      "date": "2024-05-10"
      // ... other transaction fields
    }
  ]
}
```

**Response:**
```json
{
  "anomalies": [
    {
      "id": "tx-123",
      "totalAmountCents": 50000,
      "zScore": 3.42
    }
  ]
}
```

**Architecture:**
- Express Main Thread -> Spawns Node.js Worker Thread (`anomalyWorker.ts`) -> Executes `AnomalyDetectionEngine` -> Returns results asynchronously without blocking the UI.

---

## 2. Dynamic Multi-Currency Revaluation Service

A background service that scans open balances in foreign currencies, calculates the difference relative to current exchange rates, and generates reversing adjustments directly in the PostgreSQL database.

### `POST /api/v1/revaluation/month-end`

Executes the month-end currency revaluation wizard.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "revaluationDate": "2024-05-31",
  "exchangeGainAccountId": "acc-gain-456",
  "exchangeLossAccountId": "acc-loss-789"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Month-end revaluation processed successfully. Adjustments generated."
}
```

**Architecture:**
- Queries `journal_lines` and `historical_rates` via Postgres SQL pool.
- Calculates unrealized gains/losses against the USD base.
- Automatically inserts adjusting `journal_moves` and `journal_lines` within a secure database transaction (`BEGIN` / `COMMIT`).

---

## 3. Database Schema & Triggers (Cloud SQL)

The API is backed by a highly normalized PostgreSQL relational database. 

**Key Validations Enforced at the Database Level:**
- **Double-Entry Equilibrium (`trg_verify_and_lock_journal_move`):** A PL/pgSQL trigger verifies that `SUM(debit) - SUM(credit) = 0` before any transaction can be transitioned to the `posted` state.
- **Period Locking:** Prevents modifications to transactions dated on or before the workspace's `lock_date`.
- **Intercompany Eliminations:** The `generate_intercompany_eliminations` stored procedure identifies reciprocal trade balances between parent and subsidiary workspaces to automate consolidation adjustments.


## 4. Immutable Audit Logs & Immutability Triggers
To bridge the gap with systems like QuickBooks and Odoo, LedgerFlow now maintains a complete, database-level audit log of all critical transactions and financial metadata.
- **Triggers:** `trg_audit_journal_moves`, `trg_audit_journal_lines`, `trg_audit_accounts`.
- **Functionality:** Any `INSERT`, `UPDATE`, or `DELETE` executed on the ledger tables is automatically captured as JSONB representations (`old_data`, `new_data`) directly into the `audit_logs` table. This provides a cryptographically trackable historical timeline of all mutations, enforcing strict audit compliance.

---

## 5. Server-Side AP/AR Aging Analysis
Performing O(N*M) group reductions on the UI thread leads to UI blocking and latency. LedgerFlow Enterprise moves this to a highly optimized database-layer endpoint.

### `GET /api/v1/reports/aging/:workspaceId?type=Receivables`

Computes 30/60/90+ day aging buckets directly via PostgreSQL aggregation.

**Response:**
```json
{
  "success": true,
  "type": "Receivables",
  "aging": [
    {
      "partner_id": "cust-999",
      "total_balance": 15000.00,
      "current": 5000.00,
      "days_30_60": 5000.00,
      "days_60_90": 5000.00,
      "days_over_90": 0.00
    }
  ]
}
```

---

## 6. Automated Fixed-Asset Depreciation Engine
Enterprise resource platforms must automate recurring, schedule-based entries. LedgerFlow introduces a straight-line depreciation engine capable of generating multi-year journal entry schedules in milliseconds.

### `POST /api/v1/assets/depreciate`

Generates future, un-posted (`draft`) journal moves for the entire useful life of a fixed asset.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "assetName": "Server Rack A",
  "originalCost": 12000,
  "salvageValue": 2000,
  "usefulLifeMonths": 60,
  "expenseAccountId": "acc-exp-123",
  "accumulatedAccountId": "acc-contra-456",
  "startDate": "2024-05-01"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Successfully generated 60 depreciation schedules."
}
```

## 7. Intelligent Auto-Reconciliation Engine
Manual bank reconciliation is highly time-consuming. LedgerFlow's new automated reconciliation engine analyzes imported bank statement arrays and programmatically matches them against open ledger entries.

### `POST /api/v1/reconciliation/auto-match`

Matches bank transactions to ledger `journal_lines` based on exact amount matching and date proximity (±3 days), automatically locking them as reconciled.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "bankAccountId": "acc-bank-001",
  "bankLines": [
    {
      "id": "stmt_1",
      "date": "2024-05-15",
      "amount": 105.50,
      "description": "AWS Web Services"
    }
  ]
}
```
**Response:**
```json
{
  "success": true,
  "totalProcessed": 1,
  "matchedCount": 1,
  "unmatchedCount": 0,
  "matches": [
    {
      "bankLineId": "stmt_1",
      "ledgerLineId": "jl_999",
      "amount": 105.50,
      "confidence": "High - Amount & Date Match"
    }
  ]
}
```

## 8. Perpetual Inventory Costing Engine
Traditional client-side setups fail to manage true perpetual inventory costing (e.g., Weighted Average Cost). LedgerFlow Enterprise integrates a database-level inventory subsystem that calculates Cost of Goods Sold (COGS) dynamically.

### `POST /api/v1/inventory/move`

Processes an inventory movement ('in' or 'out'), recalculates the Weighted Average Cost (WAC), and automatically generates the corresponding COGS and Inventory Asset journal moves.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "productId": "prod-456",
  "moveType": "in",
  "quantity": 50,
  "unitCost": 12.50,
  "date": "2024-05-20"
}
```
**Response:**
```json
{
  "success": true,
  "newQty": 150,
  "newUnitCost": 11.25,
  "moveId": "INV_171542_892"
}
```
**Architecture:**
- Uses `FOR UPDATE` row-level database locks to prevent concurrent race conditions during cost recalculation.
- Auto-generates offset accounting journals if the product has `asset_account_id` and `cogs_account_id` mapped.

---

## 9. Budget vs. Actuals Variance Engine
Avoids moving thousands of transaction rows to the client browser by evaluating budget performance directly within the PostgreSQL engine.

### `GET /api/v1/reports/budget-variance/:workspaceId`

Executes a hyper-optimized relational `JOIN` aggregating actual posted ledger balances against defined budget limits for a given period.

**Response:**
```json
{
  "success": true,
  "report": [
    {
      "budget_id": "budg_123",
      "budget_name": "Q2 Marketing Spend",
      "account_code": "6010",
      "account_name": "Advertising",
      "period_start": "2024-04-01",
      "period_end": "2024-06-30",
      "budgeted_amount": 10000.00,
      "actual_amount": 11500.00,
      "variance": -1500.00
    }
  ]
}
```

## 10. Automated Tax & VAT Computation Engine
Global ERPs require dynamic calculation of statutory taxes based on line-item revenues and expenses, avoiding manual spreadsheet adjustments.

### `POST /api/v1/taxes/apply`

Calculates and applies the configured tax rate (e.g., 20% VAT) to all applicable income and expense lines within a `draft` journal move. It automatically inserts the required tax liability/receivable lines to maintain double-entry equilibrium.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "moveId": "jm-789",
  "taxRateId": "tax-rate-20"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Applied 20.00% tax. Added $200.00 in tax lines."
}
```

---

## 11. Segregation of Duties & Approval Workflows
To support SOX compliance and Enterprise Maker-Checker workflows, high-value journal entries can be routed through an approval matrix.

### `POST /api/v1/approvals/request`
Initiates a request to post a journal move.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "entityId": "jm-789",
  "requestedBy": "user-maker-01"
}
```

### `POST /api/v1/approvals/resolve`
Allows an authorized 'Checker' (e.g., Admin or Senior Accountant) to approve or reject the request. If approved, the engine safely transitions the `journal_move` from `draft` to `posted` within a secure database transaction, enforcing all double-entry and period-lock constraints.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "requestId": "APP_REQ_171542892000",
  "status": "approved",
  "resolvedBy": "user-checker-02",
  "userRole": "admin"
}
```

## 12. Procure-to-Pay (P2P) & Order-to-Cash (O2C) Subledgers
Enterprise platforms decouple raw journal entries from front-office operations using Invoicing subledgers. LedgerFlow now includes a robust invoicing engine that automatically synthesizes General Ledger moves from high-level business documents.

### `POST /api/v1/invoices/:invoiceId/post`
Validates a `draft` invoice or vendor bill, locks the row, and automatically synthesizes the balanced `journal_move`. It calculates the required Trade Balance (AR/AP), Revenue/Expense, and Tax Liability ledger lines based on the invoice parameters, then transitions the invoice to `open`.

**Request Body:**
```json
{
  "arApAccountId": "acc-receivable",
  "revenueExpenseAccountId": "acc-sales",
  "taxAccountId": "acc-tax-liability"
}
```

### `POST /api/v1/invoices/:invoiceId/pay`
Registers a payment against an `open` invoice. It dynamically computes the remaining `amount_due` and synthesizes the corresponding Cash Receipt or Cash Disbursement journal entry (e.g., Debiting Cash, Crediting AR), instantly transitioning the invoice to `paid` if the balance is fully settled.

**Request Body:**
```json
{
  "amount": 120.00,
  "paymentDate": "2024-05-25",
  "cashAccountId": "acc-bank",
  "arApAccountId": "acc-receivable"
}
```

## 13. Multi-Entity Consolidation & Intercompany Eliminations
For corporate groups managing multiple subsidiaries, LedgerFlow Enterprise supports real-time, database-level Trial Balance consolidation with automated intercompany eliminations.

### `POST /api/v1/reports/consolidation`
Aggregates ledger balances across a parent workspace and an array of child workspaces. If `eliminationAccountIds` are provided (e.g., "Due to/from Subsidiary" accounts), the engine dynamically strips these balances from the consolidated presentation to prevent double-counting of internal liabilities/assets, computing the true net position of the corporate group.

**Request Body:**
```json
{
  "parentWorkspaceId": "ws-parent",
  "childWorkspaceIds": ["ws-child1", "ws-child2"],
  "eliminationAccountIds": ["acc-intercompany-receivable", "acc-intercompany-payable"]
}
```
**Response:**
```json
{
  "success": true,
  "entitiesConsolidated": 3,
  "metrics": {
    "consolidatedAssets": 1500000,
    "consolidatedLiabilities": 800000,
    "totalEliminations": 50000
  },
  "report": [
    {
      "code": "1000",
      "name": "Cash equivalent",
      "type": "asset",
      "gross_debit": 200000,
      "gross_credit": 50000,
      "net_consolidated_balance": 150000,
      "eliminated_amount": 0
    }
  ]
}
```

## 14. Continuous Audit & Forensic Fraud Detection Engine
To prevent financial manipulation, LedgerFlow includes a mathematical fraud detection module that analyzes the dataset for statistical anomalies without human intervention.

### `GET /api/v1/forensics/benfords-law/:workspaceId`
Performs a rigorous statistical analysis on the distribution of leading digits across all ledger amounts. It extracts the leading non-zero digit of every recorded transaction and compares the empirical distribution against the theoretical Benford's Law probability curve. It computes the **Chi-Square Goodness-of-Fit Statistic**, immediately flagging workspaces that exceed the 95% confidence threshold (15.507) as high-risk for potential fraud or artificial number generation.

**Response:**
```json
{
  "success": true,
  "totalAnalyzed": 10500,
  "chiSquareStatistic": 8.42,
  "isAnomalous": false,
  "riskLevel": "LOW",
  "distribution": [
    {
      "digit": "1",
      "actualCount": 3100,
      "actualPercent": 0.2952,
      "expectedPercent": 0.301,
      "variance": 0.38
    }
  ]
}
```

## 15. Revenue Recognition (ASC 606 / IFRS 15) Engine
For modern SaaS and subscription-based enterprise businesses, revenue must be recognized linearly over the duration of the contract, rather than at the time of cash receipt.

### `POST /api/v1/revenue/recognize`
Automatically generates a long-term amortization schedule of `draft` journal moves. It programmatically shifts funds from a Deferred Revenue liability account into a Recognized Revenue income account over the exact lifecycle of the contract, strictly enforcing straight-line ASC-606 compliance.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "contractName": "Acme Corp Annual Software License",
  "totalContractValue": 120000,
  "deferredRevenueAccountId": "acc-def-rev",
  "recognizedRevenueAccountId": "acc-software-rev",
  "durationMonths": 12,
  "startDate": "2024-01-01"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Successfully generated 12 ASC-606 revenue recognition schedules."
}
```

## 16. Multi-Currency & FX Unrealized Gains/Losses
Enterprise ledgers must value foreign currency positions dynamically. LedgerFlow incorporates a month-end revaluation engine.

### `POST /api/v1/fx/revalue`
Scans all `open` invoices denominated in foreign currencies. It compares the historical exchange rate (at issue date) against the target date rate, automatically synthesizing a balancing journal entry to post the resulting difference to the **Unrealized FX Gain/Loss** accounts.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "targetDate": "2024-05-31",
  "unrealizedGainAccountId": "acc-fx-gain",
  "unrealizedLossAccountId": "acc-fx-loss"
}
```

---

## 17. HR & Payroll Automation Engine
Payroll involves complex multi-account balancing (Gross Wages, Tax Withholdings, Net Cash).

### `POST /api/v1/payroll/run`
Iterates over all `active` employees in a workspace. It calculates their monthly gross wages and tax withholdings based on their profile, synthesizes a massive compiled journal entry mapping everything to the correct expense and liability accounts, and outputs the net cash reduction required.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodStart": "2024-05-01",
  "periodEnd": "2024-05-31",
  "paymentDate": "2024-05-31",
  "wagesExpenseAccountId": "acc-wages-exp",
  "taxLiabilityAccountId": "acc-tax-liab",
  "cashAccountId": "acc-bank-1"
}
```

---

## 18. Project / Job Costing Engine
Links revenue and expense ledger lines to specific dimensional tags (Projects) to calculate exact Work In Progress (WIP) and operational profitability outside of the standard Chart of Accounts hierarchy.

### `GET /api/v1/reports/projects/:workspaceId`
Executes a specialized SQL aggregation returning recognized revenues, total expenses, and the net margin strictly bounded to specific `project_id` dimensions.

**Response:**
```json
{
  "success": true,
  "report": [
    {
      "project_id": "proj-999",
      "project_name": "Q3 Marketing Campaign",
      "budget": 50000,
      "recognized_revenue": 120000,
      "total_expenses": 45000,
      "net_profit": 75000
    }
  ]
}
```

## 19. Fixed Asset Disposal Engine
When an enterprise sells a physical asset (like a server or vehicle), it must calculate the net book value and clear out historical depreciation.

### `POST /api/v1/assets/:assetId/dispose`
Calculates the accumulated depreciation on a specific fixed asset, determines its current Net Book Value (NBV), and compares it against the cash `salePrice`. It automatically synthesizes a complex journal entry that debits cash, zeroes out the historical asset cost, clears the accumulated depreciation account, and accurately plugs the remainder into a Gain/Loss on Disposal account.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "disposalDate": "2024-06-15",
  "salePrice": 5000,
  "cashAccountId": "acc-cash",
  "gainLossAccountId": "acc-gain-loss"
}
```

---

## 20. Web3 / Digital Asset Tracking (FIFO / HIFO)
Enterprises holding cryptocurrency must track cost basis across multiple fragmented purchases (lots) to accurately report Capital Gains.

### `POST /api/v1/crypto/sell`
Executes a sale of digital assets. Based on the defined inventory method (e.g., FIFO or Highest-In-First-Out [HIFO]), the engine loops through historical `digital_asset_lots`, consuming partial quantities until the sale order is filled. It calculates the exact blended cost basis, compares it to the current spot price proceeds, and generates the exact Realized Capital Gain/Loss journal entry for tax reporting.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "assetId": "asset-btc-01",
  "sellQuantity": 1.5,
  "spotPriceUsd": 65000,
  "cashAccountId": "acc-bank-1"
}
```

## 21. Lease Accounting Engine (ASC 842 / IFRS 16)
Modern accounting standards require capitalizing operating leases onto the balance sheet. 

### `POST /api/v1/leases/:leaseId/recognize`
Calculates and synthesizes the complex monthly journal entries required for ASC 842 compliance. It dynamically calculates the Interest Expense on the Lease Liability, reduces the liability principal, and calculates the straight-line Amortization Expense of the Right-of-Use (ROU) Asset, generating all corresponding ledger lines automatically.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodDate": "2024-05-31"
}
```

---

## 22. Intercompany Transfer Pricing
For corporate groups, transferring costs or charging management fees between parent and child entities requires mirrored accounting entries.

### `POST /api/v1/intercompany/transfer`
Takes a base cost and applies a predefined `markup_percentage` (e.g., Cost Plus 10%). It automatically synthesizes *two separate journal moves in two different workspaces simultaneously*. It generates the Revenue entry in the Parent workspace and the corresponding Expense entry in the Child workspace, ensuring intercompany balances remain perfectly symmetrical for consolidation.

**Request Body:**
```json
{
  "agreementId": "ic-agmt-01",
  "periodDate": "2024-05-31",
  "baseAmount": 50000
}
```

## 23. Dimensional Cost Allocation Engine
Enterprise cost centers often require pooling indirect expenses (e.g., Rent, Utilities) and distributing them systematically across multiple departments.

### `POST /api/v1/allocations/run`
Executes an active `allocation_rule`. It calculates the net balance of a source account for the specific period, zeros out that unallocated balance via a credit/debit, and synthesizes multiple new journal lines distributing that exact balance proportionally (e.g., 60% / 40%) to the target `cost_center_ids` based on the predefined rule structure.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodDate": "2024-05-31",
  "ruleId": "alloc-rule-01"
}
```

---

## 24. Procurement & Three-Way Matching
Enterprise procurement requires tracking Purchase Orders (POs) independently from actual Vendor Invoices, utilizing an Accrued Purchases liability account during the timing gap between receiving goods and receiving the bill.

### `POST /api/v1/procurement/receive`
Records an Item Receipt against an issued Purchase Order. It automatically calculates the received value based on PO line prices and synthesizes the critical Accrued Purchases journal entry (Debiting Inventory/Expense, and Crediting the Accrued Liability account), transitioning the PO to `received` status.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "poId": "po-456",
  "receiptDate": "2024-06-01",
  "accruedLiabilityAccountId": "acc-accrued-ap",
  "inventoryAssetAccountId": "acc-inventory",
  "linesReceived": [
    {
      "poLineId": "po-line-1",
      "quantityReceived": 100
    }
  ]
}
```

## 25. Autonomous OCR Ingestion Pipeline
To eliminate manual data entry, the system can ingest raw images or PDFs (e.g., scanned receipts, vendor bills) and synthesize structured financial data.

### `POST /api/v1/ml/process-document`
Processes an uploaded `source_document`. It executes an OCR extraction to parse out the Vendor, Date, Total Amount, and Tax values. It instantly synthesizes a `draft` Vendor Bill in the invoicing subledger, attaching the extracted values and linking the original document for audit trails.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "documentId": "doc-pdf-888"
}
```

---

## 26. Machine Learning Account Prediction
LedgerFlow utilizes predictive algorithms to automatically suggest the correct Expense Account based on historical patterns for a given vendor.

### `POST /api/v1/ml/train-mapping`
When a user manually corrects or selects an account for a new vendor, this endpoint trains the internal prediction matrix. It executes an `UPSERT` against the `ml_account_predictions` table, increasing the `occurrence_count` and gradually raising the `confidence_score`. The next time an OCR document from that vendor is processed, the system will accurately auto-map the expense account.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "vendorName": "Amazon Web Services",
  "keyword": "Cloud Compute",
  "selectedAccountId": "acc-hosting-expense"
}
```

## 27. Manufacturing Assembly Engine (BOM Execution)
For hardware or manufacturing enterprises, assembling products requires pulling raw materials from inventory and capitalizing labor costs into a finished good.

### `POST /api/v1/manufacturing/assemble`
Consumes an active Bill of Materials (BOM) to "produce" a target quantity of finished goods. It dynamically calculates the required quantities of all component parts, determines their current cost basis, and synthesizes a journal entry that credits Raw Materials Inventory, credits Applied Direct Labor/Overhead, and debits the full capitalized cost into Finished Goods Inventory.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "bomId": "bom-01",
  "quantityToProduce": 500,
  "assemblyDate": "2024-06-15",
  "wipAccountId": "acc-raw-mat",
  "finishedGoodsAccountId": "acc-fin-goods"
}
```

---

## 28. Recurring Subscription Billing Engine
Modern SaaS and service businesses require automated invoice generation against active contracts.

### `POST /api/v1/billing/recurring-run`
Executes an automated billing cycle for a target month and year. It queries all `active` customer contracts, calculates the amortized monthly due amount, and synthesizes hundreds of `open` customer invoices instantaneously, queuing them for the Accounts Receivable ledger.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "targetMonth": 6,
  "targetYear": 2024
}
```

---

## 29. Automated Dunning & Collections Engine
Protecting cash flow requires ruthless enforcement of Accounts Receivable terms.

### `POST /api/v1/collections/dunning-run`
Scans the entire ledger for `open` customer invoices where the `due_date` has passed. It calculates the exact days overdue. If the invoice violates the late policy (e.g., > 30 days late), it automatically updates the outstanding subtotal and synthesizes a master journal entry assessing a 5% Late Fee to the AR balance and recognizing Late Fee Revenue. It also flags the accounts for automated notice dispatch.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "currentDate": "2024-06-30",
  "lateFeeAccountId": "acc-late-fee-rev",
  "arAccountId": "acc-ar"
}
```

## 30. Supply Chain: Landed Cost Capitalization Engine
When importing goods, the true cost of inventory includes freight, customs, and insurance. Expensing these immediately violates GAAP matching principles.

### `POST /api/v1/scm/landed-costs/allocate`
Connects an external freight vendor bill to a specific internal Item Receipt. It dynamically calculates the prorated allocation (by value or quantity) across all received item lines, synthesizing a journal entry that reverses the Freight Expense and capitalizes the exact landed cost directly into the **Inventory Asset** account.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "receiptId": "rcpt-01",
  "freightInvoiceId": "inv-freight-999",
  "allocationMethod": "value",
  "inventoryAssetAccountId": "acc-inventory",
  "freightExpenseAccountId": "acc-freight-in"
}
```

---

## 31. Human Capital: Travel & Expense (T&E) Automation
Corporate expense reports involve multi-line categorizations that must be accrued prior to payroll disbursement.

### `POST /api/v1/hcm/expenses/:reportId/approve`
Approves a submitted T&E report. It iterates through all individual expense lines, automatically synthesizing a balanced journal entry that debits the various categorized expense accounts (e.g., Meals, Travel, Supplies) and credits the total sum to a centralized **Employee Reimbursement Payable** liability account.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "approvalDate": "2024-06-15"
}
```

---

## 32. Corporate Treasury: Zero Balance Account (ZBA) Sweep Engine
Enterprise treasury teams use master-subsidiary account structures to pool liquidity overnight, requiring daily automated transfer entries.

### `POST /api/v1/treasury/sweep`
Executes an active `treasury_sweep_rule`. It calculates the live, real-time ledger balance of a subsidiary bank account, compares it against a defined `target_balance` (usually $0.00), and synthesizes the exact transfer journal entry required to sweep the excess cash up to the Master account, or fund the deficit cash down from the Master.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "ruleId": "sweep-rule-01",
  "sweepDate": "2024-06-30"
}
```

## 33. Debt & Loan Amortization Engine
When enterprises hold long-term debt, each monthly cash payment must be mathematically split between Interest Expense and Principal Reduction.

### `POST /api/v1/loans/:loanId/amortize`
Calculates the exact amortized payment required for a specific period based on the loan's current remaining principal balance, annual interest rate, and remaining term. It automatically synthesizes a journal entry that debits **Interest Expense**, debits the **Loan Liability** (reducing the principal), and credits **Cash** for the total payment amount.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodDate": "2024-05-31"
}
```

---

## 34. Deferred Revenue Waterfall Engine (ASC 606 Expansion)
For businesses selling annual subscriptions paid upfront, cash received cannot be immediately recognized as revenue. It must sit as a Liability (Deferred Revenue) and drain into the P&L over the service period.

### `POST /api/v1/revenue/deferred-run`
Executes a monthly waterfall run. It scans all active contracts, calculates the straight-line monthly recognition amount based on the contract term, and synthesizes a master journal entry. This entry debits the **Deferred Revenue** liability account (draining the balance sheet) and credits the **Recognized Revenue** income account (funding the P&L).

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodDate": "2024-05-31"
}
```

---

## 35. Real Estate: Common Area Maintenance (CAM) Allocation
Commercial Real Estate holding companies must distribute pooled property expenses (like landscaping or security) back to their tenants based on strict Pro Rata Share (PRS) metrics.

### `POST /api/v1/real-estate/cam-allocation`
Takes a pool of total CAM expenses for a property and dynamically allocates them across the property's rent roll based on each tenant's Pro Rata Share. It automatically generates individual CAM recovery invoices for every tenant, debits Accounts Receivable, and credits the **CAM Recovery Revenue** account.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "propertyId": "prop-hq-01",
  "periodDate": "2024-06-30",
  "totalCamExpenses": 45000,
  "arAccountId": "acc-ar",
  "camRevenueAccountId": "acc-cam-recovery"
}
```

## 36. Equity & Stock-Based Compensation (ASC 718)
High-growth startups and enterprises frequently grant RSUs or Options to employees, which must be expensed over the vesting term.

### `POST /api/v1/equity/sbc/amortize`
Calculates the straight-line monthly Stock-Based Compensation (SBC) expense based on the total shares granted, fair market value (409A valuation), and vesting schedule. It dynamically synthesizes a journal entry that debits **SBC Expense** and credits the equity **Additional Paid-In Capital (APIC)** account for all active grants within their vesting window.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodDate": "2024-05-31"
}
```

---

## 37. Fund & Non-Profit Accounting
Non-profits and research institutions must meticulously track restricted grant money vs. unrestricted operational money.

### `POST /api/v1/funds/:fundId/release`
Executes the release of restricted net assets once grant conditions are met. It synthesizes a complex journal move that debits the **Restricted Net Assets** account (reducing the restriction) and credits the **Unrestricted Net Assets** account (making the funds available for general operations).

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "releaseDate": "2024-06-30",
  "releaseAmount": 25000,
  "justification": "Completion of phase 1 research milestones"
}
```

---

## 38. Retail POS: Daily Cash Drawer Reconciliation
Physical retail environments require strict daily cash controls to identify employee theft or tender mismatch.

### `POST /api/v1/retail/drawers/:drawerId/reconcile`
Takes the physical cash count from a Point of Sale (POS) drawer shift and queries the ledger for the expected cash balance (based on posted sales receipts). It automatically computes the variance and synthesizes a journal entry booking any discrepancies directly to the **Cash Over/Short** account (either as an expense or miscellaneous revenue).

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "reconciliationDate": "2024-06-15",
  "actualCashCount": 495.50
}
```

## 39. Healthcare Revenue Cycle Management (RCM)
Hospitals and clinics deal with complex insurance claims where the "chargemaster" billed amount is never the amount actually paid. The difference must be reconciled as a Contractual Adjustment.

### `POST /api/v1/healthcare/claims/:claimId/remittance`
Processes an Electronic Remittance Advice (ERA) from an insurance payer. It takes the original billed amount, compares it to the Allowed Amount and Paid Amount, and synthesizes a complex journal entry. It debits Cash for the actual payment, debits the **Contractual Adjustment** (Write-Off) account for the unallowed portion, and credits AR, leaving only the patient's deductible/co-pay remaining on the ledger.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "remittanceDate": "2024-06-30",
  "paidAmount": 450.00,
  "allowedAmount": 500.00,
  "cashAccountId": "acc-cash",
  "adjustmentAccountId": "acc-contractual-adj"
}
```

---

## 40. Logistics: Activity-Based Fleet Depreciation
Straight-line depreciation does not work for trucking and logistics companies; vehicles depreciate based on physical mileage driven, not just time.

### `POST /api/v1/fleet/:vehicleId/depreciate`
Calculates Activity-Based Depreciation. The endpoint accepts a new odometer reading, calculates the `milesDriven` during the period, multiplies it by the vehicle's unique `depreciationRatePerMile` (Cost / Estimated Total Life Miles), and synthesizes a journal entry debiting **Depreciation Expense** and crediting **Accumulated Depreciation**.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "periodDate": "2024-06-30",
  "newOdometerReading": 125400.5,
  "depreciationExpenseAccountId": "acc-dep-exp",
  "accumulatedDepreciationAccountId": "acc-accum-dep"
}
```

## 41. Agriculture: Biological Asset Growth (IAS 41)
Farms and agricultural holding companies cannot treat livestock or crops like standard inventory; living assets grow in value over time before they are harvested.

### `POST /api/v1/agriculture/biological-assets/:assetId/revalue`
Executes an IAS 41 Fair Value adjustment. It accepts a new fair value appraisal for a biological asset (e.g., a herd of cattle), compares it to the previous recorded value, and automatically synthesizes a journal entry that debits the Asset account and credits an **Unrealized Gain on Biological Assets** account (or vice versa for a loss).

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "valuationDate": "2024-06-30",
  "newFairValue": 150000.00
}
```

---

## 42. Media & Entertainment: Multi-Party Royalty Distribution
Music labels, book publishers, and film studios receive a single gross revenue wire from a distributor (like Spotify) that must be instantly fractionated across dozens of contributors.

### `POST /api/v1/media/royalties/distribute`
Takes a gross revenue dump for a specific IP (e.g., a song) and loops through the attached `royalty_splits`. It dynamically calculates the fractional amounts owed to producers, writers, and performers. It synthesizes a massive journal entry that debits Cash for the gross receipt, credits individual **Royalty Payable** liability accounts for each contributor, and recognizes the remainder as Net Studio Revenue.

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "ipId": "ip-song-1",
  "periodDate": "2024-06-30",
  "totalRevenueGenerated": 100000.00,
  "cashAccountId": "acc-bank-1"
}
```

---

## 43. Multi-Document Payment Allocation Engine

### `POST /api/v1/payments`
Atomically records a customer or vendor payment, allocates settlement amounts across one or more open invoices/bills, updates document statuses (paid/partially_paid), and synthesizes a balanced General Ledger journal entry debiting Cash and crediting Accounts Receivable (or debiting Accounts Payable and crediting Cash).

**Request Body:**
```json
{
  "workspaceId": "ws-123",
  "paymentDate": "2024-06-30",
  "amountCents": 150000,
  "paymentMethod": "bank_transfer",
  "referenceNumber": "WIRE-99481",
  "customerId": "cust-456",
  "entityName": "Acme Corp",
  "cashAccountId": "acc-bank-101",
  "allocations": [
    {
      "documentId": "inv-001",
      "documentType": "invoice",
      "amountCents": 100000
    },
    {
      "documentId": "inv-002",
      "documentType": "invoice",
      "amountCents": 50000
    }
  ]
}
```

---

## 44. Server-Side Binary PDF Rendering

### `GET /api/v1/documents/:type/:id/pdf?workspaceId=:workspaceId`
Generates deterministic, pixel-perfect binary PDF documents (`application/pdf`) with `%PDF-` binary signatures for:
- `invoice` — Customer sales invoices with line items, tax breakdowns, discounts, and retainage.
- `estimate` — Customer sales proposals and quotes.
- `creditNote` — Customer credit memos and vendor credit vouchers.
- `payment` — Official payment receipts with document allocation tables.
- `statement` — Chronological customer/vendor balance statements with running balances.


## ETags and conditional requests (Z-05)

- Every `GET` answer carries an `ETag` header. Send it back as `If-None-Match` and an unchanged answer comes back as `304 Not Modified` with no body.
- An entry's version is its `updatedAt`. To update it only if nobody changed it since you read it, send `If-Match: "<updatedAt>"` with `PUT /api/v1/transactions/:id` (a full update or a `partialUpdate`). If it changed, the answer is `412 Precondition Failed` with `{"error": "version_conflict", "currentTransaction": {...}}` and nothing is saved. `If-Match: *` checks nothing. Sending `expectedUpdatedAt` in the body still works and answers `409` on a conflict.

## Sparse fieldsets (Z-04)

`GET /api/v1/transactions?workspaceId=…&fields=date,description,totalAmountCents` returns only those fields of each entry, plus its `id`. A field can name one level inside an object (`metadata.invoiceId`). At most 50 fields; a name that is not a field name answers `400`. Without `fields`, whole entries come back as before.

## Rate limits per API key (Z-02)

Requests made with an API key count against that key's own limit a minute (chosen when the key is made: 30 to 1,200 on the screen, 10 to 10,000 through `POST /api/v1/keys/provision` with `rateLimitPerMinute`; 120 otherwise), not against your IP address. Every answer carries `RateLimit-*` headers; over the limit, the answer is `429` with `{"code": "RATE_LIMIT_EXCEEDED"}` until the minute is over.

## Batch create (Z-03)

`POST /api/v1/transactions/batch-create` with `{"workspaceId": "...", "transactions": [ {...}, {...} ]}` creates up to 500 entries in one request, all or none. Each entry is checked exactly as `POST /api/v1/transactions` checks one (the schema, balanced lines, accounts in the workspace, the period lock, a unique id). The answer is `{"status": "success", "data": {"created": 3, "ids": [...]}}` with the ids in the order sent. If one entry is refused, nothing is written and the message names it by its index (`"Entry 1: ..."`: `400`, or `409` for a closed period or an id that already exists). A batch counts in full against the plan's entry limit (`402` when it would go over). Send an `Idempotency-Key` header to retry safely.

## OpenAPI description (Z-01)

`GET /api/v1/openapi.json` (no key needed) is an OpenAPI 3.1 description of the transaction endpoints, for Postman, code generators and other tools. The entry shape in it is generated from the schema the server checks requests with, so it always matches.

## TypeScript client (Z-06)

`sdk/ledgerflowClient.ts` is a small client with no dependencies (Node 18+ or a browser): copy the file into your project.

```ts
const lf = new LedgerFlowClient({ apiKey: process.env.LEDGERFLOW_KEY!, baseUrl: 'https://your-ledgerflow-address' });
for await (const entry of lf.listTransactions(workspaceId, { startDate: '2026-01-01', fields: ['date', 'totalAmountCents'] })) { /* every page */ }
const { ids } = await lf.createTransactions(workspaceId, [entryA, entryB]);   // all or none
await lf.updateTransaction(ids[0], { memo: 'Checked' }, { ifUpdatedAt: entry.updatedAt });  // 412 if changed since
```

It follows pages for you, sends an `Idempotency-Key` with every create (a retried request never creates twice), waits and retries when your key's limit a minute is reached, and throws `LedgerFlowError` (with `status` and the server's message) when a request is refused.
