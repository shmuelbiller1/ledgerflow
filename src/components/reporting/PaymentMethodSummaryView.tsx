import React,{useMemo} from 'react';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {useDataNeedsStore} from '../../stores/useDataNeedsStore';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {useServerOperationalReport,collectionStamp} from '../../hooks/useServerOperationalReport';
import {paymentMethodSummary} from '../../lib/paymentMethodSummary';
import {validCustomReportPeriod} from '../../lib/reportCustomPeriod';
import {formatCurrency} from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import PaymentFlowsByMethodPanel from './PaymentFlowsByMethodPanel';
import { useReportText } from './useReportText';
export default function PaymentMethodSummaryView({startDate='',endDate='',compareStartDate='',compareEndDate=''}:{startDate?:string;endDate?:string;compareStartDate?:string;compareEndDate?:string}){
  const reportText = useReportText();
 const customers=useLedgerStore(state=>state.customers),payments=useLedgerStore(state=>state.payments),truncated=useLedgerStore(state=>state.truncatedCollections),failed=useDataNeedsStore(state=>state.failed);
 const workspace=useAuthStore(state=>state.currentWorkspaceId),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency);
 const {loading}=useLedgerCollections('customers','payments');
 const valid=validCustomReportPeriod({startDate,endDate}),compared=validCustomReportPeriod({startDate:compareStartDate,endDate:compareEndDate});
 const isTruncated=Boolean(truncated.customers||truncated.payments);
 const pmUrl=workspace&&valid?`/api/v1/reports/payment-methods?${new URLSearchParams({workspaceId:workspace,startDate,endDate,...(compared?{compareStartDate,compareEndDate}:{})})}`:'';
 const serverSummary=useServerOperationalReport<{rows:ReturnType<typeof paymentMethodSummary>;previousRows:ReturnType<typeof paymentMethodSummary>}>(
  isTruncated&&valid&&Boolean(workspace),
  pmUrl,
  `${workspace}:${startDate}:${endDate}:${compareStartDate}:${compareEndDate}:${collectionStamp(customers,payments)}`,
  body=>Array.isArray(body.rows)?{rows:body.rows as ReturnType<typeof paymentMethodSummary>,previousRows:Array.isArray(body.previousRows)?(body.previousRows as ReturnType<typeof paymentMethodSummary>):[]}:undefined,
 );
 const scoped=useMemo(()=>({customers:customers.filter(row=>!workspace||row.workspaceId===workspace),payments:payments.filter(row=>!workspace||row.workspaceId===workspace)}),[customers,payments,workspace]);
 const localRows=useMemo(()=>valid&&!loading?paymentMethodSummary(scoped.customers,scoped.payments,{startDate,endDate},currency || 'USD'):[],[scoped,valid,loading,startDate,endDate,currency]);
 const rows=serverSummary?.rows||localRows;
 const previous=useMemo(()=>{
  const prevList=serverSummary?serverSummary.previousRows:(compared&&!loading?paymentMethodSummary(scoped.customers,scoped.payments,{startDate:compareStartDate,endDate:compareEndDate},currency || 'USD'):[]);
  return new Map(prevList.map(row=>[row.id,row.cents]));
 },[serverSummary,scoped,compared,loading,compareStartDate,compareEndDate,currency]);
 return <section aria-label={reportText('r.sales-payment-summary', 'Sales payment summary')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.sales-payment-summary-by-method', 'Sales payment summary by method')}</h2><p>{startDate} – {endDate}{reportText('r.received-customer-payment-documents-grouped-by-t', '. Received customer payment documents, grouped by their stored method using the existing customer-payment report rules and base-currency conversion. Drafts, voids and outgoing payments are excluded. Includes unapplied receipts; this is a receipts summary, not sales revenue or invoice allocation. Undated documents follow the existing report rules and are counted explicitly.')}</p>{loading&&<p role="status">{reportText('r.loading-payments', 'Loading payments…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}{((!serverSummary&&(truncated.customers||truncated.payments))||failed.customers||failed.payments)&&<p role="alert">{reportText('r.loaded-payment-history-is-incomplete-or-failed-t', 'Loaded payment history is incomplete or failed. These figures are provisional.')}</p>}<ReportTableScroll><table className="w-full text-sm"><caption>{reportText('r.customer-receipts-by-method', 'Customer receipts by method:')} {startDate} – {endDate}</caption><thead><tr><th scope="col">{reportText('r.method', 'Method')}</th><th scope="col">{reportText('r.payments', 'Payments')}</th><th scope="col">{reportText('r.received', 'Received')}</th><th scope="col">{reportText('r.undated-included', 'Undated included')}</th>{compared&&<th scope="col">{reportText('r.previous-receipts-change', 'Previous receipts / change')}</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><th scope="row" className="text-left"><bdi>{row.name}</bdi></th><td>{row.count}</td><td>{formatCurrency(row.cents,currency)}</td><td>{row.undated}</td>{compared&&<td>{formatCurrency(previous.get(row.id)??0,currency)} / {formatCurrency(row.cents-(previous.get(row.id)??0),currency)}</td>}</tr>)}</tbody></table>{valid&&!loading&&!rows.length&&<p>{reportText('r.no-received-payment-documents-for-this-period', 'No received payment documents for this period.')}</p>}</ReportTableScroll><PaymentFlowsByMethodPanel payments={payments} workspaceId={workspace||''} homeCurrency={currency||'USD'} startDate={startDate} endDate={endDate} loading={loading} incomplete={Boolean((!serverSummary&&truncated.payments)||failed.payments)} /></section>;
}
