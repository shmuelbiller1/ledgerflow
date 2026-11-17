import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, describe } from 'node:test';
import type { ItemDetails, StockAge } from '../lib/stockMoves';
import { Firestore } from '../server/db/firestore';
import type { Explanation } from '../server/reports/explain';
import { reportCacheSize } from '../server/routes/reportRoutes';
import { buildSnapshot, periodBalancesReady, resetPeriodBalancesReadyForTests, type BalancesAsOf } from '../server/services/balanceService';
import { resetStockMovesReadyForTests, stockMovesReady } from '../server/services/stockMoveService';
import { seedSandbox } from './helpers/sandbox';
import { startBooksReadApi } from './helpers/sandboxReadApi';

const url = process.env.LF_TEST_DATABASE_URL;
const person = 'bookkeeper';
const read = fetch;

describe('SBX-1 HTTP report and balance reads (PostgreSQL)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `sbx-report-${randomUUID()}`;
  const other = `${ws}-other`;
  const id = (s: string) => `${ws}-${s}`;
  const cash = id('cash');
  const sale = id('sales');
  const invoice = id('invoice');
  const wsQuery = `workspaceId=${ws}`;
  const reports = '/api/v1/reports';
  const balances = '/api/v1/balances';
  const date = '2026-03-31';
  const sheet = `${reports}/balance-sheet?${wsQuery}&endDate=${date}`;
  const pl = `${reports}/profit-and-loss?${wsQuery}&startDate=2025-01-01&endDate=${date}`;
  let live: Firestore;
  let draft: Firestore;
  let sandboxId: string;
  let realApi: Awaited<ReturnType<typeof startBooksReadApi>>;
  let sandboxApi: typeof realApi;

  const request = (api: typeof realApi, path: string, uid = person, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('x-test-uid', uid);
    return read(`${api.base}${path}`, { ...init, headers });
  };
  async function json<T>(api: typeof realApi, path: string, init?: RequestInit): Promise<T> {
    const answer = await request(api, path, person, init);
    const body = await answer.json() as T;
    assert.equal(answer.status, 200, `${path}: ${JSON.stringify(body)}`);
    return body;
  }
  const lines = (amount: number) => [{ accountId: cash, amountCents: amount }, { accountId: sale, amountCents: -amount }];
  const entry = (day: string, amount: number) => ({ workspaceId: ws, date: day, status: 'completed', lines: lines(amount) });

  before(async () => {
    // A single connection suffices for both handles, including catalog probes on a checked-out transaction.
    live = new Firestore({ connectionString: url, max: 1 });
    for (const workspaceId of [ws, other]) {
      await live.collection('workspaces').doc(workspaceId).create({ uid: 'owner', members: ['owner', person, 'reader'], currency: 'USD' });
    }
    await live.doc(`chartAccounts/${cash}`).create({ workspaceId: ws, name: 'Cash', code: '1000', type: 'asset', category: 'Cash' });
    await live.doc(`chartAccounts/${sale}`).create({ workspaceId: ws, name: 'Sales', code: '4000', type: 'revenue', category: 'Revenue' });
    await live.doc(`transactions/${id('closed-sale')}`).create({ ...entry('2025-10-02', 10_000), metadata: { invoiceId: invoice } });
    await live.doc(`transactions/${id('open-sale')}`).create(entry('2026-02-04', 2_000));
    await live.doc(`transactions/${id('elsewhere')}`).create({ workspaceId: other, date: '2028-01-01', status: 'draft' });
    await buildSnapshot(live, ws, '2025-12-31', 'test');
    for (const n of ['file-1', 'file-2']) await live.doc(`documents/${id(n)}`).create({ workspaceId: ws, linkedId: invoice });
    await live.doc(`documents/${id('foreign-file')}`).create({ workspaceId: other, linkedId: invoice });
    await live.doc(`stockMoves/${id('stock')}`).create({
      workspaceId: ws, itemId: id('widget'), itemName: 'Widget', kind: 'purchase', date: '2026-03-01',
      quantity: 2, quantityBefore: 0, quantityAfter: 2, unitCostCents: 300, valueCents: 600, seq: '1', uid: person,
    });
    sandboxId = await seedSandbox(live, ws, person);
    draft = live.forSandbox(sandboxId);
    realApi = await startBooksReadApi(live);
    sandboxApi = await startBooksReadApi(live, draft);
  });

  after(async () => {
    await sandboxApi?.stop();
    await realApi?.stop();
    if (!live) return;
    try {
      await live.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [ws]);
      for (const table of ['transactions', 'periodBalances', 'chartAccounts', 'documents', 'stockMoves', 'repostQueue', 'workspaces']) {
        await live.pool.query(`delete from public."${table}" where workspace_id = any($1::text[]) or id = any($1::text[])`, [[ws, other]]);
      }
    } finally {
      await live.terminate();
    }
  });

  test('empty-overlay figures match; a draft edit before the snapshot never reuses it or the live cached answer', async () => {
    type Pnl = { netIncome: number; provenance: { cachedAt?: string } };
    type Sheet = { assets: Record<string, number>; provenance: { cachedAt?: string } };
    const balance = `${balances}?${wsQuery}&asOf=${date}&byLabel=1`;
    const original = await json<BalancesAsOf>(realApi, balance);
    assert.equal(original.snapshot?.asOf, '2025-12-31');
    assert.equal(original.entriesRead, 1);
    assert.equal(original.accounts[cash], 12_000);
    assert.equal(original.retainedEarnings, 12_000);
    const empty = await json<BalancesAsOf>(sandboxApi, balance);
    assert.deepEqual(empty.accounts, original.accounts);
    assert.deepEqual(empty.byLabel, original.byLabel);
    assert.equal(empty.retainedEarnings, original.retainedEarnings);
    assert.equal(empty.snapshot, null);
    assert.equal(empty.entriesRead, 2);
    const livePnl = await json<Pnl>(realApi, pl);
    const liveSheet = await json<Sheet>(realApi, sheet);
    assert.equal(livePnl.netIncome, 12_000);
    assert.equal(liveSheet.assets[cash], 12_000);
    assert.deepEqual(await json<Pnl>(sandboxApi, pl), livePnl);
    assert.deepEqual(await json<Sheet>(sandboxApi, sheet), liveSheet);

    const years = `${balances}/entry-years?${wsQuery}`;
    const savedYears = await json<{ years: number[] }>(realApi, years);
    assert.deepEqual(savedYears.years, [2026, 2025]);
    assert.deepEqual(await json(sandboxApi, years), savedYears);

    const cacheSize = reportCacheSize();
    await draft.doc(`transactions/${id('closed-sale')}`).update({ lines: lines(25_000) });
    await draft.doc(`transactions/${id('open-sale')}`).delete();
    await draft.doc(`transactions/${id('new-year')}`).create(entry('2027-01-01', 700));
    const changed = await json<BalancesAsOf>(sandboxApi, balance);
    assert.equal(changed.accounts[cash], 25_000);
    assert.equal(changed.retainedEarnings, 25_000);
    assert.equal(changed.snapshot, null);
    assert.deepEqual((await json<{ years: number[] }>(sandboxApi, years)).years, [2027, 2025]);
    assert.deepEqual(await json(realApi, years), savedYears);
    const draftPnl = await json<Pnl>(sandboxApi, pl);
    const draftSheet = await json<Sheet>(sandboxApi, sheet);
    assert.equal(draftPnl.netIncome, 25_000);
    assert.equal(draftSheet.assets[cash], 25_000);
    assert.equal(draftPnl.provenance.cachedAt, undefined);
    assert.equal(draftSheet.provenance.cachedAt, undefined);
    // A sandbox-only URL must not allocate a cache entry either.
    assert.equal((await json<Pnl>(sandboxApi, `${pl}&_read=draft-only`)).netIncome, 25_000);
    assert.equal(reportCacheSize(), cacheSize);
    assert.deepEqual(await json(realApi, balance), original, 'live snapshot and balances are unchanged');
    const realRepeat = await json<Pnl>(realApi, pl);
    assert.equal(realRepeat.netIncome, 12_000);
    assert.ok(realRepeat.provenance.cachedAt);
    assert.equal((await json<Sheet>(realApi, sheet)).assets[cash], 12_000);
    assert.equal((await json<Pnl>(realApi, `${pl}&_read=draft-only`)).netIncome, 12_000);

    const savedByPerson = live.doc(`transactions/${id('live-during-draft')}`);
    await savedByPerson.create(entry('2026-03-30', 500));
    try {
      assert.equal((await json<Pnl>(sandboxApi, pl)).netIncome, 25_500, 'same URL sees a new untouched live row');
    } finally {
      await savedByPerson.delete();
    }
  });

  test('explain counts only visible linked files, through both GET and POST', async () => {
    const path = `${reports}/explain?${wsQuery}&accountIds=${cash}&endDate=2025-12-31`;
    const counts = (answer: Explanation) => answer.lines.map(line => [line.document?.id, line.attachments]);
    const original = await json<Explanation>(realApi, path);
    assert.deepEqual(counts(original), [[invoice, 2]], 'a same-linked file in another workspace is not counted');
    assert.deepEqual(counts(await json<Explanation>(sandboxApi, path)), counts(original));
    await draft.doc(`documents/${id('file-1')}`).delete();
    await draft.doc(`documents/${id('file-2')}`).update({ linkedId: 'another-invoice' });
    await draft.doc(`documents/${id('draft-file')}`).create({ workspaceId: ws, linkedId: invoice });
    const getResult = await json<Explanation>(sandboxApi, path);
    assert.deepEqual(counts(getResult), [[invoice, 1]]);
    const postResult = await json<Explanation>(sandboxApi, `${reports}/explain`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: ws, accountIds: [cash], endDate: '2025-12-31' }),
    });
    assert.deepEqual(postResult, getResult);
    assert.deepEqual(await json(realApi, path), original);
  });

  test('stock report readers use the scoped stock history, including on a one-connection pool', { timeout: 5_000 }, async () => {
    const details = `${reports}/inventory-details?${wsQuery}&startDate=2026-03-01&endDate=${date}`;
    const aging = `${reports}/stock-aging?${wsQuery}&asOf=${date}`;
    const original = await json<{ items: ItemDetails[] }>(realApi, details);
    const originalAging = await json<{ items: StockAge[] }>(realApi, aging);
    assert.deepEqual(original.items[0].closing, { quantity: 2, valueCents: 600 });
    assert.deepEqual(await json(sandboxApi, details), original);
    assert.deepEqual(await json(sandboxApi, aging), originalAging);
    await draft.runTransaction(async tx => {
      assert.equal(await stockMovesReady(draft, tx), true);
      assert.equal(await periodBalancesReady(draft, tx), true);
      tx.update(draft.doc(`stockMoves/${id('stock')}`), { quantity: 4, quantityAfter: 4, valueCents: 1200 });
    });
    assert.deepEqual((await json<{ items: ItemDetails[] }>(sandboxApi, details)).items[0].closing, { quantity: 4, valueCents: 1200 });
    assert.equal((await json<{ items: StockAge[] }>(sandboxApi, aging)).items[0].buckets.d30, 4);
    assert.deepEqual(await json(realApi, details), original);
    assert.deepEqual(await json(realApi, aging), originalAging);
  });

  test('sandbox readiness checks neither use nor populate the live flags', async t => {
    resetPeriodBalancesReadyForTests();
    resetStockMovesReadyForTests();
    const scopedProbe = t.mock.method(draft, 'tablesExist');
    const liveProbe = t.mock.method(live, 'tablesExist');
    try {
      assert.equal(await stockMovesReady(draft), true);
      assert.equal(await periodBalancesReady(draft), true);
      assert.equal(liveProbe.mock.callCount(), 0);
      assert.equal(await stockMovesReady(live), true);
      assert.equal(await periodBalancesReady(live), true);
      assert.deepEqual(liveProbe.mock.calls.map(call => call.arguments), [['stockMoves'], ['periodBalances']]);
      assert.equal(await stockMovesReady(draft), true);
      assert.equal(await periodBalancesReady(draft), true);
      assert.deepEqual(scopedProbe.mock.calls.map(call => call.arguments), [['stockMoves'], ['periodBalances'], ['stockMoves'], ['periodBalances']]);
    } finally {
      resetPeriodBalancesReadyForTests();
      resetStockMovesReadyForTests();
    }
  });

  test('read scope requires the bound person and current real membership; live HTTP cannot select a sandbox', async () => {
    assert.equal((await request(sandboxApi, pl, 'reader')).status, 403, 'another member does not own this sandbox');
    assert.equal((await request(sandboxApi, pl.replace(ws, other))).status, 403, 'this person belongs to both workspaces');
    assert.equal((await request(sandboxApi, pl, person, { headers: { 'x-test-key-workspace': ws } })).status, 403);
    assert.equal((await request(sandboxApi, `${reports}/group-summary?groupId=test&startDate=2025-01-01&endDate=${date}`)).status, 403);
    const scopedAnswer = await request(sandboxApi, pl);
    assert.match(scopedAnswer.headers.get('Cache-Control') || '', /no-store/);
    await scopedAnswer.json();
    const injected = await json<{ netIncome: number }>(realApi, `${pl}&sandboxId=${sandboxId}`, { headers: { 'x-sandbox-id': sandboxId } });
    assert.equal(injected.netIncome, 12_000);
    const members = ['owner', person, 'reader'];
    await draft.collection('workspaces').doc(ws).update({ members });
    await live.collection('workspaces').doc(ws).update({ members: ['owner', 'reader'] });
    try {
      assert.equal((await request(sandboxApi, pl)).status, 403, 'still a member in the overlay, not in the real books');
      assert.equal((await request(sandboxApi, `${balances}/entry-years?${wsQuery}`)).status, 403);
    } finally {
      await live.collection('workspaces').doc(ws).update({ members });
    }
    await live.pool.query('update sandbox.sandboxes set expires_at = now() where id = $1', [sandboxId]);
    assert.equal((await request(sandboxApi, pl)).status, 403, 'no cached or live fallback when the scope expires');
  });
});
