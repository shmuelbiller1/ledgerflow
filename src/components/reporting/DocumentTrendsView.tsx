import React,{useState} from 'react';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {useDataNeedsStore} from '../../stores/useDataNeedsStore';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {useServerSalesTrends} from '../../hooks/useServerProfitability';
import {useServerPurchaseTrends} from '../../hooks/useServerPurchaseTrends';
import {RangeReportSourceNote} from './RangeReportSourceNote';
import {validCustomReportPeriod} from '../../lib/reportCustomPeriod';
import {formatCurrency} from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import PurchaseItemTrendsView from './PurchaseItemTrendsView';
import { useReportText } from './useReportText';
interface Props{endDate?:string;compareEndDate?:string}
function DocumentTrendsView({kind,endDate='',compareEndDate=''}:Props&{kind:'sales'|'purchases'}){
  const reportText = useReportText();
 const truncated=useLedgerStore(state=>state.truncatedCollections);
 const currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency),failed=useDataNeedsStore(state=>state.failed);
 const {loading}=useLedgerCollections('customers','vendors','invoices','bills','inventory','transactions','accounts');
 const keys=kind==='sales'?(['customers','invoices','inventory','transactions','accounts'] as const):(['vendors','bills'] as const);
 // Wait only for this kind's own lists, and count a list that failed to load as settled: the server answers then.
 const settled=useDataNeedsStore(state=>keys.every(key=>state.loaded[key]||Boolean(state.failed[key])));
 const waiting=loading&&!settled;
 const [group,setGroup]=useState<'customer'|'item'>('customer');
 const valid=validCustomReportPeriod({startDate:endDate,endDate}),compared=validCustomReportPeriod({startDate:compareEndDate,endDate:compareEndDate});
 const sales=useServerSalesTrends(endDate,group,kind==='sales'&&valid&&!waiting),priorSales=useServerSalesTrends(compareEndDate,group,kind==='sales'&&compared&&!waiting);
 const purchaseRows=useServerPurchaseTrends(endDate,kind==='purchases'&&valid&&!waiting),priorPurchaseRows=useServerPurchaseTrends(compareEndDate,kind==='purchases'&&compared&&!waiting);
 const purchases=purchaseRows.rows;
 const rows=kind==='sales'?sales.rows:purchases;
 const priorPurchases=priorPurchaseRows.rows;
 const prior=kind==='sales'?priorSales.rows:priorPurchases;
 const displayRows=[...rows.map(row=>({...row,period:'Current'})),...prior.map(row=>({...row,period:'Previous'}))];
 const [current,previous]=kind==='sales'?[sales,priorSales]:[purchaseRows,priorPurchaseRows];
 const fromServer=current.source==='server'&&(!compared||previous.source==='server');
 const partial=!fromServer&&keys.some(key=>isCollectionCapped(truncated,key)||failed[key]);
 const title=kind==='sales'?reportText('r.sales-trends', 'Sales trends'):reportText('r.purchase-trends-by-vendor', 'Purchase trends by vendor');
 return <section aria-label={title} className="p-4 space-y-4 min-w-0"><h2>{title}</h2><p>{reportText('r.twelve-calendar-months-ending', 'Twelve calendar months ending')} {endDate}{reportText('r.the-final-month-stops-on-that-date-the-report-st', '; the final month stops on that date. The report start-date control does not shorten this twelve-month window. Only recorded monthly activity is listed; absent rows mean no included document activity.')}</p><p>{kind==='sales'?reportText('r.sales-use-the-existing-issued-invoice-item-amoun', 'Sales use the existing issued-invoice item amounts, grouped by customer or item. Drafts and opening documents are excluded; credit notes and document-level tax/discount allocation are outside this item calculation.'):reportText('r.purchases-use-the-existing-issued-bill-totals-in', 'Purchases use the existing issued-bill totals in base currency, grouped by vendor. Totals include the document taxes/discounts; opening balances, drafts and undated bills are excluded. Choose Item for the bill-line purchase register, with currencies kept separate; it has a different scope from these vendor totals.')}</p>{kind==='sales'&&<label data-print-hide>{reportText('r.group-sales-by', 'Group sales by')} <select className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={group} onChange={event=>setGroup(event.target.value==='item'?'item':'customer')}><option value="customer">{reportText('r.customer', 'Customer')}</option><option value="item">{reportText('r.item', 'Item')}</option></select></label>}{waiting&&<p role="status">{reportText('r.loading-report-records', 'Loading report records…')}</p>}{!valid&&<p role="alert">{reportText('r.choose-a-valid-report-end-date', 'Choose a valid report end date.')}</p>}{partial&&<p role="alert">{reportText('r.loaded-history-is-incomplete-or-failed-these-tre', 'Loaded history is incomplete or failed. These trends are provisional.')}</p>}<RangeReportSourceNote source={current.source} testId={`${kind}-trends-source`} what={reportText('r.these-trends', 'these trends')}/>{compared&&<RangeReportSourceNote source={previous.source} testId={`${kind}-trends-compare-source`} what={reportText('r.the-previous-period-trends', 'the previous-period trends')}/>}<ReportTableScroll><table className="w-full text-sm"><caption>{title}{reportText('r.12-months-through', ': 12 months through')} {endDate}</caption><thead><tr>{compared&&<th scope="col">{reportText('r.window', 'Window')}</th>}<th scope="col">{reportText('r.month', 'Month')}</th><th scope="col">{kind==='sales'?(group==='item'?reportText('r.item', 'Item'):reportText('r.customer', 'Customer')):reportText('r.vendor', 'Vendor')}</th><th scope="col">{reportText('r.amount', 'Amount')}</th></tr></thead><tbody>{displayRows.map(row=><tr key={`${row.period}:${row.id}`}>{compared&&<td>{row.period}</td>}<td>{row.month}</td><th scope="row" className="text-left"><bdi>{row.name}</bdi></th><td>{formatCurrency(row.cents,currency)}</td></tr>)}</tbody></table>{valid&&!waiting&&!rows.length&&<p>{reportText('r.no-included-activity-in-the-current-twelve-month', 'No included activity in the current twelve-month window.')}</p>}</ReportTableScroll></section>;
}
export function SalesTrendsView(props:Props){return <DocumentTrendsView {...props} kind="sales" />;}
function ScopedPurchaseTrendsView(props: Props) {
  const reportText = useReportText();
 const [group, setGroup] = useState<'vendor' | 'item'>('vendor');
 return <div className="space-y-3 min-w-0">
  <label className="flex flex-col gap-1 w-fit px-4" data-print-hide>{reportText('r.group-purchases-by', 'Group purchases by')}
   <select className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={group} onChange={event => setGroup(event.target.value === 'item' ? 'item' : 'vendor')}>
    <option value="vendor">{reportText('r.vendor', 'Vendor')}</option><option value="item">{reportText('r.item', 'Item')}</option>
   </select>
  </label>
  {group === 'vendor' ? <DocumentTrendsView {...props} kind="purchases" /> : <PurchaseItemTrendsView {...props} />}
 </div>;
}
export function PurchaseTrendsView(props: Props) {
 const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
 return <ScopedPurchaseTrendsView key={`${uid}:${workspaceId}`} {...props} />;
}
