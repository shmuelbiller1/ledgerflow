/**
 * AUP-30: the legacy bank CSV upload never drops a row it cannot read and never replaces an unreadable date
 * with today's. A file with any such row is refused (422) and the answer names each row.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwnerApp } from './helpers/liveApiServer';

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-30: bank CSV upload fails closed', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const ws = `ws_aup30_${randomUUID()}`;
  let app!: Awaited<ReturnType<typeof startOwnerApp>>;
  let base = '', token = '';
  // a workspace west of UTC: dates must keep the day written in the file
  before(async () => { app = await startOwnerApp('aup30-bank-csv', ws, { timezone: 'America/New_York' }); ({ base, token } = app); });
  after(async () => { await app?.stop(); });
  async function upload(csv: string) {
    const form = new FormData();
    form.append('workspaceId', ws);
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
    const res = await fetch(`${base}/api/upload-bank-csv`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-LedgerFlow-Request': '1' }, body: form });
    return { status: res.status, body: await res.json() as unknown };
  }

  it('reads a clean file in full', async () => {
    const result = await upload('Date,Description,Amount\n2026-03-01,Valid,10.00\n03/02/2026,US date,-2.50\n');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual((result.body as Array<{ date: string; amountCents: number }>).map(r => [r.date, r.amountCents]), [['2026-03-01', 1000], ['2026-03-02', -250]]);
  });

  it('keeps the day written in the file, even for a workspace west of UTC', async () => {
    const result = await upload('Date,Description,Amount\n2026/03/01,Slash date,1.00\nMar 1 2026,Written month,1.00\n2026-03-01T00:00:00Z,Timestamp,1.00\n');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual((result.body as Array<{ date: string }>).map(r => r.date), ['2026-03-01', '2026-03-01', '2026-03-01']);
  });

  it('refuses a file with an unreadable amount or date and names every row', async () => {
    const result = await upload('Date,Description,Amount\n2026-03-01,Valid,10.00\n2026-03-02,Bad amount,abc\nnot a date,Bad date,5.00\n2026-02-30,Impossible day,1.00\n,Empty date,1.00\n');
    assert.equal(result.status, 422, JSON.stringify(result.body));
    const body = result.body as { message: string; rejected: Array<{ row: number; reason: string }> };
    assert.deepEqual(body.rejected.map(r => r.row), [2, 3, 4, 5]);
    assert.match(body.message, /4 rows could not be read, so nothing was imported/);
  });

  it('a filled-in debit or credit cell that is not a number is an error, not zero', async () => {
    const result = await upload('Date,Description,Debit,Credit\n2026-03-01,Card,12.00,\n2026-03-02,Typo,,1O.00\n');
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.deepEqual((result.body as { rejected: Array<{ row: number }> }).rejected.map(r => r.row), [2]);
  });
});
