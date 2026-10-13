import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {collection,getDocs,query,where} from '../../lib/db/firestore';
import {db} from '../../firebase';
import {formatCurrency,getLocalDateISO} from '../../lib/utils';
import {validWithholdingMonth,vendorWithholdingReport} from '../../lib/vendorWithholdingReport';
import {downloadCsv} from '../../lib/csvExport';
import {RelatedRecordEditButton} from '../common/RecordDetailsLauncher';
import type {Payment} from '../../types';

interface Snapshot {payments:Payment[];cache:Payment[];retrieved:string}
export default function VendorWithholdingView(){
  const uid=useAuthStore(state=>state.user?.uid),workspace=useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedReport key={JSON.stringify([uid,workspace])}/>;
}
function ScopedReport(){
  const uid=useAuthStore(state=>state.user?.uid),workspaceId=useAuthStore(state=>state.currentWorkspaceId),guest=useAuthStore(state=>state.isGuest);
  const currency=useAuthStore(state=>state.workspaces.find(workspace=>workspace.id===state.currentWorkspaceId)?.currency||'USD');
  const payments=useLedgerStore(state=>state.payments),{loading}=useLedgerCollections('payments');
  const [month,setMonth]=useState(()=>getLocalDateISO().slice(0,7)),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),pending=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&useAuthStore.getState().user?.uid===uid&&useAuthStore.getState().currentWorkspaceId===workspaceId;
  const valid=validWithholdingMonth(month),confirmed=snapshot&&snapshot.cache===payments?snapshot:null;
  const report=useMemo(()=>valid?vendorWithholdingReport(snapshot?.payments||payments,workspaceId||'',month,currency):{rows:[],problems:[]},[valid,snapshot,payments,workspaceId,month,currency]);
  async function refresh(){
    if(!uid||!workspaceId||guest||pending.current||!current())return;
    const cacheAtStart=useLedgerStore.getState().payments;pending.current=true;setBusy(true);setError('');
    try{const docs=await getDocs(query(collection(db,'payments'),where('workspaceId','==',workspaceId)));if(current())setSnapshot({payments:docs.docs.map(doc=>({...doc.data(),id:doc.id} as Payment)),cache:cacheAtStart,retrieved:new Date().toISOString()});}
    catch{if(current())setError('Could not read complete payment history. The preview is retained; retry before exporting.');}
    finally{pending.current=false;if(current())setBusy(false);}
  }
  const exportable=Boolean(confirmed&&!busy&&!error&&valid&&!report.problems.length);
  function exportCsv(){if(!exportable||!confirmed||!current())return;downloadCsv(`Vendor_withholding_${month}.csv`,['Month','Vendor','Vendor ID','Currency','Gross settlement (minor units)','Vendor paid (minor units)','Withheld (minor units)','Payments','Saved certificate references','Withholding payments missing references','Retrieved at'],report.rows.map(row=>[row.month,row.vendor,row.vendorId,row.currency,row.settlementCents,row.paidCents,row.withheldCents,row.payments,row.certificates.join('; '),row.missingReferences,confirmed.retrieved]));}
  if(!uid&&!guest)return <p>Sign in to review vendor withholding.</p>;
  if(!workspaceId)return <p>Select a workspace to review vendor withholding.</p>;
  return <section aria-label="Vendor withholding" className="p-4 space-y-4 min-w-0"><h2>Vendor withholding by month</h2>
    <p>Posted vendor payments grouped by vendor and payment currency. Vendor paid is the gross settlement less the saved withholding amount, in that payment currency; foreign-currency bank conversion is outside this report. No total mixes currencies.</p>
    <p>Certificate references and names come from the saved payments, not today's vendor certificate. Missing withholding fields contribute no recorded withholding. This is a recorded-payment review, not verification of tax eligibility or a filing-ready return.</p>
    <label className="block">Payment month <input type="month" value={month} onChange={event=>setMonth(event.target.value)} className="min-h-11 border rounded px-3"/></label>{!valid&&<p role="alert">Choose a real calendar month.</p>}
    {!snapshot&&<p role="status">Loaded payments are an incomplete preview. Refresh complete payment history before exporting.</p>}{loading&&!snapshot&&<p role="status">Loading payment preview…</p>}{(!uid||guest)&&<p>Sign in to refresh and export complete payment history.</p>}
    {snapshot&&<p>Complete payment read retrieved {snapshot.retrieved}; selected month {month||'not selected'}.</p>}{snapshot&&!confirmed&&<p role="status">Payments changed during or after the last complete read. The dated snapshot is retained; refresh before exporting.</p>}{error&&<p role="alert">{error}</p>}
    {report.problems.length>0&&<div role="alert"><p>{report.problems.length} posted vendor payments or totals need review; CSV is unavailable because their month or amounts cannot be included reliably.</p><ul>{[...new Set(report.problems)].map(problem=><li key={problem}>{problem}</li>)}</ul></div>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!uid||guest} onClick={()=>void refresh()} className="min-h-11 border rounded px-3">{busy?'Refreshing…':'Refresh complete payments'}</button><button type="button" disabled={!exportable} onClick={exportCsv} className="min-h-11 border rounded px-3">Export CSV</button></div>
    <div role="region" aria-label="Scrollable vendor withholding table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><caption>Recorded vendor payments — {month||'choose a month'}</caption><thead><tr>{['Vendor','Currency','Gross settlement','Vendor paid','Withheld','Payments','Saved certificate references','Details'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{report.rows.map(row=><tr key={JSON.stringify([row.vendorId,row.month,row.currency])}><th scope="row"><bdi>{row.vendor}</bdi></th><td>{row.currency}</td>{[{field:'settlement',amount:row.settlementCents},{field:'paid',amount:row.paidCents},{field:'withheld',amount:row.withheldCents}].map(({field,amount})=><td key={field}><bdi>{formatCurrency(amount,row.currency)}</bdi></td>)}<td>{row.payments}</td><td><bdi>{row.certificates.join('; ')||'None saved'}</bdi>{row.missingReferences>0&&<p>{row.missingReferences} withholding payments have no readable saved reference.</p>}</td><td><RelatedRecordEditButton target={{kind:'vendors',id:row.vendorId}}/></td></tr>)}</tbody></table></div>
    {valid&&!loading&&!report.rows.length&&<p>{confirmed?'No posted vendor payments are recorded for this month. Choose another month or record a vendor payment through its existing payment editor.':'No posted vendor payments appear in this preview for the month. Refresh complete history before concluding that none are recorded.'}</p>}
  </section>;
}
