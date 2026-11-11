/**
 * Agent #13, 2026-11-11 — three defects found and fixed in the month-end close checklist
 * (`src/lib/closeChecklist.ts`, shown on Month-End Close and used by `readyToClose`):
 *
 * - AF13-001: a document in a currency with a different number of minor units than the books
 *   (JPY has none, KWD three) looked wrong to the "Invoices and bills match the ledger" item even
 *   when the ledger was right, because the repost check multiplied by the exchange rate alone while
 *   the posting path also converts minor units (`minorUnitRate` / `documentMinorRate`). Verified
 *   against the real `LedgerPostService`, not a hand-made entry.
 * - AF13-002: cancelled and rejected invoices/bills counted as "old receivables and payables".
 * - AF13-003: bank lines marked `ignored` counted as "not matched yet".
 *
 * Each case is a month that is genuinely finished and must close without an extra sign-off.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCloseChecklist, readyToClose } from '../lib/closeChecklist';
import { findPostingMismatches } from '../lib/postingCheck';
import { makeBill, makeInvoice, makeTransaction } from './fixtures';
import {
  jpyInvoice, postJpyInvoice, startPostingHarness, type PostingHarness,
} from './helpers/postingHarness';
import type { BankStatementLine, Transaction } from '../types';

const MONTH = '2026-03';
const posted = makeTransaction({
  id: 't1', date: '2026-03-05', status: 'completed',
  lines: [
    { id: 'l1', accountId: 'ar', accountName: 'Accounts Receivable', amountCents: 5000 },
    { id: 'l2', accountId: 'rev', accountName: 'Sales', amountCents: -5000 },
  ],
});

const bankLine = (overrides: Partial<BankStatementLine>): BankStatementLine => ({
  id: 'bl1', uid: 'u1', workspaceId: 'ws-1', date: '2026-03-06', description: 'Card payment',
  amountCents: -1200, status: 'pending', ...overrides,
} as BankStatementLine);

describe('Month-end close checklist counts only what is still open', () => {
  test('AF13-002: a cancelled or rejected invoice/bill is not an old receivable or payable', () => {
    const items = buildCloseChecklist({
      month: MONTH,
      transactions: [posted],
      bankLines: [bankLine({ status: 'matched', matchedTransactionId: 't1' })],
      invoices: [
        makeInvoice({ id: 'i-open', number: 'INV-OPEN', amountCents: 5000, status: 'sent', date: '2025-11-01', dueDate: '2025-12-01' }),
        makeInvoice({ id: 'i-cancelled', number: 'INV-C', amountCents: 5000, status: 'cancelled', date: '2025-11-01', dueDate: '2025-12-01' }),
        makeInvoice({ id: 'i-rejected', number: 'INV-R', amountCents: 5000, status: 'rejected', date: '2025-11-01', dueDate: '2025-12-01' }),
        makeInvoice({ id: 'i-paid', number: 'INV-P', amountCents: 5000, status: 'paid', date: '2025-11-01', dueDate: '2025-12-01' }),
      ],
      bills: [
        makeBill({ id: 'b-cancelled', number: 'B-C', amountCents: 5000, status: 'cancelled', date: '2025-11-01', dueDate: '2025-12-01' } as never),
      ],
    } as never);
    const aging = items.find(i => i.id === 'aging')!;
    assert.equal(aging.count, 1, 'only the invoice that is really still owed');
    assert.match(aging.detail, /1 invoice or bill more than 60 days overdue/);
  });

  test('AF13-003: a bank line marked ignored is not waiting to be matched, and an ignored-only month closes', () => {
    const items = buildCloseChecklist({
      month: MONTH,
      transactions: [posted],
      bankLines: [
        bankLine({ id: 'bl-matched', status: 'matched', matchedTransactionId: 't1' }),
        bankLine({ id: 'bl-ignored', status: 'ignored' }),
      ],
      invoices: [],
      bills: [],
    } as never);
    const reconcile = items.find(i => i.id === 'reconcile')!;
    assert.equal(reconcile.count, 0);
    assert.equal(reconcile.status, 'done');
    assert.match(reconcile.detail, /All 1 bank line matched/);

    const onlyIgnored = buildCloseChecklist({
      month: MONTH, transactions: [posted],
      bankLines: [bankLine({ id: 'bl-ignored-2', status: 'ignored' })],
      invoices: [], bills: [],
    } as never).find(i => i.id === 'reconcile')!;
    assert.equal(onlyIgnored.status, 'done');
    assert.match(onlyIgnored.detail, /No bank lines left to match/);

    assert.deepEqual(readyToClose(items, {}), { ready: true });
  });
});

describe('AF13-001: the repost check converts minor units exactly as the posting path does', () => {
  let harness: PostingHarness;
  before(async () => { harness = await startPostingHarness(); });
  after(() => harness.restore());

  test('¥100,000 at 0.0067 posts 67,000 US cents and the checklist agrees (it used to say 670)', async () => {
    const accrual = await postJpyInvoice(harness);
    assert.equal(harness.byAccount(accrual).ar, 67_000, 'the server posts ¥100,000 × 0.67 = 67,000 US cents');

    const input = {
      invoices: [jpyInvoice()],
      bills: [],
      transactions: [accrual],
    };
    assert.deepEqual(findPostingMismatches({ ...input, baseCurrency: 'USD' }), [], 'a correct JPY entry is not reported as wrong');
    // without a base currency the check falls back to USD, the same default the posting path uses
    assert.deepEqual(findPostingMismatches(input), [], 'the USD default gives the same answer for a USD book');
  });

  test('KWD (three decimals) converts by 10, in both directions, and a real difference is still found', async () => {
    harness.reset();
    await harness.service.postInvoiceLedger('inv-kwd', {
      number: 'INV-KWD-1', customerId: 'c1', customerName: 'Kuwait Customer',
      date: '2026-03-11', dueDate: '2026-04-11',
      amountCents: 12_345, currency: 'KWD', exchangeRate: 3.25, status: 'sent',
    }, 'w1', 'u1', undefined, harness.context());
    const accrual = harness.sent[0];
    // 12.345 KWD × 3.25 = 40.12125 USD → 4,012 US cents (rounded, half away from zero)
    assert.equal(harness.byAccount(accrual).ar, 4_012);
    const invoice = makeInvoice({ id: 'inv-kwd', number: 'INV-KWD-1', amountCents: 12_345, currency: 'KWD', exchangeRate: 3.25, status: 'sent' as const, dueDate: '2026-04-11' });
    assert.deepEqual(findPostingMismatches({ invoices: [invoice], bills: [], transactions: [accrual], baseCurrency: 'USD' }), []);

    // an entry that is really wrong is still reported, with the converted figure
    const short = { ...accrual, lines: accrual.lines.map(l => (l.accountId === 'ar' ? { ...l, amountCents: l.amountCents - 500, baseAmountCents: undefined } : l)) } as Transaction;
    const mismatch = findPostingMismatches({ invoices: [invoice], bills: [], transactions: [short], baseCurrency: 'USD' })[0];
    assert.equal(mismatch?.issue, 'amount');
    assert.equal(mismatch?.expectedCents, 4_012);
    assert.equal(mismatch?.postedCents, 3_512);
  });
});
