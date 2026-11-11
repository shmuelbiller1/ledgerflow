/**
 * Agent #7 probe A7-04 (review-only): can the entry the system made for a document be changed behind the document?
 *
 * The code base states the rule itself: ledgerDoor.ts — "amounts and lines never change in place"; and
 * stockRevaluationService.ts revaluationEntryLock — a stock revaluation / landed cost / repost entry "moves together
 * with" its record, "so the generic edit, void, delete and Reverse & Correct paths refuse it". This probe asks whether
 * the same holds for the entries that move together with an invoice and a payment.
 *
 * Books in USD. Invoice INV-9 for 500.00 (no tax), then a payment of 500.00 through POST /payments.
 * By hand, before anything else:  Bank +500.00, Accounts Receivable 0.00, Sales -500.00; invoice paid.
 * A bookkeeper (not the owner) then uses the generic entry routes on the two system entries.
 *
 * The test asserts what the system does TODAY. Each line marked DEFECT is a state where the documents and the ledger
 * say different things and no screen or route puts them back together.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7-04 system entries can be changed behind their documents', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  const invoiceId = () => `${b.ws}_inv9`;
  let accrualId = '', paymentEntryId = '', paymentId = '';
  before(async () => { b = await openBooks('sysedit'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  test('setup: invoice 500.00 paid in full — Bank +500.00, A/R 0.00, Sales -500.00', async () => {
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Acme' } as never);
    const data = { id: invoiceId(), workspaceId: b.ws, number: 'INV-9', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-08-03', dueDate: '2026-09-02', status: 'sent', currency: 'USD',
      amountCents: 50_000, items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 50_000, amountCents: 50_000 }] };
    const posted = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${invoiceId()}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'a7-04-inv' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const paid = await b.send(b.OWNER, 'POST', '/api/v1/payments', { workspaceId: b.ws, amountCents: 50_000, paymentDate: '2026-08-10', cashAccountId: b.acct.bank, customerId: `${b.ws}_c1`,
      allocations: [{ documentId: invoiceId(), documentType: 'invoice', amountCents: 50_000 }] }, { 'x-operation-id': 'a7-04-pay' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    paymentId = paid.body.data.paymentId; paymentEntryId = paid.body.data.transactionId;
    accrualId = (await b.entries()).find(e => e.metadata?.type === 'invoice-accrual')!.id;
    assert.deepEqual(named(b, await b.balances()), { bank: 50_000, sales: -50_000 });
  });

  test('a bookkeeper voids the payment\'s entry with the generic route: the ledger loses the money, the documents keep it', async () => {
    const res = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${paymentEntryId}`, { workspaceId: b.ws, partialUpdate: { status: 'void' } });
    console.log(`PUT /transactions/<payment entry> { partialUpdate: { status: 'void' } } -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    const balances = named(b, await b.balances());
    const invoice = (await b.db.collection('invoices').doc(invoiceId()).get()).data()!;
    const payment = (await b.db.collection('payments').doc(paymentId).get()).data()!;
    console.log(`ledger now: ${JSON.stringify(balances)}`);
    console.log(`invoice: status ${invoice.status}, paid ${invoice.amountPaidCents}; payment: status ${payment.status}, amount ${payment.amountCents}`);
    assert.equal(res.status, 200, 'the generic route accepts it');
    // DEFECT: the ledger says the customer still owes 500.00 and the bank has nothing; the invoice says paid and the
    // payment says posted. Expected: refused (409) with a pointer to "void the payment", as for a revaluation entry.
    console.log('DEFECT A7-04a: ledger A/R 500.00 and Bank 0.00, while the invoice is "paid" and the payment is "posted"');
    assert.deepEqual(balances, { ar: 50_000, sales: -50_000 });
    assert.equal(invoice.status, 'paid');
    assert.equal(payment.status, 'posted');
  });

  test('a bookkeeper rewrites the invoice\'s entry to 100.00 with the generic route: the invoice still says 500.00', async () => {
    const entry = (await b.entries()).find(e => e.id === accrualId)!;
    const res = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${accrualId}`, { transaction: {
      id: accrualId, workspaceId: b.ws, date: entry.date, description: entry.description, currency: 'USD', status: 'completed', type: 'actual', metadata: entry.metadata,
      lines: [{ accountId: b.acct.ar, amountCents: 10_000 }, { accountId: b.acct.sales, amountCents: -10_000 }],
    } });
    console.log(`PUT /transactions/<invoice entry> (lines rewritten to 100.00) -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
    const balances = named(b, await b.balances());
    const invoice = (await b.db.collection('invoices').doc(invoiceId()).get()).data()!;
    console.log(`ledger now: ${JSON.stringify(balances)}; invoice amount ${invoice.amountCents}`);
    assert.equal(res.status, 200, 'the generic route accepts it');
    // DEFECT: sales in the ledger are 100.00; the invoice (and every report read from documents) says 500.00.
    console.log('DEFECT A7-04b: Sales in the ledger 100.00, the invoice 500.00');
    assert.equal(balances.sales, -10_000);
    assert.equal(invoice.amountCents, 50_000);
  });

  test('"Reverse & Correct" on the invoice\'s entry is accepted too: the invoice stays issued with nothing in the ledger', async () => {
    const res = await b.send(b.BOOKKEEPER, 'POST', `/api/v1/transactions/${accrualId}/reverse`, { workspaceId: b.ws, reversalDate: '2026-08-20', reason: 'audit probe' });
    console.log(`POST /transactions/<invoice entry>/reverse -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
    const balances = named(b, await b.balances());
    const invoice = (await b.db.collection('invoices').doc(invoiceId()).get()).data()!;
    console.log(`ledger now: ${JSON.stringify(balances)}; invoice status ${invoice.status}, amount ${invoice.amountCents}`);
    assert.equal(res.status, 200, 'the reverse route accepts it');
    console.log('DEFECT A7-04c: the ledger holds nothing for an invoice that is still issued and marked paid');
    assert.deepEqual(balances, {});
    assert.equal(invoice.status, 'paid');
  });

  test('what the audit trail kept of the two edits: the action, not what changed', async () => {
    const logs = (await b.db.collection('auditLogs').where('workspaceId', '==', b.ws).get()).docs.map(d => d.data())
      .filter(l => ['TRANSACTION_UPDATED', 'TRANSACTION_UPDATED_PARTIAL'].includes(String(l.action)));
    for (const l of logs) console.log(`audit: ${l.action} ${JSON.stringify(l.details)}`);
    assert.equal(logs.length, 2);
    // DEFECT (audit trail): neither entry records the old or the new status, amounts or lines
    console.log('DEFECT A7-04d: the audit entries for an in-place change of a posted entry carry no before/after values');
    for (const l of logs) assert.deepEqual(Object.keys(l.details as object), ['description']);
  });
});
