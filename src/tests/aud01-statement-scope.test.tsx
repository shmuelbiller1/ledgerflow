/**
 * AUD-01: one customer statement checked in the three outputs — the screen (StatementView), the server JSON
 * (GET /reports/statement) and the PDF (GET /documents/statement/:id/pdf) — with one scope (src/lib/statementScope.ts):
 * the same period, the same documents, the same opening balance and the same running balance on every row.
 *
 * Worked figures (cents), Acme, period 2026-04-01 to 2026-06-30:
 *   before the period   INV-1 2026-03-10 +50,000, PAY-1 2026-03-20 −20,000, CN-1 2026-03-25 −5,000
 *                       → opening 50,000 − 20,000 − 5,000 = 25,000
 *   2026-04-05          INV-10 +10,000 → 35,000; INV-11 +20,000 → 55,000 (same day: by number, whatever order they
 *                       were read in); PAY-2 −10,000 → 45,000 (payments after the day's invoices)
 *   2026-05-02          CN-2 8,000 with 3,000 refunded → −5,000 → 40,000 ("part refunded")
 *   left out            INV-3 2026-07-01 (after the period), INV-4 draft, PAY-3 void, another customer's INV-9
 *   → closing 40,000
 * No dates given: 1 January of this year to today in the workspace's time zone, everywhere; every document above is
 * dated in 2026, so whatever the year, the closing balance is 50,000 − 20,000 − 5,000 + 10,000 + 20,000 − 10,000
 * − 5,000 + 99,000 = 139,000. A date that is not real, or a period that ends before it starts, is refused by all three.
 */
import { stubFetch } from './helpers/dom';
import { withSandboxReadApi } from './helpers/sandboxReadApi';
import test, { after, afterEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { resolveStatementScope } from '../lib/statementScope';
import { formatTzDate } from '../lib/utils';
import StatementView from '../components/reporting/StatementView';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { makeCreditNote, makeCustomer, makeInvoice, makePayment } from './fixtures';
import { pdfText } from './helpers/pdfText';
import type { Workspace } from '../types';

test('same-day references sort in one fixed locale (en), whatever the runtime\'s language', async () => {
  const { computeStatement } = await import('../server/reports/computeReports');
  const c = makeCustomer({ id: 'c' });
  const two = [makeInvoice({ id: 'a', number: 'חשבונית-2', customerId: 'c', amountCents: 100, date: '2026-04-05', status: 'sent' }), makeInvoice({ id: 'b', number: 'INV-2', customerId: 'c', amountCents: 200, date: '2026-04-05', status: 'sent' })];
  const order = (list: typeof two) => computeStatement(c, list, [], [], '2026-04-01', '2026-04-30', 'customer').entries.map(e => e.reference);
  const en = ['INV-2', 'חשבונית-2'].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
  assert.deepEqual(order(two), en);
  assert.deepEqual(order([...two].reverse()), en);
});

test('the scope: defaults to this year to today; refuses dates that are not real and a backwards period', () => {
  assert.deepEqual(resolveStatementScope({}, '2026-10-21'), { scope: { startDate: '2026-01-01', endDate: '2026-10-21' } });
  assert.deepEqual(resolveStatementScope({ startDate: '', endDate: '2026-06-30' }, '2026-10-21'), { scope: { startDate: '2026-01-01', endDate: '2026-06-30' } });
  assert.deepEqual(resolveStatementScope({ startDate: '2026-04-01', endDate: '2026-06-30' }, '2026-10-21'), { scope: { startDate: '2026-04-01', endDate: '2026-06-30' } });
  assert.deepEqual(resolveStatementScope({ startDate: '2026-02-30' }, '2026-10-21'), { error: 'Statement dates are YYYY-MM-DD' });
  assert.deepEqual(resolveStatementScope({ endDate: '30/06/2026' }, '2026-10-21'), { error: 'Statement dates are YYYY-MM-DD' });
  assert.deepEqual(resolveStatementScope({ startDate: '2026-07-01', endDate: '2026-06-30' }, '2026-10-21'), { error: 'The statement period starts after it ends' });
});

const realFetch = globalThis.fetch;
const WS = `ws_aud01_${crypto.randomBytes(4).toString('hex')}`;
const id = (name: string) => `${WS}_${name}`;
const ACME = id('acme');
const inv = (n: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
  makeInvoice({ id: id(n), number: n, customerId: ACME, customerName: 'Acme', amountCents: cents, date, status: 'sent', workspaceId: WS, ...extra });
const pay = (n: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
  makePayment({ id: id(n), reference: n, contactId: ACME, direction: 'received', status: 'posted', amountCents: cents, date, workspaceId: WS, ...extra });
const cn = (n: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
  makeCreditNote({ id: id(n), number: n, customerId: ACME, amountCents: cents, remainingCents: 0, date, status: 'applied', workspaceId: WS, ...extra });
// the order the screen's store holds them in: INV-11 before INV-10, the payment before the invoices
const INVOICES = [inv('INV-1', '2026-03-10', 50_000), inv('INV-11', '2026-04-05', 20_000), inv('INV-10', '2026-04-05', 10_000),
  inv('INV-3', '2026-07-01', 99_000), inv('INV-4', '2026-05-10', 7_000, { status: 'draft' }), inv('INV-9', '2026-04-06', 1_000, { customerId: id('other') })];
const PAYMENTS = [pay('PAY-2', '2026-04-05', 10_000), pay('PAY-1', '2026-03-20', 20_000), pay('PAY-3', '2026-05-11', 4_000, { status: 'void' })];
const CREDITS = [cn('CN-1', '2026-03-25', 5_000), cn('CN-2', '2026-05-02', 8_000, { refundedCents: 3_000 })];
const ROWS: Array<[string, string, string, number]> = [
  ['2026-04-05', 'Invoice', 'INV-10', 35_000], ['2026-04-05', 'Invoice', 'INV-11', 55_000],
  ['2026-04-05', 'Payment', 'PAY-2', 45_000], ['2026-05-02', 'Credit note (part refunded)', 'CN-2', 40_000],
];

const seedScreen = () => {
  stubFetch(404);
  useAuthStore.setState({ currentWorkspaceId: WS, workspaces: [{ id: WS, name: 'W', currency: 'USD', timezone: 'UTC' } as Workspace] });
  useLedgerStore.setState({ customers: [makeCustomer({ id: ACME, name: 'Acme' })], vendors: [], invoices: INVOICES, bills: [], payments: PAYMENTS, creditNotes: CREDITS, vendorCredits: [] });
};
afterEach(() => cleanup());

test('the screen: opening 250.00, each row\'s running balance, closing 400.00; a backwards period shows no statement', () => {
  seedScreen();
  render(<StatementView startDate="2026-04-01" endDate="2026-06-30" />);
  fireEvent.change(screen.getByLabelText(/Select Customer/), { target: { value: ACME } });
  assert.match(screen.getByText('Opening Balance').parentElement!.textContent || '', /\$250\.00/);
  assert.match(screen.getByText('Ending Outstanding Balance').parentElement!.textContent || '', /\$400\.00/);
  const rows = within(screen.getByText('Opening Balance Brought Forward').closest('table')!).getAllByRole('row').slice(2);
  assert.deepEqual(rows.map(r => [...r.querySelectorAll('td')].map(td => td.textContent)).map(c => [c[0], c[1], c[2], c[5]]),
    ROWS.map(([date, type, ref, running]) => [date, type, `#${ref}`, `$${(running / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`]));
  cleanup();
  render(<StatementView startDate="2026-07-01" endDate="2026-06-30" />);
  assert.ok(screen.getByText('The statement period starts after it ends.'));
  assert.equal(screen.queryByText('Opening Balance Brought Forward'), null);
  assert.equal(screen.queryByRole('button', { name: /Download PDF/ }), null, 'no PDF of a period that cannot be');
});

test('the screen with no dates: this year to today, closing 1,390.00', () => {
  seedScreen();
  render(<StatementView />);
  fireEvent.change(screen.getByLabelText(/Select Customer/), { target: { value: ACME } });
  const today = formatTzDate(new Date(), 'UTC');
  assert.ok(screen.getByText(`Period: ${today.slice(0, 4)}-01-01 to ${today}`));
  assert.match(screen.getByText('Ending Outstanding Balance').parentElement!.textContent || '', /\$1,390\.00/);
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('the server JSON and the PDF on a real database', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const OWNER = 'owner-1';
  const OTHER = `${WS}_x`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const get = (path: string) => realFetch(`${base}${path}`, { headers: { 'x-test-uid': OWNER } });
  const json = (q: string) => get(`/api/v1/reports/statement?workspaceId=${WS}&type=customer&contactId=${ACME}${q}`);
  const pdf = (q: string) => get(`/api/v1/documents/statement/${ACME}/pdf?workspaceId=${WS}${q}`);

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { documentRouter } = await import('../server/routes/documentRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(WS).set({ uid: OWNER, name: 'Statement Books', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    await db.collection('workspaces').doc(OTHER).set({ uid: 'owner-2', name: 'Other', currency: 'USD', members: ['owner-2'] });
    await db.collection('customers').doc(ACME).set({ workspaceId: WS, name: 'Acme' });
    await db.collection('customers').doc(id('elsewhere')).set({ workspaceId: OTHER, name: 'Not here' });
    // stored in another order than the screen holds them: the rows must come out the same
    for (const d of [...INVOICES].reverse()) await db.collection('invoices').doc(d.id).set(d);
    for (const p of [...PAYMENTS].reverse()) await db.collection('payments').doc(p.id).set(p);
    for (const c of CREDITS) await db.collection('creditNotes').doc(c.id).set(c);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/reports', reportRouter);
    app.use('/api/v1/documents', documentRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['invoices', 'payments', 'creditNotes', 'customers', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[WS, OTHER]]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('the JSON: opening 25,000, the same rows and running balances as the screen, closing 40,000', async () => {
    const res = await json('&startDate=2026-04-01&endDate=2026-06-30');
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual([body.startDate, body.endDate, body.openingBalanceCents, body.endingBalanceCents], ['2026-04-01', '2026-06-30', 25_000, 40_000]);
    assert.deepEqual(body.entries.map((e: { date: string; type: string; reference: string; runningBalanceCents: number }) => [e.date, e.type, e.reference, e.runningBalanceCents]), ROWS);
    await withSandboxReadApi(db, WS, OWNER, async origin => {
      const requestUrl = new URL(res.url);
      const scoped = await realFetch(`${origin}${requestUrl.pathname}${requestUrl.search}`, { headers: { 'x-test-uid': OWNER } });
      assert.equal(scoped.status, 200);
      assert.deepEqual(await scoped.json(), body);
    });
  });

  test('the PDF: the period, the opening row 250.00, the same rows, balance 400.00', async () => {
    const res = await pdf('&startDate=2026-04-01&endDate=2026-06-30');
    assert.equal(res.status, 200, await res.clone().text());
    const text = pdfText(Buffer.from(await res.arrayBuffer()));
    assert.match(text, /Period/);
    assert.match(text, /2026-04-01 Opening balance/);
    assert.match(text, /USD 250\.00/);
    const at = (s: string) => text.indexOf(s);
    assert.ok(at('2026-04-05 Invoice INV-10') > 0 && at('2026-04-05 Invoice INV-10') < at('2026-04-05 Invoice INV-11') && at('2026-04-05 Invoice INV-11') < at('2026-04-05 Payment PAY-2')
      && at('2026-04-05 Payment PAY-2') < at('2026-05-02 Credit note (part refunded) CN-2'), text);
    assert.match(text, /-USD 100\.00/);
    assert.match(text, /USD 400\.00/);
    // each row's balance after it, as on the screen and in the JSON: 250.00, 350.00, 550.00, 450.00, 400.00
    assert.match(text, /BALANCE/);
    let from = 0;
    for (const balance of ['USD 250.00', 'USD 350.00', 'USD 550.00', 'USD 450.00', 'USD 400.00']) {
      const at = text.indexOf(balance, from);
      assert.ok(at >= 0, `${balance} after ${from}: ${text}`);
      from = at + balance.length;
    }
    for (const left of ['INV-1 ', 'INV-3', 'INV-4', 'INV-9', 'PAY-3']) assert.ok(!text.includes(left), `${left} is not in the period`);
  });

  test('no dates: the JSON and the PDF both cover 1 January to today and close at 139,000; the screen said the same', async () => {
    const today = formatTzDate(new Date(), 'UTC');
    const body = await (await json('')).json();
    assert.deepEqual([body.startDate, body.endDate, body.endingBalanceCents], [`${today.slice(0, 4)}-01-01`, today, 139_000]);
    const text = pdfText(Buffer.from(await (await pdf('')).arrayBuffer()));
    assert.match(text, new RegExp(`${today.slice(0, 4)}-01-01 Opening balance`));
    assert.match(text, /USD 1,390\.00/);
  });

  test('a date that is not real or a backwards period is refused by both; another workspace\'s contact is not found', async () => {
    assert.equal((await json('&startDate=2026-02-30')).status, 400);
    assert.equal((await json('&startDate=2026-07-01&endDate=2026-06-30')).status, 400);
    assert.equal((await pdf('&startDate=2026-02-30')).status, 400);
    assert.equal((await pdf('&startDate=2026-07-01&endDate=2026-06-30')).status, 400);
    // a repeated date is not read as "no date" (it would have widened the PDF to this year)
    assert.equal((await pdf('&startDate=2026-04-01&startDate=2026-05-01&endDate=2026-06-30')).status, 400);
    assert.equal((await json('&startDate=2026-04-01&startDate=2026-05-01')).status, 400);
    assert.equal((await get(`/api/v1/reports/statement?workspaceId=${WS}&type=customer&contactId=${id('elsewhere')}`)).status, 404);
    assert.equal((await get(`/api/v1/reports/statement?workspaceId=${WS}&type=vendor&contactId=${ACME}`)).status, 404, 'Acme is a customer, not a vendor');
  });
});
