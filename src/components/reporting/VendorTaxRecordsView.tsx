import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuthStore} from '../../stores/useAuthStore';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {collection,getDocs,query,where} from '../../lib/db/firestore';
import {db} from '../../firebase';
import {getLocalDateISO} from '../../lib/utils';
import {vendorTaxRecords} from '../../lib/vendorTaxRecords';
import {downloadCsv} from '../../lib/csvExport';
import {RelatedRecordEditButton} from '../common/RecordDetailsLauncher';
import type {Vendor} from '../../types';
interface Snapshot {vendors:Vendor[];cache:Vendor[];assessed:string;retrieved:string}

export default function VendorTaxRecordsView(){const uid=useAuthStore(state=>state.user?.uid),workspace=useAuthStore(state=>state.currentWorkspaceId);return <ScopedVendors key={JSON.stringify([uid,workspace])}/>;}
function ScopedVendors(){
  const uid=useAuthStore(state=>state.user?.uid),workspaceId=useAuthStore(state=>state.currentWorkspaceId),guest=useAuthStore(state=>state.isGuest);
  const vendors=useLedgerStore(state=>state.vendors),{loading}=useLedgerCollections('vendors');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),pending=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&useAuthStore.getState().user?.uid===uid&&useAuthStore.getState().currentWorkspaceId===workspaceId;
  const confirmed=snapshot&&snapshot.cache===vendors?snapshot:null,today=snapshot?.assessed||getLocalDateISO();
  const rows=useMemo(()=>vendorTaxRecords(snapshot?.vendors||vendors,workspaceId||'',today),[snapshot,vendors,workspaceId,today]);
  async function refresh(){
    if(!uid||!workspaceId||guest||pending.current||!current())return;
    const cacheAtStart=useLedgerStore.getState().vendors;
    pending.current=true;setBusy(true);setError('');
    try{const docs=await getDocs(query(collection(db,'vendors'),where('workspaceId','==',workspaceId)));if(current())setSnapshot({vendors:docs.docs.map(doc=>({...doc.data(),id:doc.id} as Vendor)),cache:cacheAtStart,assessed:getLocalDateISO(),retrieved:new Date().toISOString()});}
    catch{if(current())setError('Could not read the complete vendor list. The preview is retained; retry before exporting.');}
    finally{pending.current=false;if(current())setBusy(false);}
  }
  function exportCsv(){if(!confirmed||busy||error||!current())return;downloadCsv('Vendor_tax_records_masked.csv',['Vendor','Recorded country','Masked Tax/VAT ID','ID status','Recorded withholding expiry','Certificate status','Follow-up','Assessment day','Retrieved at'],rows.map(row=>[row.vendor,row.country,row.maskedId,row.identityStatus,row.expires,row.certificateState,row.reminders.join('; '),today,confirmed.retrieved]));}
  if(!uid&&!guest)return <p>Sign in to review vendor tax records.</p>;
  if(!workspaceId)return <p>Select a workspace to review vendor tax records.</p>;
  return <section aria-label="Vendor tax records" className="p-4 space-y-4 min-w-0"><h2>Vendor tax records</h2><p>Recorded tax/VAT identifiers and withholding-certificate expiries, assessed on {today}. Follow-up rows appear first. IDs are masked on screen and in CSV.</p>
    <p>A recorded ID is not a verified EIN, SSN or registration. The saved records do not prove that a signed W-9 was received. Withholding fields may describe Israel or another jurisdiction; this review does not choose rates or change payments.</p>
    {!snapshot&&<p role="status">Loaded vendors are a preview. Refresh the complete vendor list before exporting.</p>}{loading&&!snapshot&&<p role="status">Loading vendor preview…</p>}{(!uid||guest)&&<p>Sign in to refresh and export the complete workspace list.</p>}
    {snapshot&&<p>Complete vendor read retrieved {snapshot.retrieved}; expiry assessed on {snapshot.assessed} using the current date settings.</p>}{snapshot&&!confirmed&&<p role="status">Vendor details changed since the last complete read. The table retains that dated read; refresh before exporting.</p>}{error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!uid||guest} onClick={()=>void refresh()} className="min-h-11 border rounded px-3">{busy?'Refreshing…':'Refresh complete vendors'}</button><button type="button" disabled={!confirmed||busy||Boolean(error)} onClick={exportCsv} className="min-h-11 border rounded px-3">Export masked CSV</button></div>
    <div role="region" aria-label="Scrollable vendor tax table" tabIndex={0} className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><caption>Current vendor tax declarations — recorded expiry assessed on {today}</caption><thead><tr>{['Vendor','Recorded country','Masked Tax/VAT ID','ID status','Recorded withholding expiry','Certificate status','Follow-up','Details'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className={row.certificateState==='Expired'?'bg-red-500/10':''}><th scope="row"><bdi>{row.vendor}</bdi></th><td>{row.country}</td><td><bdi>{row.maskedId||'Not recorded'}</bdi></td><td>{row.identityStatus}</td><td>{row.expires||'Not recorded'}</td><td>{row.certificateState}</td><td>{row.reminders.join(' ')||'No follow-up flagged in these recorded fields.'}</td><td><RelatedRecordEditButton target={{kind:'vendors',id:row.id}}/></td></tr>)}</tbody></table></div>
    {!loading&&rows.length===0&&<p>{confirmed?'No vendors are recorded. Add a vendor, then record its tax/VAT identifier and any withholding certificate in the vendor editor.':'No vendors appear in the loaded view. Refresh the complete vendor list before concluding that none are recorded.'}</p>}
  </section>;
}
