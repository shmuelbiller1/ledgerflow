// Simulated DOM test: a search must not change the financial amount of selected entries.
import '../../src/tests/helpers/dom';
import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import ReconciliationWizard,{type ReconciliationResult} from '../../src/components/ledger/ReconciliationWizard';
import {useLedgerStore} from '../../src/stores/useLedgerStore';
import {markComponentCollectionsLoaded,setComponentWorkspace} from '../../src/tests/helpers/componentFixtures';
import {makeChartAccount,makeTransaction} from '../../src/tests/fixtures';
import {stubFetchWithBodies} from '../../src/tests/helpers/dom';

test('search hides a selected receipt from the difference but not the saved selection',async()=>{
 stubFetchWithBodies(200,{});setComponentWorkspace('owner');markComponentCollectionsLoaded('transactions','accounts','reconciliations');
 const bank=makeChartAccount({id:'bank',name:'Checking',type:'asset',category:'Cash',openingBalanceCents:0,balanceCents:0});
 const sale=makeTransaction({id:'receipt100',date:'2026-05-01',description:'Customer receipt',totalAmountCents:10000,status:'completed',lines:[{id:'l1',accountId:'bank',amountCents:10000},{id:'l2',accountId:'sales',amountCents:-10000}]});
 useLedgerStore.setState({accounts:[bank],transactions:[sale],reconciliations:[]});let result:ReconciliationResult|undefined;
 try{
  render(<ReconciliationWizard isOpen onClose={()=>{}} accounts={[bank]} onComplete={r=>{result=r;}} formatCurrency={n=>`$${(n/100).toFixed(2)}`}/>);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'Checking'}});fireEvent.change(screen.getByLabelText('Statement date'),{target:{value:'2026-05-31'}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  const receipt=await screen.findByRole('button',{name:/Customer receipt/});fireEvent.click(receipt);
  fireEvent.change(screen.getByRole('textbox',{name:'Search ledger transactions'}),{target:{value:'not a match'}});
  assert.equal(screen.queryByRole('button',{name:/Customer receipt/}),null);
  fireEvent.click(screen.getByRole('button',{name:'Finish reconciliation'}));
  await waitFor(()=>assert.ok(result));assert.deepEqual([result!.statementBalanceCents,result!.reconciledIds],[0,['receipt100']]);
  console.log(JSON.stringify({statementBalance:result!.statementBalanceCents,clearedIds:result!.reconciledIds,selectedReceipt:10000}));
 }finally{cleanup();}
});

test('first reconciliation uses the current account balance as its beginning balance',async()=>{
 stubFetchWithBodies(200,{});setComponentWorkspace('owner');markComponentCollectionsLoaded('transactions','accounts','reconciliations');
 // Ledger supplies a computed account: 0 opening plus one 100.00 posted receipt = 100.00 current.
 const bank=makeChartAccount({id:'bank',name:'Checking',type:'asset',category:'Cash',openingBalanceCents:0,balanceCents:10000});
 const sale=makeTransaction({id:'receipt100',date:'2026-05-01',description:'Customer receipt',totalAmountCents:10000,status:'completed',lines:[{id:'l1',accountId:'bank',amountCents:10000},{id:'l2',accountId:'sales',amountCents:-10000}]});
 useLedgerStore.setState({accounts:[bank],transactions:[sale],reconciliations:[]});let result:ReconciliationResult|undefined;
 try{
  render(<ReconciliationWizard isOpen onClose={()=>{}} accounts={[bank]} onComplete={r=>{result=r;}} formatCurrency={n=>`$${(n/100).toFixed(2)}`}/>);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'Checking'}});fireEvent.change(screen.getByLabelText('Statement date'),{target:{value:'2026-05-31'}});fireEvent.change(screen.getByLabelText('Statement ending balance ($)'),{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  const receipt=await screen.findByRole('button',{name:/Customer receipt/});assert.equal(receipt.getAttribute('aria-pressed'),'false');
  fireEvent.click(screen.getByRole('button',{name:'Finish reconciliation'}));await waitFor(()=>assert.ok(result));
  assert.deepEqual([result!.statementBalanceCents,result!.reconciledIds],[10000,[]]);
  console.log(JSON.stringify({statement:result!.statementBalanceCents,clearedIds:result!.reconciledIds,actualBeginning:0,receiptOnStatement:10000}));
 }finally{cleanup();}
});
