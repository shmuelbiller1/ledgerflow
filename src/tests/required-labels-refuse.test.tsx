/**
 * Required labels that refuse (Z-12): a label rule can refuse instead of only listing. Then the
 * server does not save an entry a person typed (posted, created in a batch, changed or corrected)
 * that misses the label, and says which label and account. Entries LedgerFlow makes itself (cost of
 * goods sold, revaluations, reversals) and entries made with imported bank lines are never refused,
 * only listed. The database part runs when LF_TEST_DATABASE_URL is set.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { refusedLabels, refusedLabelsMessage, requiredLabelWarnings, typedByPerson, withRequiredOn } from '../lib/requiredLabels';
import { RequiredLabelRules } from '../components/platform/settings/RequiredLabelRules';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { stubFetchWithBodies } from './helpers/dom';
import { makeChartAccount, makeTransaction } from './fixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { getSupabase } from '../lib/db/client';
import type { DimensionDefinition, Transaction } from '../types';

import { BRAND_NAME } from '../config/brand';
const dims = (requiredOn?: DimensionDefinition['requiredOn']): DimensionDefinition[] => [
  { id: 'category', name: 'Category', systemDefault: true },
  { id: 'property', name: 'Property', ...(requiredOn ? { requiredOn } : {}) },
];
const refusing = dims({ accountIds: ['util'], since: '2026-10-01', refuse: true });
const listing = dims({ accountIds: ['util'], since: '2026-10-01' });
const entry = (over: Partial<Transaction> = {}, utilLine: Record<string, unknown> = {}): Transaction => makeTransaction({
  id: 'tx1', date: '2026-10-05', description: 'Electric bill', status: 'completed',
  lines: [{ accountId: 'util', accountName: 'Utilities', amountCents: 12000, ...utilLine }, { accountId: 'bank', accountName: 'Checking', amountCents: -12000 }],
  ...over,
} as Partial<Transaction>);

describe('The rule', () => {
  test('a refusing rule refuses an entry a person typed without the label, and says what to do', () => {
    const missing = refusedLabels(entry(), refusing);
    assert.deepEqual(missing.map(m => [m.dimensionName, m.accountName]), [['Property', 'Utilities']]);
    assert.match(refusedLabelsMessage(missing), /^This entry needs Property on Utilities \(a required label\)\. Add it to the line, or ask an owner or accountant/);
    assert.equal(refusedLabels(entry({}, { dimensions: { property: 'P5' } }), refusing).length, 0, 'labelled');
    assert.equal(refusedLabels(entry(), listing).length, 0, 'a rule that only lists never refuses');
    assert.equal(refusedLabels(entry({ date: '2026-09-30' }), refusing).length, 0, 'before the rule applies');
    assert.equal(refusedLabels(entry({ status: 'draft' }), refusing).length, 0, 'a draft');
  });

  test(`entries ${BRAND_NAME} makes itself and reversals are never refused; bills, invoices and journal entries are`, () => {
    for (const type of ['invoice-cogs-auto', 'credit-return-auto', 'fx-revaluation', 'revenue-recognition', 'depreciation-run', 'invoice-payment']) {
      assert.equal(typedByPerson({ metadata: { type } }), false, type);
      assert.equal(refusedLabels(entry({ metadata: { type } } as Partial<Transaction>), refusing).length, 0, type);
    }
    assert.equal(typedByPerson({ metadata: { reversesTxId: 'tx0' } }), false);
    assert.equal(typedByPerson({ metadata: { isReversal: true, type: 'journal' } }), false);
    for (const type of [undefined, 'journal', 'bill-accrual', 'invoice-accrual', 'bank-line-split']) {
      assert.equal(typedByPerson({ metadata: type ? { type } : {} }), true, String(type));
    }
    assert.equal(typedByPerson({}), true, 'an entry without a kind is a journal entry');
  });

  test('the form warning says the entry is not saved without it; the setting is kept when accounts change', () => {
    assert.deepEqual(requiredLabelWarnings([{ accountId: 'util' }], '2026-10-05', refusing, []), ['Property is required on this account (line 1): the entry is not saved without it']);
    const next = withRequiredOn(refusing, 'property', { accountIds: ['util', 'rent'], since: '2026-10-01', refuse: true });
    assert.equal(next.find(d => d.id === 'property')!.requiredOn!.refuse, true);
    const off = withRequiredOn(refusing, 'property', { accountIds: ['util'], since: '2026-10-01', refuse: false });
    assert.equal('refuse' in off.find(d => d.id === 'property')!.requiredOn!, false);
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_refuse_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const call = async (path: string, method: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/transactions${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const journal = (id: string, labelled: boolean, metadata: Record<string, unknown> = {}) => ({
    id: `${ws}_${id}`, workspaceId: ws, date: '2026-10-05', description: 'Electric bill', status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: 12000,
    metadata,
    lines: [
      { accountId: `${ws}_util`, amountCents: 12000, ...(labelled ? { dimensions: { property: 'P5' } } : {}) },
      { accountId: `${ws}_bank`, amountCents: -12000 },
    ],
  });
  const exists = async (id: string) => (await db.collection('transactions').doc(`${ws}_${id}`).get()).exists;

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({
      uid: 'owner-1', name: 'Rentals', members: ['owner-1'], currency: 'USD',
      dimensions: [{ id: 'category', name: 'Category', systemDefault: true }, { id: 'property', name: 'Property', requiredOn: { accountIds: [`${ws}_util`], since: '2026-10-01', refuse: true } }],
    });
    await db.collection('chartAccounts').doc(`${ws}_util`).set({ workspaceId: ws, name: 'Utilities', type: 'expense', code: '6200' });
    await db.collection('chartAccounts').doc(`${ws}_bank`).set({ workspaceId: ws, name: 'Checking', type: 'asset', category: 'Cash', code: '1000' });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bankLines', 'chartAccounts', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  test('posting: an entry without the label is refused and nothing is written; with it, it is saved', async () => {
    const refused = await call('/bulk', 'POST', { workspaceId: ws, transactions: [journal('ok', true), journal('j1', false)] });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(String(refused.body.error), /needs Property on Utilities/);
    assert.equal(refused.body.transactionId, `${ws}_j1`);
    assert.equal(await exists('ok'), false, 'all or nothing');
    assert.equal((await call('/bulk', 'POST', { workspaceId: ws, transactions: [journal('j2', true)] })).status, 200);
    assert.equal(await exists('j2'), true);
  });

  test(`entries ${BRAND_NAME} makes and entries made with imported bank lines are saved, and listed`, async () => {
    const auto = await call('/bulk', 'POST', { workspaceId: ws, transactions: [journal('auto', false, { type: 'revenue-recognition' })] });
    assert.equal(auto.status, 200, JSON.stringify(auto.body));
    const line = { id: `${ws}_bl1`, status: 'matched', accountId: `${ws}_bank`, date: '2026-10-05', description: 'ELECTRIC CO', amountCents: -12000, matchedTransactionId: `${ws}_fromBank` };
    const imported = await call('/bulk', 'POST', { workspaceId: ws, transactions: [journal('fromBank', false)], bankLines: [line] });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
  });

  test('a batch, a change and a correction are refused the same way; voiding is not', async () => {
    const batch = await call('/batch-create', 'POST', { workspaceId: ws, transactions: [journal('b1', true), journal('b2', false)] });
    assert.equal(batch.status, 400, JSON.stringify(batch.body));
    assert.match(String(batch.body.message || batch.body.error), /Entry 1: This entry needs Property on Utilities/);
    assert.equal(await exists('b1'), false);

    const changed = await call(`/${ws}_j2`, 'PUT', { transaction: journal('j2', false) });
    assert.equal(changed.status, 400, JSON.stringify(changed.body));
    assert.equal((await db.collection('transactions').doc(`${ws}_j2`).get()).data()?.lines[0].dimensions?.property, 'P5', 'unchanged');

    const corrected = await call(`/${ws}_j2/reverse`, 'POST', { workspaceId: ws, reason: 'fix', replacement: { ...journal('j2fix', false), id: undefined } });
    assert.equal(corrected.status, 400, JSON.stringify(corrected.body));
    assert.match(String(corrected.body.error), /needs Property on Utilities/);
    assert.equal((await db.collection('transactions').doc(`${ws}_j2`).get()).data()?.reversalEventId, undefined, 'nothing reversed');

    const voided = await call(`/${ws}_j2/reverse`, 'POST', { workspaceId: ws, reason: 'void' });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
  });
});

describe('Settings → Dimensions → Required labels', () => {
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
  const utilities = makeChartAccount({ id: 'util', code: '6200', name: 'Utilities', type: 'expense' });

  test('an owner turns on "refuse": it is saved on the rule, and the accounts and date stay', async () => {
    setComponentWorkspace('owner');
    useAuthStore.setState(s => ({ workspaces: s.workspaces.map(w => ({ ...w, dimensions: listing })) }));
    useLedgerStore.setState({ accounts: [utilities] });
    const calls = stubFetchWithBodies(200, null);
    let saved: DimensionDefinition[] = [];
    render(<RequiredLabelRules dimensions={listing} onSaved={next => { saved = next; }} />);
    const box = screen.getByRole('checkbox', { name: 'Refuse to save an entry without it' }) as HTMLInputElement;
    assert.equal(box.checked, false);
    await act(async () => { fireEvent.click(box); });
    await waitFor(() => assert.ok(saved.length > 0));
    const write = calls.find(c => /\/rpc\/lf_/.test(c.url) && (c.body as { p_table?: string }).p_table === 'workspaces')!;
    const sent = ((write.body as { p_set?: { dimensions: DimensionDefinition[] } }).p_set)!.dimensions;
    assert.deepEqual(sent.find(d => d.id === 'property')!.requiredOn, { accountIds: ['util'], since: '2026-10-01', refuse: true });
  });

  test('a bookkeeper is told entries without it are not saved', () => {
    setComponentWorkspace('bookkeeper');
    useLedgerStore.setState({ accounts: [utilities] });
    stubFetchWithBodies(200, null);
    render(<RequiredLabelRules dimensions={refusing} onSaved={() => {}} />);
    assert.match(document.body.textContent || '', /from 2026-10-01; entries without it are not saved/);
    assert.equal(screen.queryByRole('checkbox'), null);
  });
});
