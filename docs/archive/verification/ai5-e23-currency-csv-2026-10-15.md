# AI #5 E-23 payment-method CSV precision follow-up (15 October 2026)

## Verified problem
The registered Money in and out by payment method panel displays original-currency amounts with `formatCurrency(amount, row.currency)`, but its CSV exported the same integer minor units with `csvMoney`, which always emits **two fractional digits**. For zero-minor-unit JPY and three-minor-unit BHD/KWD this misstates the numerical amount despite the method/currency grouping being correct.

## Change
- Use a small `paymentMethodCsvAmount` helper that formats safe integer minor units at the shared `getCurrencyFractionDigits(currency)` scale.
- Convert the integer with `BigInt` division/remainder instead of floating-point rounding. Preserve negative values, zero and leading fractional zeroes.
- Route the two payment-method export amount columns through the helper. Do not change CSV escaping, payment calculation, stored records, status rules, account postings, existing report totals, dates, or migrations.
- Add focused regression examples: USD=2 places, JPY=0, BHD/KWD=3, negative, zero, maximum safe integer, unsafe/refused values.

## Validation / risk
- This environment can edit the linked GitHub repository through the connector, but cannot clone it over the network. Full repository TypeScript/lint/unit/E2E tests have **not** been run locally. GitHub PR CI is the required integration test; do not label this done or green until it passes and the acting lead reviews it.
- Pre-existing main CI at `f6d189a` is red on Playwright visual baselines (see issue #136 and run 38752930297); production build, type/lint and timezone unit-test jobs passed. Do not update screenshot baselines without inspecting actual vs expected.
- This fix makes the **existing read-only report export faithful to the currency**; it is not a general fix to the shared CSV writer (whose two-decimal contract has other consumers).
- The report still uses a workspace browser collection that may be incomplete; existing warnings and export guards remain. Accounting/bookkeeping reconciliation and authoritative full-history verification are separate.
