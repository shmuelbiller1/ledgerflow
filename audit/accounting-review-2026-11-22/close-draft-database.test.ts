// Synthetic document route + close service in isolated PostgreSQL. Asserts current defect.
import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import type {AddressInfo} from 'node:net';
const url=process.env.LF_TEST_DATABASE_URL;const valid=url&&new URL(url).hostname==='127.0.0.1'&&new URL(url).port==='55439'&&new URL(url).pathname==='/lf_test';
test('hard close misses a draft whose date includes time on month end',{skip:!valid&&'dedicated local audit database required'},async()=>{
 process.env.DATABASE_URL=url;const express=(await import('express')).default;const {getDb}=await import('../../src/server/db/firestore');const {documentPostRouter}=await import('../../src/server/routes/documentPostRoutes');const {closePeriod}=await import('../../src/server/services/periodCloseService');const db=getDb();
 const ws=`ws_audit_close_${crypto.randomBytes(5).toString('hex')}`;const id=`${ws}_invoice`;const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as never as {user:{uid:string}}).user={uid:'audit-owner'};next();});app.use('/api/v1/documents',documentPostRouter);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{
  await db.collection('workspaces').doc(ws).set({uid:'audit-owner',members:['audit-owner'],name:'Synthetic close',currency:'USD',timezone:'UTC'});
  for (const [key,name,type,category,role] of [['ar','Accounts Receivable','asset','Receivables',''],['sales','Sales','revenue','Revenue',''],['cash','Cash','asset','Cash','cash']]) await db.collection('chartAccounts').doc(`${ws}_${key}`).set({workspaceId:ws,name,type,category,...(role?{role}:{})});
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const invoice={id,workspaceId:ws,customerId:'synthetic',number:'DRAFT',date:'2026-05-31T12:00:00Z',dueDate:'2026-06-30',status:'draft',currency:'USD',amountCents:10000,items:[{id:'l1',description:'Service',quantity:1,rateCents:10000,amountCents:10000}]};
  const create=await fetch(`${base}/api/v1/documents/invoices/${id}/post`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:ws,action:'create',data:invoice})});const body=await create.json();assert.equal(create.status,200,JSON.stringify(body));
  const close=await closePeriod(db,{workspaceId:ws,uid:'audit-owner',month:'2026-05',mode:'hard'});assert.equal(close.lockDate,'2026-05-31');
  const saved=(await db.collection('invoices').doc(id).get()).data()!;assert.equal(saved.status,'draft');assert.equal(saved.date,'2026-05-31T12:00:00Z');
  const update=await fetch(`${base}/api/v1/documents/invoices/${id}/post`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:ws,action:'update',data:{status:'sent'}})});assert.notEqual(update.status,200);const updateBody=await update.json();assert.match(JSON.stringify(updateBody),/[Pp]eriod [Ll]ocked/);
  console.log(JSON.stringify({date:saved.date,close,remainingStatus:saved.status,postStatus:update.status,postResponse:updateBody}));
 }finally{await new Promise<void>(r=>server.close(()=>r()));for(const table of ['invoices','periods','chartAccounts','auditLogs','workspaces'])await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`,[ws]);await db.terminate();}
});
