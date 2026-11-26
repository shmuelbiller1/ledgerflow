/**
 * AUP-31: the anomaly scan reads a deterministic sample (the newest posted entries), leaves out drafts,
 * voids and forecasts, compares amounts in the book's currency, and says so when it could not judge
 * (too few entries, no variation) instead of answering like a clean scan.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { callApi, startOwnerApp } from './helpers/liveApiServer';

type Scan = { anomalies: Array<{ id: string; amountCents: number }>; currency: string; skipped: string | null; scanned: number; sampleLimit: number; sampleCapped: boolean };

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-31: anomaly scan semantics', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const ws = `ws_aup31_${randomUUID()}`;
  let app!: Awaited<ReturnType<typeof startOwnerApp>>;
  let db: typeof app.db, base = '', token = '';
  // a posted entry needs two balanced lines; they carry the entry's own-currency amount
  const put = (name: string, fields: Record<string, unknown> & { totalAmountCents: number }) => db.collection('transactions').doc(`${ws}_${name}`).set({
    workspaceId: ws, date: '2026-04-01', description: name, status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
    lines: [{ accountId: 'one', amountCents: fields.totalAmountCents }, { accountId: 'two', amountCents: -fields.totalAmountCents }], ...fields,
  });
  const clear = () => db.pool.query('delete from public.transactions where workspace_id = $1', [ws]);
  const scan = async () => {
    const r = await callApi(base, 'POST', '/api/v1/forensics/anomaly-scan', { token, body: { workspaceId: ws } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Scan;
  };
  before(async () => { app = await startOwnerApp('aup31-forensic', ws, { currency: 'USD' }); ({ db, base, token } = app); });
  after(async () => { if (db) { await clear(); await db.pool.query('delete from public."auditLogs" where workspace_id = $1', [ws]); } await app?.stop(); });

  it('says it could not judge when there are too few posted entries, never "clean"', async () => {
    await clear();
    for (let i = 0; i < 3; i++) await put(`few${i}`, { totalAmountCents: 100 });
    const r = await scan();
    assert.equal(r.skipped, 'too_few_entries');
    assert.deepEqual(r.anomalies, []);
    assert.equal(r.scanned, 3);
  });

  it('says so when every amount is the same', async () => {
    await clear();
    for (let i = 0; i < 6; i++) await put(`same${i}`, { totalAmountCents: 500 });
    const r = await scan();
    assert.equal(r.skipped, 'no_variation');
    assert.deepEqual(r.anomalies, []);
  });

  it('leaves out drafts, voids and forecasts: a huge draft is not an outlier and does not count as scanned', async () => {
    await clear();
    for (let i = 0; i < 6; i++) await put(`ok${i}`, { totalAmountCents: 100 });
    await put('draft', { status: 'draft', totalAmountCents: 9_000_000 });
    await put('void', { status: 'void', totalAmountCents: 9_000_000 });
    await put('forecast', { type: 'forecast', totalAmountCents: 9_000_000 });
    const r = await scan();
    assert.equal(r.scanned, 6, 'only the six posted entries');
    assert.equal(r.skipped, 'no_variation', 'what is left is flat, so nothing is flagged');
    assert.deepEqual(r.anomalies, []);
  });

  it('compares amounts in the book currency: a EUR entry is converted at its own rate, and the answer names the currency', async () => {
    await clear();
    for (let i = 0; i < 7; i++) await put(`usd${i}`, { totalAmountCents: 100 });
    // 10,000 EUR cents at 2 = 20,000 in the book currency: an outlier only after conversion
    await put('eur', { currency: 'EUR', exchangeRate: 2, totalAmountCents: 10_000 });
    const r = await scan();
    assert.equal(r.currency, 'USD');
    assert.deepEqual(r.anomalies.map(a => [a.id, a.amountCents]), [[`${ws}_eur`, 20_000]], 'reported in the book currency, not raw EUR minor units');
  });

  it('is deterministic and newest-first: when more than the sample limit exist, the newest are scanned and it says it is capped', async () => {
    await clear();
    const rows = [];
    // 210 posted entries: 205 old normal ones, then 5 newer ones with one big outlier in the newest slice
    for (let i = 0; i < 205; i++) rows.push(put(`old${String(i).padStart(3, '0')}`, { date: '2026-01-01', totalAmountCents: 100 }));
    for (let i = 0; i < 4; i++) rows.push(put(`new${i}`, { date: '2026-06-01', totalAmountCents: 100 }));
    rows.push(put('newbig', { date: '2026-06-02', totalAmountCents: 50_000 }));
    await Promise.all(rows);
    const first = await scan(), second = await scan();
    assert.deepEqual(first, second, 'the same books give the same answer every time');
    assert.equal(first.scanned, 200);
    assert.equal(first.sampleCapped, true);
    assert.ok(first.anomalies.some(a => a.id === `${ws}_newbig`), 'the newest entries are in the sample');
  });
});
