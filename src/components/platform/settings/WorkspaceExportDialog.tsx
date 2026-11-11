import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {toast} from 'sonner';
import {useDialog} from '../../../hooks/useDialog';
import {useAuthStore} from '../../../stores/useAuthStore';
import {useLedgerStore} from '../../../stores/useLedgerStore';
import {useLedgerCollections} from '../../../hooks/useLedgerCollections';
import {csvMoney,downloadCsv} from '../../../lib/csvExport';
import {getLocalDateISO} from '../../../lib/utils';
import {validCustomReportPeriod} from '../../../lib/reportCustomPeriod';
import {ledgerExportTable,recordExportTable,bankExportLines,generateQIF,trialBalanceExportTable,type ExportKind,type TrialBalanceLayout} from '../../../lib/workspaceExports';
import {isCashAccount} from '../../../lib/txFilters';
import {generateOFX} from '../../../lib/ofx-exporter';
import {computeGeneralLedger} from '../../../server/reports/computeReports';
import type {ChartAccount,Customer,Vendor,Transaction} from '../../../types';
import { BRAND } from '../../../config/brand';
interface Source {accounts:ChartAccount[];customers:Customer[];vendors:Vendor[];transactions:Transaction[]}
export default function WorkspaceExportDialog({onClose}:{onClose:()=>void}){
 const {dialogProps,titleId}=useDialog(onClose);
 const workspace=useAuthStore(state=>state.currentWorkspaceId),uid=useAuthStore(state=>state.user?.uid),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency)||'USD';
 const scope=`${uid}:${workspace}`,initialScope=useRef(scope);
 const abort=useRef<AbortController|null>(null),pending=useRef(false);
 const [kind,setKind]=useState<ExportKind>('ledger'),[format,setFormat]=useState<'csv'|'ofx'|'qif'>('csv');
 const [startDate,setStartDate]=useState(()=>getLocalDateISO().slice(0,4)+'-01-01'),[endDate,setEndDate]=useState(getLocalDateISO);
 const [accountId,setAccountId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const accounts=useLedgerStore(state=>state.accounts);
 useLedgerCollections('accounts');
 useEffect(()=>{if(scope!==initialScope.current)onClose();},[scope,onClose]);
 useEffect(()=>()=>{abort.current?.abort();},[]);
 const scopedAccounts=accounts.filter(account=>account.workspaceId===workspace);
 const valid=validCustomReportPeriod({startDate,endDate});
 // BD-05: the trial balance is on one date (the "Through" date) in the layout the tax software reads
 const [tbLayout,setTbLayout]=useState<TrialBalanceLayout>('debit-credit');
 const asOfValid=/^\d{4}-\d{2}-\d{2}$/.test(endDate);
 const exportData=async()=>{
  if(pending.current||scope!==initialScope.current)return;
  const auth=useAuthStore.getState(),isGuest=auth.isGuest&&!auth.user;
  if(!workspace||(!isGuest&&!auth.user)){setError('Select a workspace before exporting.');return;}
  if((kind==='ledger'||kind==='bank')&&!valid){setError('Choose a valid period.');return;}
  if(kind==='trial-balance'&&!asOfValid){setError('Choose the date of the trial balance.');return;}
  pending.current=true;setBusy(true);setError('');abort.current=new AbortController();
  const current=()=>!abort.current?.signal.aborted&&`${useAuthStore.getState().user?.uid}:${useAuthStore.getState().currentWorkspaceId}`===initialScope.current;
  try{
   let source:Source,exportCurrency=currency;
   if(isGuest){const state=useLedgerStore.getState();source={accounts:state.accounts,customers:state.customers,vendors:state.vendors,transactions:state.transactions};}
   else{
    const token=await auth.user!.getIdToken();if(!current())return;
    const response=await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace)}/export`,{headers:{Authorization:`Bearer ${token}`},signal:abort.current.signal});
    if(!response.ok)throw new Error('The complete workspace export was refused or unavailable. Try again; no partial file was downloaded.');
    const data:unknown=await response.json();
    if(!data||typeof data!=='object')throw new Error('Invalid workspace export response.');
    const value=data as Record<string,unknown>;
    if(!['accounts','customers','vendors','transactions'].every(key=>Array.isArray(value[key])))throw new Error('The export response is missing record collections.');
    source=value as unknown as Source;
    const metadata=value.metadata as {currency?:unknown}|undefined;
    if(typeof metadata?.currency!=='string'||!/^[A-Za-z]{3}$/.test(metadata.currency))throw new Error('The export response is missing the workspace currency.');
    exportCurrency=metadata.currency.toUpperCase();
   }
   if(!current())return;
   const scoped=<T extends{workspaceId?:string}>(rows:T[])=>rows.filter(row=>row.workspaceId===workspace);
   source={accounts:scoped(source.accounts),customers:scoped(source.customers),vendors:scoped(source.vendors),transactions:scoped(source.transactions)};
   const filename=`${BRAND.fileSlug}-${kind}-${endDate}`;
   if(kind==='trial-balance'){
    const table=trialBalanceExportTable(source.transactions,source.accounts,endDate,tbLayout);
    downloadCsv(filename+'.csv',table.headers,table.rows);
    // a trial balance that does not balance is still downloaded, but never silently
    if(table.debitCents!==table.creditCents)setError(`Downloaded, but debits (${csvMoney(table.debitCents)}) and credits (${csvMoney(table.creditCents)}) differ by ${csvMoney(Math.abs(table.debitCents-table.creditCents))}. Data Health shows the entries that don't balance.`);
   }else if(kind!=='bank'){
    const table=kind==='ledger'?ledgerExportTable(source.transactions,source.accounts,{startDate,endDate},exportCurrency):recordExportTable(source[kind]);
    downloadCsv(filename+'.csv',table.headers,table.rows);
   }else{
    const account=source.accounts.find(row=>row.id===accountId);if(!account)throw new Error('Choose an account included in this workspace export.');
    const lines=bankExportLines(source.transactions,account,{startDate,endDate},exportCurrency);
    const balance=computeGeneralLedger([account],source.transactions,undefined,endDate).accounts[0].endingBalanceCents;
    const text=format==='qif'?generateQIF(lines):generateOFX(lines,{...account,currency:exportCurrency,balanceCents:balance},{startDate,endDate});
    const blob=new Blob([text],{type:'application/octet-stream'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename+'.'+format;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
   }
   toast.success(isGuest?'Demo records exported.':'Complete workspace records exported.');
  }catch(failure){if(current())setError(failure instanceof Error?failure.message:'Export failed.');}
  finally{pending.current=false;if(current())setBusy(false);}
 };
 return createPortal(<div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/50 p-3"><div {...dialogProps} className="w-full max-w-xl max-h-[90dvh] overflow-y-auto bg-[var(--panel)] text-[var(--text)] border rounded-xl p-5 space-y-4"><h2 id={titleId} className="text-xl font-semibold">Export workspace data</h2><p>Signed-in exports read the complete workspace from the server. Demo exports use the demo records. CSV includes UTF-8 with BOM for Hebrew in Excel.</p><label className="block">What to export <select className="block min-h-11 w-full border rounded bg-[var(--panel)]" value={kind} disabled={busy} onChange={event=>{const next=event.target.value as ExportKind;setKind(next);setFormat(next==='bank'?'ofx':'csv');}}><option value="ledger">General ledger — posted lines</option><option value="accounts">Chart of accounts — all fields</option><option value="customers">Customers — all fields</option><option value="vendors">Vendors — all fields</option><option value="bank">One bank account — posted lines</option><option value="trial-balance">Trial balance — for tax software</option></select></label>{(kind==='ledger'||kind==='bank')&&<div className="flex flex-wrap gap-3"><label>From <input className="block min-h-11 border rounded bg-[var(--panel)]" type="date" value={startDate} disabled={busy} onChange={event=>setStartDate(event.target.value)} /></label><label>Through <input className="block min-h-11 border rounded bg-[var(--panel)]" type="date" value={endDate} disabled={busy} onChange={event=>setEndDate(event.target.value)} /></label></div>}{kind==='trial-balance'&&<><div className="flex flex-wrap gap-3"><label>As of <input className="block min-h-11 border rounded bg-[var(--panel)]" type="date" value={endDate} disabled={busy} onChange={event=>setEndDate(event.target.value)} /></label><label>Columns <select className="block min-h-11 border rounded bg-[var(--panel)]" value={tbLayout} disabled={busy} onChange={event=>setTbLayout(event.target.value==='balance'?'balance':'debit-credit')}><option value="debit-credit">Debit and credit</option><option value="balance">One balance (debits positive)</option></select></label></div><p>One row per account with a balance on that day: account number, name, type and the tax line it is mapped to (set on the account), with no totals row, the way tax software imports a trial balance.</p></>}<label className="block">Format <select className="block min-h-11 w-full border rounded bg-[var(--panel)]" value={format} disabled={busy||kind!=='bank'} onChange={event=>setFormat(event.target.value==='qif'?'qif':'ofx')}>{kind==='bank'?<><option value="ofx">OFX</option><option value="qif">QIF</option></>:<option value="csv">CSV</option>}</select></label>{kind==='bank'&&<><label className="block">Bank account <select className="block min-h-11 w-full border rounded bg-[var(--panel)]" value={accountId} disabled={busy} onChange={event=>setAccountId(event.target.value)}><option value="">Choose an account</option>{scopedAccounts.filter(account=>account.type==='asset'&&isCashAccount(account)).map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label><p>One row per posted account line. Bank files use base-currency accounts only; foreign account currency conversion is not represented.</p></>}{kind!=='ledger'&&kind!=='bank'&&kind!=='trial-balance'&&<p>All stored fields are included, with Record JSON preserving nested values and exact types. Import Data currently accepts only its supported fields and creates new identities; this CSV is not a full-fidelity restore. Use the verified JSON backup for restore.</p>}{error&&<p role="alert">{error}</p>}<div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 px-4 border rounded" disabled={busy||((kind==='ledger'||kind==='bank')&&!valid)||(kind==='trial-balance'&&!asOfValid)||(kind==='bank'&&!accountId)} onClick={exportData}>{busy?'Exporting…':'Download export'}</button><button type="button" className="min-h-11 px-4 border rounded" onClick={onClose}>Close</button></div></div></div>,document.body);
}
