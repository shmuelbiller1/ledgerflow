/**
 * #891 (A10-H1-01) — a bank-reconciliation suggestion must be a cash movement.
 *
 * Worked figures from the issue (synthetic ILS books): a pending withdrawal of ₪1,416.00 against
 * BILL-914's accrual (expense ₪1,200.00 + input VAT ₪216.00, credited A/P ₪1,416.00). The accrual
 * never touched a bank account, so it can never be the withdrawal; the payment that credited bank
 * 1010 and debited A/P can. `-₪1,416.00` in cents is `-141600`.
 *
 * These assertions fail on the pre-fix rule: it read `totalAmountCents` (the journal header total)
 * and let a missing cash sign through, so the accrual scored an exact amount match.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cashLegForBankLine } from '../lib/reconciliationSuggestions';

const cash = new Set(['bank1010', 'bank1020']);
const withdrawal = { accountId: 'bank1010', amountCents: -141600 };
const deposit = { accountId: 'bank1010', amountCents: 141600 };
const allAccountsWithdrawal = { amountCents: -141600 };

const billAccrual = {
  id: 'bill914',
  totalAmountCents: 141600,
  lines: [
    { accountId: 'expense', amountCents: 120000 },
    { accountId: 'vat', amountCents: 21600 },
    { accountId: 'ap', amountCents: -141600 },
  ],
};
const payment = {
  id: 'pay914',
  totalAmountCents: 141600,
  lines: [
    { accountId: 'ap', amountCents: 141600 },
    { accountId: 'bank1010', amountCents: -141600 },
  ],
};
const transfer = {
  id: 'transfer',
  totalAmountCents: 141600,
  lines: [
    { accountId: 'bank1020', amountCents: 141600 },
    { accountId: 'bank1010', amountCents: -141600 },
  ],
};

describe('cashLegForBankLine', () => {
  it('refuses an entry with no cash leg, whatever its total', () => {
    assert.equal(cashLegForBankLine(billAccrual, cash, withdrawal), null);
    assert.equal(cashLegForBankLine(billAccrual, cash, allAccountsWithdrawal), null);
  });

  it('returns the payment leg in the statement line\'s own account', () => {
    assert.equal(cashLegForBankLine(payment, cash, withdrawal), -141600);
    assert.equal(cashLegForBankLine(payment, cash, allAccountsWithdrawal), -141600);
  });

  it('refuses a cash leg in a different bank account', () => {
    assert.equal(cashLegForBankLine(payment, cash, { accountId: 'bank1020', amountCents: -141600 }), null);
  });

  it('refuses the opposite direction', () => {
    assert.equal(cashLegForBankLine(payment, cash, deposit), null);
  });

  it('offers a transfer by the side that touched this bank, and not by its zero net', () => {
    assert.equal(cashLegForBankLine(transfer, cash, withdrawal), -141600);
    assert.equal(cashLegForBankLine(transfer, cash, { accountId: 'bank1020', amountCents: 141600 }), 141600);
    assert.equal(cashLegForBankLine(transfer, cash, allAccountsWithdrawal), null, 'both legs cancel in the all-accounts view');
  });

  it("reads foreign amounts through the caller's own line amount (exchange rate applied once)", () => {
    // ¥10,000 at 0.0067 is $67.00 = 6,700 cents; the header total is in the document currency.
    const jpyPayment = { id: 'jpy', totalAmountCents: 10000, lines: [{ accountId: 'bank1010', amountCents: -10000 }] };
    const leg = cashLegForBankLine(jpyPayment, cash, { accountId: 'bank1010', amountCents: -6700 }, () => -6700);
    assert.equal(leg, -6700);
  });
});
