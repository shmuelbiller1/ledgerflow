/**
 * EG-9: the bank rules run on the server, from one pure function shared with the browser
 * (src/lib/bankRules.ts). Imported lines get the rules' suggestion (account, contact, labels) and stay
 * pending; re-importing or re-running never applies or counts a rule twice; the re-run route is for
 * owners and accountants.
 *
 * Hand-worked figures. Rules (priority, lower first; ties by id):
 *   R3 p5  minAmountCents 100000 (≥ 1,000.00)      → tag "large"
 *   R1 p10 contains "office depot"                  → account 6000 Office, contact V1, tag "supplies", dept=ops
 *   R2 p20 contains "depot"                         → account 7000 Retail (ignored: R1 gave one), tag "retail", dept=sales, region=north
 *   R4 p1  contains "office", paused                → never
 *   R5 p1  contains "depot", its group paused       → never
 * Lines:
 *   A "OFFICE DEPOT #12"  −250.00  : R3 no (250.00 < 1,000.00); R1, R2 → 6000, V1, [supplies, retail], {dept: ops, region: north}, rules [R1, R2]
 *   B "PAYROLL TRANSFER" −1,500.00 : R3 only → no account, [large], rules [R3]
 *   C "COFFEE"              −4.50  : nothing → no suggestion
 * Hits after the import: R1 1, R2 1, R3 1. Re-run with nothing changed: 0 lines changed, hits unchanged.
 * Add R6 p1 contains "coffee" → 6000: re-run changes 1 line (C), R6 1, the others unchanged; again: 0.
 * Ledger entries written for the workspace throughout: 0.
 * Same file twice (fingerprint "rent" on two lines in the file): 1st import keeps 1 line, skips 1; 2nd skips 2;
 * the categorised line again skips the line and its entry → still 1 line, 0 entries. Re-run with limit 1 over the
 * 4 pending lines (A, B, C, D1, by id): 3 calls truncated with nextCursor = the 1st, 2nd, 3rd id, the 4th not.
 * Legacy targetCategory "Office Supplies" → the active account named exactly that (archived one and "…& Co" not).
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { suggestFromRules, sameSuggestion, reconcileCreateDefaults } from '../lib/bankRules';
import type { AutoRule, ChartAccount } from '../types';
import { commitAsServer } from './helpers/serverCommit';
import pg from 'pg';

const rule = (id: string, priority: number, condition: AutoRule['condition'], action: AutoRule['action'], extra: Partial<AutoRule> = {}): AutoRule =>
  ({ id, uid: 'someone-else', priority, condition, action, confidence: 1, isHardened: true, isActive: true, createdAt: '2026-10-01', ...extra });

const accounts = [
  { id: 'a6000', name: 'Office', code: '6000', type: 'expense' },
  { id: 'a7000', name: 'Retail', code: '7000', type: 'expense' },
  { id: 'aOld', name: 'Old', code: '6999', type: 'expense', archived: true },
] as unknown as ChartAccount[];

const RULES = [
  rule('R3', 5, { minAmountCents: 100000 }, { addTags: ['large'] }),
  rule('R1', 10, { descriptionContains: 'office depot' }, { targetAccountId: 'a6000', contactId: 'V1', addTags: ['supplies'], targetDimensions: { dept: 'ops' } }),
  rule('R2', 20, { descriptionContains: 'depot' }, { targetNodeId: 'a7000', targetTags: ['retail'], targetDimensions: { dept: 'sales', region: 'north' } }),
  rule('R4', 1, { descriptionContains: 'office' }, { targetAccountId: 'a7000' }, { isActive: false }),
  rule('R5', 1, { descriptionContains: 'depot' }, { targetAccountId: 'a7000' }, { groupName: 'Paused', groupIsActive: false }),
];
const LINE_A = { description: 'OFFICE DEPOT #12', amountCents: -25000, date: '2026-10-20' };
const LINE_B = { description: 'PAYROLL TRANSFER', amountCents: -150000, date: '2026-10-21' };
const LINE_C = { description: 'COFFEE', amountCents: -450, date: '2026-10-22' };
const EXPECT_A = { accountId: 'a6000', accountName: 'Office', contactId: 'V1', contactKind: 'vendor', tags: ['supplies', 'retail'], dimensions: { dept: 'ops', region: 'north' }, ruleIds: ['R1', 'R2'] };
const EXPECT_B = { tags: ['large'], dimensions: {}, ruleIds: ['R3'] };

describe('EG-9 the bank rule function (shared by server and browser)', () => {
  const context = { accounts, contacts: [{ id: 'V1', kind: 'vendor' as const }] };
  test('line A: R1 gives account and contact, R2 adds labels, paused rules never match', () => {
    assert.deepEqual(suggestFromRules(RULES, LINE_A, context), EXPECT_A);
  });
  test('line B: only the amount rule (1,500.00 ≥ 1,000.00); line C: nothing', () => {
    assert.deepEqual(suggestFromRules(RULES, LINE_B, context), EXPECT_B);
    assert.equal(suggestFromRules(RULES, LINE_C, context), null);
  });
  test('the order of the rules as read does not matter; the function is pure', () => {
    assert.deepEqual(suggestFromRules([...RULES].reverse(), LINE_A, context), EXPECT_A);
    assert.ok(sameSuggestion(suggestFromRules(RULES, LINE_A, context), suggestFromRules(RULES, LINE_A, context)));
  });
  test('stopProcessingOnMatch ends the run; an archived account or unknown contact is not suggested', () => {
    const stop = [rule('S', 1, { descriptionContains: 'depot' }, { targetAccountId: 'aOld', contactId: 'nobody', addTags: ['s'] }, { stopProcessingOnMatch: true }), ...RULES];
    assert.deepEqual(suggestFromRules(stop, LINE_A, context), { tags: ['s'], dimensions: {}, ruleIds: ['S'] });
  });
  // review 4368675689: older rules name the account in targetCategory
  test('targetCategory "Office Supplies" suggests that account (exact name, active chart only)', () => {
    const chart = [...accounts,
      { id: 'aSupOld', name: 'Office Supplies', type: 'expense', archived: true },
      { id: 'aSup', name: 'Office Supplies', type: 'expense' },
      { id: 'aSupX', name: 'Office Supplies & Co', type: 'expense' }] as unknown as ChartAccount[];
    const legacy = [rule('L', 1, { descriptionContains: 'staples' }, { targetCategory: 'Office Supplies' })];
    const line = { description: 'STAPLES 0042', amountCents: -1999, date: '2026-10-20' };
    assert.deepEqual(suggestFromRules(legacy, line, { accounts: chart }), { accountId: 'aSup', accountName: 'Office Supplies', tags: [], dimensions: {}, ruleIds: ['L'] });
    assert.equal(suggestFromRules([rule('L', 1, { descriptionContains: 'staples' }, { targetCategory: 'office supplies' })], line, { accounts: chart })?.accountId, undefined, 'exact name only');
    assert.equal(suggestFromRules(legacy, line)?.accountId, undefined, 'a name needs the chart');
  });
  test('the reconciliation pre-fill: the suggestion, or the first expense account', () => {
    assert.deepEqual(reconcileCreateDefaults({ suggestion: { accountId: 'a7000', contactId: 'V1', contactKind: 'vendor', tags: ['t'], dimensions: { d: 'x' }, ruleIds: ['R'] } }, accounts),
      { accountId: 'a7000', contactId: 'V1', contactKind: 'vendor', tags: ['t'], dimensions: { d: 'x' } });
    assert.equal(reconcileCreateDefaults({ suggestion: { accountId: 'aOld', tags: [], dimensions: {}, ruleIds: ['R'] } }, accounts).accountId, 'a6000', 'archived → first expense');
    assert.equal(reconcileCreateDefaults({}, accounts).accountId, 'a6000');
  });
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('EG-9 bank rules on the server', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const ws = `ws_eg9_${suffix}`;
  const OWNER = 'eg9-owner', ACC = 'eg9-acc', BK = 'eg9-bk', VIEW = 'eg9-view';
  const id = (s: string) => `${ws}_${s}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;

  const send = async (uid: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/transactions/bank-lines/apply-rules`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const line = async (key: string) => (await db.collection('bankLines').doc(id(key)).get()).data()!;
  const hits = async () => Object.fromEntries((await db.collection('autoRules').where('workspaceId', '==', ws).get()).docs.map(d => [d.id.slice(ws.length + 1), d.data().hitCount ?? 0]));
  const entries = async () => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.length;

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'EG-9', currency: 'USD', members: [OWNER, ACC, BK, VIEW], roles: { [ACC]: 'accountant', [BK]: 'bookkeeper', [VIEW]: 'viewer' } });
    for (const a of accounts) await db.collection('chartAccounts').doc(id(a.id)).set({ ...a, id: id(a.id), workspaceId: ws });
    await db.collection('vendors').doc(id('V1')).set({ workspaceId: ws, name: 'Office Depot' });
    const scoped = (r: AutoRule): AutoRule => ({
      ...r, id: id(r.id), workspaceId: ws,
      action: { ...r.action, ...(r.action.targetAccountId ? { targetAccountId: id(r.action.targetAccountId) } : {}), ...(r.action.targetNodeId ? { targetNodeId: id(r.action.targetNodeId) } : {}), ...(r.action.contactId ? { contactId: id(r.action.contactId) } : {}) },
    });
    for (const r of RULES) await db.collection('autoRules').doc(id(r.id)).set(scoped(r) as never);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string } }).user = { uid: String(req.header('x-test-uid')) }; next(); });
    app.use('/api/v1/transactions', transactionRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bankLines', 'autoRules', 'chartAccounts', 'vendors', 'idempotencyKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('an import stores the suggestions, keeps the lines pending and posts nothing', async () => {
    const res = await commitAsServer(db as never, OWNER, { workspaceId: ws, transactions: [], bankLines: [
      { id: id('A'), ...LINE_A, status: 'pending', matchedTransactionId: null },
      { id: id('B'), ...LINE_B, status: 'pending', matchedTransactionId: null },
      { id: id('C'), ...LINE_C, status: 'pending', matchedTransactionId: null },
    ] } as never);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const a = await line('A');
    assert.equal(a.status, 'pending');
    assert.equal(a.matchedTransactionId, null);
    assert.deepEqual(a.suggestion, { ...EXPECT_A, accountId: id('a6000'), contactId: id('V1'), ruleIds: [id('R1'), id('R2')] });
    assert.deepEqual((await line('B')).suggestion, { ...EXPECT_B, ruleIds: [id('R3')] });
    assert.equal((await line('C')).suggestion, null);
    assert.deepEqual(await hits(), { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0 });
    assert.equal(await entries(), 0);
  });

  test('re-importing the same line is refused and counts no hit', async () => {
    const res = await commitAsServer(db as never, OWNER, { workspaceId: ws, transactions: [], bankLines: [{ id: id('A'), ...LINE_A, status: 'pending' }] } as never);
    assert.equal(res.status, 409);
    assert.deepEqual(await hits(), { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0 });
  });

  test('the re-run route: owners and accountants only', async () => {
    assert.equal((await send(BK, { workspaceId: ws })).status, 403);
    assert.equal((await send(VIEW, { workspaceId: ws })).status, 403);
    assert.equal((await send('stranger', { workspaceId: ws })).status, 403);
    const owner = await send(OWNER, { workspaceId: ws });
    assert.equal(owner.status, 200, JSON.stringify(owner.body));
    assert.deepEqual(owner.body, { checked: 3, changed: 0, suggested: 2, truncated: false });
    assert.deepEqual(await hits(), { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0 });
  });

  test('a new rule: the re-run suggests for line C once, and never twice', async () => {
    await db.collection('autoRules').doc(id('R6')).set({ ...rule(id('R6'), 1, { descriptionContains: 'coffee' }, { targetAccountId: id('a6000') }), workspaceId: ws } as never);
    const first = await send(ACC, { workspaceId: ws });
    assert.deepEqual(first.body, { checked: 3, changed: 1, suggested: 3, truncated: false });
    const c = await line('C');
    assert.equal(c.status, 'pending');
    assert.deepEqual(c.suggestion, { accountId: id('a6000'), accountName: 'Office', tags: [], dimensions: {}, ruleIds: [id('R6')] });
    assert.deepEqual(await hits(), { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0, R6: 1 });
    const again = await send(OWNER, { workspaceId: ws });
    assert.deepEqual(again.body, { checked: 3, changed: 0, suggested: 3, truncated: false });
    assert.deepEqual(await hits(), { R1: 1, R2: 1, R3: 1, R4: 0, R5: 0, R6: 1 });
    assert.deepEqual((await line('A')).ruleIdsApplied, [id('R1'), id('R2')]);
    assert.equal(await entries(), 0);
  });

  // #796: the runner's transaction retries once (40001) after the work is done: the retried attempt still
  // reports the change and writes the audit line, and the rule still counts one hit
  test('a serializable retry keeps the change count and the audit line', async () => {
    const audits = async () => (await db.pool.query<{ c: number }>(`select count(*)::int as c from public."auditLogs" where workspace_id = $1 and data->>'action' = 'BANK_RULES_RERUN'`, [ws])).rows[0].c;
    const before = await audits();
    await db.collection('autoRules').doc(id('R7')).set({ ...rule(id('R7'), 0, { descriptionContains: 'coffee' }, { targetAccountId: id('a7000') }), workspaceId: ws } as never);
    const original = db.runTransaction.bind(db);
    let injected = false;
    db.runTransaction = (async (work: (t: never) => Promise<unknown>) => {
      db.runTransaction = original; // only the next (outer) call is wrapped; calls made inside it pass through
      return original(async (t: never) => {
        const result = await work(t);
        if (!injected) {
          injected = true;
          throw Object.assign(new pg.DatabaseError('test-only retry', 0, 'error'), { code: '40001' });
        }
        return result;
      });
    }) as typeof db.runTransaction;
    try {
      const res = await send(ACC, { workspaceId: ws });
      assert.equal(injected, true, 'the retry was injected');
      assert.deepEqual(res.body, { checked: 3, changed: 1, suggested: 3, truncated: false });
    } finally {
      db.runTransaction = original;
    }
    assert.equal((await line('C')).suggestion?.ruleIds?.[0], id('R7'));
    assert.equal((await hits()).R7, 1);
    assert.equal(await audits(), before + 1);
    await db.collection('autoRules').doc(id('R7')).delete();
  });

  // review 4368675668: the statement's fingerprint is kept, one line per fingerprint
  test('importing the same file twice gives one line (and its entry once)', async () => {
    const file = (n: string) => ({ workspaceId: ws, transactions: [], bankLines: [
      { id: id(`D${n}`), description: 'RENT OCT', amountCents: -90000, date: '2026-10-01', status: 'pending', importIdentity: `statement_csv:line:${ws}:rent` },
      { id: id(`E${n}`), description: 'RENT OCT', amountCents: -90000, date: '2026-10-01', status: 'pending', importIdentity: `statement_csv:line:${ws}:rent` },
    ] });
    const first = await commitAsServer(db as never, OWNER, file('1') as never);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.skippedDuplicates, 1, 'the same fingerprint twice in one file');
    const second = await commitAsServer(db as never, OWNER, file('2') as never);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.skippedDuplicates, 2);
    const rows = (await db.collection('bankLines').where('workspaceId', '==', ws).where('importIdentity', '==', `statement_csv:line:${ws}:rent`).get()).docs;
    assert.deepEqual(rows.map(d => d.id), [id('D1')]);
    // a categorised line again: the line and the entry made with it are both skipped
    const txId = id('tx-rent');
    const withEntry = await commitAsServer(db as never, OWNER, { workspaceId: ws, transactions: [{ id: txId, date: '2026-10-01', description: 'RENT OCT', totalAmountCents: 90000, type: 'actual', status: 'pending',
      lines: [{ accountId: id('a6000'), amountCents: 90000 }, { accountId: id('a7000'), amountCents: -90000 }] }],
    bankLines: [{ id: id('D3'), description: 'RENT OCT', amountCents: -90000, date: '2026-10-01', status: 'matched', matchedTransactionId: txId, importIdentity: `statement_csv:line:${ws}:rent` }] } as never);
    assert.equal(withEntry.status, 200, JSON.stringify(withEntry.body));
    assert.equal(withEntry.body.skippedDuplicates, 1);
    assert.equal(await entries(), 0);
  });

  // review 4368675681: a re-run goes past one call's limit with a cursor
  test('the re-run continues with nextCursor (limit 1)', async () => {
    const pending = (await db.collection('bankLines').where('workspaceId', '==', ws).where('status', '==', 'pending').get()).docs
      .filter(d => !d.data().matchedTransactionId).map(d => d.id).sort();
    assert.equal(pending.length, 4, 'A, B, C and D1');
    const seen: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < 5; i++) {
      const res = await send(OWNER, { workspaceId: ws, limit: 1, ...(after ? { after } : {}) });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.checked, 1);
      if (!res.body.truncated) { assert.equal(res.body.nextCursor, undefined); seen.push('last'); break; }
      seen.push(res.body.nextCursor);
      after = res.body.nextCursor;
    }
    assert.deepEqual(seen, [pending[0], pending[1], pending[2], 'last']);
  });

  test('a line matched to an entry is left alone by the re-run', async () => {
    await db.collection('bankLines').doc(id('A')).update({ status: 'matched', matchedTransactionId: 'tx-elsewhere' });
    const res = await send(OWNER, { workspaceId: ws });
    assert.deepEqual(res.body, { checked: 3, changed: 0, suggested: 2, truncated: false });
  });
});
