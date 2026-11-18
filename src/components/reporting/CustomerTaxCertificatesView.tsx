import { useEffect,useMemo,useRef,useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { collection,getDocs,query,where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { getLocalDateISO } from '../../lib/utils';
import { customerTaxCertificates } from '../../lib/customerTaxCertificates';
import { taxExemptionOf } from '../../lib/taxExemption';
import {
  certificateTypeName,
  SST_MEMBER_STATES,
  US_EXEMPTION_CERTIFICATE_TYPES,
} from '../../lib/tax/usExemptionCertificates';
import { downloadCsv } from '../../lib/csvExport';
import { RelatedRecordEditButton } from '../common/RecordDetailsLauncher';
import CertificateReminderDrafts from './CertificateReminderDrafts';
import type { Customer } from '../../types';
import { useReportText } from './useReportText';

interface Snapshot {customers:Customer[];assessed:string;retrieved:string;cache:Customer[]}
export default function CustomerTaxCertificatesView(){
  const uid=useAuthStore(state=>state.user?.uid), workspace=useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedCertificates key={JSON.stringify([uid,workspace])}/>;
}
function ScopedCertificates(){
  const reportText = useReportText();
  const uid=useAuthStore(state=>state.user?.uid),workspaceId=useAuthStore(state=>state.currentWorkspaceId),guest=useAuthStore(state=>state.isGuest);
  const workspaceName=useAuthStore(state=>state.workspaces.find(w=>w.id===state.currentWorkspaceId)?.name);
  const customers=useLedgerStore(state=>state.customers),{loading}=useLedgerCollections('customers');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&useAuthStore.getState().currentWorkspaceId===workspaceId&&useAuthStore.getState().user?.uid===uid;
  const confirmed=snapshot&&snapshot.cache===customers?snapshot:null;
  const today=snapshot?.assessed||getLocalDateISO();
  // Keep uncached rows and their focused detail buttons mounted after an edit.
  // A changed cache makes this dated read stale, so its CSV stays unavailable.
  const sourceCustomers=snapshot?.customers||customers;
  const customerById=useMemo(()=>new Map(sourceCustomers.map(c=>[c.id,c])),[sourceCustomers]);
  const report=useMemo(()=>customerTaxCertificates(sourceCustomers,workspaceId||'',today),[sourceCustomers,workspaceId,today]);
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
  if(!uid&&!guest)return <p>{reportText('r.sign-in-to-review-customer-certificates', 'Sign in to review customer certificates.')}</p>;
  if(!workspaceId)return <p>{reportText('r.select-a-workspace-to-review-customer-certificat', 'Select a workspace to review customer certificates.')}</p>;
  return <section aria-label={reportText('r.customer-tax-certificates', 'Customer tax certificates')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.customer-tax-certificates', 'Customer tax certificates')}</h2>
    <p>{reportText('r.current-certificates-recorded-on-customers-with', 'Current certificates recorded on customers, with expiry assessed on')} {today}{reportText('r.certificates-expiring-within-30-calendar-days-ap', '. Certificates expiring within 30 calendar days appear first. Expired records and unreadable dates are marked for review.')}</p>
    <p>{reportText('r.these-are-saved-declarations-not-verified-tax-ex', 'These are saved declarations, not verified tax exemptions. Missing expiry means no expiry was recorded. This list does not reconstruct historical certificates or change invoice tax.')}</p>
    {!snapshot&&<p role="status">{reportText('r.loaded-customers-are-a-preview-refresh-the-compl', 'Loaded customers are a preview. Refresh the complete customer list before exporting.')}</p>}{loading&&!snapshot&&<p role="status">{reportText('r.loading-customer-preview', 'Loading customer preview…')}</p>}
    {(!uid||guest)&&<p>{reportText('r.sign-in-to-refresh-and-export-the-complete-works', 'Sign in to refresh and export the complete workspace list.')}</p>}
    {snapshot&&!confirmed&&<p role="status">{reportText('r.customer-details-changed-since-the-last-complete', 'Customer details changed since the last complete read. The table retains that dated read; refresh before exporting.')}</p>}
    {snapshot&&<p>{reportText('r.complete-customer-read-retrieved', 'Complete customer read retrieved')} {snapshot.retrieved}{reportText('r.assessed-on', '; assessed on')} {snapshot.assessed} {reportText('r.using-the-current-date-settings', 'using the current date settings.')}</p>}{error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void refresh()} disabled={busy||!uid||guest||!workspaceId} className="min-h-11 border rounded px-3">{busy?reportText('r.refreshing', 'Refreshing…'):reportText('r.refresh-complete-customers', 'Refresh complete customers')}</button><button type="button" onClick={exportCsv} disabled={!confirmed||busy||Boolean(error)} className="min-h-11 border rounded px-3">{reportText('r.export-csv', 'Export CSV')}</button></div>
    <p>{report.missing} {reportText('r.customers-have-no-recorded-certificate-and-are-o', 'customers have no recorded certificate and are outside this list.')}</p>
    <div role="region" aria-label={reportText('r.scrollable-certificate-table', 'Scrollable certificate table')} tabIndex={0} className="overflow-x-auto">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}<table className="w-full min-w-[640px] text-sm"><caption>{reportText('r.current-customer-certificates-recorded-expiry-as', 'Current customer certificates — recorded expiry assessed on')} {today}</caption><thead><tr>{['Customer','Certificate number','Recorded expiry','Recorded status','Details'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{report.rows.map(row=>{const recordedType=certificateTypeName(taxExemptionOf(customerById.get(row.id))?.type);return <tr key={row.id} className={row.state==='Expired'?'bg-red-500/10':''}><th scope="row"><bdi>{row.customer}</bdi></th><td><bdi>{row.number||reportText('r.not-readable', 'Not readable')}</bdi>{recordedType?<span className="ml-2 text-xs text-[var(--muted)]">({recordedType})</span>:null}</td><td><bdi>{row.expires||reportText('r.not-recorded', 'Not recorded')}</bdi></td><td>{row.state}{row.problem&&<p>{row.problem}</p>}</td><td><RelatedRecordEditButton target={{kind:'customers',id:row.id}}/></td></tr>;})}</tbody></table></div>
    {!loading&&report.rows.length===0&&<p>{confirmed?reportText('r.no-customer-certificates-are-recorded-add-the-ce', 'No customer certificates are recorded. Add the certificate number and expiry in the customer editor, then refresh this list.'):snapshot?reportText('r.no-certificates-appeared-in-the-last-complete-re', 'No certificates appeared in the last complete read; customer details have changed since then. Refresh to review current records.'):reportText('r.no-certificates-appear-in-the-loaded-preview-ref', 'No certificates appear in the loaded preview. Refresh the complete customer list before concluding that none are recorded.')}</p>}
    <CertificateReminderDrafts
      rows={report.rows.map(row => ({ id: row.id, customer: row.customer, number: row.number, expires: row.expires, state: row.state, email: (customerById.get(row.id) as { email?: string } | undefined)?.email }))}
      today={today}
      entityName={workspaceName}
      emailsTrusted={Boolean(confirmed)}
    />
    <details className="text-xs text-[var(--muted)] space-y-2 pt-2 border-t border-[var(--line)]">
      <summary className="cursor-pointer font-medium text-[var(--text)]">{reportText('r.us-sales-tax-exemption-certificate-types-multist', 'US sales-tax exemption certificate types & multistate forms (reference)')}</summary>
      <p>{reportText('r.streamlined-sales-tax-sst-full-member-states', 'Streamlined Sales Tax (SST) full member states (')}{SST_MEMBER_STATES.length}): {SST_MEMBER_STATES.join(', ')}{reportText('r.each-state-s-own-instructions-govern-which-certi', '. Each state’s own instructions govern which certificates it accepts.')}</p>
      <dl className="space-y-1">
        {US_EXEMPTION_CERTIFICATE_TYPES.map(t=>(
          <div key={t.id}>
            <dt className="font-medium text-[var(--text)] inline">{t.name} ({t.id}): </dt>
            <dd className="inline">{t.whatItClaims} {reportText('r.source-3', '— Source:')} <a href={t.source.url} target="_blank" rel="noopener noreferrer" className="underline">{t.source.authority}</a></dd>
          </div>
        ))}
      </dl>
    </details>
  </section>;
}
