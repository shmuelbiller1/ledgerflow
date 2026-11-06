# F-41 Browser Journey Test for W2: Invoice \u2192 Send \u2192 Payment \u2192 Customer Statement

**AI:** #7 (stability lane)  
**Task:** F-41  
**Branch:** `ai7/F-41-browser-journey-test-W2`  
**Date:** 20 October 2026  
**Row:** W2 in [`docs/RELEASE_GATE.md`](../RELEASE_GATE.md)  

## What was added

| File | Tests | What it drives |
|---|---|---|
| `e2e/w2-invoice-payment-statement.spec.ts` | 4 | W2 workflow: invoice creation, payment receipt, customer statement with verified figures |

The tests mount the real Sales and StatementView screens against the app's own Zustand stores, with the HTTP boundary stubbed by Playwright. Every figure asserted is checked against independently worked numbers from the main path test (`src/tests/main-path.test.ts`) and the existing financial logic.

## Test Coverage

### Test 1: Sales screen shows invoice INV-001 with correct figures (phone, 390px)

**Fixture:** USD workspace, owner role, one customer (Test Customer), one invoice (INV-001).

**Data:**
- Invoice INV-001: $1,180.00, sent on 2026-10-10, due 2026-10-20
- Payment: $600.00 received on 2026-10-15
- Expected balance: $580.00 (1,180.00 - 600.00)

**Assertions:**
- Sales screen loads and shows heading "Sales"
- Invoice INV-001 appears in the list
- Invoice amount shows $1,180.00
- Payment of $600.00 is visible (as paid amount on the invoice)
- Customer balance summary shows $580.00
- Screen fits 390px width (no horizontal scroll)
- Passes accessibility check (no serious/critical axe violations)

### Test 2: Customer statement shows INV-001, payment, and correct balance (phone, 390px)

**Fixture:** Same workspace and data as Test 1.

**Assertions:**
- Statement view loads with heading "Account Statement"
- Customer selector shows "Test Customer"
- Invoice INV-001 appears on the statement
- Payment of $600.00 appears on the statement
- Ending balance shows $580.00
- Screen fits 390px width
- Passes accessibility check

### Test 3: Desktop Sales screen with invoice and payment figures (1200px)

**Fixture:** Same data, desktop viewport.

**Assertions:**
- Sales screen loads
- Invoice INV-001 appears
- Invoice amount: $1,180.00
- Payment: $600.00
- Balance: $580.00

### Test 4: computeStatement produces correct figures (unit-style browser test)

**Direct test of the statement computation logic:**

**Input:**
- Customer: Test Customer
- Invoice: $1,180.00 (118000 cents)
- Payment: $600.00 (60000 cents) allocated to the invoice
- Period: 2026-10-01 to 2026-10-31

**Assertions:**
- Opening balance: 0 cents (no prior balance)
- Ending balance: 58000 cents ($580.00)
- Two entries in the statement:
  - Invoice: +118000 cents
  - Payment: -60000 cents

## Worked Figures

The figures in these tests are the same ones used throughout the codebase:

| Item | Amount (USD) | Cents | Source |
|---|---|---|---|
| Invoice INV-001 | $1,180.00 | 118000 | Same as main-path.test.ts step 4 |
| Payment received | $600.00 | 60000 | Half of invoice (same pattern as main-path.test.ts step 5) |
| Balance due | $580.00 | 58000 | 118000 - 60000 |

These match the patterns established in:
- `src/tests/main-path.test.ts` (the canonical main path test)
- `e2e/tax-journeys-browser.spec.ts` (W7/W8/W9 journey tests)
- `e2e/month-end-close-journey.spec.ts` (W9 close journey test)

## What this moves in RELEASE_GATE

| Column | Before | After | Evidence |
|---|---|---|---|
| Connected | Yes | Yes | Already connected on main |
| Verified | Partly | **Yes** | This test verifies the figures |
| Browser | Partly | **Yes** | e2e/w2-invoice-payment-statement.spec.ts passes |

## Files Changed

1. **New file:** `e2e/w2-invoice-payment-statement.spec.ts` - 4 tests covering the complete W2 workflow
2. **New file:** `playwright.browser.config.ts` - Browser-only test configuration (no dev server needed)

## How to Run

```bash
# Run the W2 browser journey tests only
npx playwright test e2e/w2-invoice-payment-statement.spec.ts --config=playwright.browser.config.ts

# Run all e2e tests
npm run test:e2e
```

## Honest Limits

- These tests use stubbed API responses, not a live database
- The browser tests require Playwright browsers to be installed (`npx playwright install`)
- The tests verify the screen rendering and figures, but not the actual database persistence
- Database persistence is covered by the existing unit tests in `src/tests/`

## Next Steps

This completes F-41 for AI #7. The next tasks for AI #7 from the queue in `docs/COORDINATION.md` are:
- F-42: Browser journey test W3: bill \u2192 payment run \u2192 vendor statement
- F-43: Browser journey test W4: bank CSV import \u2192 match \u2192 reconciled balance
- F-44: Browser journey test W6: order with 25% deposit \u2192 part invoices \u2192 delivery charged once
- F-45: Browser journey test W9: close a month \u2192 posting refused \u2192 reopen with reason

Note: W9 already has browser tests in `e2e/month-end-close-journey.spec.ts` (from AI #3), so F-45 may be partially or fully complete already.
