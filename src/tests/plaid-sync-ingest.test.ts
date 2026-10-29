/**
 * AF-001 (#151): /plaid/sync stores the downloaded rows as bank lines in the same database transaction
 * that moves the connection's cursor. A failure keeps neither, so the next sync brings the same rows
 * again instead of skipping past them; a row that arrives twice is still one line.
 * Runs when LF_TEST_DATABASE_URL is set.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Firestore } from '../server/db/pgFirestore';

const url = process.env.LF_TEST_DATABASE_URL;

describe('AF-001: Plaid sync stores its rows before the cursor moves', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_af001_${suffix}`;
  let server: Server;
  let base = '';
  let db: Firestore;
  let pages: Record<string, { added: unknown[]; next: string }> = {};
  const cursorsAsked: Array<string | undefined> = [];

  const sync = async () => {
    const res = await fetch(`${base}/api/v1/plaid/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' }, body: JSON.stringify({ workspaceId: ws }),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const lines = async () => (await db.collection('bankLines').where('workspaceId', '==', ws).get()).docs.map(d => d.data());
  const bank = async (id: string) => (await db.collection('banks').doc(id).get()).data() || {};

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { plaidRouter, setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({ data: { link_token: 'l' } })) as never,
      itemPublicTokenExchange: (async () => ({ data: { access_token: 'access-af001', item_id: 'item-af001' } })) as never,
      transactionsGet: (async () => ({ data: { transactions: [] } })) as never,
      transactionsSync: (async ({ cursor }: { cursor?: string }) => {
        cursorsAsked.push(cursor);
        const page = pages[cursor || 'start'] || { added: [], next: cursor || 'start' };
        return { data: { added: page.added, modified: [], removed: [], next_cursor: page.next, has_more: false } };
      }) as never,
    });
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'AF-001', members: ['owner-1'] });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/plaid', plaidRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['banks', 'bankLines', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    await db.terminate();
  });

  let bankId = '';

  test('the rows become pending bank lines and the cursor moves with them', async () => {
    const res = await fetch(`${base}/api/v1/plaid/exchange_public_token`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': 'owner-1' },
      body: JSON.stringify({ workspaceId: ws, public_token: 'p', institutionName: 'AF Bank' }),
    });
    bankId = String((await res.json() as Record<string, unknown>).bankId);
    await db.collection('banks').doc(bankId).update({ accountId: 'acc-checking' });
    pages = {
      start: { next: 'c1', added: [
        { transaction_id: 'tx-coffee', date: '2026-10-20', name: 'Coffee', amount: 4.5 },
        { transaction_id: 'tx-salary', date: '2026-10-21', name: 'Salary', amount: -2500 },
        { transaction_id: 'tx-hold', date: '2026-10-22', name: 'Card hold', amount: 10, pending: true },
      ] },
    };
    const r = await sync();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const stored = await lines();
    assert.deepEqual(stored.map(l => [l.description, l.amountCents, l.status, l.accountId, l.importIdentity]).sort(), [
      ['Coffee', -450, 'pending', 'acc-checking', 'plaid:tx-coffee'],
      ['Salary', 250000, 'pending', 'acc-checking', 'plaid:tx-salary'],
    ], 'posted rows only, money out negative; a pending card hold is not a bank line');
    assert.equal((await bank(bankId)).syncCursor, 'c1');
  });

  test('a row Plaid sends again is still one line', async () => {
    pages.c1 = { next: 'c2', added: [{ transaction_id: 'tx-coffee', date: '2026-10-20', name: 'Coffee', amount: 4.5 }, { transaction_id: 'tx-rent', date: '2026-10-23', name: 'Rent', amount: 1200 }] };
    assert.equal((await sync()).status, 200);
    const stored = await lines();
    assert.equal(stored.length, 3);
    assert.equal(stored.filter(l => l.importIdentity === 'plaid:tx-coffee').length, 1);
    assert.equal((await bank(bankId)).syncCursor, 'c2');
  });

  test('when the rows cannot be stored, neither they nor the cursor are kept, and the next sync brings them again', async () => {
    const { storePlaidSync, plaidRowsAsBankLines } = await import('../server/services/plaidIngest');
    pages.c2 = { next: 'c3', added: [{ transaction_id: 'tx-late', date: '2026-10-25', name: 'Late', amount: 3 }] };
    // the cursor update fails (no such bank document): the line written before it in the same
    // transaction must not survive, or the connection would read past rows it never stored
    await assert.rejects(storePlaidSync(db, {
      workspaceId: ws, uid: 'owner-1', bankRef: { id: `missing_${suffix}` },
      lines: plaidRowsAsBankLines(pages.c2.added, { id: bankId }, ws), bankUpdate: { syncCursor: 'c3' },
    }));
    assert.equal((await lines()).some(l => l.importIdentity === 'plaid:tx-late'), false, 'no line without its cursor');
    assert.equal((await bank(bankId)).syncCursor, 'c2', 'the saved cursor did not move');
    // the next sync starts from the saved cursor and stores the row
    assert.equal((await sync()).status, 200);
    assert.equal(cursorsAsked.at(-1), 'c2');
    assert.equal((await lines()).filter(l => l.importIdentity === 'plaid:tx-late').length, 1);
    assert.equal((await bank(bankId)).syncCursor, 'c3');
  });

  test('a second account of the same bank login, or another currency, is stored without a ledger account (CodeRabbit on #439)', async () => {
    const { plaidRowsAsBankLines, plaidAccountFor } = await import('../server/services/plaidIngest');
    const connection = { id: 'b1', accountId: 'acc-checking', workspaceCurrency: 'USD' };
    const rows = [
      { transaction_id: 'a', account_id: 'plaid-chk', date: '2026-10-01', name: 'A', amount: 1 },
      { transaction_id: 'b', account_id: 'plaid-sav', date: '2026-10-01', name: 'B', amount: 2 },
    ];
    // two Plaid accounts and none saved: neither is assumed to be the ledger account
    assert.equal(plaidAccountFor(connection, rows), undefined);
    assert.deepEqual(plaidRowsAsBankLines(rows, connection, ws).map(l => l.accountId), [undefined, undefined]);
    // once the connection is tied to its Plaid account, only that account's rows get the ledger account
    const tied = { ...connection, plaidAccountId: 'plaid-chk' };
    assert.deepEqual(plaidRowsAsBankLines(rows, tied, ws).map(l => [l.plaidAccountId, l.accountId]), [['plaid-chk', 'acc-checking'], ['plaid-sav', undefined]]);
    // a row in another currency keeps its own currency and decimals and is left for review
    const [eur, kwd] = plaidRowsAsBankLines([
      { transaction_id: 'e', account_id: 'plaid-chk', date: '2026-10-01', name: 'E', amount: 10.5, iso_currency_code: 'EUR' },
      { transaction_id: 'k', account_id: 'plaid-chk', date: '2026-10-01', name: 'K', amount: 1.234, iso_currency_code: 'KWD' },
    ], tied, ws);
    assert.deepEqual([eur.currency, eur.amountCents, eur.accountId], ['EUR', -1050, undefined]);
    assert.deepEqual([kwd.currency, kwd.amountCents], ['KWD', -1234], 'three-decimal currency in its own minor units');
  });

  test('a bank correction updates a pending line, a deletion removes it, a matched line is only flagged (CodeRabbit on #439)', async () => {
    pages.c3 = { next: 'c4', added: [
      { transaction_id: 'tx-fix', date: '2026-10-26', name: 'Typo shop', amount: 9 },
      { transaction_id: 'tx-drop', date: '2026-10-26', name: 'Dropped', amount: 5 },
      { transaction_id: 'tx-booked', date: '2026-10-26', name: 'Booked', amount: 20 },
    ] };
    assert.equal((await sync()).status, 200);
    const byIdentity = async (id: string) => (await db.collection('bankLines').where('workspaceId', '==', ws).where('importIdentity', '==', `plaid:${id}`).get()).docs[0];
    const booked = await byIdentity('tx-booked');
    await booked.ref.update({ status: 'matched', matchedTransactionId: 'tx-posted-1' });
    // the next page corrects one row and removes the other two
    const { setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({ data: { link_token: 'l' } })) as never,
      itemPublicTokenExchange: (async () => ({ data: { access_token: 'access-af001', item_id: 'item-af001' } })) as never,
      transactionsGet: (async () => ({ data: { transactions: [] } })) as never,
      transactionsSync: (async () => ({ data: {
        added: [], has_more: false, next_cursor: 'c5',
        modified: [{ transaction_id: 'tx-fix', date: '2026-10-26', name: 'Right shop', amount: 9.5 }],
        removed: [{ transaction_id: 'tx-drop' }, { transaction_id: 'tx-booked' }],
      } })) as never,
    });
    assert.equal((await sync()).status, 200);
    const fixed = (await byIdentity('tx-fix'))?.data();
    assert.deepEqual([fixed?.description, fixed?.amountCents, fixed?.status], ['Right shop', -950, 'pending']);
    assert.equal(await byIdentity('tx-drop'), undefined, 'a pending line the bank deleted is gone');
    const kept = (await byIdentity('tx-booked'))?.data();
    assert.deepEqual([kept?.status, kept?.matchedTransactionId, kept?.bankChange], ['matched', 'tx-posted-1', 'removed'], 'a posted line is kept and flagged');
    assert.equal((await bank(bankId)).syncCursor, 'c5');
  });

  test('a long first history is stored in bounded chunks; the cursor still moves only with the last one (Codex on #439)', async () => {
    const { storePlaidSync, plaidRowsAsBankLines, PLAID_STORE_CHUNK } = await import('../server/services/plaidIngest');
    const rows = Array.from({ length: PLAID_STORE_CHUNK + 20 }, (_, i) => ({ transaction_id: `bulk-${i}`, date: '2026-09-01', name: `Row ${i}`, amount: 1 }));
    const lines = plaidRowsAsBankLines(rows, { id: bankId }, ws);
    const count = async () => (await db.pool.query(`select count(*)::int as n from public."bankLines" where workspace_id = $1 and data->>'importIdentity' like 'plaid:bulk-%'`, [ws])).rows[0].n;
    // the cursor update fails (no such bank): the first full chunk is kept, the cursor is not saved
    await assert.rejects(storePlaidSync(db, { workspaceId: ws, uid: 'owner-1', bankRef: { id: `missing_${suffix}` }, lines, bankUpdate: { syncCursor: 'bulk' } }));
    assert.equal(await count(), PLAID_STORE_CHUNK, 'earlier chunks stay stored');
    const before = (await bank(bankId)).syncCursor;
    // the retry skips what is stored, adds the rest and saves the cursor
    const done = await storePlaidSync(db, { workspaceId: ws, uid: 'owner-1', bankRef: { id: bankId }, lines, bankUpdate: { syncCursor: 'bulk' } });
    assert.equal(done.stored, 20);
    assert.equal(await count(), PLAID_STORE_CHUNK + 20);
    assert.notEqual(before, 'bulk');
    assert.equal((await bank(bankId)).syncCursor, 'bulk');
  });

  test('the sync reports the bank lines it actually added, and a correction drops the old rule suggestion (Codex on #439)', async () => {
    const { setPlaidClientForTests } = await import('../server/routes/plaidRoutes');
    let page = { added: [{ transaction_id: 'tx-count', date: '2026-10-27', name: 'Counted', amount: 2 }, { transaction_id: 'tx-hold-2', date: '2026-10-27', name: 'Hold', amount: 2, pending: true }], modified: [] as unknown[] };
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({ data: { link_token: 'l' } })) as never,
      itemPublicTokenExchange: (async () => ({ data: { access_token: 'access-af001', item_id: 'item-af001' } })) as never,
      transactionsGet: (async () => ({ data: { transactions: [] } })) as never,
      transactionsSync: (async () => ({ data: { ...page, removed: [], has_more: false, next_cursor: 'c-count' } })) as never,
    });
    const first = await sync();
    assert.equal(first.body.storedLines, 1, 'a card hold is a Plaid row but not a bank line');
    const line = (await db.collection('bankLines').where('workspaceId', '==', ws).where('importIdentity', '==', 'plaid:tx-count').get()).docs[0];
    await line.ref.update({ suggestion: { accountId: 'acc-old' } });
    page = { added: [], modified: [{ transaction_id: 'tx-count', date: '2026-10-27', name: 'Counted, renamed', amount: 3 }] };
    assert.equal((await sync()).body.storedLines, 0);
    const after = (await line.ref.get()).data();
    assert.deepEqual([after?.description, after?.amountCents, after?.suggestion], ['Counted, renamed', -300, null]);
  });

  test('a bank line in another currency is not paid or split as home-currency money (Codex on #439)', async () => {
    const { splitBankLine } = await import('../server/services/bankLineService');
    await db.collection('workspaces').doc(ws).update({ currency: 'USD' });
    await db.collection('bankLines').doc(`eur_${suffix}`).set({ workspaceId: ws, status: 'pending', amountCents: -1050, currency: 'EUR', date: '2026-10-20', description: 'Paris' });
    await assert.rejects(
      splitBankLine(db, { workspaceId: ws, uid: 'owner-1', bankLineId: `eur_${suffix}`, splits: [{ accountId: 'acc-x', amountCents: 1050 }] } as never),
      /in EUR, not USD/,
    );
    assert.equal((await db.collection('bankLines').doc(`eur_${suffix}`).get()).data()?.status, 'pending');
  });

  test('an older sync that commits last cannot put its cursor back (CodeRabbit on #439)', async () => {
    const { storePlaidSync } = await import('../server/services/plaidIngest');
    const saved = (await bank(bankId)).syncCursor as string | undefined;
    // this request started before another sync moved the bank on: it expected a cursor that is no longer saved
    await assert.rejects(storePlaidSync(db, { workspaceId: ws, uid: 'owner-1', bankRef: { id: bankId }, lines: [], expectedCursor: 'stale-cursor', bankUpdate: { syncCursor: 'older' } }), /synced by another request/);
    assert.equal((await bank(bankId)).syncCursor, saved, 'the newer cursor stays');
    const ok = await storePlaidSync(db, { workspaceId: ws, uid: 'owner-1', bankRef: { id: bankId }, lines: [], expectedCursor: saved, bankUpdate: { syncCursor: saved } });
    assert.equal(ok.stored, 0);
  });

  test('a correction for a row never stored becomes a new line instead of being lost (CodeRabbit on #439)', async () => {
    const { storePlaidSync, plaidRowsAsBankLines } = await import('../server/services/plaidIngest');
    const modified = plaidRowsAsBankLines([{ transaction_id: 'tx-orphan', date: '2026-10-28', name: 'Only the correction', amount: 4 }], { id: bankId }, ws);
    const r = await storePlaidSync(db, { workspaceId: ws, uid: 'owner-1', bankRef: { id: bankId }, lines: [], modified, bankUpdate: { syncCursor: 'c-orphan' } });
    assert.equal(r.stored, 1);
    const line = (await db.collection('bankLines').where('workspaceId', '==', ws).where('importIdentity', '==', 'plaid:tx-orphan').get()).docs[0]?.data();
    assert.deepEqual([line?.description, line?.amountCents, line?.status], ['Only the correction', -400, 'pending']);
  });
});
