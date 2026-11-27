// Synthetic HTTP route + isolated DB diagnostic; asserts the present historic-report defect.
import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import type{AddressInfo}from'node:net';
const url=process.env.LF_TEST_DATABASE_URL;const valid=url&&new URL(url).hostname==='127.0.0.1'&&new URL(url).port==='55439'&&new URL(url).pathname==='/lf_test';
test('later void changes a prior cash-basis P&L',{skip:!valid&&'dedicated local audit database required'},async()=>{
 process.env.DATABASE_URL=url;const express=(await import('express')).default;const{getDb}=await import('../../src/server/db/firestore');const{documentPostRouter}=await import('../../src/server/routes/documentPostRoutes');const{paymentRouter}=await import('../../src/server/routes/paymentRoutes');const{reportRouter}=await import('../../src/server/routes/reportRoutes');const db=getDb();const ws=`ws_audit_cash_${crypto.randomBytes(5).toString('hex')}`;const id=(s:string)=>`${ws}_${s}`;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as never as{user:{uid:string}}).user={uid:'audit-owner'};next();});app.use('/api/v1/documents',documentPostRouter);app.use('/api/v1/payments',paymentRouter);app.use('/api/v1/reports',reportRouter);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  await db.collection('workspaces').doc(ws).set({uid:'audit-owner',members:['audit-owner'],name:'Synthetic cash basis',currency:'USD',timezone:'UTC'});
  for(const [key,name,type,category,role] of [['ar','Accounts Receivable','asset','Receivables',''],['sales','Sales','revenue','Revenue',''],['cash','Cash','asset','Cash','cash']])await db.collection('chartAccounts').doc(id(key)).set({workspaceId:ws,name,type,category,...(role?{role}:{})});
  async function call(path:string,body?:unknown){const res=await fetch(`${base}${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;}
  await call(`/api/v1/documents/invoices/${id('invoice')}/post`,{workspaceId:ws,action:'create',data:{id:id('invoice'),workspaceId:ws,customerId:'alice',customerName:'Alice',number:'I-1',date:'2026-02-01',dueDate:'2026-03-01',status:'sent',currency:'USD',amountCents:10000,amountPaidCents:0,items:[{id:'l1',description:'Service',quantity:1,rateCents:10000,amountCents:10000,accountId:id('sales')}]}});
  const p=await call('/api/v1/payments',{workspaceId:ws,paymentDate:'2026-02-10',cashAccountId:id('cash'),customerId:'alice',amountCents:10000,allocations:[{documentId:id('invoice'),documentType:'invoice',amountCents:10000}]});
  const report=(bust:number)=>call(`/api/v1/reports/profit-and-loss?workspaceId=${ws}&startDate=2026-02-01&endDate=2026-02-28&basis=cash&_read=${bust}`);
  const before=await report(1);assert.equal(before.income.total,10000);
  await call(`/api/v1/payments/${p.data.paymentId}/void`,{workspaceId:ws,date:'2026-03-10',reason:'Synthetic later reversal'});
  const after=await report(2);const payment=(await db.collection('payments').doc(p.data.paymentId).get()).data()!;
  assert.deepEqual([after.income.total,payment.status,payment.voidDate],[0,'void','2026-03-10']);
  console.log(JSON.stringify({februaryBefore:before.income.total,februaryAfter:after.income.total,voidDate:payment.voidDate}));
 }finally{await new Promise<void>(r=>server.close(()=>r()));for(const table of ['paymentAllocations','allocationOperations','idempotencyKeys','transactions','payments','invoices','chartAccounts','auditLogs','numberingSeries','workspaces'])await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`,[ws]);await db.terminate();}
});
