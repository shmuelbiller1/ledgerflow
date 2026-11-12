/**
 * Month-end currency revaluation (R-07) — the arithmetic of the entry, before anything is posted.
 *
 * What is checked here, in the order it matters:
 * - only open documents in another currency are touched, and only their open amount (the same rule
 *   the aging uses, so this entry and the A/R report cannot disagree);
 * - the movement is measured against the value the books already carry — the document's own rate —
 *   so an invoice nothing changed on moves by nothing;
 * - a receivable that is worth more is a debit to it and an unrealized gain; a payable that is worth
 *   more is a credit to it and a loss;
 * - the entry always closes to zero exactly, with and without a gain/loss line;
 * - a currency with no rate today stops the run instead of being left out.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planFxRevaluation, revaluationDateProblem, revaluationReversalDate, revaluationSummary, reversalLines,
  type RevaluableDocument,
} from '../lib/fxRevaluation';

const FX = { id: 'fx', name: 'Unrealized FX Gain/Loss' };
const AR = { accountId: 'ar', accountName: 'Accounts Receivable' };
const AP = { accountId: 'ap', accountName: 'Accounts Payable' };

const doc = (over: Partial<RevaluableDocument> = {}): RevaluableDocument => ({
  id: 'i1', side: 'customer', number: 'INV-1', partyName: 'Acme', currency: 'EUR', exchangeRate: 1.08,
  amountCents: 100000, status: 'sent', ...AR, ...over,
});

/** one rate map, as the exchange service hands it (EUR is 1.20 today, so a booked 1.08 has moved) */
const plan = (docs: RevaluableDocument[], rates: Record<string, number> = { EUR: 1.2 }) =>
  planFxRevaluation(docs, currency => rates[currency], FX, 'USD');
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const lineFor = (lines: Array<{ accountId: string; amountCents: number }>, accountId: string) =>
  lines.find(l => l.accountId === accountId)?.amountCents;

describe('what the revaluation is about', () => {
  test('an open foreign invoice moves by the difference between its own rate and today\'s', () => {
    const result = plan([doc()]);
    // 1,000.00 EUR: booked at 1.08 (1,080.00), today at 1.20 (1,200.00)
    assert.equal(result.details.length, 1);
    assert.equal(result.details[0].bookedBaseCents, 108000);
    assert.equal(result.details[0].todayBaseCents, 120000);
    assert.equal(result.details[0].deltaCents, 12000);
    assert.equal(lineFor(result.lines, 'ar'), 12000, 'the receivable is debited with what it gained');
    assert.equal(lineFor(result.lines, 'fx'), -12000, 'the gain is a credit to the gain/loss account');
    assert.equal(result.netGainCents, 12000);
    assert.equal(result.debitTotalCents, 12000);
    assert.equal(result.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'the entry closes to zero');
  });

  test('a rate that went down is a loss, and the lines turn the other way', () => {
    const result = plan([doc()], { EUR: 1.0 });
    assert.equal(lineFor(result.lines, 'ar'), -8000);
    assert.equal(lineFor(result.lines, 'fx'), 8000);
    assert.equal(result.netGainCents, -8000);
    assert.match(revaluationSummary(result, money), /unrealized loss of \$80\.00/);
  });

  test('uses each currency\'s ISO minor units for JPY and KWD revaluation', () => {
    const yen = plan([doc({ id: 'j1', number: 'JPY-1', currency: 'JPY', amountCents: 10_000, exchangeRate: 0.0067 })], { JPY: 0.0072 });
    assert.equal(yen.details[0].bookedBaseCents, 6_700, '10,000 yen at 0.0067 is 6,700 USD cents');
    assert.equal(yen.details[0].todayBaseCents, 7_200, '10,000 yen at 0.0072 is 7,200 USD cents');
    assert.equal(lineFor(yen.lines, 'ar'), 500);

    const dinar = plan([doc({ id: 'k1', number: 'KWD-1', currency: 'KWD', amountCents: 12_345, exchangeRate: 3.25 })], { KWD: 3.30 });
    assert.equal(dinar.details[0].bookedBaseCents, 4_012, '12.345 KWD at 3.25 rounds to 4,012 USD cents');
    assert.equal(dinar.details[0].todayBaseCents, 4_074, '12.345 KWD at 3.30 rounds to 4,074 USD cents');
    assert.equal(lineFor(dinar.lines, 'ar'), 62);
  });

  test('a bill is the other way round: the payable is what moves', () => {
    const result = plan([doc({ id: 'b1', side: 'vendor', number: 'BILL-9', partyName: 'Globex', status: 'pending', ...AP })]);
    assert.equal(result.details[0].deltaCents, 12000, 'the bill costs 120.00 more than was booked');
    assert.equal(lineFor(result.lines, 'ap'), -12000, 'a bigger payable is a credit to it');
    assert.equal(lineFor(result.lines, 'fx'), 12000, 'and a loss for the workspace');
    assert.equal(result.netGainCents, -12000);
  });

  test('receivables and payables in one entry: one line each, and no gain/loss line when they cancel', () => {
    const result = plan([doc(), doc({ id: 'b1', number: 'BILL-9', side: 'vendor', status: 'unpaid', ...AP })]);
    assert.equal(result.lines.length, 2, 'A/R and A/P — the gain/loss line is left out, there is none');
    assert.equal(lineFor(result.lines, 'ar'), 12000);
    assert.equal(lineFor(result.lines, 'ap'), -12000);
    assert.equal(result.lines.some(l => l.accountId === 'fx'), false, 'a line of nothing in the ledger would only be noise');
    assert.equal(result.netGainCents, 0);
    assert.equal(result.debitTotalCents, 12000, 'the entry is still 120.00 wide on each side');
    assert.equal(result.lines.reduce((sum, l) => sum + l.amountCents, 0), 0);
    assert.match(revaluationSummary(result, money), /move by the same amount, so there is no gain or loss/);
  });

  test('two documents on the same account are one line, and each document keeps its own rate', () => {
    const result = plan([
      doc({ id: 'i1', exchangeRate: 1.08 }),
      doc({ id: 'i2', number: 'INV-2', exchangeRate: 1.18 }),
      doc({ id: 'i3', number: 'INV-3', exchangeRate: 1.20 }),
    ]);
    assert.equal(result.lines.length, 2, 'one A/R line and the offset');
    assert.equal(lineFor(result.lines, 'ar'), 12000 + 2000);
    assert.equal(result.details.find(d => d.id === 'i3'), undefined, 'a document already at today\'s rate moves by nothing');
    assert.equal(result.skipped.find(s => s.id === 'i3')?.reason, 'already at today\'s EUR rate');
    assert.match(result.lines[0].description, /2 invoices/);
  });

  test('the amounts are whole cents, rounded once per document', () => {
    // 333.33 EUR at 1.0842 is 36139.6386, and at 1.08 is 35999.64: the entry holds rounded cents
    const result = plan([doc({ amountCents: 33333, exchangeRate: 1.08 })], { EUR: 1.0842 });
    assert.equal(result.details[0].todayBaseCents, 36140);
    assert.equal(result.details[0].bookedBaseCents, 36000);
    assert.equal(result.details[0].deltaCents, 140);
    assert.ok(result.lines.every(l => Number.isSafeInteger(l.amountCents)), 'no fraction of a cent reaches the ledger');
  });

  test('a payment in the middle of the amount is revalued on what is left, not on the total', () => {
    const result = plan([doc({ amountPaidCents: 40000, depositCents: 10000 })]);
    assert.equal(result.details[0].openCents, 50000, '1,000.00 less the deposit and the payment');
    assert.equal(result.details[0].deltaCents, 6000);
  });
});

describe('what is left alone, and why', () => {
  test('a document in the workspace currency is not the revaluation\'s business at all', () => {
    const result = plan([doc({ currency: 'USD' }), doc({ currency: 'usd ' }), doc({ currency: '' }), doc({ currency: undefined })]);
    assert.equal(result.lines.length, 0);
    assert.equal(result.skipped.length, 0, 'nothing to explain: there was nothing to say about them');
    assert.match(revaluationSummary(result, money), /no open invoice or bill in another currency/);
  });

  test('closed, draft and settled documents are skipped, each with its reason', () => {
    const result = plan([
      doc({ id: 'a', status: 'paid' }),
      doc({ id: 'b', status: 'draft' }),
      doc({ id: 'c', status: 'void' }),
      doc({ id: 'd', amountCents: 100000, amountPaidCents: 100000 }),
    ]);
    assert.deepEqual(result.skipped.map(s => s.id), ['a', 'b', 'c', 'd']);
    assert.match(String(result.skipped[0].reason), /is paid, so nothing is owed/);
    assert.match(String(result.skipped[1].reason), /is draft/);
    assert.match(String(result.skipped[3].reason), /nothing is left open/);
  });

  test('a document with no rate of its own is not converted, because what was booked is unknown', () => {
    for (const rate of [undefined, 0, -1, Number.NaN, 'x']) {
      const result = plan([doc({ exchangeRate: rate as unknown as number })]);
      assert.equal(result.lines.length, 0);
      assert.match(String(result.skipped[0].reason), /carries no exchange rate/);
    }
  });

  test('an account kept in that currency itself is already in that money', () => {
    const result = plan([doc({ accountCurrency: 'EUR', accountName: 'A/R (EUR)' })]);
    assert.equal(result.lines.length, 0);
    assert.match(String(result.skipped[0].reason), /kept in EUR itself, so there is nothing to convert/);
  });

  test('a base-currency account is fine, and a missing one is said out loud', () => {
    assert.equal(plan([doc({ accountCurrency: 'USD' })]).lines.length, 2);
    const noAccount = plan([doc({ accountId: undefined, accountName: undefined })]);
    assert.equal(noAccount.lines.length, 0);
    assert.match(String(noAccount.skipped[0].reason), /no Accounts Receivable account is set/);
  });

  test('a currency with no rate today is named, and the plan says nothing may be posted', () => {
    const result = plan([doc(), doc({ id: 'i2', currency: 'GBP' })], { EUR: 1.2 });
    assert.deepEqual(result.unpriced, ['GBP']);
    assert.equal(result.details.length, 1, 'the priced currency is still measured, so the reason is clear');
    assert.match(revaluationSummary(result, money), /^Nothing was posted: the GBP rate is not available/);
  });

  test('everything is already at today\'s rate: nothing to post, and that is said', () => {
    const result = plan([doc()], { EUR: 1.08 });
    assert.equal(result.lines.length, 0);
    assert.match(revaluationSummary(result, money), /1 document looked at, and every open foreign one already stands at today's rate/);
  });
});

describe('the words around the numbers', () => {
  test('the summary a person reads before pressing anything', () => {
    // the receivable gained 120.00, the payable grew by 200.00: a loss of 80.00 on 200.00 of movement
    const result = plan([doc(), doc({ id: 'b1', number: 'BILL-9', side: 'vendor', status: 'pending', ...AP, exchangeRate: 1.0 })]);
    assert.equal(result.netGainCents, -8000);
    assert.equal(result.debitTotalCents, 20000);
    const text = revaluationSummary(result, money);
    assert.match(text, /2 documents in EUR/);
    assert.match(text, /\$200\.00 of movement in the accounts/);
    assert.match(text, /an unrealized loss of \$80\.00/);
    assert.match(text, /reverses the next day/, 'it says what happens tomorrow, not only today');
    assert.doesNotMatch(text, /\d{5,}/, 'a person is never shown raw cents');
  });

  test('the line says which account, how many documents, and whose', () => {
    const result = plan([doc()]);
    assert.equal(result.lines[0].description, "Accounts Receivable at today's rate: 1 invoice (INV-1, Acme)");
    assert.equal(result.lines[1].description, "Unrealized FX gain at today's rates");
    const loss = plan([doc()], { EUR: 1.0 });
    assert.equal(loss.lines[1].description, "Unrealized FX loss at today's rates");
  });

  test('a bill and an invoice are each named by their own kind', () => {
    const result = plan([
      doc({ exchangeRate: 1.0 }),
      doc({ id: 'b1', number: 'BILL-9', partyName: 'Globex', side: 'vendor', status: 'pending', ...AP, exchangeRate: 1.0 }),
    ]);
    assert.equal(result.lines.length, 2, 'one A/R line and one A/P line; the loss is the same on both sides');
    assert.match(result.lines[0].description, /Accounts Payable at today's rate: 1 bill \(BILL-9, Globex\)/);
    assert.match(result.lines[1].description, /Accounts Receivable at today's rate: 1 invoice \(INV-1, Acme\)/);
  });
});

describe('the reversal', () => {
  test('it is the same lines, the other way round', () => {
    const result = plan([doc(), doc({ id: 'b1', side: 'vendor', status: 'pending', ...AP })]);
    const back = reversalLines(result.lines);
    assert.deepEqual(back.map(l => -l.amountCents), result.lines.map(l => l.amountCents));
    assert.equal(back.reduce((s, l) => s + l.amountCents, 0), 0);
    assert.equal(back.length, result.lines.length, 'nothing is invented, nothing is forgotten');
  });

  test('the next day, across a month end and a year end, and in a leap February', () => {
    assert.equal(revaluationReversalDate('2026-10-05'), '2026-10-06');
    assert.equal(revaluationReversalDate('2026-10-31'), '2026-11-01');
    assert.equal(revaluationReversalDate('2026-12-31'), '2027-01-01');
    assert.equal(revaluationReversalDate('2028-02-28'), '2028-02-29');
    assert.equal(revaluationReversalDate('2026-02-28'), '2026-03-01');
  });

  test('today or a real past month-end is allowed; other and impossible dates are refused', () => {
    assert.equal(revaluationDateProblem('2026-10-05', '2026-10-05'), null);
    assert.equal(revaluationDateProblem('2026-09-30', '2026-10-05'), null);
    assert.match(revaluationDateProblem('2026-09-15', '2026-10-05') || '', /last day of a month/);
    assert.match(revaluationDateProblem('2026-02-30', '2026-10-05') || '', /real calendar date/);
    assert.match(revaluationDateProblem('2026-10-06', '2026-10-05') || '', /cannot be after/);
    assert.match(revaluationDateProblem('5/10/2026', '2026-10-05') || '', /YYYY-MM-DD/);
  });

  test('a historical plan names its date, its typed rates, and its next-day reversal', () => {
    const pastDate = '2026-09-30';
    const result = planFxRevaluation([doc()], currency => currency === 'EUR' ? 1.2 : undefined, FX, 'USD', pastDate);
    assert.equal(result.lines[0].description, 'Accounts Receivable at the 2026-09-30 rate: 1 invoice (INV-1, Acme)');
    assert.equal(result.lines[1].description, 'Unrealized FX gain at 2026-09-30 rates');
    assert.match(revaluationSummary(result, money, pastDate), /movement in the accounts at 2026-09-30/);
    assert.match(revaluationSummary(result, money, pastDate), /reverses on 2026-10-01/);
    const awaitingRates = planFxRevaluation([doc()], () => undefined, FX, 'USD', pastDate);
    assert.match(revaluationSummary(awaitingRates, money, pastDate), /Type the EUR rate for 2026-09-30/);
  });
});
