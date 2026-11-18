import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { MAX_OPEN_TASKS, TASK_KIND } from '../lib/tasks';
import { TIME_KIND } from '../lib/timeEntries';
import { Firestore } from '../server/db/firestore';
import { previewAccountMerge } from '../server/services/accountMergeService';
import { linkEntries, linksOf } from '../server/services/entryLinkService';
import { defineStagesInTransaction, moveToStageInTransaction, readStages } from '../server/services/stageService';
import { changeTag, listTags } from '../server/services/tagService';
import { createTask } from '../server/services/taskService';
import { listTime } from '../server/services/timeService';
import { prepareWatchTarget, runWatches } from '../server/services/watchService';
import { seedSandbox } from './helpers/sandbox';

const url = process.env.LF_TEST_DATABASE_URL;

describe('SBX-1: record and metadata reads through PostgreSQL', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `sbx-records-${randomUUID()}`;
  const other = `${ws}-other`;
  const owner = `${ws}-owner`;
  const keeper = `${ws}-keeper`;
  const actor = { workspaceId: ws, uid: owner };
  const id = (part: string) => `${ws}-${part}`;
  let live: Firestore;
  let draft: Firestore;
  let otherDraft: Firestore;

  before(async () => {
    live = new Firestore({ connectionString: url, max: 1 });
    for (const workspaceId of [ws, other]) {
      await live.collection('workspaces').doc(workspaceId).set({
        uid: owner, members: [owner, keeper], roles: { [keeper]: 'bookkeeper' }, currency: 'USD',
      });
    }
    draft = live.forSandbox(await seedSandbox(live, ws, owner));
    otherDraft = live.forSandbox(await seedSandbox(live, ws, owner));
  });

  after(async () => {
    if (!live) return;
    try {
      await live.pool.query('delete from sandbox.sandboxes where workspace_id = $1', [ws]);
      for (const table of ['auditLogs', 'notifications', 'documents', 'transactions', 'invoices', 'chartAccounts', 'projects', 'customers', 'workspaces']) {
        await live.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[ws, other]]);
      }
    } finally {
      await live.terminate();
    }
  });

  test('tag counts and renames see edited, new and deleted rows before aggregating', async () => {
    const first = live.doc(`customers/${id('first-tag')}`);
    const second = live.doc(`customers/${id('second-tag')}`);
    const invoice = live.doc(`invoices/${id('tagged-invoice')}`);
    await first.create({ workspaceId: ws, name: 'First', tags: ['VIP'] });
    await second.create({ workspaceId: ws, name: 'Second', tags: ['VIP'] });
    await invoice.create({ workspaceId: ws, status: 'draft', tags: ['VIP'] });
    await live.doc(`customers/${id('elsewhere')}`).create({ workspaceId: other, name: 'Elsewhere', tags: ['VIP'] });
    const original = [{ tag: 'VIP', total: 3, byKind: { customers: 2, invoices: 1 } }];
    assert.deepEqual(await listTags(live, ws), original);
    assert.deepEqual(await listTags(draft, ws), original);
    const audits = (db: Firestore) => db.collection('auditLogs').where('workspaceId', '==', ws).count().get();
    const auditCount = (await audits(live)).data().count;

    await draft.doc(first.path).update({ tags: ['Pending'] });
    await draft.doc(second.path).delete();
    await draft.doc(`customers/${id('draft-tag')}`).create({ workspaceId: ws, name: 'Draft', tags: ['VIP'] });
    assert.deepEqual(await listTags(draft, ws), [
      { tag: 'VIP', total: 2, byKind: { customers: 1, invoices: 1 } },
      { tag: 'Pending', total: 1, byKind: { customers: 1 } },
    ]);
    assert.equal(await changeTag(draft, ws, 'vip', 'Preferred', actor), 2);
    assert.deepEqual((await draft.doc(invoice.path).get()).data()?.tags, ['Preferred']);
    assert.deepEqual(await listTags(live, ws), original);
    assert.deepEqual(await listTags(otherDraft, ws), original);
    assert.equal((await audits(draft)).data().count, auditCount, 'draft retagging does not add an audit row');
    assert.equal((await audits(live)).data().count, auditCount);
  });

  test('link validation resolves draft-only entries and refuses a tombstoned entry', async () => {
    const a = id('link-a');
    const b = id('link-b');
    const c = id('link-draft');
    const entry = { workspaceId: ws, date: '2026-03-15', status: 'draft' };
    for (const txId of [a, b]) await live.doc(`transactions/${txId}`).create(entry);
    const original = await linkEntries(live, { ...actor, a, b });
    const links = { ...actor, transactionId: a };
    assert.deepEqual(await linksOf(draft, links), [original]);
    await draft.doc(`documents/${original.id}`).delete();
    await draft.doc(`transactions/${b}`).delete();
    await draft.doc(`transactions/${c}`).create(entry);
    await assert.rejects(linkEntries(draft, { ...actor, a, b }), { status: 404, message: 'Both entries must be in this workspace' });
    const added = await linkEntries(draft, { ...actor, a: c, b: a, note: 'Draft link' });
    assert.deepEqual(await linksOf(draft, links), [added], 'the reversed link is found and the deleted one stays hidden');
    assert.deepEqual(await linksOf(live, links), [original]);
  });

  test('stage settings, stage assignments and watch timestamps read the visible records', async () => {
    const invoice = live.doc(`invoices/${id('staged')}`);
    await invoice.create({ workspaceId: ws, number: 'I-1', status: 'draft' });
    const input = { ...actor, kind: 'invoice', id: invoice.id };
    await live.runTransaction(async tx => {
      await defineStagesInTransaction(live, tx, { ...actor, sets: { invoice: ['New', 'Done'] } });
    });
    await live.runTransaction(tx => moveToStageInTransaction(live, tx, { ...input, stage: 'New' }));
    const initial = await readStages(live, input);
    assert.deepEqual(initial.current, { [invoice.id]: 'New' });
    assert.deepEqual(await readStages(draft, input), initial);
    await draft.runTransaction(tx => moveToStageInTransaction(draft, tx, { ...input, stage: 'Done' }));
    assert.deepEqual((await readStages(draft, input)).current, { [invoice.id]: 'Done' });
    assert.deepEqual(await readStages(live, input), initial);

    const draftInvoice = draft.doc(`invoices/${id('draft-invoice')}`);
    await draftInvoice.create({ workspaceId: ws, number: 'P-1', status: 'draft' });
    const watch = { ...actor, record: { type: 'invoice', id: draftInvoice.id, label: 'Draft invoice' } };
    assert.equal((await prepareWatchTarget(draft, watch)).seenAt, (await draftInvoice.get()).updateTime?.toDate().toISOString());
    await assert.rejects(prepareWatchTarget(live, watch), { status: 404 });
    await draft.doc(invoice.path).delete();
    await assert.rejects(prepareWatchTarget(draft, { ...watch, record: { ...watch.record, id: invoice.id } }), { status: 404 });
  });

  test('time stays ordered and personal lists exclude other people’s draft hours', async () => {
    const time = (person: string, date: string) => ({ workspaceId: ws, kind: TIME_KIND, person, date, description: 'Worked', minutes: 60, billable: true, status: 'open' });
    const mine = live.doc(`documents/${id('own-time')}`);
    const theirs = live.doc(`documents/${id('keeper-time')}`);
    const later = draft.doc(`documents/${id('draft-time')}`);
    await mine.create(time(owner, '2026-03-01'));
    await theirs.create(time(keeper, '2026-03-12'));
    assert.deepEqual(await listTime(draft, actor), await listTime(live, actor));
    await draft.doc(theirs.path).update({ minutes: 90 });
    await later.create(time(owner, '2026-04-01'));
    assert.deepEqual((await listTime(draft, actor)).entries.map(e => e.id), [later.id, theirs.id, mine.id]);
    assert.deepEqual((await listTime(draft, { ...actor, uid: keeper })).entries.map(e => [e.id, e.minutes]), [[theirs.id, 90]]);
    assert.deepEqual((await listTime(live, { ...actor, uid: keeper })).entries.map(e => [e.id, e.minutes]), [[theirs.id, 60]]);
  });

  test('watch reminders refuse a draft before reading watches', async t => {
    const reads = t.mock.method(draft, 'readRows');
    await assert.rejects(runWatches(draft), /requires the live database/);
    assert.equal(reads.mock.callCount(), 0);
  });

  test('account-merge previews count the same workspace records that would be edited', async () => {
    const fromId = id('merge-from');
    const intoId = id('merge-into');
    await live.doc(`chartAccounts/${fromId}`).create({ workspaceId: ws, name: 'Supplies A', code: '6100', type: 'expense' });
    await live.doc(`chartAccounts/${intoId}`).create({ workspaceId: ws, name: 'Supplies B', code: '6200', type: 'expense' });
    await live.doc(`projects/${id('live-project')}`).create({ workspaceId: ws, name: 'One', expenseAccountId: fromId });
    const input = { ...actor, fromId, intoId };
    assert.deepEqual(await previewAccountMerge(draft, input), await previewAccountMerge(live, input));
    await draft.doc(`projects/${id('draft-project')}`).create({ workspaceId: ws, name: 'Two', expenseAccountId: fromId });
    assert.deepEqual((await previewAccountMerge(draft, input)).changes, { projects: 2 });
    assert.deepEqual((await previewAccountMerge(live, input)).changes, { projects: 1 });
  });

  test('an open draft task counts toward the scoped task limit, without using a real task slot', async () => {
    const task = { kind: TASK_KIND, workspaceId: ws, title: 'Existing task', status: 'open', assignee: owner, createdBy: owner };
    await live.pool.query(
      'insert into public.documents(id, data) select $1 || n, $2::jsonb from generate_series(1, $3::int) n',
      [`${id('task')}-`, JSON.stringify(task), MAX_OPEN_TASKS - 1],
    );
    await draft.doc(`documents/${id('draft-task')}`).create(task);
    await assert.rejects(createTask(draft, { ...actor, task: { title: 'One too many', assignee: owner } }), { status: 409 });
    const open = await live.collection('documents').where('workspaceId', '==', ws).where('kind', '==', TASK_KIND).count().get();
    assert.equal(open.data().count, MAX_OPEN_TASKS - 1);
  });
});
