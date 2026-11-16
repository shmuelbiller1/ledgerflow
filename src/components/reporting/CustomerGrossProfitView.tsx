import { useReportText } from './useReportText';
import React,{useMemo} from 'react';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {useDataNeedsStore} from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {useServerCustomerGrossProfit} from '../../hooks/useServerProfitability';
import {RangeReportSourceNote} from './RangeReportSourceNote';
import {validCustomReportPeriod} from '../../lib/reportCustomPeriod';
import {formatCurrency} from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
export default function CustomerGrossProfitView({startDate='',endDate='',compareStartDate='',compareEndDate=''}:{startDate?:string;endDate?:string;compareStartDate?:string;compareEndDate?:string}){
  const reportText = useReportText();
 const currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency),truncated=useLedgerStore(state=>state.truncatedCollections),failed=useDataNeedsStore(state=>state.failed);
 const {loading}=useLedgerCollections('customers','invoices','inventory','transactions','accounts');
 const valid=validCustomReportPeriod({startDate,endDate}),compared=validCustomReportPeriod({startDate:compareStartDate,endDate:compareEndDate});
 const current=useServerCustomerGrossProfit(startDate,endDate,valid&&!loading),rows=current.rows;
 const prior=useServerCustomerGrossProfit(compareStartDate,compareEndDate,compared&&!loading);
 const previous=useMemo(()=>new Map(prior.rows.map(row=>[row.id,row.marginCents])),[prior.rows]);
 const keys=['customers','invoices','inventory','transactions','accounts'] as const;
 const listsPartial=keys.some(key=>isCollectionCapped(truncated,key)||failed[key]);
 const partial=(current.source!=='server'||(compared&&prior.source!=='server'))&&listsPartial;
 return <section aria-label={reportText('r.gross-profit-by-customer', 'Gross profit by customer')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.gross-profit-by-customer', 'Gross profit by customer')}</h2><p>{reportText('r.issued-invoice-item-amounts-from', 'Issued invoice item amounts from ')}{startDate} {reportText('r.through', 'through ')}{endDate}{reportText('r.gp-method', ', grouped by customer using the existing Sales by Item calculation. Opening-balance documents and drafts are excluded. Credit notes are outside this invoice-only report. Posted item costs are used where matched; otherwise the existing item-cost fallback is shown as estimated. Margin = sales − cost; margin percent = margin ÷ sales, undefined when sales are zero.')}</p>{loading&&<p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}{partial&&<p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-these-fig', 'Loaded history is incomplete or failed. These figures are provisional.')}</p>}<RangeReportSourceNote source={current.source} testId="customer-gross-profit-source" what={reportText('r.these-figures', 'these figures')}/>{compared&&<RangeReportSourceNote source={prior.source} testId="customer-gross-profit-compare-source" what={reportText('r.the-previous-period-figures', 'the previous-period figures')}/>}<ReportTableScroll><table className="w-full text-sm"><caption>{reportText('r.customer-gross-profit', 'Customer gross profit: ')}{startDate} – {endDate}</caption><thead><tr><th scope="col">{reportText('r.customer', 'Customer')}</th><th scope="col">{reportText('r.sales', 'Sales')}</th><th scope="col">{reportText('r.cost', 'Cost')}</th><th scope="col">{reportText('r.gross-profit', 'Gross profit')}</th><th scope="col">{reportText('r.margin', 'Margin %')}</th><th scope="col">{reportText('r.cost-source', 'Cost source')}</th>{compared&&<th scope="col">{reportText('r.previous-profit-change', 'Previous profit / change')}</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><th scope="row" className="text-left"><bdi>{row.name}</bdi></th><td>{formatCurrency(row.salesCents,currency)}</td><td>{formatCurrency(row.costCents,currency)}</td><td>{formatCurrency(row.marginCents,currency)}</td><td>{row.marginPct===null?'—':`${row.marginPct.toFixed(1)}%`}</td><td>{row.costIsEstimate?reportText('r.includes-estimated-cost', 'Includes estimated cost'):reportText('r.existing-posted-zero-cost', 'Existing posted / zero cost')}</td>{compared&&<td>{formatCurrency(previous.get(row.id)??0,currency)} / {formatCurrency(row.marginCents-(previous.get(row.id)??0),currency)}</td>}</tr>)}</tbody></table>{valid&&!loading&&!rows.length&&<p>{reportText('r.no-issued-invoice-item-activity-in-this-period', 'No issued invoice item activity in this period.')}</p>}</ReportTableScroll></section>;
}
