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
import { RowTable } from '../ui/RowTable';
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
 return <section aria-label={reportText('r.gross-profit-by-customer', 'Gross profit by customer')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.gross-profit-by-customer', 'Gross profit by customer')}</h2><p>{reportText('r.issued-invoice-item-amounts-from', 'Issued invoice item amounts from ')}{startDate} {reportText('r.through', 'through ')}{endDate}{reportText('r.gp-method', ', grouped by customer using the existing Sales by Item calculation. Opening-balance documents and drafts are excluded. Credit notes are outside this invoice-only report. Posted item costs are used where matched; otherwise the existing item-cost fallback is shown as estimated. Margin = sales − cost; margin percent = margin ÷ sales, undefined when sales are zero.')}</p>{loading&&<p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-period', 'Choose a valid report period.')}</p>}{partial&&<p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-these-fig', 'Loaded history is incomplete or failed. These figures are provisional.')}</p>}<RangeReportSourceNote source={current.source} testId="customer-gross-profit-source" what={reportText('r.these-figures', 'these figures')}/>{compared&&<RangeReportSourceNote source={prior.source} testId="customer-gross-profit-compare-source" what={reportText('r.the-previous-period-figures', 'the previous-period figures')}/>}<ReportTableScroll><RowTable
   caption={(<>{reportText('r.customer-gross-profit', 'Customer gross profit: ')}{startDate} – {endDate}</>)}
   rows={rows}
   rowKey={row => row.id}
   captionClassName=""
   tableClassName="comparison-report-table w-full text-sm"
   headRowClassName=""
   bodyClassName=""
   columns={[
     { header: reportText('r.customer', 'Customer'), className: "text-start", headClassName: "", cell: (row) => <bdi>{row.name}</bdi> },
     { header: reportText('r.sales', 'Sales'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.salesCents,currency) },
     { header: reportText('r.cost', 'Cost'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.costCents,currency) },
     { header: reportText('r.gross-profit', 'Gross profit'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => formatCurrency(row.marginCents,currency) },
     { header: reportText('r.margin', 'Margin %'), align: 'right', className: "whitespace-nowrap tabular-nums", headClassName: "", cell: (row) => row.marginPct===null?'—':`${row.marginPct.toFixed(1)}%` },
     { header: reportText('r.cost-source', 'Cost source'), headClassName: "", cell: (row) => row.costIsEstimate?reportText('r.includes-estimated-cost', 'Includes estimated cost'):reportText('r.existing-posted-zero-cost', 'Existing posted / zero cost') },
     compared ? { header: reportText('r.previous-profit-change', 'Previous profit / change'), align: 'right', className: "whitespace-nowrap tabular-nums", cellProps: { dir: "ltr" }, headClassName: "", cell: (row) => (<>{formatCurrency(previous.get(row.id)??0,currency)} / {formatCurrency(row.marginCents-(previous.get(row.id)??0),currency)}</>) } : false,
   ]}
 />{valid&&!loading&&!rows.length&&<p>{reportText('r.no-issued-invoice-item-activity-in-this-period', 'No issued invoice item activity in this period.')}</p>}</ReportTableScroll></section>;
}
