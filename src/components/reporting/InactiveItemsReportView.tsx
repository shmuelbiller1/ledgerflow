import ReportTableScroll from './ReportTableScroll';
import React,{useMemo,useState} from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { inactiveItemsReport } from '../../lib/inactiveItemsReport';
import { useReportText } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'SKU' } as const;


export default function InactiveItemsReportView({asOfDate='',endDate='',compareEndDate=''}:{asOfDate?:string;endDate?:string;compareEndDate?:string}){
  const reportText = useReportText();
 const items=useLedgerStore(state=>state.inventory),invoices=useLedgerStore(state=>state.invoices),truncated=useLedgerStore(state=>state.truncatedCollections);
 const workspace=useAuthStore(state=>state.currentWorkspaceId),failed=useDataNeedsStore(state=>state.failed);
 const {loading}=useLedgerCollections('inventory','invoices');
 const [threshold,setThreshold]=useState('90');
 const date=asOfDate||endDate,days=Number(threshold);
 const valid=validCustomReportPeriod({startDate:date,endDate:date})&&/^\d+$/.test(threshold)&&Number.isInteger(days)&&days>=1&&days<=36500;
 const rows=useMemo(()=>valid&&!loading?inactiveItemsReport(items.filter(row=>!workspace||row.workspaceId===workspace),invoices.filter(row=>!workspace||row.workspaceId===workspace),date,days):[],[valid,loading,items,invoices,workspace,date,days]);
 const compared=valid&&validCustomReportPeriod({startDate:compareEndDate,endDate:compareEndDate});
 const previous=useMemo(()=>new Map(compared&&!loading?inactiveItemsReport(items.filter(row=>!workspace||row.workspaceId===workspace),invoices.filter(row=>!workspace||row.workspaceId===workspace),compareEndDate,days).map(row=>[row.id,row]):[]),[compared,loading,items,invoices,workspace,compareEndDate,days]);
 return <section aria-label={reportText('r.inactive-items', 'Inactive items')} className="space-y-4 p-4 min-w-0"><h2>{reportText('r.inactive-items-as-of', 'Inactive items as of')} {date}</h2><p>{reportText('r.items-with-no-recorded-positive-quantity-sale-on', 'Items with no recorded positive-quantity sale on an issued invoice for at least the selected number of days. Drafts and later invoices are excluded. Items with no recorded sale or an undated issued sale are identified separately. This reads loaded invoice history, not stock movements.')}</p><label data-print-hide>{reportText('r.days-without-a-sale', 'Days without a sale')} <input type="text" inputMode="numeric" value={threshold} onChange={event=>setThreshold(event.target.value)} aria-invalid={!valid} className="min-h-11 px-3 border rounded bg-[var(--panel)]" /></label>{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-end-date-and-1-36500-whole', 'Choose a valid report end date and 1–36500 whole days.')}</p>}{loading&&<p role="status">{reportText('r.loading-items-and-invoices', 'Loading items and invoices…')}</p>}{(truncated.inventory||truncated.invoices||failed.inventory||failed.invoices)&&<p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-inactivit', 'Loaded history is incomplete or failed. Inactivity cannot be confirmed from these provisional results.')}</p>}<ReportTableScroll><table className="w-full text-sm"><caption>{reportText('r.items-without-a-recent-recorded-sale', 'Items without a recent recorded sale')}</caption><thead><tr><th scope="col">{reportText('r.item', 'Item')}</th><th scope="col">{CODE_NAMES.c0}</th><th scope="col">{reportText('r.last-recorded-sale', 'Last recorded sale')}</th><th scope="col">{reportText('r.days-2', 'Days')}</th><th scope="col">{reportText('r.status', 'Status')}</th>{compared&&<th scope="col">{reportText('r.previous-status-days', 'Previous status / days')}</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><th scope="row" className="text-left"><bdi>{row.name}</bdi></th><td><bdi>{row.sku}</bdi></td><td>{row.lastSaleDate||'—'}</td><td>{row.daysSinceSale??'—'}</td><td>{row.status}</td>{compared&&<td>{previous.get(row.id)?.status||reportText('r.sale-within-threshold', 'Sale within threshold')} / {previous.get(row.id)?.daysSinceSale??'—'}</td>}</tr>)}</tbody></table>{valid&&!loading&&!rows.length&&<p>{reportText('r.no-matching-inactive-items', 'No matching inactive items.')}</p>}</ReportTableScroll></section>;
}
