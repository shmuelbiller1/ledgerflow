import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Firestore } from '../server/db/firestore';
import {
  OFFER_MIN_CASES, addObservation, decisionsIn, forgetRemembered, forgetRememberedCommand, listRemembered, observe, recordOutcome,
  suggestFor, suggestionFrom, type RememberedRow,
} from '../server/services/rememberedDecisions';

const fold = (obs: ReturnType<typeof observe>, rows: RememberedRow[] = []) => {
  const map = new Map(rows.map(r => [`${r.command}|${r.subject}|${r.field}`, r]));
  for (const o of obs) { const k = `${o.command}|${o.subject}|${o.field}`; map.set(k, addObservation(map.get(k), o)); }
  return [...map.values()];
};
const bill = (accountId: string, payee = 'Ocean Supplies') => ({ payee, accountId, amountCents: 1234, memo: 'secret memo' });

describe('SBX-2 Part 3 remembered decisions (pure)', () => {
  test('reads subject and choices from the step, top level and per line, keeping no amounts or memo', () => {
    assert.deepEqual(decisionsIn(bill('acc-1')), [{ subject: 'payee:ocean supplies', field: 'accountId', value: 'acc-1' }]);
    const lines = decisionsIn({ vendorId: 'v1', lines: [{ accountId: 'a', taxCode: 'VAT20' }, { payee: 'Other', accountId: 'b' }] });
    assert.deepEqual(lines, [
      { subject: 'vendorId:v1', field: 'accountId', value: 'a' },
      { subject: 'vendorId:v1', field: 'taxCode', value: 'VAT20' },
      { subject: 'payee:other', field: 'accountId', value: 'b' },
    ]);
    assert.deepEqual(decisionsIn({ accountId: 'a' }), [], 'no subject, nothing remembered');
    assert.deepEqual(decisionsIn(null), []);
  });

  test('offers a choice only at 95% over at least five cases, with the case count and label', () => {
    let rows: RememberedRow[] = [];
    for (let i = 0; i < OFFER_MIN_CASES - 1; i++) rows = fold(observe('bill.create', bill('acc-1'), 'accepted'), rows);
    assert.equal(suggestionFrom(rows[0]), undefined, 'four cases are not enough');
    rows = fold(observe('bill.create', bill('acc-1', '  OCEAN  supplies '), 'accepted'), rows);
    const offered = suggestionFrom(rows[0]);
    assert.deepEqual(offered, { command: 'bill.create', subject: 'payee:ocean supplies', field: 'accountId', value: 'acc-1', cases: 5, rate: 1, label: 'from your earlier choice' });
    rows = fold(observe('bill.create', bill('acc-2'), 'accepted'), rows);
    assert.equal(suggestionFrom(rows[0]), undefined, '5 of 6 is below 95%');
  });

  test('a rejection lowers the rate', () => {
    let rows: RememberedRow[] = [];
    for (let i = 0; i < 19; i++) rows = fold(observe('bill.create', bill('acc-1'), 'accepted'), rows);
    assert.equal(suggestionFrom(rows[0])?.cases, 19);
    rows = fold(observe('bill.create', bill('acc-1'), 'rejected'), rows);
    assert.equal(suggestionFrom(rows[0])?.rate, 0.95);
    rows = fold(observe('bill.create', bill('acc-1'), 'rejected'), rows);
    assert.equal(suggestionFrom(rows[0]), undefined);
  });

  test('suggestions never change the draft: only empty fields of the same command and subject are proposed', () => {
    let rows: RememberedRow[] = [];
    for (let i = 0; i < 5; i++) rows = fold(observe('bill.create', bill('acc-1'), 'accepted'), rows);
    const draft = { payee: 'Ocean Supplies', amountCents: 5 };
    const before = structuredClone(draft);
    assert.deepEqual(suggestFor('bill.create', draft, rows).map(s => s.value), ['acc-1']);
    assert.deepEqual(draft, before);
    assert.deepEqual(suggestFor('bill.create', { ...draft, accountId: 'mine' }, rows), [], 'a filled field is left alone');
    assert.deepEqual(suggestFor('expense.create', draft, rows), []);
    assert.deepEqual(suggestFor('bill.create', { payee: 'Someone else' }, rows), []);
  });

  test('real command envelopes ({ bill: {...} }) are read, and a root field the draft fills is left alone', () => {
    const step = { bill: { vendorId: 'v9', cashAccountId: 'bank1', lines: [{ accountId: 'a' }] }, postingDay: '2026-11-01' };
    assert.deepEqual(decisionsIn(step).map(d => [d.subject, d.field, d.value]), [['vendorId:v9', 'cashAccountId', 'bank1'], ['vendorId:v9', 'accountId', 'a']]);
    let rows: RememberedRow[] = [];
    for (let i = 0; i < 5; i++) rows = fold(observe('bill.create', step, 'accepted'), rows);
    assert.deepEqual(suggestFor('bill.create', { bill: { vendorId: 'v9', lines: [{}] } }, rows).map(s => s.field).sort(), ['accountId', 'cashAccountId']);
    assert.deepEqual(suggestFor('bill.create', { bill: { vendorId: 'v9', cashAccountId: 'mine', lines: [{ accountId: 'x' }] } }, rows), []);
    assert.deepEqual(suggestFor('bill.create', { bill: { vendorId: 'v9', lines: [{ payee: 'Other' }] } }, rows).map(s => s.field), ['cashAccountId'], 'a line field is not offered at the document level');
  });

  test('bill splits and invoice items are lines too', () => {
    assert.deepEqual(decisionsIn({ bill: { vendorId: 'v1', splits: [{ accountId: 'a' }] } }).map(d => [d.subject, d.field, d.value]), [['vendorId:v1', 'accountId', 'a']]);
    assert.deepEqual(decisionsIn({ invoice: { customerId: 'c1', items: [{ incomeAccountId: 'sales' }] } }).map(d => [d.subject, d.field, d.value]), [['customerId:c1', 'incomeAccountId', 'sales']]);
    let rows: RememberedRow[] = [];
    for (let i = 0; i < 5; i++) rows = fold(observe('bill.create', { bill: { vendorId: 'v1', splits: [{ accountId: 'a' }] } }, 'accepted'), rows);
    assert.deepEqual(suggestFor('bill.create', { bill: { vendorId: 'v1', splits: [{ accountId: 'mine' }] } }, rows), [], 'a filled split is left alone');
    assert.deepEqual(suggestFor('bill.create', { bill: { vendorId: 'v1', splits: [{}] } }, rows).map(s => s.value), ['a']);
  });

  test('lines: a filled line is left alone, an empty line gets its own subject choice, and two line values are two choices', () => {
    let rows: RememberedRow[] = [];
    for (let i = 0; i < 5; i++) rows = fold(observe('bill.create', { vendorId: 'v1', lines: [{ accountId: 'a' }, { payee: 'Other', accountId: 'b' }] }, 'accepted'), rows);
    assert.deepEqual(suggestFor('bill.create', { vendorId: 'v1', lines: [{ accountId: 'mine' }] }, rows), [], 'every line already names an account');
    assert.deepEqual(suggestFor('bill.create', { vendorId: 'v1', lines: [{}] }, rows).map(s => [s.subject, s.value]), [['vendorId:v1', 'a']]);
    assert.deepEqual(suggestFor('bill.create', { vendorId: 'v1', lines: [{ accountId: 'x' }, { payee: 'other' }] }, rows).map(s => [s.subject, s.value]), [['payee:other', 'b']]);
    assert.equal(decisionsIn({ vendorId: 'v1', lines: [{ accountId: 'a' }, { accountId: 'c' }] }).length, 2);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('SBX-2 Part 3 remembered decisions (PostgreSQL)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let live: Firestore;
  before(() => { live = new Firestore({ connectionString: url, max: 2 }); });
  after(() => live.terminate());

  test('stored per workspace, never shared, and a person can forget one or all', async t => {
    const a = `rd-${randomUUID()}`;
    const b = `rd-${randomUUID()}`;
    t.after(() => live.pool.query('delete from assistant."rememberedDecisions" where workspace_id = any($1::text[])', [[a, b]]));
    const steps = Array.from({ length: 5 }, () => ({ command: 'bill.create', input: { ...bill('acc-1'), taxCode: 'VAT20' } }));
    await recordOutcome(live.pool, a, steps, 'accepted');
    const rows = await listRemembered(live.pool, a);
    assert.deepEqual(rows.map(r => [r.field, r.cases, r.choices]), [['accountId', 5, { 'acc-1': 5 }], ['taxCode', 5, { VAT20: 5 }]]);
    assert.deepEqual(await listRemembered(live.pool, b), [], 'another workspace sees nothing');
    assert.equal(suggestFor('bill.create', { payee: 'Ocean Supplies' }, await listRemembered(live.pool, b)).length, 0);
    // only what the step could have put there: the random workspace id and the timestamp could contain "1234" by chance
    const stored = JSON.stringify((await live.pool.query('select * from assistant."rememberedDecisions" where workspace_id = $1', [a])).rows
      .map(({ workspace_id: _ws, updated_at: _u, ...row }) => row));
    assert.ok(!stored.includes('secret memo') && !stored.includes('1234'), 'no memo or amount is stored');
    assert.equal(await forgetRemembered(live.pool, a, { command: 'bill.create', subject: 'payee:ocean supplies', field: 'taxCode' }), 1);
    assert.deepEqual((await listRemembered(live.pool, a)).map(r => r.field), ['accountId']);
    assert.equal(await forgetRemembered(live.pool, a), 1);
    assert.deepEqual(await listRemembered(live.pool, a), []);
  });

  test('the forget command deletes in the command transaction: it commits with it or rolls back with it', async t => {
    const ws = `rd-${randomUUID()}`;
    t.after(() => live.pool.query('delete from assistant."rememberedDecisions" where workspace_id = $1', [ws]));
    await recordOutcome(live.pool, ws, [{ command: 'bill.create', input: bill('acc-1') }], 'accepted');
    const ctx = { db: live, workspaceId: ws, afterCommit: () => { throw new Error('no after-commit work'); } } as never;
    // the audit line or the commit fails after the delete: nothing is forgotten
    await assert.rejects(live.runTransaction(async tx => {
      assert.deepEqual(await forgetRememberedCommand.handler(ctx, tx as never, {}), { forgotten: 1 });
      throw new Error('audit write failed');
    }, { maxAttempts: 1 }), /audit write failed/);
    assert.equal((await listRemembered(live.pool, ws)).length, 1, 'the delete rolled back with the command');
    // the command commits: the choice is gone
    assert.deepEqual(await live.runTransaction(tx => forgetRememberedCommand.handler(ctx, tx as never, {})), { forgotten: 1 });
    assert.deepEqual(await listRemembered(live.pool, ws), []);
    // outside a database transaction there is nothing to delete with
    await assert.rejects(forgetRememberedCommand.handler(ctx, {} as never, {}), /not available here/);
  });

  test('the assistant role cannot read or write remembered decisions', async () => {
    const client = await live.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role lf_sandbox');
      await assert.rejects(client.query('select * from assistant."rememberedDecisions"'), /permission denied/);
    } finally { await client.query('rollback'); client.release(); }
  });
});
