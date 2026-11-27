// Synthetic route and isolated Postgres diagnostic; asserts current behavior, not desired behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type {AddressInfo} from 'node:net';
const url=process.env.LF_TEST_DATABASE_URL;
const valid=url && new URL(url).hostname==='127.0.0.1' && new URL(url).port==='55439' && new URL(url).pathname==='/lf_test';
test('payment accepts wrong party, mixed sides and a cancelled invoice',{skip:!valid && 'dedicated local audit database required'},async()=>{
 process.env.DATABASE_URL=url;
 const express=(await import('express')).default;const {getDb}=await import('../../src/server/db/firestore');
 const {documentPostRouter}=await import('../../src/server/routes/documentPostRoutes');const {paymentRouter}=await import('../../src/server/routes/paymentRoutes');
 const db=getDb();const ws=`ws_audit_payment_${crypto.randomBytes(5).toString('hex')}`;const id=(s:string)=>`${ws}_${s}`;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as never as {user:{uid:string}}).user={uid:'audit-owner'};next();});app.use('/api/v1/documents',documentPostRouter);app.use('/api/v1/payments',paymentRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 try{
  await db.collection('workspaces').doc(ws).set({uid:'audit-owner',members:['audit-owner'],name:'Synthetic payment',currency:'USD',timezone:'UTC'});
  for(const [key,name,type,category,role] of [['ar','Accounts Receivable','asset','Receivables',''],['ap','Accounts Payable','liability','Payables',''],['sales','Sales','revenue','Revenue',''],['expense','Expense','expense','Expense',''],['cash','Cash','asset','Cash','cash']]) await db.collection('chartAccounts').doc(id(key)).set({workspaceId:ws,name,type,category,...(role?{role}:{})});
  async function post(path:string,body:unknown){const res=await fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return data;}
  async function inv(key:string,customerId:string){await post(`/api/v1/documents/invoices/${id(key)}/post`,{workspaceId:ws,action:'create',data:{id:id(key),workspaceId:ws,uid:'audit-owner',number:key,customerId,customerName:customerId,date:'2026-05-01',dueDate:'2026-06-01',status:'sent',currency:'USD',amountCents:10000,amountPaidCents:0,items:[{id:'l1',description:'Service',quantity:1,rateCents:10000,amountCents:10000,accountId:id('sales')}]}});}
  await inv('invoice_bob','bob');await inv('invoice_carol','carol');
  await post(`/api/v1/documents/bills/${id('bill')}/post`,{workspaceId:ws,action:'create',data:{id:id('bill'),workspaceId:ws,uid:'audit-owner',number:'B-1',vendorId:'david',vendorName:'David',date:'2026-05-01',dueDate:'2026-06-01',status:'approved',currency:'USD',amountCents:10000,splits:[{description:'Expense',amountCents:10000,accountId:id('expense')}]}});
  const common={workspaceId:ws,paymentDate:'2026-05-15',cashAccountId:id('cash'),customerId:'alice'};
  const wrong=await post('/api/v1/payments',{...common,amountCents:10000,allocations:[{documentId:id('invoice_bob'),documentType:'invoice',amountCents:10000}]});
  const mixed=await post('/api/v1/payments',{...common,amountCents:20000,allocations:[{documentId:id('invoice_carol'),documentType:'invoice',amountCents:10000},{documentId:id('bill'),documentType:'bill',amountCents:10000}]});
  const bob=(await db.collection('invoices').doc(id('invoice_bob')).get()).data()!;const carol=(await db.collection('invoices').doc(id('invoice_carol')).get()).data()!;const bill=(await db.collection('bills').doc(id('bill')).get()).data()!;
  const txs=(await db.collection('transactions').where('workspaceId','==',ws).get()).docs.map(d=>d.data());
  const bal=(account:string)=>txs.flatMap(t=>(t.lines||[]) as Array<{accountId:string;amountCents:number}>).filter(l=>l.accountId===id(account)).reduce((s,l)=>s+l.amountCents,0);
  const rows=(await db.collection('paymentAllocations').where('workspaceId','==',ws).get()).docs.map(d=>d.data()).map(d=>({documentType:d.documentType,side:d.side,partyId:d.partyId,documentId:d.documentId}));
  assert.deepEqual([bob.amountPaidCents,carol.amountPaidCents,bill.amountPaidCents],[10000,10000,10000]);
  assert.deepEqual([bal('cash'),bal('ar'),bal('ap')],[30000,-10000,-10000]);
  assert.equal(rows.find(r=>r.documentId===id('invoice_bob'))?.partyId,'alice');
  assert.deepEqual(rows.find(r=>r.documentId===id('bill')),{documentType:'bill',side:'receivable',partyId:'alice',documentId:id('bill')});
  await post(`/api/v1/documents/invoices/${id('cancelled')}/post`,{workspaceId:ws,action:'create',data:{id:id('cancelled'),workspaceId:ws,uid:'audit-owner',number:'CANCELLED',customerId:'alice',customerName:'Alice',date:'2026-05-01',dueDate:'2026-06-01',status:'cancelled',currency:'USD',amountCents:10000,amountPaidCents:0,items:[{id:'l1',description:'Cancelled service',quantity:1,rateCents:10000,amountCents:10000,accountId:id('sales')}]}});
  const cancellationBefore=(await db.collection('transactions').where('workspaceId','==',ws).get()).docs.map(d=>d.data()).filter(t=>t.metadata?.invoiceId===id('cancelled'));
  assert.equal(cancellationBefore.length,0);
  const cancelledPay=await post('/api/v1/payments',{...common,amountCents:10000,allocations:[{documentId:id('cancelled'),documentType:'invoice',amountCents:10000}]});
  const cancelled=(await db.collection('invoices').doc(id('cancelled')).get()).data()!;
  assert.equal(cancelled.amountPaidCents,10000);assert.equal(cancelled.status,'paid');
  const cancelledTx=(await db.collection('transactions').where('workspaceId','==',ws).get()).docs.map(d=>d.data()).find(t=>t.metadata?.paymentId===cancelledPay.data.paymentId)!;
  assert.deepEqual(cancelledTx.lines.map((l:{accountId:string;amountCents:number})=>[l.accountId,l.amountCents]),[[id('cash'),10000],[id('ar'),-10000]]);
  console.log(JSON.stringify({wrongStatus:wrong.status,mixedStatus:mixed.status,documentsPaid:[bob.amountPaidCents,carol.amountPaidCents,bill.amountPaidCents],balances:{cash:bal('cash'),ar:bal('ar'),ap:bal('ap')},rows,cancelledInvoice:{priorJournals:cancellationBefore.length,amountPaid:cancelled.amountPaidCents,status:cancelled.status,paymentLines:cancelledTx.lines}}));
 }finally{await new Promise<void>(r=>server.close(()=>r()));for(const table of ['paymentAllocations','allocationOperations','idempotencyKeys','transactions','payments','invoices','bills','chartAccounts','auditLogs','numberingSeries','workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`,[ws]);await db.terminate();}
});
