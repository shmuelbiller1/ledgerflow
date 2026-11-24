/**
 * Signing an estimate online (Y-20): writers make a private link (the same one when asked again; not
 * for a draft); the customer's page shows the estimate; a name and "I accept" sign it once; it becomes
 * an order with who, when and from where; an audit line and a notice; an expired one cannot be signed;
 * the PDF says who signed.
 */
import './helpers/dom';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { signatureProblem, signState } from '../lib/estimateSignature';
import { layoutDocumentPdf } from '../server/services/pdfService';
import PublicEstimatePage from '../components/sales/PublicEstimatePage';
import { EstimateSignLink } from '../components/sales/EstimateSignLink';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';

describe('The rules', () => {
  test('who can sign what, and what a signature needs', () => {
    assert.equal(signState({ status: 'sent' }, '2026-10-10'), 'open');
    assert.equal(signState({ status: 'sent', expiryDate: '2026-10-09' }, '2026-10-10'), 'expired');
    assert.equal(signState({ status: 'accepted', orderedAt: '2026-10-01' }, '2026-10-10'), 'signed');
    assert.equal(signState({ status: 'draft' }, '2026-10-10'), 'closed');
    assert.equal(signState({ status: 'declined' }, '2026-10-10'), 'closed');
    assert.equal(signatureProblem({ name: 'Dana Levi', agree: true }), null);
    assert.equal(signatureProblem({ name: 'דנה לוי', agree: true }), null);
    assert.match(String(signatureProblem({ name: 'D', agree: true })), /full name/);
    assert.match(String(signatureProblem({ name: '12345', agree: true })), /full name/);
    assert.match(String(signatureProblem({ name: 'Dana Levi', agree: false })), /I accept/);
  });

  test('the PDF of a signed estimate says who signed and when', () => {
    const layout = layoutDocumentPdf('estimate', { number: 'EST-1', amountCents: 100, orderedAt: '2026-10-10', signature: { name: 'Dana Levi', signedAt: '2026-10-10T09:00:00.000Z' } }, { name: 'Shop' });
    assert.deepEqual(layout.meta.at(-1), ['Signed by', 'Dana Levi, 2026-10-10']);
  });
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_sign_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const link = async (uid: string, estimateId: string) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/estimates/${estimateId}/sign-link`, { method: 'POST', headers: { 'x-test-uid': uid } });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const page = async (token: string) => fetch(`${base}/api/v1/invoices/public/estimate/${token}`);
  const sign = async (token: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/invoices/public/estimate/${token}/sign`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'TestBrowser/1' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { publicInvoiceRouter } = await import('../server/routes/publicInvoiceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Sign Co', currency: 'USD', members: ['owner-1', 'book-1', 'view-1'], roles: { 'book-1': 'bookkeeper', 'view-1': 'viewer' } });
    const est = (id: string, fields: Record<string, unknown>) => db.collection('estimates').doc(`${ws}_${id}`).set({ workspaceId: ws, customerId: 'c1', customerName: 'Acme Ltd', number: id.toUpperCase(), date: '2026-10-01', amountCents: 117000, taxAmountCents: 17000, lines: [{ description: 'Kitchen', quantity: 1, unitPriceCents: 100000, amountCents: 100000 }], ...fields });
    await est('e1', { status: 'sent', expiryDate: '2099-12-31' });
    await est('draft', { status: 'draft' });
    await est('old', { status: 'sent', expiryDate: '2020-01-01' });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/invoices/public', publicInvoiceRouter);
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    for (const table of ['estimates', 'auditLogs', 'notifications', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('a link, the page, one signature, and the estimate becomes an order', async () => {
    assert.equal((await link('view-1', `${ws}_e1`)).status, 403);
    assert.equal((await link('book-1', `${ws}_draft`)).status, 409);
    const made = await link('book-1', `${ws}_e1`);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const token = String(made.body.token);
    assert.match(token, /^es_[a-f0-9]{48}$/);
    assert.equal((await link('owner-1', `${ws}_e1`)).body.token, token, 'asking again gives the same link');

    assert.equal((await page('es_' + '0'.repeat(48))).status, 404);
    const shown = await (await page(token)).json() as { estimate: Record<string, unknown> };
    assert.deepEqual([shown.estimate.company, shown.estimate.number, shown.estimate.amountCents, shown.estimate.taxCents, shown.estimate.state], ['Sign Co', 'E1', 117000, 17000, 'open']);
    assert.equal(JSON.stringify(shown).includes('workspaceId'), false, 'nothing internal on the public page');

    assert.equal((await sign(token, { name: 'Dana Levi', agree: false })).status, 400);
    const signed = await sign(token, { name: '  Dana Levi ', agree: true });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.equal(signed.body.signedBy, 'Dana Levi');
    const est = (await db.collection('estimates').doc(`${ws}_e1`).get()).data()!;
    assert.deepEqual([est.status, est.orderedBy, typeof est.orderedAt, est.signature.name, est.signature.userAgent], ['accepted', 'customer', 'string', 'Dana Levi', 'TestBrowser/1']);
    assert.ok(est.signature.ip, 'the address is kept');
    assert.equal((await sign(token, { name: 'Someone Else', agree: true })).status, 409, 'signed once');
    assert.equal(((await (await page(token)).json()) as { estimate: { state: string; signedBy: string } }).estimate.signedBy, 'Dana Levi');
    const audit = await db.pool.query(`select data->>'description' as d from public."auditLogs" where workspace_id = $1 and data->>'action' = 'ESTIMATE_SIGNED'`, [ws]);
    assert.equal(audit.rows.length, 1);
    const told = await db.pool.query(`select data->>'title' as title from public.notifications where workspace_id = $1 and data->>'kind' = 'estimate.signed'`, [ws]);
    assert.ok(told.rows.length >= 1);
    assert.equal(told.rows[0].title, 'Acme Ltd accepted estimate E1');
    assert.equal((await link('book-1', `${ws}_e1`)).status, 409, 'no new link for a signed estimate');
  });

  test('an expired estimate cannot be signed', async () => {
    await db.collection('estimates').doc(`${ws}_old`).update({ signToken: `es_${'a'.repeat(48)}` });
    const res = await sign(`es_${'a'.repeat(48)}`, { name: 'Dana Levi', agree: true });
    assert.equal(res.status, 409);
    assert.match(String(res.body.message), /expired/);
  });
});

describe('On screen', () => {
  afterEach(() => cleanup());

  test('the customer\'s page: reads the estimate, asks for a name and "I accept", then thanks them', async () => {
    window.history.pushState({}, '', `/e/es_${'b'.repeat(48)}`);
    const posts: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ status: 'success', signedBy: 'Dana Levi', signedAt: '2026-10-10T09:00:00.000Z' }), { status: 200 }); }
      return new Response(JSON.stringify({ status: 'success', estimate: { company: 'Sign Co', number: 'E1', date: '2026-10-01', expiryDate: '', customerName: 'Acme Ltd', currency: 'USD', lines: [{ key: 'line-1', description: 'Kitchen', quantity: 1, amountCents: 100000 }], taxCents: 17000, amountCents: 117000, notes: '', state: 'open' } }), { status: 200 });
    }) as typeof fetch;
    render(<PublicEstimatePage />);
    await waitFor(() => assert.ok(screen.getByRole('heading', { name: 'Estimate E1' })));
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Dana Levi' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign and accept' })); });
    assert.match(screen.getByRole('alert').textContent || '', /I accept/, 'the box must be ticked');
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign and accept' })); });
    assert.deepEqual(posts, [{ name: 'Dana Levi', agree: true }]);
    await waitFor(() => assert.match(screen.getByRole('status').textContent || '', /Accepted and signed by Dana Levi/));
    window.history.pushState({}, '', '/');
  });

  test('on the estimates list: Ask to sign makes the link and shows it', async () => {
    const workspace = setComponentWorkspace();
    useAuthStore.setState({ currentWorkspaceId: 'w1', workspaces: [{ ...workspace, id: 'w1' }] });
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'success', token: `es_${'c'.repeat(48)}` }), { status: 200 })) as typeof fetch;
    render(<EstimateSignLink workspaceId="w1" estimate={{ id: 'e1', number: 'EST-1' }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask the customer to sign estimate EST-1' })); });
    await waitFor(() => assert.match((screen.getByLabelText('Signing link') as HTMLInputElement).value, /\/e\/es_c{48}$/));
  });
});
