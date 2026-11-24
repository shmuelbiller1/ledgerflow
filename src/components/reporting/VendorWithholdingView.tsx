import { RowTable } from '../ui/RowTable';
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
import ReportEmptyState from './ReportEmptyState';
import type {Payment} from '../../types';
import { useReportText } from './useReportText';

interface Snapshot {payments:Payment[];cache:Payment[];retrieved:string}
export default function VendorWithholdingView(){
  const uid=useAuthStore(state=>state.user?.uid),workspace=useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedReport key={JSON.stringify([uid,workspace])}/>;
}
function ScopedReport(){
  const reportText = useReportText();
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
  if(!uid&&!guest)return <p>{reportText('r.sign-in-to-review-vendor-withholding', 'Sign in to review vendor withholding.')}</p>;
  if(!workspaceId)return <p>{reportText('r.select-a-workspace-to-review-vendor-withholding', 'Select a workspace to review vendor withholding.')}</p>;
  return <section aria-label={reportText('r.vendor-withholding', 'Vendor withholding')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.vendor-withholding-by-month', 'Vendor withholding by month')}</h2>
    <p>{reportText('r.posted-vendor-payments-grouped-by-vendor-and-pay', 'Posted vendor payments grouped by vendor and payment currency. Vendor paid is the gross settlement less the saved withholding amount, in that payment currency; foreign-currency bank conversion is outside this report. No total mixes currencies.')}</p>
    <p>{reportText('r.certificate-references-and-names-come-from-the-s', 'Certificate references and names come from the saved payments, not today\'s vendor certificate. Missing withholding fields contribute no recorded withholding. This is a recorded-payment review, not verification of tax eligibility or a filing-ready return.')}</p>
    <label className="block">{reportText('r.payment-month', 'Payment month')} <input type="month" value={month} onChange={event=>setMonth(event.target.value)} className="min-h-11 border rounded px-3"/></label>{!valid&&<p role="alert">{reportText('r.choose-a-real-calendar-month', 'Choose a real calendar month.')}</p>}
    {!snapshot&&<p role="status">{reportText('r.loaded-payments-are-an-incomplete-preview-refres', 'Loaded payments are an incomplete preview. Refresh complete payment history before exporting.')}</p>}{loading&&!snapshot&&<p role="status">{reportText('r.loading-payment-preview', 'Loading payment preview…')}</p>}{(!uid||guest)&&<p>{reportText('r.sign-in-to-refresh-and-export-complete-payment-h', 'Sign in to refresh and export complete payment history.')}</p>}
    {snapshot&&<p>{reportText('r.complete-payment-read-retrieved', 'Complete payment read retrieved')} {snapshot.retrieved}{reportText('r.selected-month', '; selected month')} {month||reportText('r.not-selected', 'not selected')}.</p>}{snapshot&&!confirmed&&<p role="status">{reportText('r.payments-changed-during-or-after-the-last-comple', 'Payments changed during or after the last complete read. The dated snapshot is retained; refresh before exporting.')}</p>}{error&&<p role="alert">{error}</p>}
    {report.problems.length>0&&<div role="alert"><p>{report.problems.length} {reportText('r.posted-vendor-payments-or-totals-need-review-csv', 'posted vendor payments or totals need review; CSV is unavailable because their month or amounts cannot be included reliably.')}</p><ul>{[...new Set(report.problems)].map(problem=><li key={problem}>{problem}</li>)}</ul></div>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!uid||guest} onClick={()=>void refresh()} className="min-h-11 border rounded px-3">{busy?reportText('r.refreshing', 'Refreshing…'):reportText('r.refresh-complete-payments', 'Refresh complete payments')}</button><button type="button" disabled={!exportable} onClick={exportCsv} className="min-h-11 border rounded px-3">{reportText('r.export-csv', 'Export CSV')}</button></div>
    <div role="region" aria-label={reportText('r.scrollable-vendor-withholding-table', 'Scrollable vendor withholding table')} tabIndex={0} className="overflow-x-auto">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}<RowTable
      caption={<>{reportText('r.recorded-vendor-payments', 'Recorded vendor payments —')} {month||reportText('r.choose-a-month', 'choose a month')}</>}
      captionClassName="py-2 text-start font-semibold"
      tableClassName="report-schedule comparison-report-table w-full min-w-[850px] text-sm"
      bodyClassName=""
      rows={report.rows} rowKey={row => JSON.stringify([row.vendorId,row.month,row.currency])}
      columns={[
        { header: reportText('r.vendor', 'Vendor'), cell: row => <bdi>{row.vendor}</bdi> },
        { header: reportText('r.currency-2', 'Currency'), cell: row => row.currency },
        { header: reportText('r.gross-settlement', 'Gross settlement'), align: 'right', cell: row => <bdi>{formatCurrency(row.settlementCents,row.currency)}</bdi> },
        { header: reportText('r.vendor-paid', 'Vendor paid'), align: 'right', cell: row => <bdi>{formatCurrency(row.paidCents,row.currency)}</bdi> },
        { header: reportText('r.withheld', 'Withheld'), align: 'right', cell: row => <bdi>{formatCurrency(row.withheldCents,row.currency)}</bdi> },
        { header: reportText('r.payments', 'Payments'), align: 'right', cell: row => row.payments },
        { header: reportText('r.saved-certificate-references', 'Saved certificate references'), cell: row => <><bdi>{row.certificates.join('; ')||reportText('r.none-saved', 'None saved')}</bdi>{row.missingReferences>0&&<p>{row.missingReferences} {reportText('r.withholding-payments-have-no-readable-saved-refe', 'withholding payments have no readable saved reference.')}</p>}</> },
        { header: reportText('r.details', 'Details'), cell: row => <RelatedRecordEditButton target={{kind:'vendors',id:row.vendorId}}/> },
      ]} /></div>
    {valid&&!loading&&!report.rows.length&&(payments.length===0
      ? <ReportEmptyState
          title={reportText('r.no-payments-loaded-yet', 'No payments loaded yet')}
          description={reportText('r.this-report-reads-recorded-vendor-payments-recor', 'This report reads the vendor payments in this browser: record or import a vendor payment and it appears here.')}
        />
      : <ReportEmptyState
          title={confirmed
            ? reportText('r.no-posted-vendor-payments-are-recorded-for-this', 'No posted vendor payments are recorded for this month. Choose another month or record a vendor payment through its existing payment editor.')
            : reportText('r.no-posted-vendor-payments-appear-in-this-preview', 'No posted vendor payments appear in this preview for the month. Refresh complete history before concluding that none are recorded.')}
          description={confirmed
            ? reportText('r.choose-another-month-or-record-a-vendor-payment', 'Choose another month, or record a vendor payment through its existing payment editor.')
            : reportText('r.refresh-complete-history-before-concluding-that-none', 'Refresh complete history before concluding that none are recorded.')}
        />)}
  </section>;
}
