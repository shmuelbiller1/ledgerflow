/**
 * Agent #13 probe, AF13-008, 2026-11-11.
 *
 * Question: does the A/R aging (and the customer balance built from the same helper) agree with the
 * ledger for a document in a currency with a different number of minor units than the books (JPY:
 * none; books in USD: two)?
 *
 * `toBaseCents` (src/server/reports/partyReports.ts) converts a document amount with the exchange
 * rate alone. The ledger entry for the same document is converted with `documentMinorRate`
 * (= rate × 10^(books' digits − document's digits)). Independent expectation for a wholly unpaid
 * ¥100,000 invoice at 0.0067 in a USD book: the receivable is ¥100,000 × $0.0067 = $670.00 =
 * 67,000 cents, so the aging row must be 67,000 too.
 *
 * This probe FAILS on purpose while the defect is open (issue #641) and must be updated to expect
 * 67,000 once it is fixed — that inversion is the acceptance test.
 * Run: NODE_ENV=test npx tsx --test audit/agent13-2026-11-11/probes/af13-008-fx-aging-vs-ledger.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePartyAging } from '../../../src/lib/aging';
import { makeInvoice } from '../../../src/tests/fixtures';
import { startPostingHarness, type PostingHarness } from '../../../src/tests/helpers/postingHarness';

describe('AF13-008 aging vs ledger for a 0-decimal document currency', () => {
  let harness: PostingHarness;
  before(async () => { harness = await startPostingHarness(); });
  after(() => harness.restore());

  test('a JPY invoice posts 67,000 receivable cents but the aging shows 670', async () => {
    harness.reset();
    await harness.service.postInvoiceLedger('inv-jpy', {
      number: 'INV-JPY-1', customerId: 'c1', customerName: 'Tokyo Customer',
      date: '2026-03-10', dueDate: '2026-04-10',
      amountCents: 100_000, currency: 'JPY', exchangeRate: 0.0067, status: 'sent',
    }, 'w1', 'u1', undefined, harness.context());

    const ledgerReceivable = harness.byAccount(harness.sent[0]).ar;
    assert.equal(ledgerReceivable, 67_000, 'the ledger receivable: ¥100,000 × 0.67 = 67,000 US cents');

    const aging = computePartyAging(
      [{ id: 'c1', name: 'Tokyo Customer' }],
      [makeInvoice({
        id: 'inv-jpy', number: 'INV-JPY-1', customerId: 'c1', customerName: 'Tokyo Customer',
        amountCents: 100_000, currency: 'JPY', exchangeRate: 0.0067, status: 'sent',
        date: '2026-03-10', dueDate: '2026-04-10',
      })],
      'customer', '2026-03-31',
    );

    // What the aging reports today (the defect): 100× smaller than the ledger it must reconcile to.
    assert.equal(aging[0]?.total, 670, 'the aging understates a JPY receivable by 100x today');
    assert.notEqual(aging[0]?.total, ledgerReceivable, 'and so it does not agree with the ledger');
  });
});
