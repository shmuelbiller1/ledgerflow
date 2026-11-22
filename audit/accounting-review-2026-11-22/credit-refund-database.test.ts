// Synthetic credit and refund route diagnostic on dedicated isolated Postgres; asserts current behavior.
import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import type {AddressInfo} from 'node:net';
const url=process.env.LF_TEST_DATABASE_URL;const valid=url&&new URL(url).hostname==='127.0.0.1'&&new URL(url).port==='55439'&&new URL(url).pathname==='/lf_test';
test('foreign credit refund and pre-issuance date persist through routes',{skip:!valid&&'dedicated local audit database required'},async()=>{
 process.env.DATABASE_URL=url;const express=(await import('express')).default;const {getDb}=await import('../../src/server/db/firestore');const {documentPostRouter}=await import('../../src/server/routes/documentPostRoutes');const {paymentRouter}=await import('../../src/server/routes/paymentRoutes');const db=getDb();const ws=`ws_audit_refund_${crypto.randomBytes(5).toString('hex')}`;const id=(x:string)=>`${ws}_${x}`;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as never as {user:{uid:string}}).user={uid:'audit-owner'};next();});app.use('/api/v1/documents',documentPostRouter);app.use('/api/v1/payments',paymentRouter);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  await db.collection('workspaces').doc(ws).set({uid:'audit-owner',members:['audit-owner'],name:'Synthetic refund',currency:'USD',timezone:'UTC'});
  for(const [key,name,type,category,role] of [['ar','Accounts Receivable','asset','Receivables',''],['sales','Sales','revenue','Revenue',''],['cash','Cash','asset','Cash','cash']])await db.collection('chartAccounts').doc(id(key)).set({workspaceId:ws,name,type,category,...(role?{role}:{})});
  async function post(path:string,body:unknown){const res=await fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;}
  async function credit(key:string,currency:string,exchangeRate:number){return post(`/api/v1/documents/creditNotes/${id(key)}/post`,{workspaceId:ws,action:'create',data:{id:id(key),workspaceId:ws,uid:'audit-owner',customerId:'synthetic',customerName:'Synthetic',number:key,date:'2026-05-10',status:'open',currency,exchangeRate,amountCents:10000,remainingCents:10000}});}
  await credit('foreign','EUR',1.2);
  const refund=await post('/api/v1/payments/credits/refund',{workspaceId:ws,kind:'customer',creditId:id('foreign'),amountCents:10000,cashAccountId:id('cash'),date:'2026-05-15'});
  const txs=(await db.collection('transactions').where('workspaceId','==',ws).get()).docs.map(d=>d.data());const issuance=txs.find(t=>t.metadata?.creditNoteId===id('foreign'))!;const ref=txs.find(t=>t.id===refund.data.transactionId)!;
  type Line={accountId:string;amountCents:number;exchangeRate?:number};
  const amount=(tx:Record<string,unknown>,account:string)=>(tx.lines as Line[]).find(l=>l.accountId===id(account))!;
  assert.equal(amount(issuance,'ar').amountCents,-12000);assert.equal(amount(ref,'ar').amountCents,10000);assert.equal(amount(ref,'cash').amountCents,-10000);
  assert.equal((await db.collection('creditNotes').doc(id('foreign')).get()).data()?.remainingCents,0);
  await credit('early','USD',1);
  const early=await post('/api/v1/payments/credits/refund',{workspaceId:ws,kind:'customer',creditId:id('early'),amountCents:10000,cashAccountId:id('cash'),date:'2026-05-01'});
  const earlyTx=(await db.collection('transactions').doc(early.data.transactionId).get()).data()!;assert.equal(earlyTx.date,'2026-05-01');
  console.log(JSON.stringify({foreign:{issuedAR:amount(issuance,'ar').amountCents,refundAR:amount(ref,'ar').amountCents,refundCash:amount(ref,'cash').amountCents,lineRate:amount(ref,'ar').exchangeRate,creditRemaining:0},early:{creditDate:'2026-05-10',refundDate:earlyTx.date}}));
 }finally{await new Promise<void>(r=>server.close(()=>r()));for(const table of ['transactions','creditNotes','chartAccounts','auditLogs','idempotencyKeys','workspaces'])await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`,[ws]);await db.terminate();}
});
