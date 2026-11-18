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
import { useReportText } from './useReportText';
import { RowTable } from '../ui/RowTable';
interface Props { startDate?:string; endDate?:string; asOfDate?:string; compareStartDate?:string; compareEndDate?:string }
export function AccountBalancesAsOfView({asOfDate='',endDate='',compareEndDate=''}:Props) {
  const reportText = useReportText();
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
  return <section aria-label={reportText('r.account-balances-as-of-a-date', 'Account balances as of a date')} className="space-y-4 p-4 min-w-0"><h2>{reportText('r.account-balances-as-of', 'Account balances as of')} {date}</h2><p>{reportText('r.uses-the-existing-general-ledger-ending-balance', 'Uses the existing general-ledger ending balance, including opening balances and posted activity through this date. Each account retains its existing normal-balance sign and workspace base currency. The report start date does not reset the balance.')}</p>{serverAsOf&&<p data-testid="balances-asof-source">{reportText('r.balances-include-every-entry-through', 'Balances include every entry through')} {serverAsOf} {reportText('r.as-summed-by-the-server-plus-the-loaded-entries', 'as summed by the server, plus the loaded entries after it.')}</p>}{partial&&<p role="alert">{reportText('r.loaded-ledger-history-is-incomplete-or-failed-th', 'Loaded ledger history is incomplete or failed. These balances are provisional.')}</p>}{loading&&<p role="status">{reportText('r.loading-ledger-records', 'Loading ledger records…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-end-date', 'Choose a valid report end date.')}</p>}<ReportTableScroll><RowTable
    caption={(<>{reportText('r.balances-at', 'Balances at')} {date}</>)}
    rows={rows}
    rowKey={row => row.id}
    captionClassName=""
    tableClassName="comparison-report-table w-full text-sm"
    headRowClassName=""
    bodyClassName=""
    columns={[
      { header: reportText('r.code', 'Code'), headClassName: "", cell: (row) => row.code },
      { header: reportText('r.account', 'Account'), rowHeader: true, className: "text-start", headClassName: "", cell: (row) => <bdi>{row.name}</bdi> },
      { header: reportText('r.type', 'Type'), headClassName: "", cell: (row) => reportText(`r.account-type.${row.type}`, row.type) },
      { header: reportText('r.balance', 'Balance'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.cents,currency) },
      compared ? { header: reportText('r.previous-balance-change', 'Previous balance / change'), align: 'right', className: "whitespace-nowrap tabular-nums", cellProps: { dir: "ltr" }, headClassName: "", cell: (row) => (<>{formatCurrency(previous.get(row.id)??0,currency)} / {formatCurrency(row.cents-(previous.get(row.id)??0),currency)}</>) } : false,
    ]}
  /></ReportTableScroll></section>;
}
export function PaymentPeriodByInvoiceDateView({startDate='',endDate='',compareStartDate='',compareEndDate=''}:Props) {
  const reportText = useReportText();
  const invoices=useLedgerStore(state=>state.invoices),truncated=useLedgerStore(state=>state.truncatedCollections);
  const workspace=useAuthStore(state=>state.currentWorkspaceId),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency);
  const failed=useDataNeedsStore(state=>state.failed);
  const {loading}=useLedgerCollections('invoices');
  const valid=validCustomReportPeriod({startDate,endDate});
  const rows=useMemo(()=>valid&&!loading?paymentPeriodByInvoiceDate(invoices.filter(row=>!workspace||row.workspaceId===workspace),{startDate,endDate}):[],[invoices,workspace,startDate,endDate,valid,loading]);
  const compared=validCustomReportPeriod({startDate:compareStartDate,endDate:compareEndDate});
  const priorRows=useMemo(()=>compared&&!loading?paymentPeriodByInvoiceDate(invoices.filter(row=>!workspace||row.workspaceId===workspace),{startDate:compareStartDate,endDate:compareEndDate}):[],[invoices,workspace,compareStartDate,compareEndDate,compared,loading]);
  const displayRows=[...rows.map(row=>({...row,period:'Current'})),...priorRows.map(row=>({...row,period:'Previous'}))];
  return <section aria-label={reportText('r.payment-period-by-invoice-date', 'Payment period by invoice date')} className="space-y-4 p-4 min-w-0"><h2>{reportText('r.payment-period-by-invoice-date', 'Payment period by invoice date')}</h2><p>{reportText('r.invoices-issued-from', 'Invoices issued from')} {startDate} {reportText('r.through-2', 'through')} {endDate}{reportText('r.days-run-from-issue-to-the-recorded-final-paymen', '. Days run from issue to the recorded final payment date. Only fully paid invoices with valid dates are shown; partial payments and missing dates are excluded. A final payment may be after the selected issue period. This is not a payment-weighted average.')}</p>{(truncated.invoices||failed.invoices)&&<p role="alert">{reportText('r.loaded-invoice-history-is-incomplete-or-failed-t', 'Loaded invoice history is incomplete or failed. These results are provisional.')}</p>}{loading&&<p role="status">{reportText('r.loading-invoices', 'Loading invoices…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}<ReportTableScroll><RowTable
    caption={reportText('r.settlement-days-for-invoices-issued-in-the-selec', 'Settlement days for invoices issued in the selected period')}
    rows={displayRows}
    rowKey={row => `${row.period}:${row.id}`}
    captionClassName=""
    tableClassName="comparison-report-table w-full text-sm"
    headRowClassName=""
    bodyClassName=""
    columns={[
      compared ? { header: reportText('r.issue-period', 'Issue period'), headClassName: "", cell: (row) => row.period === 'Current' ? reportText('r.period-current', 'Current') : reportText('r.period-previous', 'Previous') } : false,
      { header: reportText('r.invoice-issue-paid', 'Invoice · issue → paid'), rowHeader: true, className: "text-start", headClassName: "", cell: (row) => <bdi>{row.label}</bdi> },
      { header: reportText('r.invoice-amount', 'Invoice amount'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.cents,currency) },
      { header: reportText('r.days-to-pay', 'Days to pay'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => row.days },
    ]}
  />{valid&&!loading&&!rows.length&&<p>{reportText('r.no-fully-paid-invoices-with-recorded-dates-in-th', 'No fully paid invoices with recorded dates in this issue period.')}</p>}</ReportTableScroll></section>;
}
