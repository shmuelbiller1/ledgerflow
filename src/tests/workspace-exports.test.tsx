import './helpers/dom';
import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {render,cleanup,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {ledgerExportTable,recordExportTable,readExportedRecords,bankExportLines,generateQIF,trialBalanceExportTable} from '../lib/workspaceExports';
import {toCsv} from '../lib/csvExport';
import {parseCsv} from '../lib/csv';
import {prepareImport,applyMapping,guessMapping} from '../lib/recordImport';
import {generateOFX} from '../lib/ofx-exporter';
import WorkspaceExportDialog from '../components/platform/settings/WorkspaceExportDialog';
import {useAuthStore} from '../stores/useAuthStore';
import {auth as firebaseAuth} from '../firebase';
import {useLedgerStore} from '../stores/useLedgerStore';
import {makeChartAccount,makeTransaction,makeCustomer,makeVendor} from './fixtures';
const auth=useAuthStore.getState(),ledger=useLedgerStore.getState(),fetchOriginal=globalThis.fetch;

afterEach(()=>{cleanup();(firebaseAuth as unknown as {currentUser:unknown}).currentUser=null;useAuthStore.setState(auth,true);useLedgerStore.setState(ledger,true);globalThis.fetch=fetchOriginal;});
const period={startDate:'2024-02-29',endDate:'2024-03-31'};
test('posted ledger CSV keeps every line, unknown account, boundary dates and exact shared FX',()=>{
 const tx=makeTransaction({date:'2024-02-29',description:'חשבונית #1, A',exchangeRate:2,lines:[{accountId:'acc-1',amountCents:101},{accountId:'missing',amountCents:-101},{accountId:'acc-1',amountCents:5,exchangeRate:3}]});
 const report=ledgerExportTable([tx,makeTransaction({date:'2024-03-31',status:'draft'}),makeTransaction({date:'2024-04-01'})],[makeChartAccount({name:'בנק A'})],period,'ILS');
 assert.equal(report.rows.length,3);assert.deepEqual(report.rows.map(row=>row.slice(8,11)),[['2.02','0.00','ILS'],['0.00','2.02','ILS'],['0.15','0.00','ILS']]);
 const rows=parseCsv('\uFEFF'+toCsv(report.headers,report.rows));assert.equal(rows[1][3],'חשבונית #1, A');assert.equal(rows[2][7],'Unknown account');
 assert.throws(()=>ledgerExportTable([],[],{startDate:'2024-02-30',endDate:'2024-03-31'},'USD'));
});
test('full-field record CSV preserves exact Hebrew, whitespace, formula-like text, booleans, nulls and nested data',()=>{
 const records=[{id:'לקוח/א',name:' לָקוֹח A ',notes:'=SUM(1,2)\nשלום "x"',active:false,address:{city:'ירושלים',line:'א #12'},tags:['Hebrew','עברית'],empty:null,amountCents:-123},{id:'other',name:'Vendor',other:42}];
 const table=recordExportTable(records),csv='\uFEFF'+toCsv(table.headers,table.rows);
 assert.deepEqual(readExportedRecords(csv),records);
 const columns=parseCsv(csv,',');assert.ok(columns[1][columns[0].indexOf('notes')].startsWith("'=SUM"));
 assert.throws(()=>readExportedRecords('name\nA'),/Record JSON/);
 assert.throws(()=>readExportedRecords(toCsv(['Record JSON'],[['[]']])),/Invalid/);
});
test('supported customer/vendor/account fields round trip through the actual Import Data mapping and preparation',()=>{
 for(const [kind,record] of [['customers',makeCustomer({name:'לקוח A',email:'a@example.com',phone:'123',address:'ירושלים #12',notes:'שלום, A'})],['vendors',makeVendor({name:'ספק A',category:'ציוד',is1099:true})],['accounts',makeChartAccount({name:'בנק A',code:'1000',type:'asset',category:'Cash',currency:'ILS'})]] as const){
  const table=recordExportTable([record]),[headers,...rows]=parseCsv('\uFEFF'+toCsv(table.headers,table.rows));
  const prepared=prepareImport(kind,applyMapping(kind,rows,guessMapping(kind,headers)));
  assert.deepEqual(prepared.errors,[]);assert.equal(prepared.records[0].data.name,record.name);
  if(kind==='customers')assert.equal(prepared.records[0].data.notes,'שלום, A');
  if(kind==='vendors')assert.equal(prepared.records[0].data.is1099,true);
  if(kind==='accounts')assert.equal(prepared.records[0].data.currency,'ILS');
 }
});
test('bank files keep repeated posted lines, exact base amounts and English QIF fields with Hebrew text',()=>{
 const account=makeChartAccount({currency:'ILS',type:'asset',category:'Cash'}),tx=makeTransaction({date:'2024-02-29',description:'תשלום A\n#2',exchangeRate:2,lines:[{accountId:account.id,amountCents:100},{accountId:account.id,amountCents:-25},{accountId:'other',amountCents:999}]});
 const lines=bankExportLines([tx,makeTransaction({date:'2024-03-01',status:'draft'})],account,period,'ILS');assert.equal(lines.length,2);assert.notEqual(lines[0].id,lines[1].id);
 const qif=generateQIF(lines);assert.match(qif,/D02\/29\/2024/);assert.match(qif,/T2.00/);assert.match(qif,/T-0.50/);assert.match(qif,/תשלום A #2/);
 const ofx=generateOFX(lines,account);assert.equal((ofx.match(/<STMTTRN>/g)||[]).length,2);assert.match(ofx,/<TRNAMT>-0.50/);
 assert.throws(()=>bankExportLines([tx],{...account,currency:'EUR'},period,'ILS'),/base currency/);
 assert.throws(()=>bankExportLines([tx],{...account,type:'expense'},period,'ILS'),/bank asset/);
});
test('export dialog exposes English choices, refuses invalid dates and keeps bank format separate',()=>{
 useAuthStore.setState({isGuest:true,user:null,currentWorkspaceId:'ws-1'});useLedgerStore.setState({accounts:[makeChartAccount()]});
 render(<WorkspaceExportDialog onClose={()=>{}} />);
 fireEvent.change(screen.getByLabelText('Through'),{target:{value:'2024-02-29'}});fireEvent.change(screen.getByLabelText('From'),{target:{value:'2024-03-01'}});
 assert.equal((screen.getByRole('button',{name:'Download export'}) as HTMLButtonElement).disabled,true);
 fireEvent.change(screen.getByLabelText('What to export'),{target:{value:'customers'}});
 assert.equal((screen.getByLabelText('Format') as HTMLSelectElement).value,'csv');assert.match(screen.getByText(/Import Data currently/).textContent||'',/not a full-fidelity restore/);
 fireEvent.change(screen.getByLabelText('What to export'),{target:{value:'bank'}});assert.equal((screen.getByLabelText('Format') as HTMLSelectElement).value,'ofx');assert.ok(screen.getByLabelText('Bank account'));
});
test('a workspace change closes an open export dialog before stale data can download',()=>{
 useAuthStore.setState({isGuest:true,user:null,currentWorkspaceId:'ws-1'});let closed=0;render(<WorkspaceExportDialog onClose={()=>{closed++;}} />);
 act(()=>useAuthStore.setState({currentWorkspaceId:'ws-2'}));return waitFor(()=>assert.equal(closed,1));
});
test('complete server export refuses duplicate requests and does not fall back on server refusal',async()=>{
 const user={providerId:'password',uid:'u-1',displayName:null,email:null,photoURL:null,emailVerified:true,isAnonymous:false,tenantId:null,providerData:[],metadata:{},getIdToken:async()=> 'test-token',getIdTokenResult:async()=>({token:'test-token',claims:{},expirationTime:'',issuedAtTime:'',signInProvider:null}),reload:async()=>{}};
 // `runCommand` reads the token from the auth singleton, not the store: without this the screen looked
 // signed-in and sent no Authorization header at all
 (firebaseAuth as unknown as {currentUser:unknown}).currentUser=user;
 useAuthStore.setState({isGuest:false,user,currentWorkspaceId:'ws-1'});
 let calls=0,release:(value:Response)=>void=()=>{};
 globalThis.fetch=async(input,options)=>{calls++;assert.equal(String(input),'/api/v1/workspaces/ws-1/export');assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer test-token');return new Promise<Response>(resolve=>{release=resolve;});};
 render(<WorkspaceExportDialog onClose={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Download export'}));await waitFor(()=>assert.equal(calls,1));
 const busy=screen.getByRole('button',{name:'Exporting…'});assert.equal((busy as HTMLButtonElement).disabled,true);fireEvent.click(busy);assert.equal(calls,1);
 await act(async()=>{release(new Response('{}',{status:503}));});await waitFor(()=>assert.match(screen.getByRole('alert').textContent||'',/no partial file was downloaded/));
 assert.equal((screen.getByRole('button',{name:'Download export'}) as HTMLButtonElement).disabled,false);
});

test('OFX declares UTF-8, escapes text markup and records the selected period and balance date',()=>{
 const account=makeChartAccount({currency:'ILS',code:'1<2',balanceCents:200});
 const text=generateOFX([makeTransaction({id:'x<y',date:'2024-02-29',description:'שלום & <NAME>bad',lines:[{accountId:account.id,amountCents:200}]})],account,period);
 assert.match(text,/ENCODING:UTF-8/);assert.match(text,/<ACCTID>1&lt;2/);assert.match(text,/<FITID>x&lt;y/);assert.match(text,/שלום &amp; &lt;NAME&gt;bad/);
 assert.match(text,/<DTSTART>20240229000000/);assert.match(text,/<DTEND>20240331235959/);assert.match(text,/<DTASOF>20240331235959/);
});

// BD-05: the trial balance for tax software
test('trial balance for tax software: one row per account by number, tax line, debit/credit or one balance, no totals row',()=>{
 const accounts=[
  makeChartAccount({id:'cash',code:'1000',name:'Checking',type:'asset',openingBalanceCents:20000}),
  makeChartAccount({id:'sales',code:'4000',name:'Sales',type:'income',taxCategory:'Schedule C: Gross receipts'} as never),
  makeChartAccount({id:'rent',code:'600',name:'Rent',type:'expense',taxCategory:'Schedule C: Rent'} as never),
  makeChartAccount({id:'idle',code:'1500',name:'Idle',type:'asset'}),
 ];
 const ledger=[
  makeTransaction({id:'s',date:'2026-03-05',lines:[{accountId:'cash',accountName:'Checking',amountCents:50000},{accountId:'sales',accountName:'Sales',amountCents:-50000}]}),
  makeTransaction({id:'r',date:'2026-03-31T17:00:00Z',lines:[{accountId:'rent',accountName:'Rent',amountCents:12000},{accountId:'cash',accountName:'Checking',amountCents:-12000}]}),
  makeTransaction({id:'later',date:'2026-04-01',lines:[{accountId:'cash',amountCents:1},{accountId:'sales',amountCents:-1}]}),
  makeTransaction({id:'d',date:'2026-03-10',status:'draft',lines:[{accountId:'cash',amountCents:999},{accountId:'sales',amountCents:-999}]}),
 ];
 const table=trialBalanceExportTable(ledger,accounts,'2026-03-31','debit-credit');
 assert.deepEqual(table.headers,['Account Number','Account Name','Account Type','Tax Line','Debit','Credit']);
 assert.deepEqual(table.rows,[
  ['600','Rent','expense','Schedule C: Rent','120.00','0.00'],
  ['1000','Checking','asset','','580.00','0.00'],
  ['4000','Sales','income','Schedule C: Gross receipts','0.00','500.00'],
 ],'numeric account order, the idle account and April left out');
 assert.deepEqual([table.debitCents,table.creditCents],[70000,50000],'the opening balance has no other side here, so this one does not balance');
 const single=trialBalanceExportTable(ledger,accounts,'2026-03-31','balance');
 assert.deepEqual(single.headers.at(-1),'Balance');
 assert.deepEqual(single.rows.map(row=>row.at(-1)),['120.00','580.00','-500.00']);
 assert.throws(()=>trialBalanceExportTable(ledger,accounts,'31/03/2026','balance'),/Choose the date/);
});

test('export dialog: the trial balance asks for one date and the columns',()=>{
 useAuthStore.setState({isGuest:true,user:null,currentWorkspaceId:'ws-1'});useLedgerStore.setState({accounts:[makeChartAccount()]});
 render(<WorkspaceExportDialog onClose={()=>{}} />);
 fireEvent.change(screen.getByLabelText('What to export'),{target:{value:'trial-balance'}});
 assert.ok(screen.getByLabelText('As of'));assert.equal(screen.queryByLabelText('From'),null);
 assert.equal((screen.getByLabelText('Columns') as HTMLSelectElement).value,'debit-credit');
 assert.match(screen.getByText(/the way tax software imports a trial balance/).textContent||'',/no totals row/);
 assert.equal((screen.getByRole('button',{name:'Download export'}) as HTMLButtonElement).disabled,false);
});
