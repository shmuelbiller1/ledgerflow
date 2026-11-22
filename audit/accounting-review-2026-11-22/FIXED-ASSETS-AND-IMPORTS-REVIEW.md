# Fixed Assets, Bank Statement Imports & API Retry Idempotency Review

Scope: `src/lib/depreciationEngine.ts`, `src/server/services/depreciationService.ts`, `src/server/commands/assets.ts`, `src/server/services/assetDisposalService.ts`, `src/server/services/placeInServiceService.ts`, `src/lib/assetDisposal.ts`, `src/lib/assetFromBill.ts`, `src/components/assets/FixedAssetsView.tsx`, `src/lib/camt053Parser.ts`, `src/lib/ofxParser.ts`, `src/server/services/fxRevaluationService.ts`, `src/lib/fxRevaluation.ts`, `src/tests/security-s5-idempotency-matrix.test.ts`.

Existing automated coverage run: `assets-fx-imports-suite.log` — 40/40 passed against isolated local PostgreSQL (`asset-disposal.test.ts`, `asset-from-bill.test.tsx`, `depreciation-schedule.test.tsx`, `fx-revaluation.test.ts`, `integrations-formats.test.ts`).

---

## FA-01 — P1: Capitalized subsequent asset costs (`asset.costaddition`) are depreciated retroactively back to the original purchase date instead of prospectively over remaining life

**Authoritative accounting principle (IAS 16 ¶55, IAS 8 ¶36–37 / ASC 360-10-35):** Depreciation of an asset or subsequent capitalized expenditure begins when it is available for use, and revisions to depreciable carrying amount are recognized **prospectively** over the remaining useful life (or depreciated as a separate component from its own in-service date) — never retroactively as a prior-period catch-up on expenditure that did not yet exist.

**Mechanism:** `assetCostAdditionCommand` (`src/server/commands/assets.ts:182–212`) appends `{ date, amountCents }` to `costAdditions` and increments `purchasePriceCents`, advertising `period.depreciation` as the next step (`line 237`). However, `depreciationEngine.ts:30–59` (`monthlyAmounts` and `depreciationThrough`) ignores `costAdditions` and divides the entire updated `purchasePriceCents` over the full original useful life starting from `asset.purchaseDate`, while `runDepreciation` (`depreciationService.ts:65–67`) posts `depreciationThrough(asset, month) - accumulatedDepreciationCents`. Also note `asset.costaddition` does not check whether `existing.status === 'disposed'`.

**Independently worked vs actual figures (`asset-cost-addition-database.test.ts`):**
- Delivery van bought `2025-01-15` for **$12,000.00**, 2-year straight-line (`$500.00/month`), `$0` salvage; 12 months depreciated through `2026-01` (`$6,000.00` accumulated, `$6,000.00` remaining carrying value, 12 months remaining life).
- On `2026-02-10`, **$2,400.00** of shelving is capitalized via `/api/v1/commands/asset.costaddition`, followed by `runDepreciation` for `2026-02`.
- **Expected prospective Feb 2026 depreciation** over the remaining 12 months: `($6,000 + $2,400) / 12` = **$700.00** (`70,000` cents) (or `$500.00` in Feb 2026 if the new component starts the month after addition).
- **Actual posted Feb 2026 depreciation and P&L expense:** `13 × ($14,400 / 24) − $6,000 = $7,800 − $6,000` = **$1,800.00** (`180,000` cents) — dumping **$1,200.00** (12 months of 2025 catch-up) into February 2026 expense for shelving bought in February 2026, and understating subsequent months (`$600/mo` instead of `$700/mo`). If a cost addition is recorded after the original useful life has elapsed, 100% of the capitalized addition is expensed in a single month.

**Acceptance:** Track component schedules or compute prospective depreciation from each addition's effective month over remaining (or component-specific) useful life, refuse cost additions on disposed assets, and reconcile fixed-asset subledger carrying values to the general ledger.

---

## FA-02 — P1: Creating a fixed asset from a bill (`assetCandidates` / `FixedAssetsView`) copies raw split `amountCents`, breaking subledger-to-GL tie-out on foreign-currency and tax-inclusive bills

**Authoritative accounting principle (IAS 16 ¶16(a), IAS 21 ¶21):** Initial recognition of PPE is measured in the functional currency at the spot exchange rate on the transaction date, **excluding refundable purchase taxes** and net of trade discounts, matching the amount capitalized to the fixed-asset general-ledger account.

**Mechanism:** `assetCandidates` (`src/lib/assetFromBill.ts:28–45`) and `FixedAssetsView.tsx:96–101` (`pickBillLine`) copy `line.amountCents` directly into `costCents` and format `(c.costCents / 100).toFixed(2)` without converting `bill.currency` at `bill.exchangeRate` (or scaling non-2-decimal currencies) and without stripping recoverable input tax on `taxInclusive` bills (which `TransactionTemplates.buildBillLines` posts to `Input Tax Recoverable`, debiting only the net amount to `Equipment`).

**Independently worked vs actual figures (`asset-from-bill-database.test.ts`):**
- **Foreign-currency bill (`EUR` 10,000.00 at `1.15 USD/EUR`):** Real bill posting debits `Equipment` GL **$11,500.00** (`1,150,000` USD cents), but `assetCandidates` supplies **`$10,000.00`** (`1,000,000` cents) to the Fixed Asset Register (**$1,500.00** understated vs GL).
- **Tax-inclusive bill (`USD` $1,100.00 gross including $100.00 recoverable input VAT):** Real bill posting debits `Equipment` GL **$1,000.00** (`100,000` cents) and `Input Tax Recoverable` **$100.00**, but `assetCandidates` supplies **`$1,100.00`** (`110,000` cents) to the Fixed Asset Register (**$100.00** overstated vs GL, causing cumulative depreciation and disposal write-offs to exceed the GL Equipment balance).

**Acceptance:** Derive `assetCandidates` cost in workspace functional currency minor units from the net capitalized amount actually posted to the fixed-asset GL account (accounting for `currency`, `exchangeRate`, `currencyDigits`, `taxInclusive` recoverable tax, and purchase discounts).

---

## IM-01 — P1: ISO 20022 CAMT.053 bank statement parser (`parseCamt053Statement`) scales 0-decimal (`JPY`) by `100×` and 3-decimal (`KWD`) by `0.1×`

**Mechanism:** Unlike `parseOFXStatement` (`ofxParser.ts:75`, which explicitly refuses non-2-decimal currencies), `parseCamt053Statement` (`src/lib/camt053Parser.ts:124–180`) extracts `Ccy="..."` onto the parsed bank line while computing `amountCents` with hardcoded 2-decimal `whole * 100` arithmetic (`parseAmountToCents` at `:124–140`).

**Independently worked vs actual figures (`camt053-minor-units.test.ts`):**
- `<Amt Ccy="JPY">10000</Amt>`: expected `amountCents = 10_000` (`¥10,000`); actual `amountCents = 1_000_000` (`¥1,000,000` — **100× overstated**).
- `<Amt Ccy="KWD">100.125</Amt>`: expected `amountCents = 100_125` (`KWD 100.125`); actual `amountCents = 10_013` (`KWD 10.013` — **10× understated** and rounded to 2 decimals).

**Acceptance:** Parse `<Amt Ccy="...">` using ISO 4217 minor-unit precision (`currencyDigits(currency)`) and reject fractional digits exceeding the currency's exponent rather than silently rounding or mis-scaling.

---

## ID-01 — P2: Headerless API retries on `/api/v1/transactions`, `/api/v1/payments`, and `/api/v1/transactions/intercompany/post` double-post (`#942` open in broad DB suite)

**Observation (`full-database-suite.log` / `src/tests/security-s5-idempotency-matrix.test.ts:221–268`):** The broad isolated-database test suite (`7,329` tests: `7,326` passed, `1` module-load timing failure, `1` skipped, `1` todo) surfaces an open `todo` test (`S-5 #942`) where sending two identical `POST` requests without `x-operation-id` to `/api/v1/transactions`, `/api/v1/payments`, and `/api/v1/transactions/intercompany/post` returns `200` on all six calls and creates **6** ledger entries in `wsA` instead of **3**. While the in-app `runCommand` browser wrapper supplies `x-operation-id`, external API/SDK/webhook/proxy callers retrying without that header can duplicate posted journals, payments (when open invoice balance permits or unapplied), and intercompany transfers.

**Acceptance:** Require `Idempotency-Key` / `x-operation-id` on mutating financial endpoints (or enforce deterministic request-window deduplication) and turn `S-5 #942` from `todo` into an enforced passing test before public API release.

---

## Reproduction Commands

```bash
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx -y node@24 --import tsx --test --test-force-exit \
  audit/accounting-review-2026-11-22/asset-cost-addition-database.test.ts \
  audit/accounting-review-2026-11-22/asset-from-bill-database.test.ts \
  audit/accounting-review-2026-11-22/camt053-minor-units.test.ts
```
