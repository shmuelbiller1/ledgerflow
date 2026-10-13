import './helpers/dom';
import test,{afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {vendorWithholdingReport,validWithholdingMonth} from '../lib/vendorWithholdingReport';
import VendorWithholdingView from '../components/reporting/VendorWithholdingView';
import {setComponentWorkspace,markComponentCollectionsLoaded} from './helpers/componentFixtures';
import {useLedgerStore} from '../stores/useLedgerStore';
import {useAuthStore} from '../stores/useAuthStore';
import {getSupabase} from '../lib/db/client';
import type {Payment} from '../types';

const realFetch=globalThis.fetch;
const payment=(id:string,extra:Partial<Payment>={}):Payment=>({id,uid:'test-user',workspaceId:'component-workspace',direction:'made',contactId:'ספק-א',contactName:'ספק Old',date:'2024-02-29',amountCents:10000,currency:'USD',exchangeRate:1,method:'bank_transfer',depositAccountId:'bank',allocations:[],unappliedCents:0,status:'posted',createdAt:'2024-02-29T12:00:00Z',...extra});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{setComponentWorkspace();markComponentCollectionsLoaded('payments');useLedgerStore.setState({payments:[]});globalThis.fetch=async()=>response([]);});
afterEach(async()=>{cleanup();globalThis.fetch=realFetch;getSupabase().realtime.disconnect();await getSupabase().auth.dispose();});

test('saved payments give exact gross, vendor-paid and retained amounts without mixing currencies or replacing historic names/references',()=>{
  const source=[payment('a',{withheldCents:500,withholdingCertificate:'W-אב'}),payment('b',{contactName:'ספק New',amountCents:14000,withheldCents:1000,withholdingCertificate:'W-ישן'}),payment('eur',{amountCents:8000,currency:'EUR',exchangeRate:1.2}),payment('void',{status:'void'}),payment('draft',{status:'draft'}),payment('receipt',{direction:'received'}),payment('old',{date:'2024-01-31'}),payment('next',{date:'2024-03-01'}),payment('foreign',{workspaceId:'other'})];
  const before=JSON.stringify(source),result=vendorWithholdingReport(source,'component-workspace','2024-02','USD');
  assert.deepEqual(result.problems,[]);assert.equal(result.rows.length,2);
  const usd=result.rows.find(row=>row.currency==='USD')!;assert.deepEqual([usd.settlementCents,usd.paidCents,usd.withheldCents,usd.payments],[24000,22500,1500,2]);
  assert.deepEqual(new Set(usd.certificates),new Set(['W-אב','W-ישן']));assert.ok(usd.vendor.includes('ספק Old'));assert.ok(usd.vendor.includes('ספק New'));assert.equal(usd.vendorId,'ספק-א');
  const eur=result.rows.find(row=>row.currency==='EUR')!;assert.deepEqual([eur.settlementCents,eur.paidCents,eur.withheldCents],[8000,8000,0]);assert.equal(eur.missingReferences,0);assert.equal(JSON.stringify(source),before);
});
test('real months, missing historical references, malformed posted values and unsafe totals remain explicit',()=>{
  assert.equal(validWithholdingMonth('2024-02'),true);for(const month of ['2024-13','1899-12','2024-2',''])assert.equal(validWithholdingMonth(month),false);
  assert.throws(()=>vendorWithholdingReport([],'component-workspace','2024-13','USD'),/real calendar month/);
  const rows=[payment('missing',{withheldCents:500}),payment('bad-day',{date:'2024-02-30'}),payment('fraction',{withheldCents:1.5}),payment('foreign-tax',{currency:'EUR',withheldCents:10}),payment('too-much',{withheldCents:10000})];
  const report=vendorWithholdingReport(rows,'component-workspace','2024-02','USD');assert.equal(report.problems.length,4);assert.equal(report.rows[0].missingReferences,1);assert.deepEqual([report.rows[0].paidCents,report.rows[0].withheldCents],[9500,500]);
  const overflow=vendorWithholdingReport([payment('max',{amountCents:Number.MAX_SAFE_INTEGER}),payment('extra',{amountCents:1})],'component-workspace','2024-02','USD');assert.equal(overflow.problems.length,1);
});
test('a refused full read retains preview; complete read enables CSV, while invalid rows or in-flight edits block it',async()=>{
  const before=payment('before',{withheldCents:500,withholdingCertificate:'W-אב'});useLedgerStore.setState({payments:[before]});render(<VendorWithholdingView/>);
  fireEvent.change(screen.getByLabelText('Payment month'),{target:{value:'2024-02'}});
  const csv=screen.getByRole('button',{name:'Export CSV'}) as HTMLButtonElement;assert.equal(csv.disabled,true);
  globalThis.fetch=async()=>response({message:'Denied'},403);fireEvent.click(screen.getByRole('button',{name:'Refresh complete payments'}));await screen.findByRole('alert');assert.ok(screen.getByText('ספק Old'));assert.equal(csv.disabled,true);
  let started='';let finish:(value:Response)=>void=()=>{};globalThis.fetch=async input=>{started=String(input);return new Promise<Response>(resolve=>{finish=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete payments'}));await waitFor(()=>assert.ok(started));assert.equal(new URL(started).searchParams.get('workspace_id'),'eq.component-workspace');
  act(()=>useLedgerStore.setState({payments:[{...before,withheldCents:700}]}));await act(async()=>finish(response([{id:before.id,data:before}])));assert.equal(csv.disabled,true);assert.ok(screen.getByText(/Payments changed during or after/));
  globalThis.fetch=async()=>response([{id:before.id,data:before}]);fireEvent.click(screen.getByRole('button',{name:'Refresh complete payments'}));await waitFor(()=>assert.equal(csv.disabled,false));
  globalThis.fetch=async()=>response([{id:'bad',data:payment('bad',{date:'2024-02-30'})}]);fireEvent.click(screen.getByRole('button',{name:'Refresh complete payments'}));await screen.findByRole('alert');assert.equal(csv.disabled,true);
});
test('old-workspace reads cannot populate the next workspace or disclose the previous payment cache',async()=>{
  render(<VendorWithholdingView/>);let started=false;let finish:(value:Response)=>void=()=>{};globalThis.fetch=async()=>{started=true;return new Promise<Response>(resolve=>{finish=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete payments'}));await waitFor(()=>assert.equal(started,true));
  act(()=>{useLedgerStore.setState({payments:[payment('private',{contactName:'Private vendor'})]});useAuthStore.setState({currentWorkspaceId:'next-workspace'});});
  await act(async()=>finish(response([{id:'private',data:payment('private',{contactName:'Private vendor'})}])));assert.equal(screen.queryByText('Private vendor'),null);assert.equal((screen.getByRole('button',{name:'Export CSV'}) as HTMLButtonElement).disabled,true);
});
