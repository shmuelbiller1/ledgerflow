import ReportTableScroll from './ReportTableScroll';
import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { partyPeriodSummary, type PartyPeriodRow } from '../../lib/partyPeriodSummary';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { normalizeSearchText } from '../../lib/textNormalization';
import { formatCurrency } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { useReportText } from './useReportText';
interface Props { startDate?: string; endDate?: string; compareStartDate?: string; compareEndDate?: string }
const columnsFor = (reportText: ReturnType<typeof useReportText>): {key: keyof Omit<PartyPeriodRow,'id'|'name'>; label:string}[] => [{key:'openingCents',label:reportText('r.opening-2', 'Opening')},{key:'invoicedCents',label:reportText('r.invoiced-billed', 'Invoiced / billed')},{key:'paidCents',label:reportText('r.paid', 'Paid')},{key:'creditedCents',label:reportText('r.credited-net-refunds', 'Credited (net refunds)')},{key:'closingCents',label:reportText('r.closing', 'Closing')}];
function PartyPeriodSummaryView({kind,startDate='',endDate='',compareStartDate='',compareEndDate=''}: Props & {kind:'customer'|'vendor'}) {
  const reportText = useReportText();
  const columns = columnsFor(reportText);
  const workspace = useAuthStore(state => state.currentWorkspaceId);
  const currency = useAuthStore(state => state.getCurrentWorkspace()?.currency);
  const customers=useLedgerStore(state=>state.customers),vendors=useLedgerStore(state=>state.vendors);
  const invoices=useLedgerStore(state=>state.invoices),bills=useLedgerStore(state=>state.bills);
  const payments=useLedgerStore(state=>state.payments),creditNotes=useLedgerStore(state=>state.creditNotes),vendorCredits=useLedgerStore(state=>state.vendorCredits);
  const truncated=useLedgerStore(state=>state.truncatedCollections),failed=useDataNeedsStore(state=>state.failed);
  const {loading}=useLedgerCollections('customers','vendors','invoices','bills','payments','creditNotes','vendorCredits');
  const [search,setSearch]=useState('');
  const period={startDate,endDate},compare={startDate:compareStartDate,endDate:compareEndDate};
  const valid=validCustomReportPeriod(period),compared=validCustomReportPeriod(compare);
  const input=useMemo(()=>{
    const scoped=<T extends {workspaceId?:string}>(rows:T[])=>rows.filter(row=>!workspace || row.workspaceId===workspace);
    return {customers:scoped(customers),vendors:scoped(vendors),invoices:scoped(invoices),bills:scoped(bills),payments:scoped(payments),creditNotes:scoped(creditNotes),vendorCredits:scoped(vendorCredits),baseCurrency:currency || 'USD'};
  },[customers,vendors,invoices,bills,payments,creditNotes,vendorCredits,workspace,currency]);
  const rows=useMemo(()=>valid&&!loading?partyPeriodSummary(kind,input,{startDate,endDate}):[],[kind,input,valid,loading,startDate,endDate]);
  const previous=useMemo(()=>new Map(compared&&!loading?partyPeriodSummary(kind,input,{startDate:compareStartDate,endDate:compareEndDate}).map(row=>[row.id,row.closingCents]):[]),[kind,input,compared,loading,compareStartDate,compareEndDate]);
  const visible=rows.filter(row=>normalizeSearchText(row.name).includes(normalizeSearchText(search)));
  const keys=kind==='customer'?(['customers','invoices','payments','creditNotes'] as const):(['vendors','bills','payments','vendorCredits'] as const);
  const partial=keys.some(key=>isCollectionCapped(truncated,key)||failed[key]);
  const title=kind==='customer'?'Customer period ledger summary':'Supplier period ledger summary';
  const exportRows=()=>{if(partial||loading||!valid)return;downloadCsv(`${kind}_period_${startDate}_${endDate}.csv`,['Party',...columns.map(column=>column.label)],visible.map(row=>[row.name,...columns.map(column=>csvMoney(row[column.key]))]));};
  return <section className="space-y-4 p-4 min-w-0" aria-label={title}>
    <h2 className="text-lg font-semibold">{title}</h2>
    <p>{reportText('r.opening-is-the-existing-balance-at-the-end-of-th', 'Opening is the existing balance at the end of the day before')} {startDate}{reportText('r.movements-run-through', '. Movements run through')} {endDate}{reportText('r.inclusive-closing-opening-invoiced-billed-paid-c', ', inclusive. Closing = opening + invoiced/billed − paid − credits net of refunds. All amounts use the workspace base currency.')}</p>
    <p className="text-sm text-[var(--muted)]">{reportText('r.uses-existing-document-statuses-payment-attribut', 'Uses existing document statuses, payment attribution and FX rules. Undated documents follow the existing balance-summary rules; this is document settlement activity, not a bank cash-flow statement.')}</p>
    {loading&&<p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p>}
    {partial&&<p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-these-fig-2', 'Loaded history is incomplete or failed. These figures are provisional; CSV export is disabled.')}</p>}
    {!valid&&<p role="alert">{reportText('r.choose-a-valid-period-in-the-report-controls', 'Choose a valid period in the report controls.')}</p>}
    <div data-print-hide className="flex flex-wrap gap-3"><label>{reportText('r.search-party', 'Search party')} <input value={search} onChange={event=>setSearch(event.target.value)} className="min-h-11 border rounded px-3 bg-[var(--panel)]" /></label><button type="button" disabled={partial||loading||!valid} onClick={exportRows} className="min-h-11 border rounded px-3">{reportText('r.export-csv', 'Export CSV')}</button></div>
    {valid&&!loading&&<ReportTableScroll><table className="w-full text-sm"><caption>{title}: {startDate} – {endDate}</caption><thead><tr><th scope="col">{reportText('r.party', 'Party')}</th>{columns.map(column=><th scope="col" key={column.key}>{column.label}</th>)}{compared&&<th scope="col">{reportText('r.previous-closing-change', 'Previous closing / change')}</th>}</tr></thead><tbody>{visible.map(row=><tr key={row.id}><th scope="row" className="text-left"><bdi>{row.name}</bdi></th>{columns.map(column=><td className="text-right tabular-nums" key={column.key}>{formatCurrency(row[column.key],currency)}</td>)}{compared&&<td className="text-right">{formatCurrency(previous.get(row.id)??0,currency)} / {formatCurrency(row.closingCents-(previous.get(row.id)??0),currency)}</td>}</tr>)}</tbody></table>{!visible.length&&<p>{reportText('r.no-matching-parties', 'No matching parties.')}</p>}</ReportTableScroll>}
  </section>;
}
export function CustomerPeriodSummaryView(props:Props){return <PartyPeriodSummaryView {...props} kind="customer" />;}
export function SupplierPeriodSummaryView(props:Props){return <PartyPeriodSummaryView {...props} kind="vendor" />;}
