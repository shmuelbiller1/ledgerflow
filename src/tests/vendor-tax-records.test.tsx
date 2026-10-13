import './helpers/dom';
import test,{afterEach,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {vendorTaxRecords,maskRecordedTaxId} from '../lib/vendorTaxRecords';
import VendorTaxRecordsView from '../components/reporting/VendorTaxRecordsView';
import {setComponentWorkspace,markComponentCollectionsLoaded} from './helpers/componentFixtures';
import {useAuthStore} from '../stores/useAuthStore';
import {useLedgerStore} from '../stores/useLedgerStore';
import {getSupabase} from '../lib/db/client';
import type {Vendor} from '../types';
const realFetch=globalThis.fetch;
const vendor=(id:string,metadata:Vendor['metadata']={}):Vendor=>({id,uid:'test-user',workspaceId:'component-workspace',name:`ספק ${id}`,category:'Supplier',metadata});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{setComponentWorkspace();markComponentCollectionsLoaded('vendors');useLedgerStore.setState({vendors:[]});globalThis.fetch=async()=>response([]);});
afterEach(async()=>{cleanup();globalThis.fetch=realFetch;getSupabase().realtime.disconnect();await getSupabase().auth.dispose();});

test('masked tax identifiers never return the full value, including short, invalid and mixed-script inputs',()=>{
  for(const value of ['123456789','12-3456789','123-45-6789','1234','אבג','אישור-מס-123456','unknown']){
    const masked=maskRecordedTaxId(value);assert.ok(masked);assert.notEqual(masked,value);assert.equal(masked.includes(value),false);
  }
  assert.equal(maskRecordedTaxId('123456789'),'••••6789');assert.equal(maskRecordedTaxId('1234'),'••••');assert.equal(maskRecordedTaxId(123456789),'');
});
test('zero-rate declarations, real calendar days, missing fields and country scope do not claim verified W-9 or legal eligibility',()=>{
  const records=[vendor('zero',{vatNumber:'123456789',taxPlace:{country:'IL'},withholding:{ratePercent:0,number:'EX-1',expires:'2024-02-29'}}),vendor('past',{taxPlace:{country:'IL'},withholding:{ratePercent:3,number:'EX-2',expires:'2024-01-31'}}),vendor('bad',{vatNumber:'123',withholding:{ratePercent:0,expires:'2024-02-30'}}),vendor('missing',{taxPlace:{country:'IL'}}),vendor('us',{taxPlace:{country:'US'}}),{...vendor('foreign'),workspaceId:'other'}];
  const original=JSON.stringify(records),rows=vendorTaxRecords(records,'component-workspace','2024-02-01');
  assert.equal(rows.length,5);assert.equal(rows.find(row=>row.id==='zero')?.certificateState,'Expiring within 30 days');
  assert.equal(rows.find(row=>row.id==='zero')?.identityStatus,'Recorded — unverified');assert.equal(rows.find(row=>row.id==='past')?.certificateState,'Expired');
  assert.equal(rows.find(row=>row.id==='bad')?.certificateState,'Needs review');assert.equal(rows.find(row=>row.id==='bad')?.expires,'');
  assert.ok(rows.find(row=>row.id==='missing')?.reminders.some(text=>text.includes('check whether one is required')));
  assert.equal(rows.find(row=>row.id==='us')?.reminders.some(text=>text.includes('Israeli')),false);
  assert.equal(JSON.stringify(rows).includes('123456789'),false);assert.equal(JSON.stringify(records),original);
  assert.throws(()=>vendorTaxRecords([],'component-workspace','2024-02-30'),/real assessment day/);
});
test('a refused refresh retains masked preview and retry alone enables export from the complete read',async()=>{
  const stored=vendor('preview',{vatNumber:'123456789'});useLedgerStore.setState({vendors:[stored]});render(<VendorTaxRecordsView/>);
  const csv=screen.getByRole('button',{name:'Export masked CSV'}) as HTMLButtonElement;assert.equal(csv.disabled,true);assert.equal(document.body.textContent!.includes('123456789'),false);
  globalThis.fetch=async()=>response({message:'Refused'},403);fireEvent.click(screen.getByRole('button',{name:'Refresh complete vendors'}));await screen.findByRole('alert');assert.ok(screen.getByText('ספק preview'));assert.equal(csv.disabled,true);
  let request='';let finish:(result:Response)=>void=()=>{};globalThis.fetch=async input=>{request=String(input);return new Promise<Response>(resolve=>{finish=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete vendors'}));await waitFor(()=>assert.ok(request));assert.equal(new URL(request).searchParams.get('workspace_id'),'eq.component-workspace');assert.equal(csv.disabled,true);
  const full=vendor('full',{vatNumber:'987654321',taxPlace:{country:'IL'}});await act(async()=>finish(response([{id:full.id,data:full}])));
  await waitFor(()=>assert.equal(csv.disabled,false));assert.ok(screen.getByText('ספק full'));assert.equal(document.body.textContent!.includes('987654321'),false);assert.ok(screen.getByText('••••4321'));
  act(()=>useLedgerStore.setState({vendors:[{...full,address:'New address'}]}));assert.equal(csv.disabled,true);assert.ok(screen.getByText(/changed since the last complete read/));assert.ok(screen.getByText('ספק full'));
});
test('old-user responses are discarded and sign-out does not show the prior vendor cache',async()=>{
  render(<VendorTaxRecordsView/>);let started=false;let finish:(result:Response)=>void=()=>{};globalThis.fetch=async()=>{started=true;return new Promise<Response>(resolve=>{finish=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete vendors'}));await waitFor(()=>assert.equal(started,true));
  const privateVendor=vendor('private',{vatNumber:'123456789'});act(()=>{useLedgerStore.setState({vendors:[privateVendor]});useAuthStore.setState({user:null,isGuest:false});});
  await act(async()=>finish(response([{id:privateVendor.id,data:privateVendor}])));assert.ok(screen.getByText('Sign in to review vendor tax records.'));assert.equal(screen.queryByText('ספק private'),null);assert.equal(document.body.textContent!.includes('123456789'),false);
});

test('an edit during a complete read leaves its dated response stale until a new refresh',async()=>{
  const before=vendor('during',{vatNumber:'123456789'}),after={...before,address:'כתובת חדשה'};
  useLedgerStore.setState({vendors:[before]});render(<VendorTaxRecordsView/>);
  let started=false;let finish:(result:Response)=>void=()=>{};
  globalThis.fetch=async()=>{started=true;return new Promise<Response>(resolve=>{finish=resolve;});};
  fireEvent.click(screen.getByRole('button',{name:'Refresh complete vendors'}));await waitFor(()=>assert.equal(started,true));
  act(()=>useLedgerStore.setState({vendors:[after]}));await act(async()=>finish(response([{id:before.id,data:before}])));
  const csv=screen.getByRole('button',{name:'Export masked CSV'}) as HTMLButtonElement;
  assert.equal(csv.disabled,true);assert.ok(screen.getByText(/changed since the last complete read/));
  globalThis.fetch=async()=>response([{id:after.id,data:after}]);fireEvent.click(screen.getByRole('button',{name:'Refresh complete vendors'}));
  await waitFor(()=>assert.equal(csv.disabled,false));assert.equal(screen.queryByText(/changed since the last complete read/),null);
});
