/**
 * Scheduled reports (K-28): the last finished week (Monday to Sunday) or month; schedules checked
 * (report, frequency, 1–10 real addresses); the email and spreadsheet carry the report's own figures;
 * the daily job sends each period once (claimed and recorded per address: aud04-scheduled-report-delivery.test.ts); "Send now" for owners and accountants;
 * the database refuses a malformed schedule list. The database part runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  agingTable, lastFinishedPeriod, parseRecipients, profitAndLossTable, reportCsv, reportEmailHtml, scheduleProblem,
} from '../lib/scheduledReports';
import type { Firestore } from '../server/db/pgFirestore';

describe('Periods and schedules', () => {
  test('the last finished week is Monday to Sunday; the last finished month is the one before', () => {
    assert.deepEqual(lastFinishedPeriod('weekly', '2026-10-05'), { key: 'W:2026-09-28', startDate: '2026-09-28', endDate: '2026-10-04', label: '2026-09-28 – 2026-10-04' }, 'on a Monday');
    assert.equal(lastFinishedPeriod('weekly', '2026-10-11').key, 'W:2026-09-28', 'on the Sunday after: still that week');
    assert.equal(lastFinishedPeriod('weekly', '2026-10-12').key, 'W:2026-10-05');
    assert.deepEqual(lastFinishedPeriod('monthly', '2026-01-01'), { key: 'M:2025-12', startDate: '2025-12-01', endDate: '2025-12-31', label: '2025-12' });
    assert.equal(lastFinishedPeriod('monthly', '2028-03-15').endDate, '2028-02-29');
  });

  test('a schedule needs a known report, weekly or monthly, and 1–10 real addresses', () => {
    const ok = { report: 'profit-and-loss' as const, frequency: 'monthly' as const, recipients: ['a@b.co'] };
    assert.equal(scheduleProblem(ok), null);
    assert.match(scheduleProblem({ ...ok, report: 'cash' as never }) || '', /Choose a report/);
    assert.match(scheduleProblem({ ...ok, frequency: 'daily' as never }) || '', /weekly or monthly/);
    assert.match(scheduleProblem({ ...ok, recipients: [] }) || '', /at least one/);
    assert.match(scheduleProblem({ ...ok, recipients: ['not an address'] }) || '', /is not an email address/);
    assert.match(scheduleProblem({ ...ok, recipients: Array.from({ length: 11 }, (_, i) => `p${i}@b.co`) }) || '', /At most 10/);
    assert.deepEqual(parseRecipients('a@b.co, A@B.co;\nc@d.org  e@f.io'), ['a@b.co', 'c@d.org', 'e@f.io']);
  });

  test('the email and the spreadsheet carry the report\'s figures; text is escaped', () => {
    const period = lastFinishedPeriod('monthly', '2026-10-01');
    const table = profitAndLossTable({
      income: { total: 150000, accounts: { s: { name: 'Sales <web>', code: '4000', balance: 150000 }, z: { name: 'Idle', balance: 0 } } },
      expense: { total: 40000, accounts: { r: { name: 'Rent', code: '6000', balance: 40000 } } },
      netIncome: 110000,
    }, period);
    assert.equal(table.title, 'Profit and loss, 2026-09');
    assert.deepEqual(table.rows.map(r => r.cells), [['Income', ''], ['4000 Sales <web>', 150000], ['Total income', 150000], ['Expenses', ''], ['6000 Rent', 40000], ['Total expenses', 40000], ['Net profit', 110000]], 'an account at zero is left out');
    const html = reportEmailHtml(table, { workspaceName: 'Acme & Co', currency: 'USD', format: c => `$${(c / 100).toFixed(2)}` });
    assert.match(html, /Sales &lt;web&gt;/);
    assert.match(html, /Acme &amp; Co · amounts in USD/);
    assert.match(html, /\$1100\.00/);
    assert.equal(reportCsv(table).split('\r\n')[7], '"Net profit","1100.00"');
    const aging = agingTable([{ partyName: 'Acme', buckets: { current: 500, d1_30: 250 }, total: 750 }, { partyName: 'Beta', buckets: { d90plus: 100 }, total: 100 }], [{ key: 'current', label: 'Current' }, { key: 'd1_30', label: '1–30 days' }, { key: 'd90plus', label: 'Over 90 days' }], period);
    assert.deepEqual(aging.rows.at(-1)?.cells, ['Total', 500, 250, 100, 850]);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Sending (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_sched_${crypto.randomBytes(4).toString('hex')}`;
  const id = (name: string) => `${ws}_${name}`;
  let db: Firestore;
  let server: Server;
  let base = '';
  const sent: Array<{ to: string; subject: string; html: string; attachments?: Array<{ filename: string; content: string | Buffer }> }> = [];
  let setTransport: (t: null | ((m: never) => Promise<never>)) => void;
  const schedule = { id: 'pl', report: 'profit-and-loss', frequency: 'monthly', recipients: ['owner@example.com', 'acct@example.com'] };

  before(async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    const mailer = await import('../server/services/mailer');
    setTransport = mailer.setMailTransportForTests as never;
    setTransport((async (m: { to: string; subject: string; html: string }) => { sent.push(m); return { delivered: true, provider: 'test' }; }) as never);
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Sched Co', currency: 'USD', timezone: 'UTC', members: ['owner-1', 'book-1'], roles: { 'book-1': 'bookkeeper' }, scheduledReports: [schedule] });
    await db.collection('chartAccounts').doc(id('cash')).set({ workspaceId: ws, name: 'Cash', code: '1000', type: 'asset' });
    await db.collection('chartAccounts').doc(id('sales')).set({ workspaceId: ws, name: 'Sales', code: '4000', type: 'income' });
    for (const [n, date, cents] of [['sep', '2026-09-10', 120000], ['oct', '2026-10-02', 999]] as const) {
      await db.collection('transactions').doc(id(n)).set({ workspaceId: ws, date, description: n, status: 'completed', totalAmountCents: cents, lines: [{ accountId: id('cash'), amountCents: cents }, { accountId: id('sales'), amountCents: -cents }] });
    }
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    setTransport(null);
    server?.close();
    for (const table of ['transactions', 'chartAccounts', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('the daily run sends September once to each address, with its own figures and a spreadsheet', async () => {
    const { runScheduledReports } = await import('../server/services/scheduledReportService');
    await runScheduledReports(db, new Date('2026-10-06T08:00:00Z'));
    const mine = sent.filter(m => m.subject.includes('Sched Co'));
    assert.deepEqual(mine.map(m => m.to).sort(), ['acct@example.com', 'owner@example.com']);
    assert.equal(mine[0].subject, 'Profit and loss, 2026-09 · Sched Co');
    assert.match(mine[0].html, /\$1,200\.00/, 'September only: October\'s sale is not in it');
    assert.equal(mine[0].attachments?.[0].filename, 'profit-and-loss-2026-09-30.csv');
    assert.equal((await db.collection('workspaces').doc(ws).get()).data()?.scheduledReportsSent?.pl, 'M:2026-09');
    await runScheduledReports(db, new Date('2026-10-20T08:00:00Z'));
    assert.equal(sent.filter(m => m.subject.includes('Sched Co')).length, 2, 'not sent twice');
  });

  test('Send now: owners and accountants; the last finished period, the record of what was sent unchanged', async () => {
    const post = (uid: string, scheduleId = 'pl') => fetch(`${base}/api/v1/workspaces/${ws}/report-schedules/${scheduleId}/send-now`, { method: 'POST', headers: { 'x-test-uid': uid } });
    assert.equal((await post('book-1')).status, 403);
    assert.equal((await post('owner-1', 'nope')).status, 404);
    const before = sent.length;
    const res = await post('owner-1');
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { sent: number }).sent, 2);
    assert.equal(sent.length, before + 2);
  });

  test('R-3 preview: the report pack for the last finished month, three spreadsheets, nothing sent; owners and accountants only', async () => {
    const preview = (uid: string, body: Record<string, unknown>) => fetch(`${base}/api/v1/workspaces/${ws}/report-schedules/preview`, { method: 'POST', headers: { 'x-test-uid': uid, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await preview('book-1', { report: 'report-pack', frequency: 'monthly' })).status, 403);
    assert.equal((await preview('owner-1', { report: 'nope', frequency: 'monthly' })).status, 400);
    const before = sent.length;
    const res = await preview('owner-1', { report: 'report-pack', frequency: 'monthly' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json() as { subject: string; html: string; attachments: string[]; period: { endDate: string } };
    const end = body.period.endDate;
    assert.match(body.subject, /^Report pack .* · Sched Co$/);
    assert.match(body.html, /Profit and loss/);
    assert.match(body.html, /Balance sheet/);
    assert.match(body.html, /Receivables aging/);
    assert.deepEqual(body.attachments, [`profit-and-loss-${end}.csv`, `balance-sheet-${end}.csv`, `receivables-aging-${end}.csv`]);
    assert.equal(sent.length, before, 'a preview sends nothing');
  });

  test('the database refuses a malformed schedule list', async () => {
    const ref = db.collection('workspaces').doc(ws);
    for (const bad of [
      [{ ...schedule, report: 'cash' }],
      [{ ...schedule, recipients: ['nobody'] }],
      [{ ...schedule, extra: 1 }],
      [{ ...schedule, recipients: [] }],
      'weekly',
    ]) await assert.rejects(ref.update({ scheduledReports: bad }));
    await ref.update({ scheduledReports: [schedule, { ...schedule, id: 'bs', report: 'balance-sheet', frequency: 'weekly' }] });
    assert.equal((await ref.get()).data()?.scheduledReports.length, 2);
  });
});
