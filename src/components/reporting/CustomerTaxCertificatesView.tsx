import { useEffect,useMemo,useRef,useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { collection,getDocs,query,where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { getLocalDateISO } from '../../lib/utils';
import { customerTaxCertificates } from '../../lib/customerTaxCertificates';
import { downloadCsv } from '../../lib/csvExport';
import { RelatedRecordEditButton } from '../common/RecordDetailsLauncher';
import type { Customer } from '../../types';

interface Snapshot {customers:Customer[];assessed:string;retrieved:string;cache:Customer[]}
export default function CustomerTaxCertificatesView(){
  const uid=useAuthStore(state=>state.user?.uid), workspace=useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedCertificates key={JSON.stringify([uid,workspace])}/>;
}
function ScopedCertificates(){
  const uid=useAuthStore(state=>state.user?.uid),workspaceId=useAuthStore(state=>state.currentWorkspaceId),guest=useAuthStore(state=>state.isGuest);
  const customers=useLedgerStore(state=>state.customers),{loading}=useLedgerCollections('customers');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&useAuthStore.getState().currentWorkspaceId===workspaceId&&useAuthStore.getState().user?.uid===uid;
  const confirmed=snapshot&&snapshot.cache===customers?snapshot:null;
  const today=snapshot?.assessed||getLocalDateISO();
  // Keep uncached rows and their focused detail buttons mounted after an edit.
  // A changed cache makes this dated read stale, so its CSV stays unavailable.
  const report=useMemo(()=>customerTaxCertificates(snapshot?.customers||customers,workspaceId||'',today),[snapshot,customers,workspaceId,today]);
  async function refresh(){
    if(pending.current||!workspaceId||!uid||guest||!current())return;
    const cacheAtStart=useLedgerStore.getState().customers;
    pending.current=true;setBusy(true);setError('');
    try{
      const docs=await getDocs(query(collection(db,'customers'),where('workspaceId','==',workspaceId)));
      if(current())setSnapshot({customers:docs.docs.map(doc=>({...doc.data(),id:doc.id} as Customer)),assessed:getLocalDateISO(),retrieved:new Date().toISOString(),cache:cacheAtStart});
    }catch{if(current())setError('Could not load the complete customer list. Your preview is retained; retry before exporting.');}
    finally{pending.current=false;if(current())setBusy(false);}
  }
  const exportCsv=()=>{if(!confirmed||busy||error||!current())return;downloadCsv('Customer_tax_certificates.csv',['Customer','Certificate number','Recorded expiry','Recorded status','Review note','Assessment day','Retrieved at'],report.rows.map(row=>[row.customer,row.number,row.expires,row.state,row.problem,today,confirmed.retrieved]));};
  if(!uid&&!guest)return <p>Sign in to review customer certificates.</p>;
  if(!workspaceId)return <p>Select a workspace to review customer certificates.</p>;
  return <section aria-label="Customer tax certificates" className="p-4 space-y-4 min-w-0"><h2>Customer tax certificates</h2>
    <p>Current certificates recorded on customers, with expiry assessed on {today}. Certificates expiring within 30 calendar days appear first. Expired records and unreadable dates are marked for review.</p>
    <p>These are saved declarations, not verified tax exemptions. Missing expiry means no expiry was recorded. This list does not reconstruct historical certificates or change invoice tax.</p>
    {!snapshot&&<p role="status">Loaded customers are a preview. Refresh the complete customer list before exporting.</p>}{loading&&!snapshot&&<p role="status">Loading customer preview…</p>}
    {(!uid||guest)&&<p>Sign in to refresh and export the complete workspace list.</p>}
    {snapshot&&!confirmed&&<p role="status">Customer details changed since the last complete read. The table retains that dated read; refresh before exporting.</p>}
    {snapshot&&<p>Complete customer read retrieved {snapshot.retrieved}; assessed on {snapshot.assessed} using the current date settings.</p>}{error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void refresh()} disabled={busy||!uid||guest||!workspaceId} className="min-h-11 border rounded px-3">{busy?'Refreshing…':'Refresh complete customers'}</button><button type="button" onClick={exportCsv} disabled={!confirmed||busy||Boolean(error)} className="min-h-11 border rounded px-3">Export CSV</button></div>
    <p>{report.missing} customers have no recorded certificate and are outside this list.</p>
    <div role="region" aria-label="Scrollable certificate table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><caption>Current customer certificates — recorded expiry assessed on {today}</caption><thead><tr>{['Customer','Certificate number','Recorded expiry','Recorded status','Details'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{report.rows.map(row=><tr key={row.id} className={row.state==='Expired'?'bg-red-500/10':''}><th scope="row"><bdi>{row.customer}</bdi></th><td><bdi>{row.number||'Not readable'}</bdi></td><td><bdi>{row.expires||'Not recorded'}</bdi></td><td>{row.state}{row.problem&&<p>{row.problem}</p>}</td><td><RelatedRecordEditButton target={{kind:'customers',id:row.id}}/></td></tr>)}</tbody></table></div>
    {!loading&&report.rows.length===0&&<p>{confirmed?'No customer certificates are recorded. Add the certificate number and expiry in the customer editor, then refresh this list.':snapshot?'No certificates appeared in the last complete read; customer details have changed since then. Refresh to review current records.':'No certificates appear in the loaded preview. Refresh the complete customer list before concluding that none are recorded.'}</p>}
  </section>;
}
