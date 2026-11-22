# Loans & Non-2-Decimal Currency Input Review

Scope: `src/lib/loanSchedule.ts`, `src/lib/loans.ts`, `src/components/finance/LoansView.tsx`, `src/server/commands/loans.ts`, `src/lib/moneyFormat.ts`, `src/lib/currencyMinorUnits.ts`, `src/modules/integrity/TruthEngine.ts`, `src/components/onboarding/OpeningBalancesSetup.tsx`, `src/server/services/openingBalanceService.ts`, `src/components/transactions/TransactionEditModalView.tsx`, `src/components/transactions/SplitEditor.tsx`.

Existing automated coverage run: `src/tests/loans.test.ts`, `src/tests/loans-view.test.tsx`, `src/tests/loan-asset-commands.test.ts` (27/27 passed against isolated local PostgreSQL).

---

## MU-01 — P0: Zero-decimal (JPY) and three-decimal (KWD) input screens scale amounts by `100` while display and ledger storage follow ISO 4217 minor units (`100×` overstatement in JPY, `10×` understatement in KWD)

**Architectural contract (`src/lib/currencyMinorUnits.ts:1–7`):** Every stored integer is in the **minor units of its own currency** (`currencyDigits('JPY') === 0`, `currencyDigits('USD') === 2`, `currencyDigits('KWD') === 3`), and `formatCurrency` / `formatMoney` divide by `10 ** currencyDigits(currency)`.

**Defect:**
1. `OpeningBalancesSetup.tsx:30, 88` labels the input column `Balance (${currency})`, yet parses each typed major-unit value with `TruthEngine.parseAmountToCentsOrZero(amounts[a.id] || '0')` **without passing `currency`** (defaulting `currencyDigits(undefined)` to `2`, i.e. `× 100`).
2. `moneyFormat.ts:172–201` (`parseAmountToCents` / `readAmountCents`) hardcodes `.mul(100)` with no currency parameter at all, and is called by `LoansView.tsx:90` (`principalCents`), `TransactionEditModalView.tsx:438–440` (paired with `formatDecimal`, which also divides by `100`), `SplitEditor.tsx:202–217`, `ExpenseClaims.tsx:40–43`, `EstimateLinesEditor.tsx:62`, `EstimateDepositDialog.tsx:37`, and `OrderInvoiceDialog.tsx:50`.

**Independently worked figures:**
- **JPY opening balance:** User enters `1000000` (`¥1,000,000`). Expected stored minor units: **`1,000,000`** (`¥1,000,000`). Actual UI payload and posted balance-sheet asset/equity balance: **`100,000,000`** (**`¥100,000,000`** — **100× overstated**).
- **KWD opening balance:** User enters `1000.125` (`KWD 1,000.125`, 1,000,125 fils). Expected stored minor units: **`1,000,125`**. Actual UI payload: **`100,013`** (**`KWD 100.013`** — **10× understated** plus 2-decimal rounding loss).
- **JPY loan principal:** User enters `1000000` (`¥1,000,000`) in `LoansView`. Expected `principalCents`: **`1,000,000`**. Actual saved command payload: `currency: 'JPY'`, `principalCents: 100_000_000` (**`¥100,000,000`**).

**Evidence & boundaries:** `minor-unit-inputs-ui.test.tsx` exercises the real `OpeningBalancesSetup` and `LoansView` components in simulated DOM; `opening-balance-jpy-database.test.ts` posts that exact opening-balance payload through the real `/api/v1/workspaces/:id/opening-balances` route into isolated local PostgreSQL and reads `/api/v1/reports/balance-sheet`. Not an authenticated real-browser click-through.

**Acceptance criteria:** Every currency-amount parser and input formatter must thread the active document or workspace ISO 4217 currency (`currencyDigits(currency)`), with round-trip regression tests for 0-decimal (`JPY`, `KRW`), 2-decimal (`USD`, `EUR`), and 3-decimal (`KWD`, `BHD`, `JOD`) currencies across opening balances, loans, journal editing, estimates, orders, and expense claims.

---

## LN-01 — P1: UI-created loan references truncate to 4 hex digits (`LOAN-LOANxxxx`, 65,536 possibilities) and link ledger entries by `reference` alone

**Mechanism:**
1. `LoansView.tsx:200, 217` mints `const id = secureId('loan-')` (`"loan-" + UUID`) and computes `reference: newLoanReference(id)`. Also note `useEntityOperations.ts:314–317` overwrites `record.id` with a fresh `docId` while keeping `record.reference` derived from the discarded `id`.
2. `newLoanReference` (`src/lib/loans.ts:121–123`) strips non-alphanumerics and slices the first 8 characters: `'loan-abcd1111-...'` becomes `'LOAN-LOANABCD'` — the `'LOAN'` prefix consumes half of the 8-character budget, leaving only **16 bits (4 hex digits = 65,536 values)** of entropy (~50% collision probability around 302 loans; ~1.9% at 50 loans).
3. Neither `createLoanDisbursementEntry` nor `createLoanPaymentEntry` stores `loanId` in `metadata`; `LoansView.tsx:397`, `recordedInstallments` (`loans.ts:210`), and `loanLedgerCents` (`loans.ts:229`) match ledger entries solely via `tx.reference === loan.reference`.

**Worked case (`loan-reference-collision-ui.test.tsx`):** Loan 1 (`loan-abcd1111-...`) posts payment #1 of $500.00 against `loan` liability with `reference: 'LOAN-LOANABCD'`. Loan 2 (`loan-abcd2222-...`, $1,000.00 principal, 0% over 2 months, **no entries of its own**) receives the same `LOAN-LOANABCD` reference. On `LoansView`, Loan 2 immediately displays **"In the books"**, hides **"Record the $1,000.00 arriving"**, counts installment #1 as already paid, displays **$500.00 still owed** instead of **$1,000.00**, and computes `loanLedgerCents = -50_000` (-$500.00).

**Acceptance criteria:** Persist and match by immutable `metadata.loanId` (with backward-compatible fallback only when `loanId` is absent), preserve caller-minted or server-returned `loan.id` consistently, and strip any `'loan-'` prefix before generating human-readable references with sufficient entropy or per-workspace uniqueness enforcement.

---

## LN-02 — P2: Loan amortization ignores the elapsed days/months between `startDate` and `firstPaymentDate`

**Mechanism:** Both `LoansView.tsx:359–366` and `buildLoanSchedule` (`src/lib/loanSchedule.ts:84–115`) expose separate **Money arrived** (`startDate`) and **First payment** (`firstPaymentDate`) dates and allow any `firstPaymentDate > startDate`. However, installment #1 interest is always `interestForMonthCents(principalCents, annualRate)` (`principal * annualRate / 12`), and subsequent due dates step monthly from `firstPaymentDate` without adjusting for a long payment holiday or short stub period.

**Independently worked figures (`loan-grace-interest.test.ts`):**
- **$100,000.00 loan at 12% p.a., `startDate = 2026-01-01`, `firstPaymentDate = 2026-04-01` (3-month grace period), 12 monthly payments:**
  - Expected interest accrued by `2026-04-01`: **$3,000.00** (simple monthly `3 × 1%`), **$3,030.10** (monthly compounding), or **$2,958.90** (ACT/365, `90/365 × 12%`).
  - Actual schedule installment #1 interest: **$1,000.00** (2 months / ~$2,000.00 of grace-period interest omitted).
- **$100,000.00 loan at 12% p.a., `startDate = 2026-01-25`, `firstPaymentDate = 2026-02-01` (7-day stub):**
  - Expected ACT/365 7-day interest: **$230.14** (`7/365 × 12%`).
  - Actual schedule installment #1 interest: **$1,000.00**.

**Scope & nuance:** Real-world loan agreements use varied day-count conventions (30/360, ACT/365, ACT/360, compounded vs simple odd-period interest). Either restrict the schedule calculator to regular 1-month first periods (with explicit UI disclosure and manual adjustment support for irregular loans) or implement explicit day-count / odd-first-period interest calculation and period-end accrued-interest support.

---

## Reproduction Commands

```bash
NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit \
  audit/accounting-review-2026-11-22/loan-reference-collision-ui.test.tsx \
  audit/accounting-review-2026-11-22/loan-grace-interest.test.ts \
  audit/accounting-review-2026-11-22/minor-unit-inputs-ui.test.tsx

LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
  npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/opening-balance-jpy-database.test.ts
```
