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
 * Run: NODE_ENV=test npx tsx --test audit/agent13-2026-11-11/probes/af13-008-fx-aging-vs-ledger.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lineAmount } from '../../../src/lib/txFilters';
import { computePartyAging } from '../../../src/lib/aging';
import { makeChartAccount, makeInvoice } from '../../../src/tests/fixtures';
import type { Transaction, Workspace } from '../../../src/types';

describe('AF13-008 aging vs ledger for a 0-decimal document currency', () => {
  const sent: Transaction[] = [];
  const realFetch = globalThis.fetch;
  let LedgerPostService: typeof import('../../../src/services/LedgerPostService').LedgerPostService;

  before(async () => {
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      sent.push(...(JSON.parse(String(init?.body || '{}')).transactions || []));
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    ({ LedgerPostService } = await import('../../../src/services/LedgerPostService'));
  });
  after(() => { globalThis.fetch = realFetch; });

  const context = () => ({
    lockDate: null, transactions: [], inventory: [],
    workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD' } as Workspace],
    accounts: [
      makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' }),
      makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' }),
      makeChartAccount({ id: 'rev', name: 'Sales', type: 'income', category: 'Revenue' }),
    ],
  });

  test('a JPY invoice posts 67,000 receivable cents but the aging shows 670', async () => {
    sent.length = 0;
    await LedgerPostService.postInvoiceLedger('inv-jpy', {
      number: 'INV-JPY-1', customerId: 'c1', customerName: 'Tokyo Customer',
      date: '2026-03-10', dueDate: '2026-04-10',
      amountCents: 100_000, currency: 'JPY', exchangeRate: 0.0067, status: 'sent',
    }, 'w1', 'u1', undefined, context());

    const ledgerReceivable = sent[0].lines
      .filter(l => l.accountId === 'ar')
      .reduce((sum, l) => sum + lineAmount(l, sent[0]), 0);
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
