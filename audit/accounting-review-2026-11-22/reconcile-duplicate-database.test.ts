// Two statement lines point to one journal, using the real reconciliation route and isolated DB.
import test from'node:test';import assert from'node:assert/strict';import crypto from'node:crypto';import type{AddressInfo}from'node:net';
const url=process.env.LF_TEST_DATABASE_URL;const valid=url&&new URL(url).hostname==='127.0.0.1'&&new URL(url).port==='55439'&&new URL(url).pathname==='/lf_test';
test('two separate bank lines can match the same ledger entry in one request',{skip:!valid&&'dedicated local audit database required'},async()=>{
 process.env.DATABASE_URL=url;const express=(await import('express')).default;const{getDb}=await import('../../src/server/db/firestore');const{transactionRouter}=await import('../../src/server/routes/transactionRoutes');const db=getDb();const ws=`ws_audit_recdup_${crypto.randomBytes(5).toString('hex')}`;const id=(s:string)=>`${ws}_${s}`;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as never as{user:{uid:string}}).user={uid:'audit-owner'};next();});app.use('/api/v1/transactions',transactionRouter);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 try{
  await db.collection('workspaces').doc(ws).set({uid:'audit-owner',members:['audit-owner'],name:'Synthetic duplicate reconciliation',currency:'USD'});
  for(const [name,type,category]of[['bank','asset','Cash'],['sales','revenue','Revenue']])await db.collection('chartAccounts').doc(id(name)).set({workspaceId:ws,name,type,category});
  for(const n of ['one','two'])await db.collection('bankLines').doc(id(n)).set({workspaceId:ws,accountId:id('bank'),date:'2026-05-01',description:`deposit ${n}`,status:'pending',amountCents:10000,currency:'USD'});
  await db.collection('transactions').doc(id('entry')).set({id:id('entry'),workspaceId:ws,uid:'audit-owner',date:'2026-05-01',description:'deposit',status:'completed',type:'actual',currency:'USD',exchangeRate:1,totalAmountCents:10000,lines:[{accountId:id('bank'),amountCents:10000},{accountId:id('sales'),amountCents:-10000}]});
  const operations=[...['one','two'].map(n=>({type:'updateBankLine',id:id(n),data:{status:'matched',matchedTransactionId:id('entry')}})),{type:'updateTransaction',id:id('entry'),data:{status:'reconciled'}}];
  const res=await fetch(`${base}/api/v1/transactions/reconcile`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:ws,operations})});const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));
  const lines=await Promise.all(['one','two'].map(async n=>(await db.collection('bankLines').doc(id(n)).get()).data()!));const entry=(await db.collection('transactions').doc(id('entry')).get()).data()!;
  assert.deepEqual(lines.map(l=>[l.status,l.matchedTransactionId]),[['matched',id('entry')],['matched',id('entry')]]);assert.equal(entry.status,'reconciled');console.log(JSON.stringify({bankLines:lines.map(l=>l.amountCents),matched:lines.map(l=>l.matchedTransactionId),ledgerCashLeg:10000}));
 }finally{await new Promise<void>(r=>server.close(()=>r()));for(const table of['bankLines','transactions','chartAccounts','auditLogs','idempotencyKeys','workspaces'])await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`,[ws]);await db.terminate();}
});
