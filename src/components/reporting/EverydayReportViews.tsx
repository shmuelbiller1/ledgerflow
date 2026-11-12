import ReportTableScroll from './ReportTableScroll';
import React, { useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useDataNeedsStore } from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { balanceEntries, opensFromServer } from '../../lib/serverBalances';
import { accountBalancesAsOf, paymentPeriodByInvoiceDate } from '../../lib/everydayReports';
import { validCustomReportPeriod } from '../../lib/reportCustomPeriod';
import { formatCurrency } from '../../lib/utils';
interface Props { startDate?:string; endDate?:string; asOfDate?:string; compareStartDate?:string; compareEndDate?:string }
export function AccountBalancesAsOfView({asOfDate='',endDate='',compareEndDate=''}:Props) {
  const accounts=useLedgerStore(state=>state.accounts),transactions=useLedgerStore(state=>state.transactions);
  const workspace=useAuthStore(state=>state.currentWorkspaceId),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency);
  const truncated=useLedgerStore(state=>state.truncatedCollections),failed=useDataNeedsStore(state=>state.failed);
  const {loading}=useLedgerCollections('accounts','transactions');
  const date=asOfDate||endDate;
  const valid=validCustomReportPeriod({startDate:date,endDate:date});
  const compared=validCustomReportPeriod({startDate:compareEndDate,endDate:compareEndDate});
  const scoped=useMemo(()=>({accounts:accounts.filter(row=>!workspace||row.workspaceId===workspace),transactions:transactions.filter(row=>!workspace||row.workspaceId===workspace)}),[accounts,transactions,workspace]);
  // L-123 step 3c: each date reads the server's balances through the oldest loaded day when it is on or after it
  const serverOpening=useLedgerStore(state=>state.serverOpening);
  const rows=useMemo(()=>valid&&!loading?accountBalancesAsOf(scoped.accounts,balanceEntries(scoped.transactions,serverOpening,date,workspace||undefined),date):[],[valid,loading,scoped,date,serverOpening,workspace]);
  const previous=useMemo(()=>new Map(compared&&!loading?accountBalancesAsOf(scoped.accounts,balanceEntries(scoped.transactions,serverOpening,compareEndDate,workspace||undefined),compareEndDate).map(row=>[row.id,row.cents]):[]),[compared,loading,scoped,compareEndDate,serverOpening,workspace]);
  const serverAsOf=useMemo(()=>opensFromServer(scoped.transactions,serverOpening,date,workspace||undefined)?serverOpening.asOf:'',[scoped,serverOpening,date,workspace]);
  const partial=(['accounts','transactions'] as const).some(key=>(isCollectionCapped(truncated,key)&&!(key==='transactions'&&serverAsOf))||failed[key]);
  return <section aria-label="Account balances as of a date" className="space-y-4 p-4 min-w-0"><h2>Account balances as of {date}</h2><p>Uses the existing general-ledger ending balance, including opening balances and posted activity through this date. Each account retains its existing normal-balance sign and workspace base currency. The report start date does not reset the balance.</p>{serverAsOf&&<p data-testid="balances-asof-source">Balances include every entry through {serverAsOf} as summed by the server, plus the loaded entries after it.</p>}{partial&&<p role="alert">Loaded ledger history is incomplete or failed. These balances are provisional.</p>}{loading&&<p role="status">Loading ledger records…</p>}{!valid&&<p role="alert">Choose a valid report end date.</p>}<ReportTableScroll><table className="w-full text-sm"><caption>Balances at {date}</caption><thead><tr><th scope="col">Code</th><th scope="col">Account</th><th scope="col">Type</th><th scope="col">Balance</th>{compared&&<th scope="col">Previous balance / change</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.code}</td><th scope="row" className="text-left"><bdi>{row.name}</bdi></th><td>{row.type}</td><td className="text-right">{formatCurrency(row.cents,currency)}</td>{compared&&<td className="text-right">{formatCurrency(previous.get(row.id)??0,currency)} / {formatCurrency(row.cents-(previous.get(row.id)??0),currency)}</td>}</tr>)}</tbody></table></ReportTableScroll></section>;
}
export function PaymentPeriodByInvoiceDateView({startDate='',endDate='',compareStartDate='',compareEndDate=''}:Props) {
  const invoices=useLedgerStore(state=>state.invoices),truncated=useLedgerStore(state=>state.truncatedCollections);
  const workspace=useAuthStore(state=>state.currentWorkspaceId),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency);
  const failed=useDataNeedsStore(state=>state.failed);
  const {loading}=useLedgerCollections('invoices');
  const valid=validCustomReportPeriod({startDate,endDate});
  const rows=useMemo(()=>valid&&!loading?paymentPeriodByInvoiceDate(invoices.filter(row=>!workspace||row.workspaceId===workspace),{startDate,endDate}):[],[invoices,workspace,startDate,endDate,valid,loading]);
  const compared=validCustomReportPeriod({startDate:compareStartDate,endDate:compareEndDate});
  const priorRows=useMemo(()=>compared&&!loading?paymentPeriodByInvoiceDate(invoices.filter(row=>!workspace||row.workspaceId===workspace),{startDate:compareStartDate,endDate:compareEndDate}):[],[invoices,workspace,compareStartDate,compareEndDate,compared,loading]);
  const displayRows=[...rows.map(row=>({...row,period:'Current'})),...priorRows.map(row=>({...row,period:'Previous'}))];
  return <section aria-label="Payment period by invoice date" className="space-y-4 p-4 min-w-0"><h2>Payment period by invoice date</h2><p>Invoices issued from {startDate} through {endDate}. Days run from issue to the recorded final payment date. Only fully paid invoices with valid dates are shown; partial payments and missing dates are excluded. A final payment may be after the selected issue period. This is not a payment-weighted average.</p>{(truncated.invoices||failed.invoices)&&<p role="alert">Loaded invoice history is incomplete or failed. These results are provisional.</p>}{loading&&<p role="status">Loading invoices…</p>}{!valid&&<p role="alert">Choose a valid report period.</p>}<ReportTableScroll><table className="w-full text-sm"><caption>Settlement days for invoices issued in the selected period</caption><thead><tr>{compared&&<th scope="col">Issue period</th>}<th scope="col">Invoice · issue → paid</th><th scope="col">Invoice amount</th><th scope="col">Days to pay</th></tr></thead><tbody>{displayRows.map(row=><tr key={`${row.period}:${row.id}`}>{compared&&<td>{row.period}</td>}<th scope="row" className="text-left"><bdi>{row.label}</bdi></th><td className="text-right">{formatCurrency(row.cents,currency)}</td><td className="text-right">{row.days}</td></tr>)}</tbody></table>{valid&&!loading&&!rows.length&&<p>No fully paid invoices with recorded dates in this issue period.</p>}</ReportTableScroll></section>;
}
