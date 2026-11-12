/** Harness smoke test: one invoice through the real route; the books balance and A/R equals the invoice. */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7 harness smoke', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  before(async () => { b = await openBooks('smoke'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  test('an invoice of 330.00 posts A/R +330.00, Sales -300.00, VAT -30.00 and every entry balances', async () => {
    const id = `${b.ws}_inv1`;
    const data = { id, workspaceId: b.ws, number: 'INV-1', customerName: 'Acme', customerId: 'c1', date: '2026-10-21', dueDate: '2026-11-20', status: 'sent', currency: 'USD',
      amountCents: 33_000, taxAmountCents: 3_000, taxRate: 10, items: [{ id: 'l1', description: 'Hours', quantity: 2, rateCents: 15_000, amountCents: 30_000 }] };
    const res = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${id}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'k1' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(named(b, await b.balances()), { ar: 33_000, sales: -30_000, vat: -3_000 });
    assert.deepEqual(await b.unbalanced(), []);
    const tb = await b.send(b.OWNER, 'GET', `/api/v1/reports/trial-balance?workspaceId=${b.ws}&endDate=2026-12-31`);
    console.log('trial-balance route:', tb.status, JSON.stringify(tb.body).slice(0, 600));
    const bs = await b.send(b.OWNER, 'GET', `/api/v1/reports/balance-sheet?workspaceId=${b.ws}&asOfDate=2026-12-31`);
    console.log('balance-sheet route:', bs.status, JSON.stringify(bs.body).slice(0, 600));
  });
});
