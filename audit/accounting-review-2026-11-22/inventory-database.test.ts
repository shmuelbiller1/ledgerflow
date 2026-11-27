// Isolated synthetic DB + actual document posting route. These assertions record current behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
const url=process.env.LF_TEST_DATABASE_URL;
const valid=url && new URL(url).hostname==='127.0.0.1' && new URL(url).port==='55439' && new URL(url).pathname==='/lf_test';

test('inventory quantity and rounding through purchase and invoice posting', {skip:!valid && 'dedicated local audit database required'},async()=>{
  process.env.DATABASE_URL=url;
  const express=(await import('express')).default;
  const {getDb}=await import('../../src/server/db/firestore');
  const {documentPostRouter}=await import('../../src/server/routes/documentPostRoutes');
  const db=getDb(); const ws=`ws_audit_stock_${crypto.randomBytes(5).toString('hex')}`; const id=(s:string)=>`${ws}_${s}`;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as never as {user:{uid:string}}).user={uid:'audit-owner'};next();});app.use('/api/v1/documents',documentPostRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r)); const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    await db.collection('workspaces').doc(ws).set({uid:'audit-owner',members:['audit-owner'],name:'Synthetic stock',currency:'USD',timezone:'UTC'});
    for(const [key,name,type,category,role] of [['ar','Accounts Receivable','asset','Receivables',''],['ap','Accounts Payable','liability','Payables',''],['sales','Sales','revenue','Revenue',''],['inventory','Inventory','asset','Inventory','inventory'],['cogs','Cost of Goods Sold','expense','COGS','cogs'],['cash','Cash','asset','Cash','cash']])
      await db.collection('chartAccounts').doc(id(key)).set({workspaceId:ws,name,type,category,...(role?{role}:{})});
    await db.collection('inventory').doc(id('free')).set({workspaceId:ws,name:'No-cost item',sku:'FREE',quantityAtHand:10,unitCostCents:0});
    await db.collection('inventory').doc(id('rounded')).set({workspaceId:ws,name:'Three for one',sku:'ROUND',quantityAtHand:0,unitCostCents:0});
    async function post(kind:string,key:string,data:Record<string,unknown>){const res=await fetch(`${base}/api/v1/documents/${kind}/${id(key)}/post`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspaceId:ws,action:'create',data})});const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return body as Record<string,unknown>;}
    const baseInvoice={workspaceId:ws,uid:'audit-owner',customerId:'synthetic-customer',customerName:'Synthetic',date:'2026-05-02',dueDate:'2026-06-02',status:'sent',currency:'USD',amountPaidCents:0};
    const zero=await post('invoices','invoice_free',{...baseInvoice,id:id('invoice_free'),number:'FREE-1',amountCents:2000,items:[{id:'l1',itemId:id('free'),description:'Sale',quantity:2,rateCents:1000,amountCents:2000,accountId:id('sales')}]});
    const free=(await db.collection('inventory').doc(id('free')).get()).data()!;
    const freeInv=(await db.collection('invoices').doc(id('invoice_free')).get()).data()!;
    const freeTxs=(await db.collection('transactions').where('workspaceId','==',ws).get()).docs.map(d=>d.data()).filter(t=>t.metadata?.invoiceId===id('invoice_free'));
    assert.equal(free.quantityAtHand,10);assert.notEqual(freeInv.metadata?.cogsPending,true);assert.equal(freeTxs.filter(t=>t.metadata?.type==='invoice-cogs-auto').length,0);
    await post('bills','bill',{id:id('bill'),workspaceId:ws,uid:'audit-owner',number:'B-1',vendorId:'synthetic-vendor',vendorName:'Synthetic',date:'2026-05-01',dueDate:'2026-06-01',status:'approved',currency:'USD',amountCents:100,splits:[{itemId:id('rounded'),quantity:3,amountCents:100,accountId:id('inventory'),description:'Three units'}]});
    const purchased=(await db.collection('inventory').doc(id('rounded')).get()).data()!;assert.deepEqual([purchased.quantityAtHand,purchased.unitCostCents],[3,33]);
    await post('invoices','invoice_rounded',{...baseInvoice,id:id('invoice_rounded'),number:'ROUND-1',amountCents:3000,items:[{id:'l1',itemId:id('rounded'),description:'Sale',quantity:3,rateCents:1000,amountCents:3000,accountId:id('sales')}]});
    const after=(await db.collection('inventory').doc(id('rounded')).get()).data()!;
    const txs=(await db.collection('transactions').where('workspaceId','==',ws).get()).docs.map(d=>d.data());
    const invLines=txs.flatMap(t=>(t.lines||[]) as Array<{accountId:string;amountCents:number}>).filter(l=>l.accountId===id('inventory'));
    const bal=invLines.reduce((sum,l)=>sum+l.amountCents,0);
    assert.equal(after.quantityAtHand,0);assert.equal(bal,1);
    console.log(JSON.stringify({zeroCostSale:{quantityAfter:free.quantityAtHand,cogsPending:freeInv.metadata?.cogsPending??null,journalCount:freeTxs.length,response:zero},roundedPurchaseAndSale:{purchaseValue:100,unitCost:purchased.unitCostCents,quantityAfter:after.quantityAtHand,inventoryLedgerBalance:bal}}));
  }finally{
    await new Promise<void>(r=>server.close(()=>r()));
    for(const table of ['transactions','bills','invoices','inventory','stockMoves','chartAccounts','auditLogs','idempotencyKeys','workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id=$1 or id=$1`,[ws]);
    await db.terminate();
  }
});
