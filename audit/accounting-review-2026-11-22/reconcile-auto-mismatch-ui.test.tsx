// Simulated DOM, real Auto-match action with synthetic data; fetch is stubbed.
import '../../src/tests/helpers/dom';import test from'node:test';import assert from'node:assert/strict';import React from'react';
import{cleanup,fireEvent,render,screen,waitFor}from'@testing-library/react';import Reconciliation from '../../src/components/ledger/Reconciliation';import{useLedgerStore}from'../../src/stores/useLedgerStore';import{useUIStore}from'../../src/stores/useUIStore';import{makeChartAccount,makeTransaction}from'../../src/tests/fixtures';import{setComponentWorkspace,markComponentCollectionsLoaded}from'../../src/tests/helpers/componentFixtures';import{stubFetchWithBodies}from'../../src/tests/helpers/dom';
test('auto-match uses journal total rather than the actual cash leg',async()=>{
 const calls=stubFetchWithBodies(200,{status:'ok'});setComponentWorkspace('owner');markComponentCollectionsLoaded('accounts','transactions','bankLines');useUIStore.setState({activeTab:'reconciliation'});
 const accounts=[makeChartAccount({id:'bank',name:'Checking',type:'asset',category:'Cash'}),makeChartAccount({id:'ar',name:'Accounts Receivable',type:'asset',category:'Receivables'}),makeChartAccount({id:'sales',name:'Sales',type:'revenue'})];
 const entry=makeTransaction({id:'entry',date:'2026-05-01',description:'Acme service',status:'completed',currency:'USD',exchangeRate:1,totalAmountCents:10000,lines:[{id:'1',accountId:'bank',amountCents:2000},{id:'2',accountId:'ar',amountCents:8000},{id:'3',accountId:'sales',amountCents:-10000}]});
 const bankLine={id:'line',workspaceId:'component-workspace',date:'2026-05-01',description:'Acme service',amountCents:10000,accountId:'bank',status:'pending',currency:'USD'};
 useLedgerStore.setState({accounts,transactions:[entry],bankLines:[bankLine as never]});
 try{render(<Reconciliation/>);fireEvent.click(screen.getByRole('button',{name:'Auto-match all'}));await waitFor(()=>assert.ok(calls.some(c=>c.url.includes('/transactions/reconcile'))));const call=calls.find(c=>c.url.includes('/transactions/reconcile'))!;const ops=(call.body as {operations:Array<{id:string;data:{matchedTransactionId?:string;status:string}}>}).operations;
 assert.deepEqual(ops.map(o=>[o.id,o.data.status,o.data.matchedTransactionId]),[['line','matched','entry'],['entry','reconciled',undefined]]);console.log(JSON.stringify({bankLine:10000,actualBankLeg:2000,journalTotal:10000,operations:ops}));
 }finally{cleanup();}
});
