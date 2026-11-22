// Synthetic fake provider + isolated local Postgres only. Asserts the current unsafe behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('malformed posted row is dropped while cursor advances and logs success', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../../src/server/db/firestore');
  const { syncOneBank, setPlaidClientForTests } = await import('../../src/server/routes/plaidRoutes');
  const { SecurityService } = await import('../../src/services/securityService');
  const db = getDb();
  const ws = `ws_audit_bank_${crypto.randomBytes(5).toString('hex')}`;
  const bankId = `${ws}_bank`;
  const cursors: Array<string | undefined> = [];
  try {
    await db.collection('workspaces').doc(ws).set({ uid:'owner-audit', name:'Synthetic only', currency:'USD', members:['owner-audit'] });
    await db.collection('banks').doc(bankId).set({ workspaceId:ws, uid:'owner-audit', institutionName:'Fake Bank', status:'active', access_token:SecurityService.encryptSensitiveField('fake-token'), syncCursor:'before' });
    setPlaidClientForTests({
      linkTokenCreate: (async () => ({data:{link_token:'fake'}})) as never,
      itemPublicTokenExchange: (async () => ({data:{access_token:'fake',item_id:'fake'}})) as never,
      transactionsGet: (async () => ({data:{transactions:[]}})) as never,
      transactionsSync: (async ({cursor}: {cursor?:string}) => { cursors.push(cursor); return {data:{added: cursor === 'before' ? [
        { transaction_id:'valid-1', date:'2026-11-01', name:'Valid', amount:100, pending:false },
        { transaction_id:'missing-date', name:'Malformed', amount:45, pending:false },
      ] : [], modified:[], removed:[], next_cursor:'after', has_more:false}}; }) as never,
    });
    const ref = db.collection('banks').doc(bankId);
    const result = await syncOneBank(db, await ref.get(), { workspaceId:ws, uid:'owner-audit', workspaceCurrency:'USD' });
    const bank = (await ref.get()).data()!;
    const lines = (await db.collection('bankLines').where('workspaceId','==',ws).get()).docs.map(d=>d.data());
    assert.equal(result.kind,'ok');
    assert.equal(bank.syncCursor,'after');
    assert.equal(lines.length,1);
    assert.equal(lines[0].importIdentity,'plaid:valid-1');
    assert.equal((bank.syncLog as Array<{result:string;lines:number}>).at(-1)?.result,'ok');
    assert.equal((bank.syncLog as Array<{result:string;lines:number}>).at(-1)?.lines,2);
    await syncOneBank(db, await ref.get(), { workspaceId:ws, uid:'owner-audit', workspaceCurrency:'USD' });
    assert.deepEqual(cursors,['before','after']);
    assert.equal((await db.collection('bankLines').where('workspaceId','==',ws).get()).size,1);
    console.log('Fake provider supplied 2 posted rows, stored 1; cursor advanced before → after; sync log says ok/2.');
  } finally {
    for (const table of ['banks','bankLines','auditLogs','workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`,[ws]);
    await db.terminate();
  }
});
