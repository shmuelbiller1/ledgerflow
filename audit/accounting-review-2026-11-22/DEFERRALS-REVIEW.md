# Prepaid and deferred-revenue schedules — partial review

## DR-01 — P1: taxable invoice's gross amount can be spread as revenue, exceeding actual revenue

**Worked example:** Issue a taxable service invoice for **$100 revenue + $10 separately accounted output tax = $110 A/R**, before any income is earned. The tax liability is not revenue. Select a two-month income spread beginning in March, for the gross $110. On the February invoice date, the real posting and spread routes produce A/R debit $110, output tax credit $10, deferred revenue credit **$110**, and sales **debit $10** (negative income). The February P&L route reports **−$10 income**. For the stated accounting assumption — all $100 of service revenue earned equally in March and April and tax remains separately recognized — the initial balances should instead be A/R debit $110, tax credit $10, deferred revenue credit **$100**, and $0 income; March and April each recognize $50. The diagnostic directly verifies the February output; it does not assert the later-month report was independently tested.

**Evidence and path:** `spread-gross-database.test.ts` uses the real document, spread and P&L routes with synthetic owner identity and local PostgreSQL. `prepaidService.ts:88–104` limits the amount to the document's gross `amountCents`, not to income actually posted to the chosen revenue account, and `:114–141` posts the specified amount to that revenue account and deferred revenue. `SpreadDialog.tsx:78–110, 155–158` suggests the largest related line but permits the user to change the amount to any value through gross and submit it. The test sends that permitted amount via the route; it is not an authenticated UI click-through. Choosing an unrelated revenue account or a prepaid bill including tax could have related effects but were not independently tested. A correct amount may depend on treatment of discounts, multiple obligations, tax, FX and the relevant framework, so the server should derive and validate against the actual eligible posting and preserve a clear basis, not simply subtract tax in every possible case.

**Acceptance:** Validate chosen account and deferrable amount against the source posting, identify net revenue/expense independently of tax, handle multiple lines/discounts/FX and adjustments, and reconcile schedule, journal, liability/prepaid balance and period reports. Explain any override and require a balancing, reviewable adjustment instead of silently overstating the schedule.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/spread-gross-database.test.ts
```

1 diagnostic passed while asserting the defect. The initial fixture lacked the required synthetic Cash account and returned 400; after adding the account the route reproduced the defect. The related [RP-08](REPORTING-REVIEW.md) separately reproduces a cash-basis schedule interaction.

---

## DR-02 — P1: editing a spread invoice or bill replaces its document posting while leaving the larger active deferral/prepaid schedule intact

**Worked example:** Post a February 1 invoice `INV-1` (`status: 'sent'`) for **$1,200.00** (`DR A/R $1,200`, `CR Sales $1,200`), and spread its **$1,200.00** revenue over March–May (`$400.00/month`). Then update `INV-1` via `action: 'update'` (`status: 'sent'`) down to **$300.00** (or change its revenue account / date). Because `documentPostService.ts:172, 237–252` checks `existing.revenueSchedule || existing.prepaidSchedule` only on `action === 'delete'`, and `invoicePosting.ts:27–30` (`billPosting.ts:26–29`) blocks only `unposting` (`draft`, `rejected`, `void`, `cancelled`), the update succeeds (`200 OK`): the original `$1,200` invoice journal is reversed and replaced with `$300` (`DR A/R $300`, `CR Sales $300`), while the `$1,200` deferral entry (`DR Sales $1,200`, `CR Deferred Revenue $1,200`) and three `$400` recognition entries remain active.

**Independently worked vs actual figures (`spread-edit-database.test.ts`):**
- On a `$300.00` invoice fully deferred to March–May (`$100.00/month`), February revenue should be **$0.00**, February A/R **$300.00**, February Deferred Revenue **$300.00**, and March revenue **$100.00**.
- Actual route/DB result: February P&L income is **−$900.00** (`-90,000` cents), February Balance Sheet carries **$300.00** total assets (`A/R`) against **$1,200.00** `Deferred Revenue` (with `−$900.00` retained earnings), and March P&L recognizes **$400.00** (`40,000` cents). Also note `undoSpread` (`prepaidService.ts:164`) checks period locks across every schedule entry back to the initial deferral date, so once an early installment month is closed, there is no built-in partial cancellation of remaining unearned months either.

**Acceptance:** Refuse amount, currency/FX, date, or line-account mutations on any invoice or bill with an active `revenueSchedule` / `prepaidSchedule` until the schedule is undone or prospectively adjusted, and provide a period-lock-safe remaining-schedule adjustment/cancellation workflow when earlier months are closed.

```sh
LF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/lf_test NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx -y node@24 --import tsx --test --test-force-exit audit/accounting-review-2026-11-22/spread-edit-database.test.ts
```

