/**
 * A8N-01 reproduction — an APPLIED credit note / vendor credit can still be deleted or shrunk.
 *
 * Audit evidence only. This file is NOT part of the CI test glob (`src/tests/*.test.ts`) and changes no product code.
 * It drives the real HTTP routers (documents, commands, payments) against a real PostgreSQL database
 * (LF_TEST_DATABASE_URL — an isolated, disposable test database; never a production one).
 *
 * Run (Node 24):
 *   LF_TEST_DATABASE_URL=postgresql://... NODE_ENV=test SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic \
 *     npx tsx --test --test-force-exit audit/agent8-2026-11-17/repro/a8n-01-applied-credit-delete-edit.repro.ts
 *
 * Each test asserts the behaviour OBSERVED at the pinned revision. A test that starts failing with
 * "now refused" means the guard was added and the finding should be re-verified and closed.
 *
 * Hand-worked figures (books in USD, 10% VAT, no FX):
 *   Scenario A (customer, full application, then delete — done by a BOOKKEEPER):
 *     INV-A  300.00 + 30.00 VAT = 330.00      DR A/R 330.00 / CR Sales 300.00 / CR VAT 30.00
 *     CN-A   100.00 + 10.00 VAT = 110.00      CR A/R 110.00 / DR Sales 100.00 / DR VAT 10.00
 *     apply 110.00 of CN-A to INV-A           no entry (same rate); INV-A due 220.00; CN-A remaining 0.00, "applied"
 *       → A/R ledger 220.00 = open documents 220.00
 *     delete CN-A                             (a sound system refuses: the credit settled an invoice)
 *       observed → reversal DR A/R 110.00; A/R ledger 330.00, INV-A still says 110.00 paid (due 220.00)
 *       → ledger − documents = 110.00; Sales back to 300.00, VAT back to 30.00
 *   Scenario B (customer, partial application, shrink, refund the rest in cash):
 *     INV-B  330.00 (as INV-A);  CN-B 110.00 (100.00 + 10.00)
 *     apply 60.00 of CN-B to INV-B            INV-B due 270.00; CN-B remaining 50.00
 *     update CN-B total to 50.00 (45.45 + 4.55; remaining not sent)
 *       observed → CN-B re-posted at 50.00 (CR A/R 50.00), remaining stays 50.00
 *     refund 50.00 of CN-B from the bank      DR A/R 50.00 / CR Bank 50.00; CN-B remaining 0.00
 *       → the customer has had 60.00 off an invoice + 50.00 cash = 110.00 against a 50.00 credit note in the books
 *       → A/R ledger for B = 330.00 − 50.00 + 50.00 = 330.00; INV-B due 270.00; difference 60.00
 *   Scenario C (vendor, full application, then delete):
 *     BILL-C 100.00 + 18.00 VAT = 118.00      CR A/P 118.00
 *     VC-C   118.00                            DR A/P 118.00
 *     apply 118.00 of VC-C to BILL-C          BILL-C paid (due 0.00)
 *     delete VC-C
 *       observed → A/P ledger back to 118.00 credit while BILL-C stays "paid": a payable no bill asks to be paid
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { DATA_CHECKS, type CheckContext } from '../../../src/lib/dataChecks';
import { isPostable } from '../../../src/lib/txFilters';
import type { Transaction } from '../../../src/types';

const url = process.env.LF_TEST_DATABASE_URL;
const evidencePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'evidence', 'a8n-01-observed.json');
const observed: Record<string, unknown> = { ranAt: new Date().toISOString(), node: process.version };

describe('A8N-01: applied credits can be deleted or shrunk (real PostgreSQL, real HTTP routers)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_a8n01_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-a8n01';
  const BOOKKEEPER = 'bookkeeper-a8n01';
  let db: import('../../../src/server/db/pgFirestore').Firestore;
  let server: Server;
  let base = '';
  const id = (s: string) => `${ws}_${s}`;
  const accounts = [
    { id: id('ar'), name: 'Accounts Receivable', type: 'asset', category: 'Receivables', code: '1100' },
    { id: id('bank'), name: 'Bank', type: 'asset', category: 'Cash', code: '1000' },
    { id: id('vatin'), name: 'VAT Receivable', type: 'asset', category: 'Tax', code: '1300' },
    { id: id('ap'), name: 'Accounts Payable', type: 'liability', category: 'Payables', code: '2000' },
    { id: id('vat'), name: 'VAT Payable', type: 'liability', category: 'Tax', code: '2200' },
    { id: id('sales'), name: 'Sales', type: 'income', code: '4000' },
    { id: id('supplies'), name: 'Office Supplies', type: 'expense', code: '6000' },
  ].map(a => ({ ...a, workspaceId: ws }));
  const workspace = {
    id: ws, uid: OWNER, name: 'A8N-01 repro', currency: 'USD', timezone: 'UTC',
    defaultAccountMappings: { ar: id('ar'), ap: id('ap'), revenue: id('sales'), tax: id('vat'), cash: id('bank'), expense: id('supplies') },
  };

  const http = async (uid: string, path_: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}${path_}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(body) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> };
  };
  const postDocument = (uid: string, type: string, docId: string, action: string, data?: Record<string, unknown>) =>
    http(uid, `/api/v1/documents/${type}/${docId}/post`, { workspaceId: ws, action, ...(data ? { data } : {}) });
  const command = (uid: string, name: string, input: Record<string, unknown>) => http(uid, `/api/v1/commands/${name}`, { workspaceId: ws, input });
  const applyCredit = (uid: string, kind: 'customer' | 'vendor', creditId: string, documentId: string, amountCents: number) =>
    http(uid, '/api/v1/payments/credits/apply', { workspaceId: ws, kind, creditId, documentId, amountCents, date: '2026-10-22' });
  const refundCredit = (uid: string, creditId: string, amountCents: number) =>
    http(uid, '/api/v1/payments/credits/refund', { workspaceId: ws, kind: 'customer', creditId, amountCents, cashAccountId: id('bank'), date: '2026-10-23' });

  const load = async (c: string) => (await db.collection(c).where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id })) as Array<Record<string, unknown> & { id: string }>;
  const doc = async (c: string, docId: string) => (await db.collection(c).doc(docId).get()).data();
  /** Debit-positive ledger balance of one account over the entries the reports count (isPostable). */
  const balance = async (account: string, filter: (t: Transaction) => boolean = () => true) =>
    (await load('transactions') as unknown as Transaction[]).filter(t => isPostable(t) && filter(t))
      .flatMap(t => t.lines || []).filter(l => l.accountId === id(account)).reduce((s, l) => s + l.amountCents, 0);
  const forDocs = (ids: string[]) => (t: Transaction) => {
    const m = (t.metadata || {}) as Record<string, unknown>;
    return [m.invoiceId, m.creditNoteId, m.billId, m.vendorCreditId, m.creditId, m.documentId, m.refundOfCreditId].some(v => typeof v === 'string' && ids.includes(v));
  };
  /** The product's own EG-10 integrity checks (Data Health), over one scenario's documents and entries only. */
  const controlBalance = async (ids: string[]) => {
    const [allInvoices, allBills, allAllocations, chart, allTransactions] = await Promise.all([load('invoices'), load('bills'), load('paymentAllocations'), load('chartAccounts'), load('transactions')]);
    const invoices = allInvoices.filter(d => ids.includes(d.id));
    const bills = allBills.filter(d => ids.includes(d.id));
    const allocations = allAllocations.filter(r => ids.includes(String(r.documentId)));
    const transactions = (allTransactions as unknown as Transaction[]).filter(forDocs(ids));
    const ctx = { invoices, bills, allocations, accounts: chart, transactions, recurring: [], today: '2026-10-31', baseCurrency: 'USD' } as unknown as CheckContext;
    return ['control-balance', 'settlement-ledger'].flatMap(checkId => DATA_CHECKS.find(c => c.id === checkId)!.run(ctx).map(f => ({ id: f.id, title: f.title, description: f.description })));
  };
  const invoice = (docId: string, number: string) => ({
    id: docId, workspaceId: ws, number, customerName: 'Acme', customerId: 'c1', date: '2026-10-21', dueDate: '2026-11-20', status: 'sent', currency: 'USD',
    amountCents: 33_000, taxAmountCents: 3_000, taxRate: 10, taxVersion: 2,
    items: [{ id: 'l1', description: 'Hours', quantity: 2, rateCents: 15_000, amountCents: 30_000 }],
  });
  const creditNote = (docId: string, number: string) => ({
    id: docId, workspaceId: ws, number, customerId: 'c1', customerName: 'Acme', date: '2026-10-21', status: 'open', currency: 'USD',
    amountCents: 11_000, taxAmountCents: 1_000, taxVersion: 2, remainingCents: 11_000,
  });

  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../../../src/server/db/firestore')).getDb() as unknown as typeof db;
    await db.collection('workspaces').doc(ws).set({ ...workspace, members: [OWNER, BOOKKEEPER], roles: { [OWNER]: 'owner', [BOOKKEEPER]: 'bookkeeper' } } as unknown as Record<string, unknown>);
    for (const a of accounts) await db.collection('chartAccounts').doc(a.id).set(a as unknown as Record<string, unknown>);
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: `${String(req.header('x-test-uid'))}@test.local` }; next(); });
    app.use('/api/v1/documents', (await import('../../../src/server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/commands', (await import('../../../src/server/routes/commandRoutes')).commandRouter);
    app.use('/api/v1/payments', (await import('../../../src/server/routes/paymentRoutes')).paymentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    observed.workspace = ws;
  });

  after(async () => {
    server?.close();
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(observed, null, 2)}\n`);
    for (const table of ['paymentAllocations', 'allocationOperations', 'transactions', 'invoices', 'bills', 'creditNotes', 'vendorCredits', 'chartAccounts', 'idempotencyKeys', 'auditLogs', 'numberingSeries', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    await db.terminate();
  });

  test('Scenario A: a bookkeeper deletes a fully applied credit note; A/R ledger and the invoice disagree by 110.00', async () => {
    const inv = id('invA'), cn = id('cnA');
    assert.equal((await postDocument(OWNER, 'invoices', inv, 'create', invoice(inv, 'INV-A'))).status, 200);
    const created = await command(OWNER, 'creditnote.create', { creditNote: creditNote(cn, 'CN-A') });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const applied = await applyCredit(BOOKKEEPER, 'customer', cn, inv, 11_000);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));

    const before_ = {
      arLedger: await balance('ar', forDocs([inv, cn])), sales: await balance('sales', forDocs([inv, cn])), vat: await balance('vat', forDocs([inv, cn])),
      invoice: await doc('invoices', inv), credit: await doc('creditNotes', cn),
    };
    assert.equal(before_.arLedger, 22_000, 'before: A/R 330.00 − 110.00 = 220.00');
    assert.equal(before_.invoice?.amountPaidCents, 11_000);
    assert.equal(before_.invoice?.settledByRecordsCents, 11_000);
    assert.equal(before_.credit?.remainingCents, 0);
    assert.equal(before_.credit?.status, 'applied');
    assert.equal(before_.credit?.appliedTo, undefined, 'the application is NOT recorded in appliedTo (the field the delete guard reads)');

    const deleted = await command(BOOKKEEPER, 'creditnote.delete', { id: cn });
    observed.scenarioA_deleteStatus = deleted.status;
    observed.scenarioA_deleteBody = deleted.body;
    assert.equal(deleted.status, 200, `OBSERVED DEFECT: deleting a fully applied credit note is accepted. If this is now refused the guard was added: ${JSON.stringify(deleted.body)}`);

    const invoiceAfter = await doc('invoices', inv);
    const allocations = (await load('paymentAllocations')).filter(r => r.documentId === inv);
    const after_ = {
      creditExists: (await db.collection('creditNotes').doc(cn).get()).exists,
      arLedger: await balance('ar', forDocs([inv, cn])), sales: await balance('sales', forDocs([inv, cn])), vat: await balance('vat', forDocs([inv, cn])),
      invoiceAmountPaidCents: invoiceAfter?.amountPaidCents, invoiceSettledByRecordsCents: invoiceAfter?.settledByRecordsCents, invoiceStatus: invoiceAfter?.status,
      liveCreditRowsOnInvoice: allocations.filter(r => r.kind === 'credit').map(r => ({ sourceId: r.sourceId, amountCents: r.amountCents, reversedBy: r.reversedBy ?? null })),
    };
    assert.equal(after_.creditExists, false, 'the credit note record is gone');
    assert.equal(after_.arLedger, 33_000, 'A/R ledger is back to the full 330.00');
    assert.equal(after_.sales, -30_000, 'revenue is back to 300.00');
    assert.equal(after_.vat, -3_000, 'output VAT is back to 30.00');
    assert.equal(after_.invoiceAmountPaidCents, 11_000, 'the invoice still says 110.00 was paid by the credit');
    assert.equal(after_.invoiceSettledByRecordsCents, 11_000);
    assert.equal(after_.liveCreditRowsOnInvoice.length, 1, 'the payment-ledger row still points at the deleted credit note');
    const documentDue = 33_000 - Number(after_.invoiceAmountPaidCents);
    assert.equal(after_.arLedger - documentDue, 11_000, 'ledger 330.00 − document due 220.00 = 110.00 that no record explains');

    // no way back through the product: the invoice can be neither deleted nor voided, and there is no "unapply"
    const deleteInvoice = await command(OWNER, 'invoice.delete', { id: inv });
    const voidInvoice = await postDocument(OWNER, 'invoices', inv, 'update', { status: 'void' });
    observed.scenarioA = {
      before: { arLedgerCents: before_.arLedger, salesCents: before_.sales, vatCents: before_.vat, invoiceAmountPaidCents: before_.invoice?.amountPaidCents, creditRemainingCents: before_.credit?.remainingCents, creditStatus: before_.credit?.status },
      after: after_, ledgerMinusDocumentDueCents: after_.arLedger - documentDue,
      cleanup: { invoiceDelete: { status: deleteInvoice.status, body: deleteInvoice.body }, invoiceVoid: { status: voidInvoice.status, body: voidInvoice.body } },
      dataChecks: await controlBalance([inv, cn]),
    };
    assert.equal(deleteInvoice.status, 409, 'the invoice cannot be deleted: it has a recorded settlement');
    assert.equal(voidInvoice.status, 409, 'the invoice cannot be voided either');
  });

  test('Scenario B: a partly applied credit note is shrunk to what is left and refunded: 110.00 given against a 50.00 credit', async () => {
    const inv = id('invB'), cn = id('cnB');
    assert.equal((await postDocument(OWNER, 'invoices', inv, 'create', invoice(inv, 'INV-B'))).status, 200);
    assert.equal((await command(OWNER, 'creditnote.create', { creditNote: creditNote(cn, 'CN-B') })).status, 200);
    assert.equal((await applyCredit(BOOKKEEPER, 'customer', cn, inv, 6_000)).status, 200);
    const creditBefore = await doc('creditNotes', cn);
    assert.equal(creditBefore?.remainingCents, 5_000);
    assert.equal(creditBefore?.status, 'partially_applied');

    // total lowered from 110.00 to 50.00 (45.45 + 4.55): less than the 60.00 already applied would allow
    const shrink = await command(BOOKKEEPER, 'creditnote.update', { id: cn, data: { amountCents: 5_000, taxAmountCents: 455 } });
    observed.scenarioB_shrinkStatus = shrink.status;
    observed.scenarioB_shrinkBody = shrink.body;
    assert.equal(shrink.status, 200, `OBSERVED DEFECT: the total of a partly applied credit note can be lowered below what was applied. If refused, the guard was added: ${JSON.stringify(shrink.body)}`);
    const creditShrunk = await doc('creditNotes', cn);
    assert.equal(creditShrunk?.amountCents, 5_000);
    assert.equal(creditShrunk?.remainingCents, 5_000, 'remaining stays 50.00: the credit now looks unused');

    const refund = await refundCredit(BOOKKEEPER, cn, 5_000);
    observed.scenarioB_refundStatus = refund.status;
    observed.scenarioB_refundBody = refund.body;
    assert.equal(refund.status, 200, `OBSERVED: the 50.00 "remaining" is paid out in cash: ${JSON.stringify(refund.body)}`);

    const invoiceAfter = await doc('invoices', inv);
    const creditAfter = await doc('creditNotes', cn);
    const scoped = forDocs([inv, cn]);
    const result = {
      arLedgerCents: await balance('ar', scoped), bankCents: await balance('bank', scoped), salesCents: await balance('sales', scoped), vatCents: await balance('vat', scoped),
      invoiceAmountPaidCents: invoiceAfter?.amountPaidCents, creditAmountCents: creditAfter?.amountCents, creditRemainingCents: creditAfter?.remainingCents,
      creditRefundedCents: creditAfter?.refundedCents, creditStatus: creditAfter?.status,
    };
    observed.scenarioB = { ...result, dataChecks: await controlBalance([inv, cn]) };
    assert.equal(result.invoiceAmountPaidCents, 6_000, '60.00 of the invoice was settled by the credit');
    assert.equal(result.bankCents, -5_000, '50.00 left the bank');
    assert.equal(result.creditAmountCents, 5_000, 'against a credit note that is 50.00 in the books');
    // the credit note's own entry reduced revenue + VAT by 50.00 in total, yet 110.00 of value was given
    assert.equal(result.salesCents + result.vatCents, -(33_000 - 5_000), 'revenue + VAT net of the credit: 330.00 − 50.00 = 280.00');
    const documentDue = 33_000 - Number(result.invoiceAmountPaidCents);
    assert.equal(result.arLedgerCents - documentDue, 6_000, 'A/R ledger 330.00 − document due 270.00 = 60.00 that no record explains');
  });

  test('Scenario C: a fully applied vendor credit is deleted; the bill stays "paid" while A/P holds 118.00', async () => {
    const bill = id('billC'), vc = id('vcC');
    const billData = {
      id: bill, workspaceId: ws, number: 'BILL-C', vendorId: 'v1', vendorName: 'Paper Co', date: '2026-10-21', dueDate: '2026-11-20', status: 'unpaid', currency: 'USD',
      amountCents: 11_800, taxAmountCents: 1_800, taxRate: 18, taxVersion: 2, amountPaidCents: 0,
      splits: [{ id: 's1', accountId: id('supplies'), description: 'Paper', amountCents: 10_000 }],
    };
    const billPost = await postDocument(OWNER, 'bills', bill, 'create', billData);
    assert.equal(billPost.status, 200, JSON.stringify(billPost.body));
    const vcData = { id: vc, workspaceId: ws, number: 'VC-C', vendorId: 'v1', vendorName: 'Paper Co', date: '2026-10-21', status: 'open', currency: 'USD', amountCents: 11_800, taxAmountCents: 1_800, taxVersion: 2, remainingCents: 11_800 };
    const vcPost = await command(OWNER, 'vendorcredit.create', { vendorCredit: vcData });
    assert.equal(vcPost.status, 200, JSON.stringify(vcPost.body));
    const applied = await applyCredit(BOOKKEEPER, 'vendor', vc, bill, 11_800);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    const scoped = forDocs([bill, vc]);
    assert.equal(await balance('ap', scoped), 0, 'before: A/P 118.00 credit − 118.00 debit = 0');
    assert.equal((await doc('bills', bill))?.status, 'paid');

    const deleted = await command(BOOKKEEPER, 'vendorcredit.delete', { id: vc });
    observed.scenarioC_deleteStatus = deleted.status;
    observed.scenarioC_deleteBody = deleted.body;
    assert.equal(deleted.status, 200, `OBSERVED DEFECT: deleting a fully applied vendor credit is accepted. If refused, the guard was added: ${JSON.stringify(deleted.body)}`);
    const billAfter = await doc('bills', bill);
    const result = { apLedgerCents: await balance('ap', scoped), billStatus: billAfter?.status, billAmountPaidCents: billAfter?.amountPaidCents, vendorCreditExists: (await db.collection('vendorCredits').doc(vc).get()).exists };
    observed.scenarioC = { ...result, dataChecks: await controlBalance([bill, vc]) };
    assert.equal(result.vendorCreditExists, false);
    assert.equal(result.apLedgerCents, -11_800, 'A/P ledger: 118.00 owed again');
    assert.equal(result.billStatus, 'paid', 'the bill still says it is paid');
    assert.equal(result.billAmountPaidCents, 11_800);
  });

  test('Control: the same credit note cannot be voided or sent back to draft (the product already refuses that)', async () => {
    const inv = id('invD'), cn = id('cnD');
    assert.equal((await postDocument(OWNER, 'invoices', inv, 'create', invoice(inv, 'INV-D'))).status, 200);
    assert.equal((await command(OWNER, 'creditnote.create', { creditNote: creditNote(cn, 'CN-D') })).status, 200);
    assert.equal((await applyCredit(OWNER, 'customer', cn, inv, 6_000)).status, 200);
    const voided = await command(OWNER, 'creditnote.update', { id: cn, data: { status: 'void' } });
    const drafted = await command(OWNER, 'creditnote.update', { id: cn, data: { status: 'draft' } });
    observed.control = { voidStatus: voided.status, voidBody: voided.body, draftStatus: drafted.status, draftBody: drafted.body };
    assert.ok([400, 409].includes(voided.status), `void of an applied credit is refused (${voided.status})`);
    assert.ok([400, 409].includes(drafted.status), `draft of an applied credit is refused (${drafted.status})`);
    assert.equal((await doc('creditNotes', cn))?.status, 'partially_applied');
  });
});
