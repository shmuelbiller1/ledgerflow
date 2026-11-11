/**
 * Agent #7 probe A7-07 (review-only): once a month is closed, does every way of writing an entry refuse that month?
 *
 * RELEASE_GATE.md, "Never postponed, at any stage": period and transaction integrity.
 * Books in USD. September 2026 is closed (hard) through the app's own route. A bookkeeper then tries each server writer
 * with a date in September. Expected for a correct system: every one of them is refused and the September figures
 * stay exactly as they were when the month was closed.
 *
 * By hand, before the close:  one journal on 2026-09-10, Bank +1,000.00 / Sales -1,000.00.
 * After the close and every attempt, September must still read Bank 1,000.00 and Sales -1,000.00.
 *
 * The test asserts what the system does TODAY; a line marked DEFECT is a writer that got through.
 *
 * Scope, so nothing is over-claimed: no screen of the app calls POST /workspaces/:id/seed (searched src/ outside
 * src/server at 39b0012: zero callers; the guest-mode demo uses the same seed data in memory only). It is reachable
 * by anyone signed in as owner, accountant or bookkeeper of the workspace who sends the request by hand.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DB_URL, named, openBooks, type Books } from './harness';
import { isPostable, lineAmount } from '../../../src/lib/txFilters';

describe('A7-07 closed-period sweep across the server writers', { skip: !DB_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  let b: Books;
  const results: Array<{ writer: string; status: number; refused: boolean; byLock: boolean; reason: string }> = [];
  /** records the answer and WHY it was refused: only a refusal that names the closed period counts as the lock working */
  const note = (writer: string, res: { status: number; body?: unknown } | number, why?: string) => {
    const status = typeof res === 'number' ? res : res.status;
    const body = typeof res === 'number' ? {} : (res.body || {}) as { error?: unknown; message?: unknown };
    const reason = why ?? String(typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : JSON.stringify(body)).slice(0, 150);
    const byLock = status >= 400 && /closed|locked|lock date|period/i.test(reason);
    results.push({ writer, status, refused: status >= 400, byLock, reason });
    console.log(`${status >= 400 ? (byLock ? 'refused, period lock ' : 'refused, OTHER REASON') : 'ACCEPTED             '} ${status}  ${writer}${status >= 400 ? `\n        "${reason}"` : ''}`);
  };
  const september = async () => {
    const out: Record<string, number> = {};
    for (const t of (await b.entries()).filter(e => isPostable(e) && String(e.date).startsWith('2026-09'))) for (const l of t.lines || []) out[l.accountId] = (out[l.accountId] || 0) + lineAmount(l, t);
    return named(b, out);
  };
  const journal = (id: string, date: string, cents: number) => ({ id, uid: b.BOOKKEEPER, workspaceId: b.ws, date, description: `probe ${id}`, currency: 'USD', status: 'completed', type: 'journal', totalAmountCents: cents,
    lines: [{ accountId: b.acct.bank, amountCents: cents }, { accountId: b.acct.sales, amountCents: -cents }] });

  before(async () => { b = await openBooks('closed'); });
  after(async () => { await b.close(); await b.db.terminate(); });

  test('setup: a September journal of 1,000.00, an October invoice, then September is closed (hard)', async () => {
    const first = await b.send(b.OWNER, 'POST', '/api/v1/transactions/bulk', { workspaceId: b.ws, transactions: [journal(`${b.ws}_sep`, '2026-09-10', 100_000)] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    await b.db.collection('customers').doc(`${b.ws}_c1`).set({ id: `${b.ws}_c1`, workspaceId: b.ws, name: 'Acme' } as never);
    const inv = { id: `${b.ws}_inv_oct`, workspaceId: b.ws, number: 'INV-OCT', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-10-05', dueDate: '2026-11-04', status: 'sent', currency: 'USD', amountCents: 20_000,
      items: [{ id: 'l1', description: 'Work', quantity: 1, rateCents: 20_000, amountCents: 20_000 }] };
    assert.equal((await b.send(b.OWNER, 'POST', `/api/v1/documents/invoices/${inv.id}/post`, { workspaceId: b.ws, action: 'create', data: inv }, { 'idempotency-key': 'a7-07-inv' })).status, 200);
    // control: with a DRAFT dated in September, the close itself is refused
    const draft = { ...journal(`${b.ws}_sep_draft`, '2026-09-11', 300), status: 'draft' };
    await b.db.collection('transactions').doc(draft.id).set(draft as never);
    const withDraft = await b.send(b.OWNER, 'POST', `/api/v1/workspaces/${b.ws}/periods/2026-09/close`, { mode: 'hard' });
    console.log(`control: closing September while a draft is dated in it -> ${withDraft.status} "${String(withDraft.body?.message || withDraft.body?.error).slice(0, 90)}"`);
    assert.equal(withDraft.status >= 400, true);
    assert.match(String(withDraft.body?.message || withDraft.body?.error), /draft/);
    await b.db.collection('transactions').doc(draft.id).delete();
    const closed = await b.send(b.OWNER, 'POST', `/api/v1/workspaces/${b.ws}/periods/2026-09/close`, { mode: 'hard' });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    const ws = (await b.db.collection('workspaces').doc(b.ws).get()).data()!;
    console.log(`closed: lockDate = ${ws.lockDate}`);
    assert.equal(ws.lockDate, '2026-09-30');
    assert.deepEqual(await september(), { bank: 100_000, sales: -100_000 });
    // fixture for the DELETE check only: a draft dated in the closed month, put back through the data layer (the
    // close route would not have allowed it to be there; a draft may be deleted, a posted entry never may)
    await b.db.collection('transactions').doc(draft.id).set(draft as never);
  });

  test('every writer, dated in the closed month, as a bookkeeper', async () => {
    const B = b.BOOKKEEPER;
    note('POST /transactions (one journal)', await b.send(B, 'POST', '/api/v1/transactions', { transaction: journal(`${b.ws}_a`, '2026-09-15', 5_000) }, { 'x-operation-id': 'a7-07-a' }));
    note('POST /transactions/bulk', await b.send(B, 'POST', '/api/v1/transactions/bulk', { workspaceId: b.ws, transactions: [journal(`${b.ws}_b`, '2026-09-15', 5_000)] }));
    note('POST /transactions/batch-create', await b.send(B, 'POST', '/api/v1/transactions/batch-create', { workspaceId: b.ws, transactions: [journal(`${b.ws}_c`, '2026-09-15', 5_000)] }, { 'x-operation-id': 'a7-07-c' }));
    const inv = { id: `${b.ws}_inv_sep`, workspaceId: b.ws, number: 'INV-SEP', customerName: 'Acme', customerId: `${b.ws}_c1`, date: '2026-09-20', status: 'sent', currency: 'USD', amountCents: 7_000, items: [{ id: 'l1', description: 'x', quantity: 1, rateCents: 7_000, amountCents: 7_000 }] };
    note('POST /documents/invoices/:id/post (invoice dated in the month)', await b.send(B, 'POST', `/api/v1/documents/invoices/${inv.id}/post`, { workspaceId: b.ws, action: 'create', data: inv }, { 'idempotency-key': 'a7-07-d' }));
    const bill = { id: `${b.ws}_bill_sep`, workspaceId: b.ws, number: 'B-SEP', vendorName: 'Paper Co', vendorId: 'v1', date: '2026-09-20', status: 'approved', currency: 'USD', amountCents: 3_000, splits: [{ accountId: b.acct.supplies, amountCents: 3_000, description: 'x' }] };
    note('POST /documents/bills/:id/post (bill dated in the month)', await b.send(B, 'POST', `/api/v1/documents/bills/${bill.id}/post`, { workspaceId: b.ws, action: 'create', data: bill }, { 'idempotency-key': 'a7-07-e' }));
    note('POST /payments (payment dated in the month, for the October invoice)', await b.send(B, 'POST', '/api/v1/payments', { workspaceId: b.ws, amountCents: 1_000, paymentDate: '2026-09-25', cashAccountId: b.acct.bank, customerId: `${b.ws}_c1` }, { 'x-operation-id': 'a7-07-f' }));
    note('PUT /transactions/:id { partialUpdate: { status: "void" } } on the September entry', await b.send(B, 'PUT', `/api/v1/transactions/${b.ws}_sep`, { workspaceId: b.ws, partialUpdate: { status: 'void' } }));
    note('PUT /transactions/:id (rewrite the September entry)', await b.send(B, 'PUT', `/api/v1/transactions/${b.ws}_sep`, { transaction: journal(`${b.ws}_sep`, '2026-09-10', 1) }));
    note('DELETE /transactions/:id on the September entry (posted: refused by the never-delete rule before the lock is reached)', await b.send(B, 'DELETE', `/api/v1/transactions/${b.ws}_sep?workspaceId=${b.ws}`));
    note('DELETE /transactions/:id on a September DRAFT', await b.send(B, 'DELETE', `/api/v1/transactions/${b.ws}_sep_draft?workspaceId=${b.ws}`));
    note('POST /transactions/:id/reverse with the reversal dated in the month', await b.send(B, 'POST', `/api/v1/transactions/${b.ws}_sep/reverse`, { workspaceId: b.ws, reversalDate: '2026-09-28', reason: 'probe' }));
    await b.db.collection('creditNotes').doc(`${b.ws}_cn`).set({ id: `${b.ws}_cn`, workspaceId: b.ws, number: 'CN-1', customerId: `${b.ws}_c1`, status: 'open', date: '2026-10-06', amountCents: 500, remainingCents: 500, currency: 'USD' } as never);
    note('POST /payments/credits/refund dated in the month', await b.send(B, 'POST', '/api/v1/payments/credits/refund', { workspaceId: b.ws, kind: 'customer', creditId: `${b.ws}_cn`, amountCents: 500, cashAccountId: b.acct.bank, date: '2026-09-29' }));
    // the daily recurring job, with an entry schedule due inside the closed month
    await b.db.collection('recurring').doc(`${b.ws}_rec`).set({ id: `${b.ws}_rec`, workspaceId: b.ws, uid: b.BOOKKEEPER, isActive: true, description: 'Monthly accrual', frequency: 'monthly', nextOccurrence: '2026-09-12', createdAt: '2026-08-01T00:00:00Z', amountCents: 2_000,
      template: { currency: 'USD', lines: [{ accountId: b.acct.supplies, amountCents: 2_000 }, { accountId: b.acct.bank, amountCents: -2_000 }] } } as never);
    const { processRecurring } = await import('../../../src/server/services/recurringService');
    const job = await processRecurring(b.db as never, '2026-09-12');
    const mine = job.details.filter(d => d.operationId.startsWith(`${b.ws}_rec`));
    note('daily recurring job, entry due 2026-09-12', mine.some(d => d.status === 'success') ? 200 : 409, mine.map(d => `${d.status}${d.error ? `: ${d.error}` : ''}`).join('; '));
    // the demo-data route: POST /workspaces/:id/seed writes two entries dated 2026-09-01 and 2026-09-05
    note('POST /workspaces/:workspaceId/seed (demo data: entries dated 2026-09-01 and 2026-09-05)', await b.send(B, 'POST', `/api/v1/workspaces/${b.ws}/seed`, {}));
  });

  test('the closed month afterwards', async () => {
    const now = await september();
    const through = results.filter(r => !r.refused).map(r => r.writer);
    console.log(`September in the ledger now: ${JSON.stringify(now)}`);
    console.log(`writers that got through the closed month: ${through.length ? through.join(' | ') : 'none'}`);
    // DEFECT: exactly one writer is not refused — the demo-data route — and September's figures changed after the close
    assert.deepEqual(through, ['POST /workspaces/:workspaceId/seed (demo data: entries dated 2026-09-01 and 2026-09-05)']);
    assert.notDeepEqual(now, { bank: 100_000, sales: -100_000 });
    console.log('DEFECT A7-07: POST /workspaces/:id/seed posts entries into a hard-closed month');
    const otherReason = results.filter(r => r.refused && !r.byLock).map(r => r.writer);
    console.log(`refused by the period lock: ${results.filter(r => r.byLock).length} of ${results.length} writers; refused for another reason: ${otherReason.length} (${otherReason.join(' | ') || 'none'})`);
    assert.deepEqual(otherReason, ['DELETE /transactions/:id on the September entry (posted: refused by the never-delete rule before the lock is reached)']);
    assert.equal((await b.entries()).some(e => e.id === `${b.ws}_sep_draft`), true, 'the September draft is still there');
  });

  test('what the demo-data route left in real books', async () => {
    const entries = (await b.entries()).filter(e => String(e.id).includes('tx_demo'));
    const accountIds = new Set((await b.db.collection('chartAccounts').where('workspaceId', '==', b.ws).get()).docs.map(d => d.id));
    const orphanLines = entries.flatMap(e => e.lines).filter(l => !accountIds.has(l.accountId));
    const invoices = (await b.db.collection('invoices').where('workspaceId', '==', b.ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as Record<string, unknown>).filter(d => d.number === 'INV-DEMO-001');
    const invoiceEntries = (await b.entries()).filter(e => invoices.some(i => e.metadata?.invoiceId === i.id));
    const audit = (await b.db.collection('auditLogs').where('workspaceId', '==', b.ws).get()).docs.map(d => d.data()).filter(l => /seed|demo/i.test(JSON.stringify(l)));
    const ws = (await b.db.collection('workspaces').doc(b.ws).get()).data()!;
    console.log(`demo entries written: ${entries.length} (dates ${entries.map(e => e.date).join(', ')}); lines that point to no account of this workspace: ${orphanLines.length} of ${entries.flatMap(e => e.lines).length}`);
    console.log(`demo invoice INV-DEMO-001: status ${invoices[0]?.status}, amount ${invoices[0]?.amountCents}; ledger entries for it: ${invoiceEntries.length}`);
    console.log(`audit rows mentioning the seeding: ${audit.length}; workspace.isDemoLoaded: ${ws.isDemoLoaded}`);
    // the same five accounts, read two ways: the reports take the id saved inside the row, Data Health takes the row's own id
    const bs = await b.send(b.OWNER, 'GET', `/api/v1/reports/balance-sheet?workspaceId=${b.ws}&endDate=2026-12-31`);
    const demoBank = Object.entries(bs.body.assets as Record<string, number>).find(([id]) => id.startsWith('acc_demo_bank'));
    console.log(`balance sheet route (2026-12-31): isBalanced=${bs.body.isBalanced}, lines on unknown accounts=${bs.body.orphanedLines.length}, "Operating Bank Account" (demo) = ${demoBank?.[1]}`);
    const health = (await b.dataHealth()).filter(x => ['missing-account', 'control-balance', 'unbalanced'].includes(x.checkId));
    for (const f of health) console.log(`Data Health (${f.severity}) [${f.checkId}]: ${f.title}`);
    // can the owner take it out again in one step? ("clear demo data": POST /transactions/reset)
    const reset = await b.send(b.OWNER, 'POST', '/api/v1/transactions/reset', { workspaceId: b.ws, confirmReset: true });
    console.log(`POST /transactions/reset (owner, confirmReset) -> ${reset.status} ${JSON.stringify(reset.body).slice(0, 120)}`);
    // and a second call
    const again = await b.send(b.BOOKKEEPER, 'POST', `/api/v1/workspaces/${b.ws}/seed`, {});
    const demoInvoices = (await b.db.collection('invoices').where('workspaceId', '==', b.ws).get()).docs.filter(d => d.data().number === 'INV-DEMO-001').length;
    console.log(`a second POST /workspaces/:id/seed -> ${again.status}; invoices numbered INV-DEMO-001 now: ${demoInvoices}`);

    // what main does today (2ac666b); a tree that answers differently fails here, after everything above is printed
    const facts = {
      demoEntries: entries.length, linesOnNoAccount: orphanLines.length, invoiceStatus: invoices[0]?.status, invoiceEntries: invoiceEntries.length,
      auditRows: audit.length, markedAsDemo: ws.isDemoLoaded === true, reportOrphanedLines: bs.body.orphanedLines.length, demoBankOnBalanceSheet: demoBank?.[1],
      missingAccountFindings: health.filter(f => f.checkId === 'missing-account').length, resetStatus: reset.status, secondSeedStatus: again.status, demoInvoicesAfterSecond: demoInvoices,
    };
    console.log(JSON.stringify(facts));
    assert.deepEqual(facts, {
      demoEntries: 2, linesOnNoAccount: 4, invoiceStatus: 'sent', invoiceEntries: 0, auditRows: 0, markedAsDemo: false, reportOrphanedLines: 0, demoBankOnBalanceSheet: 300_000,
      missingAccountFindings: 4, resetStatus: 409, secondSeedStatus: 200, demoInvoicesAfterSecond: 2,
    });
  });
});
