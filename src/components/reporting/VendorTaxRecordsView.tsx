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
import { useReportText } from './useReportText';
interface Snapshot {vendors:Vendor[];cache:Vendor[];assessed:string;retrieved:string}

export default function VendorTaxRecordsView(){const uid=useAuthStore(state=>state.user?.uid),workspace=useAuthStore(state=>state.currentWorkspaceId);return <ScopedVendors key={JSON.stringify([uid,workspace])}/>;}
function ScopedVendors(){
  const reportText = useReportText();
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
  if(!uid&&!guest)return <p>{reportText('r.sign-in-to-review-vendor-tax-records', 'Sign in to review vendor tax records.')}</p>;
  if(!workspaceId)return <p>{reportText('r.select-a-workspace-to-review-vendor-tax-records', 'Select a workspace to review vendor tax records.')}</p>;
  return <section aria-label={reportText('r.vendor-tax-records', 'Vendor tax records')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.vendor-tax-records', 'Vendor tax records')}</h2><p>{reportText('r.recorded-tax-vat-identifiers-and-withholding-cer', 'Recorded tax/VAT identifiers and withholding-certificate expiries, assessed on')} {today}{reportText('r.follow-up-rows-appear-first-ids-are-masked-on-sc', '. Follow-up rows appear first. IDs are masked on screen and in CSV.')}</p>
    <p>{reportText('r.a-recorded-id-is-not-a-verified-ein-ssn-or-regis', 'A recorded ID is not a verified EIN, SSN or registration. The saved records do not prove that a signed W-9 was received. Withholding fields may describe Israel or another jurisdiction; this review does not choose rates or change payments.')}</p>
    {!snapshot&&<p role="status">{reportText('r.loaded-vendors-are-a-preview-refresh-the-complet', 'Loaded vendors are a preview. Refresh the complete vendor list before exporting.')}</p>}{loading&&!snapshot&&<p role="status">{reportText('r.loading-vendor-preview', 'Loading vendor preview…')}</p>}{(!uid||guest)&&<p>{reportText('r.sign-in-to-refresh-and-export-the-complete-works', 'Sign in to refresh and export the complete workspace list.')}</p>}
    {snapshot&&<p>{reportText('r.complete-vendor-read-retrieved', 'Complete vendor read retrieved')} {snapshot.retrieved}{reportText('r.expiry-assessed-on', '; expiry assessed on')} {snapshot.assessed} {reportText('r.using-the-current-date-settings', 'using the current date settings.')}</p>}{snapshot&&!confirmed&&<p role="status">{reportText('r.vendor-details-changed-since-the-last-complete-r', 'Vendor details changed since the last complete read. The table retains that dated read; refresh before exporting.')}</p>}{error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!uid||guest} onClick={()=>void refresh()} className="min-h-11 border rounded px-3">{busy?reportText('r.refreshing', 'Refreshing…'):reportText('r.refresh-complete-vendors', 'Refresh complete vendors')}</button><button type="button" disabled={!confirmed||busy||Boolean(error)} onClick={exportCsv} className="min-h-11 border rounded px-3">{reportText('r.export-masked-csv', 'Export masked CSV')}</button></div>
    <div role="region" aria-label={reportText('r.scrollable-vendor-tax-table', 'Scrollable vendor tax table')} tabIndex={0} className="overflow-x-auto">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}<table className="w-full min-w-[760px] text-sm"><caption>{reportText('r.current-vendor-tax-declarations-recorded-expiry', 'Current vendor tax declarations — recorded expiry assessed on')} {today}</caption><thead><tr>{[reportText('r.vendor', 'Vendor'),reportText('r.recorded-country', 'Recorded country'),reportText('r.masked-tax-vat-id', 'Masked Tax/VAT ID'),reportText('r.id-status', 'ID status'),reportText('r.recorded-withholding-expiry', 'Recorded withholding expiry'),reportText('r.certificate-status', 'Certificate status'),reportText('r.follow-up', 'Follow-up'),reportText('r.details', 'Details')].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className={row.certificateState==='Expired'?'bg-red-500/10':''}><th scope="row"><bdi>{row.vendor}</bdi></th><td>{row.country}</td><td><bdi>{row.maskedId||reportText('r.not-recorded', 'Not recorded')}</bdi></td><td>{row.identityStatus}</td><td>{row.expires||reportText('r.not-recorded', 'Not recorded')}</td><td>{row.certificateState}</td><td>{row.reminders.join(' ')||reportText('r.no-follow-up-flagged-in-these-recorded-fields', 'No follow-up flagged in these recorded fields.')}</td><td><RelatedRecordEditButton target={{kind:'vendors',id:row.id}}/></td></tr>)}</tbody></table></div>
    {!loading&&rows.length===0&&<p>{confirmed?reportText('r.no-vendors-are-recorded-add-a-vendor-then-record', 'No vendors are recorded. Add a vendor, then record its tax/VAT identifier and any withholding certificate in the vendor editor.'):reportText('r.no-vendors-appear-in-the-loaded-view-refresh-the', 'No vendors appear in the loaded view. Refresh the complete vendor list before concluding that none are recorded.')}</p>}
  </section>;
}
