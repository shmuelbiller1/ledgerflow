/**
 * The main path across a group of books (DA-09), against the real database: two companies, each with
 * its own sales and costs, a loan from one to the other posted as intercompany (both sides at once),
 * one group of both. The group summary adds them up, finds the loan on both sides, takes it out of
 * the total and still balances; a fee one charges the other is taken out of the group's income and
 * costs; every company figure is what that company's own books say, and
 * explaining it there adds up to it. Then the second company keeps its books in euros: translated,
 * the total still balances, with the translation difference on its own line.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

describe('The main path across a group of books', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const ann = `ann_dag_${tag}`;
  const [hold, sub] = ['hold', 'sub'].map(n => `ws_dag_${n}_${tag}`);
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  let groupId = '';
  const call = async (path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}) => {
    const res = await fetch(`${base}${path}`, { method: init.method || 'GET', headers: { 'content-type': 'application/json', 'x-test-uid': ann, ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}) }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const entry = (ws: string, id: string, date: string, debit: string, credit: string, cents: number) => ({
    id: `${ws}_${id}`, workspaceId: ws, date, description: id, status: 'completed', type: 'actual', currency: 'USD', totalAmountCents: cents,
    lines: [{ accountId: `${ws}_${debit}`, amountCents: cents }, { accountId: `${ws}_${credit}`, amountCents: -cents }],
  });
  const summary = (extra = '') => call(`/api/v1/reports/group-summary?groupId=${groupId}&startDate=2026-01-01&endDate=2026-12-31${extra}`);

  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { accountRouter } = await import('../server/routes/accountRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    for (const [ws, name] of [[hold, 'Holding'], [sub, 'Daughter']]) {
      await db.collection('workspaces').doc(ws).set({ uid: ann, name, currency: 'USD', members: [ann] });
      for (const [id, accName, type, category] of [['cash', 'Cash', 'asset', 'Cash'], ['sales', 'Sales', 'income', 'Revenue'], ['rent', 'Rent', 'expense', 'Operating'], ['capital', 'Capital', 'equity', 'Equity']]) {
        await db.collection('chartAccounts').doc(`${ws}_${id}`).set({ workspaceId: ws, name: accName, type, category, code: id });
      }
    }
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'ann@example.test' }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/reports', reportRouter);
    app.use('/api/v1/account', accountRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await db.pool.query(`delete from public."workspaceGroups" where data->>'ownerUid' = $1`, [ann]);
    for (const ws of [hold, sub]) {
      for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'idempotencyKeys']) await db.pool.query(`delete from public."${table}" where workspace_id = $1`, [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
    }
    await db.terminate();
  });

  test('each company keeps its own books', async () => {
    for (const [ws, sale, rent] of [[hold, 50000, 20000], [sub, 30000, 5000]] as const) {
      const res = await call('/api/v1/transactions/bulk', { method: 'POST', body: { workspaceId: ws, transactions: [
        entry(ws, 'capital', '2026-01-02', 'cash', 'capital', 100000), entry(ws, 'sale', '2026-03-01', 'cash', 'sales', sale), entry(ws, 'rent', '2026-03-02', 'rent', 'cash', rent),
      ] } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  });

  test('a loan from one to the other is posted on both sides at once', async () => {
    const res = await call('/api/v1/transactions/intercompany/post', { method: 'POST', body: {
      sourceWorkspaceId: hold, targetWorkspaceId: sub, amountCents: 15000, date: '2026-04-01', description: 'Loan to Daughter',
      sourceAccountId: `${hold}_cash`, targetAccountId: `${sub}_cash`,
    } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const source = (await db.collection('transactions').doc(String(res.body.sourceTxId)).get()).data()!;
    const target = (await db.collection('transactions').doc(String(res.body.targetTxId)).get()).data()!;
    assert.equal(source.metadata.targetTxId, res.body.targetTxId);
    assert.equal(target.metadata.sourceTxId, res.body.sourceTxId);
  });

  test('the group adds them up, finds the loan on both sides, takes it out of the total and balances', async () => {
    const made = await call('/api/v1/account/groups', { method: 'POST', body: { name: 'Family', workspaceIds: [hold, sub] } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    groupId = String((made.body.group as { id: string }).id);
    const res = await summary();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const total = res.body.total as Record<string, number> & { eliminated: Record<string, number> };
    assert.equal(total.netIncome, 55000);
    assert.equal(total.income, 80000);
    assert.deepEqual(total.eliminated, { assets: 15000, liabilities: 15000, difference: 0, income: 0, cogs: 0, expense: 0, profitDifference: 0, investment: 0 }, 'the loan is taken out on both sides');
    assert.equal(total.totalAssets, total.totalLiabilities + total.totalEquity, 'the group balances');
    assert.equal(total.totalLiabilities, 0, 'nothing is owed outside the group');
    assert.deepEqual(res.body.intercompany, { matched: 1, unmatched: [] });
  });

  test('a sale from one to the other is taken out of the group\'s income and costs; net income stays (CB-26)', async () => {
    const res = await call('/api/v1/transactions/intercompany/post', { method: 'POST', body: {
      sourceWorkspaceId: hold, targetWorkspaceId: sub, amountCents: 4000, date: '2026-04-15', description: 'Management fee',
      sourceAccountId: `${hold}_sales`, targetAccountId: `${sub}_rent`,
    } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const group = await summary();
    const members = group.body.members as Array<{ income: number; expense: number }>;
    assert.deepEqual(members.map(m => [m.income, m.expense]), [[54000, 20000], [30000, 9000]], 'each company\'s own books have it');
    const total = group.body.total as Record<string, number> & { eliminated: Record<string, number> };
    assert.deepEqual([total.income, total.expense, total.netIncome], [80000, 25000, 55000], 'the group did not sell to itself');
    assert.deepEqual(total.eliminated, { assets: 19000, liabilities: 19000, difference: 0, income: 4000, cogs: 0, expense: 4000, profitDifference: 0, investment: 0 });
    assert.equal(total.totalAssets, total.totalLiabilities + total.totalEquity);
  });

  test('every company figure is its own books\' figure, and explaining it there adds up to it', async () => {
    const res = await summary();
    for (const member of res.body.members as Array<{ workspaceId: string; income: number; totalAssets: number }>) {
      const pl = await call(`/api/v1/reports/pl?workspaceId=${member.workspaceId}&startDate=2026-01-01&endDate=2026-12-31`);
      assert.equal((pl.body.income as { total: number }).total, member.income, `${member.workspaceId} income`);
      const bs = await call(`/api/v1/reports/balance-sheet?workspaceId=${member.workspaceId}&endDate=2026-12-31`);
      assert.equal(bs.body.totalAssets, member.totalAssets, `${member.workspaceId} assets`);
      const explained = await call(`/api/v1/reports/explain?workspaceId=${member.workspaceId}&accountIds=${member.workspaceId}_sales&startDate=2026-01-01&endDate=2026-12-31`);
      assert.equal(-Number(explained.body.totalCents), member.income, `${member.workspaceId} sales explained`);
    }
  });

  test('in euros, the daughter is translated and the group still balances, with the translation difference on its line', async () => {
    await db.collection('workspaces').doc(sub).update({ currency: 'EUR' });
    // a new loan between companies in different currencies needs what arrives; no guessed rate
    const loan = { sourceWorkspaceId: hold, targetWorkspaceId: sub, amountCents: 12000, date: '2026-05-01', sourceAccountId: `${hold}_cash`, targetAccountId: `${sub}_cash` };
    const refused = await call('/api/v1/transactions/intercompany/post', { method: 'POST', body: loan });
    assert.equal(refused.status, 400);
    assert.match(String(refused.body.error), /in USD and Daughter in EUR: say how much arrives in EUR/);
    const posted = await call('/api/v1/transactions/intercompany/post', { method: 'POST', body: { ...loan, targetAmountCents: 10000 } });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal((await db.collection('transactions').doc(String(posted.body.targetTxId)).get()).data()?.totalAmountCents, 10000);
    const rates = encodeURIComponent(JSON.stringify({ EUR: { closing: 1.2, average: 1.1, historical: 1 } }));
    const res = await summary(`&reportCurrency=USD&rates=${rates}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const total = res.body.total as Record<string, number> & { eliminated: Record<string, number> };
    assert.equal(total.totalAssets, total.totalLiabilities + total.totalEquity, 'still balances');
    assert.ok(total.cta !== 0, 'a translation difference');
    // the first loan was booked as 15,000 in both (before the companies' currencies differed): 15,000 EUR at 1.2;
    // the second as 12,000 USD and 10,000 EUR, which at 1.2 agree
    // the fee (4,000 in both) likewise: 4,000 USD against 4,800 at the closing rate, 4,400 at the average
    assert.equal(total.eliminated.assets, 31000);
    assert.equal(total.eliminated.liabilities, 34800, 'the daughter\'s side of both loans and the fee at the closing rate');
    assert.equal(total.eliminated.difference, -3800, 'the sides booked in one currency now differ by the rate, and it is said');
    assert.deepEqual([total.eliminated.income, total.eliminated.expense, total.eliminated.profitDifference], [4000, 4400, -400], 'and so do the fee\'s income and cost');
  });
  test('intercompany retries replay the same pair and audit each workspace once', async () => {
    const payload = { sourceWorkspaceId: hold, targetWorkspaceId: sub, amountCents: 300, targetAmountCents: 300, date: '2026-04-02', description: 'Retry test', sourceAccountId: `${hold}_cash`, targetAccountId: `${sub}_cash` };
    const key = `intercompany_retry_${tag}`;
    const first = await call('/api/v1/transactions/intercompany/post', { method: 'POST', body: payload, idempotencyKey: key });
    const again = await call('/api/v1/transactions/intercompany/post', { method: 'POST', body: payload, idempotencyKey: key });
    assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body, first.body);
    for (const [workspace, id] of [[hold, first.body.sourceTxId], [sub, first.body.targetTxId]] as const) {
      const logs = await db.collection('auditLogs').where('workspaceId', '==', workspace).where('entityId', '==', id).get();
      assert.equal(logs.docs.length, 1);
    }

  });


});
