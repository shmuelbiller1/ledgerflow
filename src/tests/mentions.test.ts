/**
 * @mentions (BG-01): @dana or @dana@example.com in a question about an entry, an answer, or a task
 * tells that person; only people in the workspace; never the writer; once each.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { mentionedPeople } from '../lib/mentions';

const people = [{ uid: 'u-dana', email: 'Dana.Levi@example.com' }, { uid: 'u-omer', email: 'omer@shop.co.il' }, { uid: 'u-none' }];

describe('Finding who is named', () => {
  test('by the part before the @ or the whole email, any case; punctuation after; once each; not the writer; not emails in passing', () => {
    assert.deepEqual(mentionedPeople('@dana.levi can you check? cc @OMER.', people), ['u-dana', 'u-omer']);
    assert.deepEqual(mentionedPeople('Ask @dana.levi@example.com, then @dana.levi again', people), ['u-dana']);
    assert.deepEqual(mentionedPeople('write to dana.levi@example.com about it', people), [], 'an email address in passing is not a mention');
    assert.deepEqual(mentionedPeople('@omer please', people, 'u-omer'), [], 'not the writer');
    assert.deepEqual(mentionedPeople('@nobody and @', people), []);
    assert.deepEqual(mentionedPeople('שאלה ל @omer', people), ['u-omer'], 'after Hebrew text');
  });
});

describe('Telling them (database)', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_mention_${crypto.randomBytes(4).toString('hex')}`;
  let db: import('../server/db/pgFirestore').Firestore;
  const told = async (kind: string) => (await db.pool.query<{ uid: string }>(`select data->>'uid' as uid from public.notifications where workspace_id = $1 and data->>'kind' = $2 order by 1`, [ws, kind])).rows.map(r => r.uid);
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    db = (await import('../server/db/firestore')).getDb();
    await db.collection('workspaces').doc(ws).set({ uid: `${ws}-owner`, name: 'Mentions', currency: 'USD', members: [`${ws}-owner`, `${ws}-book`, `${ws}-view`], roles: { [`${ws}-book`]: 'bookkeeper', [`${ws}-view`]: 'viewer' } });
    for (const [who, email] of [['owner', 'boss'], ['book', 'keeper'], ['view', 'reader']]) await db.collection('users').doc(`${ws}-${who}`).set({ uid: `${ws}-${who}`, email: `${email}.${ws}@example.test` });
    await db.collection('transactions').doc(`${ws}_tx`).set({ workspaceId: ws, date: '2026-10-01', description: 'Amazon', amountCents: 34000, status: 'posted', lines: [{ accountId: 'mention-debit', amountCents: 34000 }, { accountId: 'mention-credit', amountCents: -34000 }] });
  });
  after(async () => {
    for (const table of ['clientQueries', 'documents', 'transactions', 'auditLogs', 'notifications', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.pool.query(`delete from public.users where id like $1`, [`${ws}-%`]);
    await db.terminate();
  });

  test('a question naming the viewer tells them; a task note naming the owner tells the owner', async () => {
    const { askQuery } = await import('../server/services/clientQueryService');
    const { createTask } = await import('../server/services/taskService');
    await askQuery(db, { workspaceId: ws, uid: `${ws}-book`, email: `keeper.${ws}@example.test`, transactionId: `${ws}_tx`, question: `What was this, @reader.${ws}?` });
    assert.deepEqual(await told('mention.query'), [`${ws}-view`]);
    await createTask(db, { workspaceId: ws, uid: `${ws}-book`, email: `keeper.${ws}@example.test`, task: { title: 'Find the Amazon receipt', assignee: `${ws}-view`, note: `@boss.${ws} has the card statement` } });
    assert.deepEqual(await told('mention.task'), [`${ws}-owner`]);
  });
});
