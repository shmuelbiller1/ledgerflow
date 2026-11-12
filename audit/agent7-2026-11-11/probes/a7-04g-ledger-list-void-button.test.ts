/**
 * Agent #7 probe A7-04g (review-only): what the ledger list's "Reverse transaction" button sends, sent to the server.
 *
 * Source read at main 2708f47c (not run in a browser — no Chromium in this sandbox):
 *   - src/components/transactions/TransactionRow.tsx:461-469 — every row in an open period shows the button
 *     aria-label "Reverse transaction"; it is disabled only for a reversal or an entry already reversed. There is
 *     no check of where the entry came from (isDocumentEntry is used for the inline cells only).
 *   - src/components/ledger/TransactionGrid.tsx:50 — the button calls handleVoidTransaction. Up to 2ac666b it called
 *     DELETE /transactions/:id, which the server refuses for a posted entry (403); PR #647 changed the wiring.
 *   - src/hooks/transactionActions/entryActions.ts:32-51 — handleVoidTransaction sends
 *       PUT /api/v1/transactions/:id   { partialUpdate: { status: 'failed', deletedAt: <now> } }
 *     and, for "Undo" in the toast, a full PUT with the entry as it was.
 *
 * This probe sends exactly those two requests as a bookkeeper, on the entry of a payment and on the entry of an
 * invoice (INV-9, 500.00, paid in full: Bank +500.00, Accounts Receivable 0.00, Sales -500.00).
 * Expected for a correct system: refused for an entry that belongs to a document ("void the payment" / "void the
 * invoice"), and for a hand entry a reversing entry rather than a status change.
 *
 * Run: LF_TEST_DATABASE_URL=… NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *      npx tsx --test --test-force-exit audit/agent7-2026-11-11/probes/a7-04g-ledger-list-void-button.test.ts
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';

describe('A7-04g the ledger list\'s "Reverse transaction" button, as the server sees it', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  const invoiceId = () => `${b.ws}_inv9`;
  let accrualId = '', paymentEntryId = '', paymentId = '';
  before(async () => { b = await openBooks('voidbtn'); });
  after(async () => { await b.close(); await b.db.terminate(); });
  const facts: Record<string, unknown> = {};

  test('setup: invoice 500.00 paid in full — Bank +500.00, A/R 0.00, Sales -500.00', async () => {
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Acme' } as never);
    const data = { id: invoiceId(), workspaceId: b.ws, number: 'INV-9', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-08-03', dueDate: '2026-09-02', status: 'sent', currency: 'USD',
      amountCents: 50_000, items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 50_000, amountCents: 50_000 }] };
    const posted = await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${invoiceId()}/post`, { workspaceId: b.ws, action: 'create', data }, { 'idempotency-key': 'a7-04g-inv' });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const paid = await b.send(b.OWNER, 'POST', '/api/v1/payments', { workspaceId: b.ws, amountCents: 50_000, paymentDate: '2026-08-10', cashAccountId: b.acct.bank, customerId: `${b.ws}_c1`,
      allocations: [{ documentId: invoiceId(), documentType: 'invoice', amountCents: 50_000 }] }, { 'x-operation-id': 'a7-04g-pay' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    paymentEntryId = paid.body.data.transactionId; paymentId = paid.body.data.paymentId;
    accrualId = (await b.entries()).find(e => e.metadata?.type === 'invoice-accrual')!.id;
    assert.deepEqual(named(b, await b.balances()), { bank: 50_000, sales: -50_000 });
  });

  for (const [label, id] of [['(a) the payment\'s entry', () => paymentEntryId], ['(b) the invoice\'s entry', () => accrualId]] as const) {
    test(`${label}: the button's request, then the toast's "Undo"`, async () => {
      const original = (await b.entries()).find(e => e.id === id())!;
      const before = named(b, await b.balances());
      const count = (await b.entries()).length;
      const res = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${id()}`, { partialUpdate: { status: 'failed', deletedAt: new Date().toISOString() } });
      const after = named(b, await b.balances());
      console.log(`${label}: PUT … { partialUpdate: { status: 'failed', deletedAt } } -> ${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body).slice(0, 160)}`);
      console.log(`${label}: books before ${JSON.stringify(before)}`);
      console.log(`${label}: books after  ${JSON.stringify(after)}`);
      console.log(`${label}: entries in the ledger before ${count}, after ${(await b.entries()).length} (a reversal would have added one)`);
      const invoice = (await b.db.collection('invoices').doc(invoiceId()).get()).data()!;
      const payment = (await b.db.collection('payments').doc(paymentId).get()).data()!;
      console.log(`${label}: invoice: status ${invoice.status}, paid ${invoice.amountPaidCents}; payment: status ${payment.status}, amount ${payment.amountCents}`);
      const health = await b.dataHealth();
      console.log(`${label}: Data Health: ${health.length ? health.map(f => `(${f.severity}) [${f.checkId}] ${f.title}`).join(' | ') : 'none'}`);
      const { findPostingMismatches } = await import('../../../src/lib/postingCheck');
      const invoices = (await b.db.collection('invoices').where('workspaceId', '==', b.ws).get()).docs.map(d => ({ ...d.data(), id: d.id }));
      const mismatches = findPostingMismatches({ invoices: invoices as never, bills: [], transactions: (await b.entries()) as never });
      console.log(`${label}: month-end posting check: ${mismatches.length ? mismatches.map(m => `${m.kind} ${m.number}: ${m.issue}`).join(' | ') : 'nothing found'}`);
      // "Undo" in the toast: a full PUT with the entry as the list held it
      const undo = await b.send(b.BOOKKEEPER, 'PUT', `/api/v1/transactions/${id()}`, { transaction: { ...original, status: original.status, deletedAt: (original as { deletedAt?: string }).deletedAt || null, updatedAt: new Date().toISOString() } });
      const afterUndo = named(b, await b.balances());
      console.log(`${label}: "Undo" (full PUT with the entry as it was) -> ${undo.status} ${undo.status === 200 ? '' : JSON.stringify(undo.body).slice(0, 200)}`);
      console.log(`${label}: books after "Undo" ${JSON.stringify(afterUndo)}${JSON.stringify(afterUndo) === JSON.stringify(before) ? '   (restored)' : '   <-- NOT restored'}`);
      const storedNow = (await b.db.collection('transactions').doc(id()).get()).data() as { status?: string; deletedAt?: string | null };
      console.log(`${label}: the entry as stored after "Undo": status ${storedNow.status}, deletedAt ${storedNow.deletedAt ? 'still set' : String(storedNow.deletedAt)}`);
      facts[label] = { button: res.status, leftTheBooks: JSON.stringify(after) !== JSON.stringify(before), undo: undo.status, restored: JSON.stringify(afterUndo) === JSON.stringify(before) };
      if (JSON.stringify(afterUndo) !== JSON.stringify(before)) {
        // put the books back for the next case, the only way left: the owner clears the two marks
        const back = await b.send(b.OWNER, 'PUT', `/api/v1/transactions/${id()}`, { partialUpdate: { status: original.status, deletedAt: null } });
        console.log(`${label}: (probe housekeeping) owner sets status and deletedAt back by partial update -> ${back.status}; books ${JSON.stringify(named(b, await b.balances()))}`);
      }
    });
  }

  test('summary: what main does today', () => {
    console.log(JSON.stringify(facts));
    for (const f of Object.values(facts) as Array<{ button: number; leftTheBooks: boolean; undo: number; restored: boolean }>) {
      assert.equal(f.button, 200, 'the server accepts the button\'s request');
      assert.equal(f.leftTheBooks, true, 'and the entry leaves the books');
      assert.equal(f.undo, 200, 'the server answers 200 to "Undo"');
      assert.equal(f.restored, false, 'and the entry stays out of the books');
    }
    console.log('DEFECT A7-04h: "Undo" answers 200 and the entry stays out of the books (the full update does not clear deletedAt)');
    console.log('DEFECT A7-04g: the request behind the ledger list\'s "Reverse transaction" button takes the entry of a payment or an invoice out of the books; nothing is reversed and the document is not told');
  });
});
