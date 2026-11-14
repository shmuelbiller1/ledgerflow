# Checkpoint 03 — Accounting, Multi-Currency (JPY/KWD), Tax & Financial Reporting Audit (Agent #7 — 2026-11-13)

- **Live Verification:** `probe-04-non2dec-jpy-kwd-tax-and-gl-corruption.ts`, `probe-05-fx-reval-cutoff-and-depreciation-tamper.ts`, and `probe-06-statement-multicurrency-and-update-self-conflict.ts` (`exit 0`, zero stderr against PostgreSQL 16.2 `lf_test`).

---

## 1. `A7N-04` (P1 / Critical) — Systemic Non-2-Decimal Currency (`JPY` 0-Decimal / `KWD` 3-Decimal) 100x / 10x Errors & Live General Ledger Corruption

Every amount in LedgerFlow is stored in the **minor units of its own ISO 4217 currency** (`docs/design/BM-04-currency-minor-units.md`: `USD` = 2 decimals, `JPY` = 0 decimals, `KWD` = 3 decimals), while `exchangeRate` is stored in **major units of home currency per major unit of document currency** (`0.0067 USD/JPY`, `3.25 USD/KWD`). Converting minor units requires `convertMinorUnits(amount, rate, from, to)` (`rate * 10^(digits(to) - digits(from))`), **never** `Math.round(amount * rate)`.

Eight tax, compliance, prepaid, and export modules still multiplied raw minor units by `rate` (or divided by `/ 100`), verified live in `probe-04`:

| Module & Line | Defect | Live `probe-04` / Unit Result | Expected True Value | Fix |
|---|---|---|---|---|
| **`src/lib/taxRecompute.ts:78` + `taxRecomputeService.ts`** | `Math.round(calculateDocumentTax(doc) * rate)` on `¥100,000` + `¥10,000` JPY bill at `0.0067` | Computes `expectedTaxCents = 67` (`$0.67`) vs posted `6,700` (`$67.00`) and **posts a `-6,633c` (`-$66.33`) `tax-adjustment` journal entry into `transactions`**, corrupting Input VAT & Expense! | `expectedTaxCents = 6700`, `differenceCents = 0`, `0` adjustments posted | Patch `03` |
| **`src/lib/taxCodes.ts:242,265` (`computeTaxReturn`)** | `toBase = Math.round(cents * rate)` | `JPY` Box 1 = `67` (`$0.67`, **100x understated**); `KWD` `10,000` fils (`10.000 KWD`) at `3.25` Box 1 = `32,500` (`$325.00`, **10x overstated**) | `JPY`: `6,700` (`$67.00`); `KWD`: `3,250` (`$32.50`) | Patch `03` |
| **`src/lib/taxReturnDocs.ts:98,116` (`taxByRate`)** | `toBase = Math.round(cents * rate)` | `salesTaxCents = 67` (`$0.67`) | `6,700` (`$67.00`) | Patch `03` |
| **`src/lib/tax/ilVatReturn.ts:74-75` + `taxReturnService.ts:31-38`** | Inherits `buildTaxReturn` 100x JPY bug **and** `computeWorkspaceTaxReturn` ignores `israelVatReturn` on `vat:IL:*`, dropping `fixedAssetInputVatCents` (Tshumot Kvu'ot) | `fixedAssetInputVatCents = 67`; `wsTaxReturnHasFixedAssetBox = false` | `6,700`; boxes `4a` (`Fixed-asset input VAT`) & `4b` (`Other input VAT`) included | Patch `03` |
| **`src/lib/tax/ilAllocation.ts:30` (`needsAllocationNumber`)** | `Math.round(input.netCents * exchangeRate)` on `¥5,000,000 JPY` B2B invoice at `0.024 ILS/JPY` (`₪120,000` = `12,000,000` agorot vs `500,000` agorot Oct-2026 ITA threshold) | Computes `120,000` agorot (`₪1,200`) -> returns `false`, **skipping mandatory 9-digit ITA allocation number**! | `true` (`12,000,000 > 500,000` agorot) | Patch `03` |
| **`src/lib/tax/usNexusWatch.ts:80,154`** | `toBase = Math.round(cents * rate)` on `¥20,000,000 JPY` Washington sales at `0.0067` (`$134,000` USD vs `$100,000` WA economic nexus threshold) | Computes `salesCents = 134,000` (`$1,340.00`) -> **`crossed: false`**, hiding statutory US state sales-tax registration obligation! | `salesCents = 13,400,000` (`$134,000.00`), `crossed: true` | Patch `03` |
| **`src/lib/tax/usSalesTaxReturn.ts:52,88`** | `toBase = Math.round(cents * rate)` | `taxCollectedCents = 67` (`$0.67`) | `6,700` (`$67.00`) | Patch `03` |
| **`src/lib/prepaidSchedule.ts:87` (`documentLine`)** | `Math.round(best[1] * rate)` | `baseCents = 670` (`$6.70`) | `67,000` (`$670.00`) | Patch `03` |
| **`src/lib/plExport.ts:39-76` (`exportPlToExcel`)** | Hardcoded `/ 100` on every P&L cell **plus** unguarded `(prevData?.income?.accounts as ...)[id]` crash when `prevData === null` | Crashes `TypeError` when `isComparative === false`; divides `¥100,000` by `100` (`1,000`) and `KWD 50.000` (`50,000` fils) by `100` (`500`) | **FIXED ON BRANCH** (`src/lib/plExport.ts` + `agent7-ui-and-export-regressions.test.tsx`) | Committed |

---

## 2. `A7N-05` (P1 / High) — Historical `revaluateForeignBalances` (`fxRevaluationService.ts`) Ignores `asOf` Cutoff Date and Drops Bill `apAccountId`

- **File:** `src/server/services/fxRevaluationService.ts:116-126, 207-215`
- **Live Reproduction (`probe-05`):**
  1. `INV-SEP-001` (`€1,000` issued `2026-09-10` at `1.10`, paid `2026-10-15`) was **open on `2026-09-30`**, yet running `revaluateForeignBalances({ date: '2026-09-30', rates: { EUR: 1.20 } })` **completely skipped it** (`expectedSepInvoiceIncluded: false`) because it checked current `status === 'paid'` instead of settlements as of `2026-09-30`.
  2. `BILL-OCT-002` (`€2,000` dated `2026-10-05`, after cutoff!) **was erroneously revalued into the `2026-09-30` journal entry** (`futureOctBillIncludedInSepReval: true`), because `toRevaluable` never filtered `doc.date <= date`.
  3. `BILL-OCT-002` specified `apAccountId: 'acc_ap_custom'`, yet line 123 passed `undefined` for all vendor bills (`side === 'customer' ? String(row.arAccountId || '') || undefined : undefined`), posting `-20,000c` to the default A/P account instead of the bill's A/P account (`billUsedDefaultApInsteadOfCustomAp: true`).
- **Remediation:** `audit/agent7-2026-11-13/patches/04-fx-revaluation-asof-cutoff-and-ap-account.patch`.

---

## 3. `A7N-07` & Financial Statement Integrity (`computeStatement`, `computeTrialBalance`, `computeCashFlow`)

1. **`computeStatement` Multi-Currency Summing Bug (`src/server/reports/computeReports.ts:378-485` — `probe-06`):**
   - `computeCustomerBalanceSummary` converts each document via `toBaseCents` (`€500` at `1.00`/`$500` + `¥100,000` at `0.0067` = **`117,000` USD cents** = `$1,170.00`), whereas `computeStatement` summed raw `inv.amountCents` across currencies (`50,000 + 100,000 = 150,000` = **`$1,500.00`**), creating a `$330.00` discrepancy between Customer Statement and Customer Balance Summary for the same customer!
2. **`computeTrialBalance` Silent Orphan Drop (`computeReports.ts:183-196`):**
   - Lines referencing deleted/missing `accountId`s were skipped (`if (trialBalance[line.accountId])`), allowing a ledger with orphaned legs to report `isBalanced: true` or hide missing accounts instead of surfacing an explicit `Orphaned / Missing Account` row.
3. **`computeCashFlow` Asset Disposal Misclassification (`computeReports.ts:253-268`):**
   - Direct-method `computeCashFlow` iterates non-cash legs of cash-bearing entries; on an `asset-disposal` entry (`DR Cash, DR Accum Dep, CR Fixed Asset, CR Gain on Disposal`), the non-cash `Gain on Disposal` income leg was bucketed into `operating` (`-gain`) while `Cost - Accum Dep` went to `investing`, understating `investing` cash proceeds by the gain (or overstating by the loss) instead of attributing actual cash proceeds (`cashDelta`) to `investing`.
- **Remediation:** `audit/agent7-2026-11-13/patches/06-reporting-statement-tb-cashflow-and-unposted-filter.patch`.
