// HTTP router with injected test identity and isolated local Postgres; asserts present defects.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('foreign manual journals persist mismatched home amounts and client balance', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const express = (await import('express')).default;
  const { getDb } = await import('../../src/server/db/firestore');
  const { transactionRouter } = await import('../../src/server/routes/transactionRoutes');
  const { computeProfitAndLoss } = await import('../../src/server/reports/computeReports');
  const { LedgerEngine } = await import('../../src/kernel/ledger/LedgerEngine');
  const db = getDb();
  const ws = `ws_audit_fx_${crypto.randomBytes(5).toString('hex')}`;
  const id = (x: string) => `${ws}_${x}`;
  const accounts = [
    {id:id('cash'),workspaceId:ws,uid:'owner-audit',name:'Cash',type:'asset',category:'Cash'},
    {id:id('sales'),workspaceId:ws,uid:'owner-audit',name:'Sales',type:'revenue',category:'Revenue'},
  ];
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ (req as unknown as {user:{uid:string}}).user={uid:'owner-audit'}; next(); });
  app.use('/api/v1/transactions',transactionRouter);
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  try {
    await db.collection('workspaces').doc(ws).set({uid:'owner-audit',members:['owner-audit'],name:'Synthetic FX',currency:'USD'});
    for (const a of accounts) await db.collection('chartAccounts').doc(a.id).set(a);
    const created=[];
    for (const explicit of [false,true]) {
      const fx = explicit ? {exchangeRate:0.0067} : {};
      const tx = { id:id(explicit?'line':'header'),workspaceId:ws,date:'2026-07-01',description:'Synthetic FX',currency:'JPY',exchangeRate:0.0067,status:'completed',type:'actual',lines:[{accountId:id('cash'),amountCents:1_000_000,...fx},{accountId:id('sales'),amountCents:-1_000_000,...fx}] };
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/transactions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transaction:tx})});
      const body = await res.json(); assert.equal(res.status,200,JSON.stringify(body));
      const stored = (await db.collection('transactions').doc(tx.id).get()).data()!;
      const pl = computeProfitAndLoss(accounts as never,[stored] as never,'2026-07-01','2026-07-31');
      const client = LedgerEngine.computeDimensionalBalances(accounts as never,[stored] as never).get(id('cash'))?.total;
      created.push({explicit,pl:pl.income.total,client,lineRates:(stored.lines as Array<{exchangeRate:number}>).map(l=>l.exchangeRate)});
    }
    assert.deepEqual(created,[{explicit:false,pl:1_000_000,client:1_000_000,lineRates:[1,1]},{explicit:true,pl:670_000,client:6_700,lineRates:[0.0067,0.0067]}]);
    console.log('Persisted synthetic foreign journals:',JSON.stringify(created));
  } finally {
    await new Promise<void>(r=>server.close(()=>r()));
    for (const table of ['transactions','chartAccounts','auditLogs','idempotencyKeys','workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`,[ws]);
    await db.terminate();
  }
});
