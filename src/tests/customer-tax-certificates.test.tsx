import './helpers/dom';
import test,{afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {customerTaxCertificates} from '../lib/customerTaxCertificates';
import CustomerTaxCertificatesView from '../components/reporting/CustomerTaxCertificatesView';
import {useAuthStore} from '../stores/useAuthStore';
import {useLedgerStore} from '../stores/useLedgerStore';
import {useRecordDetailsStore} from '../stores/useRecordDetailsStore';
import {getSupabase} from '../lib/db/client';
import {setComponentWorkspace,markComponentCollectionsLoaded} from './helpers/componentFixtures';
import type {Customer} from '../types';

const realFetch=globalThis.fetch;
const customer=(id:string,expires?:unknown,number:unknown='אישור EX-1'):Customer=>({id,uid:'test-user',workspaceId:'component-workspace',name:`לקוח ${id}`,metadata:{taxExemption:{number,...(expires===undefined?{}:{expires})}}});
beforeEach(()=>{setComponentWorkspace();markComponentCollectionsLoaded('customers');useLedgerStore.setState({customers:[],truncatedCollections:{}});globalThis.fetch=async()=>new Response(JSON.stringify([]),{headers:{'content-type':'application/json'}});});
afterEach(async()=>{cleanup();globalThis.fetch=realFetch;useRecordDetailsStore.getState().close();getSupabase().realtime.disconnect();await getSupabase().auth.dispose();});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('the 30-calendar-day window is inclusive across leap February and preserves Hebrew identities',()=>{
  const data=[customer('late','2024-03-03'),customer('past','2024-01-31'),customer('end','2024-03-02'),customer('today','2024-02-01'),customer('leap','2024-02-29')];
  const before=JSON.stringify(data),report=customerTaxCertificates(data,'component-workspace','2024-02-01');
  assert.deepEqual(report.rows.map(row=>[row.id,row.state]),[['today','Expiring within 30 days'],['leap','Expiring within 30 days'],['end','Expiring within 30 days'],['past','Expired'],['late','Current by recorded date']]);
  assert.equal(report.rows[0].number,'אישור EX-1');assert.equal(JSON.stringify(data),before);
});
test('missing, unreadable and invalid stored expiries stay distinct from a current certificate',()=>{
  const report=customerTaxCertificates([customer('none'),customer('bad','2024-02-30'),customer('type',12),customer('number','2024-03-03',' '),{...customer('missing'),metadata:{}},{...customer('foreign'),workspaceId:'other'}],'component-workspace','2024-02-01');
  assert.equal(report.missing,1);assert.equal(report.rows.length,4);
  assert.equal(report.rows.find(row=>row.id==='none')?.state,'No expiry recorded');
  assert.equal(report.rows.find(row=>row.id==='bad')?.state,'Needs review');assert.equal(report.rows.find(row=>row.id==='bad')?.expires,'2024-02-30');
  assert.equal(report.rows.find(row=>row.id==='type')?.state,'Needs review');assert.equal(report.rows.find(row=>row.id==='type')?.expires,'12');assert.equal(report.rows.find(row=>row.id==='number')?.state,'Needs review');
  assert.throws(()=>customerTaxCertificates([],'component-workspace','2024-02-30'),/real assessment day/);
});
test('read refusal retains the preview, retry reads the workspace completely and changing details invalidates export',async()=>{
  const preview=customer('preview');useLedgerStore.setState({customers:[preview]});render(<CustomerTaxCertificatesView/>);
  const exportButton=screen.getByRole('button',{name:'Export CSV'}) as HTMLButtonElement;assert.equal(exportButton.disabled,true);
  globalThis.fetch=async()=>response({message:'Refused'},403);fireEvent.click(screen.getByRole('button',{name:'Refresh complete customers'}));
  await screen.findByRole('alert');assert.ok(screen.getByText('לקוח preview'));assert.equal(exportButton.disabled,true);
  const full=customer('full','2099-01-01'),requests:string[]=[];let release:(value:Response)=>void=()=>{};
  globalThis.fetch=async input=>{const request=String(input);requests.push(request);const offset=Number(new URL(request).searchParams.get('offset'));if(offset>0)return response(offset===1000?[{id:full.id,data:full}]:[]);return new Promise<Response>(resolve=>{release=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete customers'}));await waitFor(()=>assert.equal(requests.length,1));
  assert.match(decodeURIComponent(requests[0]),/workspace_id=eq\.component-workspace/);assert.equal(new URL(requests[0]).searchParams.get('limit'),'1000');
  assert.equal(exportButton.disabled,true);assert.equal((screen.getByRole('button',{name:'Refreshing…'}) as HTMLButtonElement).disabled,true);
  // A full transport page must cause a second read, not silently become a 1000-row list.
  const firstPage=Array.from({length:1000},(_,index)=>({id:`row-${index}`,data:{...customer(`row-${index}`),metadata:{}}}));
  await act(async()=>release(response(firstPage)));
  assert.ok(requests.some(request=>new URL(request).searchParams.get('offset')==='1000'));assert.ok(requests.every(request=>new URL(request).searchParams.get('workspace_id')==='eq.component-workspace'));
  await waitFor(()=>assert.equal(exportButton.disabled,false));assert.ok(screen.getByText('לקוח full'));assert.equal(screen.queryByText('לקוח preview'),null);
  act(()=>useLedgerStore.setState({customers:[{...preview,name:'שם Edited'}]}));
  assert.equal(exportButton.disabled,true);assert.ok(screen.getByText('לקוח full'));assert.ok(screen.getByText(/changed since the last complete read/));
  const edited={...full,name:'שם Edited'};globalThis.fetch=async()=>response([{id:edited.id,data:edited}]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete customers'}));await waitFor(()=>assert.equal(exportButton.disabled,false));assert.ok(screen.getByText('שם Edited'));
});
test('customer detail action opens the exact related record without leaving the certificate list',()=>{
  useLedgerStore.setState({customers:[customer('לקוח-1')]});render(<CustomerTaxCertificatesView/>);
  const row=within(screen.getByRole('table')).getAllByRole('row')[1];fireEvent.click(within(row).getByRole('button',{name:'Edit selected record details'}));
  assert.deepEqual(useRecordDetailsStore.getState().target,{kind:'customers',id:'לקוח-1'});
  assert.ok(screen.getByRole('region',{name:'Customer tax certificates'}));
});
test('an old workspace response cannot populate the next workspace or enable its CSV',async()=>{
  const workspace=useAuthStore.getState().getCurrentWorkspace()!;render(<CustomerTaxCertificatesView/>);
  let started=false;let release:(value:Response)=>void=()=>{};globalThis.fetch=async()=>{started=true;return new Promise<Response>(resolve=>{release=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete customers'}));await waitFor(()=>assert.equal(started,true));
  act(()=>{useLedgerStore.setState({customers:[]});useAuthStore.setState({workspaces:[{...workspace,id:'new'}],currentWorkspaceId:'new'});});
  const old=customer('old');await act(async()=>release(response([{id:old.id,data:old}])));
  assert.equal(screen.queryByText('לקוח old'),null);assert.equal((screen.getByRole('button',{name:'Export CSV'}) as HTMLButtonElement).disabled,true);
});

test('sign-out hides the prior customer cache, and an empty preview is not a complete absence claim',()=>{
  render(<CustomerTaxCertificatesView/>);assert.ok(screen.getByText(/loaded preview/,{exact:false}));
  assert.equal(screen.queryByText(/^No customer certificates are recorded\./),null);
  act(()=>{useLedgerStore.setState({customers:[customer('private')]});useAuthStore.setState({user:null,isGuest:false});});
  assert.ok(screen.getByText('Sign in to review customer certificates.'));assert.equal(screen.queryByText('לקוח private'),null);
});

test('an edit during a complete read leaves its dated response stale until a new refresh',async()=>{
  const before=customer('during',undefined,'EX-1'),after={...before,address:'כתובת חדשה'};
  useLedgerStore.setState({customers:[before]});render(<CustomerTaxCertificatesView/>);
  let started=false;let finish:(result:Response)=>void=()=>{};
  globalThis.fetch=async()=>{started=true;return new Promise<Response>(resolve=>{finish=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete customers'}));await waitFor(()=>assert.equal(started,true));
  act(()=>useLedgerStore.setState({customers:[after]}));await act(async()=>finish(response([{id:before.id,data:before}])));
  const csv=screen.getByRole('button',{name:'Export CSV'}) as HTMLButtonElement;
  assert.equal(csv.disabled,true);assert.ok(screen.getByText(/changed since the last complete read/));
  globalThis.fetch=async()=>response([{id:after.id,data:after}]);fireEvent.click(screen.getByRole('button',{name:'Refresh complete customers'}));
  await waitFor(()=>assert.equal(csv.disabled,false));assert.equal(screen.queryByText(/changed since the last complete read/),null);
});
