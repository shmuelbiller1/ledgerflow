import React,{useMemo,useState} from 'react';
import {useLedgerStore} from '../../stores/useLedgerStore';
import {useAuthStore} from '../../stores/useAuthStore';
import {useDataNeedsStore} from '../../stores/useDataNeedsStore';
import {useLedgerCollections} from '../../hooks/useLedgerCollections';
import {purchaseTrendsByVendor} from '../../lib/documentTrends';
import {useServerSalesTrends} from '../../hooks/useServerProfitability';
import {RangeReportSourceNote} from './RangeReportSourceNote';
import {validCustomReportPeriod} from '../../lib/reportCustomPeriod';
import {formatCurrency} from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import PurchaseItemTrendsView from './PurchaseItemTrendsView';
interface Props{endDate?:string;compareEndDate?:string}
function DocumentTrendsView({kind,endDate='',compareEndDate=''}:Props&{kind:'sales'|'purchases'}){
 const customers=useLedgerStore(state=>state.customers),vendors=useLedgerStore(state=>state.vendors),invoices=useLedgerStore(state=>state.invoices),bills=useLedgerStore(state=>state.bills),items=useLedgerStore(state=>state.inventory),transactions=useLedgerStore(state=>state.transactions),accounts=useLedgerStore(state=>state.accounts),truncated=useLedgerStore(state=>state.truncatedCollections);
 const workspace=useAuthStore(state=>state.currentWorkspaceId),currency=useAuthStore(state=>state.getCurrentWorkspace()?.currency),failed=useDataNeedsStore(state=>state.failed);
 const {loading}=useLedgerCollections('customers','vendors','invoices','bills','inventory','transactions','accounts');
 const [group,setGroup]=useState<'customer'|'item'>('customer');
 const valid=validCustomReportPeriod({startDate:endDate,endDate}),compared=validCustomReportPeriod({startDate:compareEndDate,endDate:compareEndDate});
 const input=useMemo(()=>{const scoped=<T extends{workspaceId?:string}>(rows:T[])=>rows.filter(row=>!workspace||row.workspaceId===workspace);return {customers:scoped(customers),vendors:scoped(vendors),invoices:scoped(invoices),bills:scoped(bills),items:scoped(items),transactions:scoped(transactions),accounts:scoped(accounts)};},[customers,vendors,invoices,bills,items,transactions,accounts,workspace]);
 const sales=useServerSalesTrends(endDate,group,kind==='sales'&&valid&&!loading),priorSales=useServerSalesTrends(compareEndDate,group,kind==='sales'&&compared&&!loading);
 const purchases=useMemo(()=>kind==='purchases'&&valid&&!loading?purchaseTrendsByVendor(input.vendors,input.bills,endDate):[],[input,valid,loading,kind,endDate]);
 const rows=kind==='sales'?sales.rows:purchases;
 const priorPurchases=useMemo(()=>kind==='purchases'&&compared&&!loading?purchaseTrendsByVendor(input.vendors,input.bills,compareEndDate):[],[input,compared,loading,kind,compareEndDate]);
 const prior=kind==='sales'?priorSales.rows:priorPurchases;
 const displayRows=[...rows.map(row=>({...row,period:'Current'})),...prior.map(row=>({...row,period:'Previous'}))];
 const keys=kind==='sales'?(['customers','invoices','inventory','transactions','accounts'] as const):(['vendors','bills'] as const);
 const fromServer=kind==='sales'&&sales.source==='server'&&(!compared||priorSales.source==='server');
 const partial=!fromServer&&(keys.some(key=>truncated[key]||failed[key])||(kind==='sales'&&Boolean(truncated.chartAccounts)));
 const title=kind==='sales'?'Sales trends':'Purchase trends by vendor';
 return <section aria-label={title} className="p-4 space-y-4 min-w-0"><h2>{title}</h2><p>Twelve calendar months ending {endDate}; the final month stops on that date. The report start-date control does not shorten this twelve-month window. Only recorded monthly activity is listed; absent rows mean no included document activity.</p><p>{kind==='sales'?'Sales use the existing issued-invoice item amounts, grouped by customer or item. Drafts and opening documents are excluded; credit notes and document-level tax/discount allocation are outside this item calculation.':'Purchases use the existing issued-bill totals in base currency, grouped by vendor. Totals include the document taxes/discounts; opening balances, drafts and undated bills are excluded. Choose Item for the bill-line purchase register, with currencies kept separate; it has a different scope from these vendor totals.'}</p>{kind==='sales'&&<label data-print-hide>Group sales by <select className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={group} onChange={event=>setGroup(event.target.value==='item'?'item':'customer')}><option value="customer">Customer</option><option value="item">Item</option></select></label>}{loading&&<p role="status">Loading report records…</p>}{!valid&&<p role="alert">Choose a valid report end date.</p>}{partial&&<p role="alert">Loaded history is incomplete or failed. These trends are provisional.</p>}{kind==='sales'&&<RangeReportSourceNote source={sales.source} testId="sales-trends-source" what="these trends"/>}{kind==='sales'&&compared&&<RangeReportSourceNote source={priorSales.source} testId="sales-trends-compare-source" what="the previous-period trends"/>}<ReportTableScroll><table className="w-full text-sm"><caption>{title}: 12 months through {endDate}</caption><thead><tr>{compared&&<th scope="col">Window</th>}<th scope="col">Month</th><th scope="col">{kind==='sales'?(group==='item'?'Item':'Customer'):'Vendor'}</th><th scope="col">Amount</th></tr></thead><tbody>{displayRows.map(row=><tr key={`${row.period}:${row.id}`}>{compared&&<td>{row.period}</td>}<td>{row.month}</td><th scope="row" className="text-left"><bdi>{row.name}</bdi></th><td>{formatCurrency(row.cents,currency)}</td></tr>)}</tbody></table>{valid&&!loading&&!rows.length&&<p>No included activity in the current twelve-month window.</p>}</ReportTableScroll></section>;
}
export function SalesTrendsView(props:Props){return <DocumentTrendsView {...props} kind="sales" />;}
function ScopedPurchaseTrendsView(props: Props) {
 const [group, setGroup] = useState<'vendor' | 'item'>('vendor');
 return <div className="space-y-3 min-w-0">
  <label className="flex flex-col gap-1 w-fit px-4" data-print-hide>Group purchases by
   <select className="min-h-11 border rounded px-3 bg-[var(--panel)]" value={group} onChange={event => setGroup(event.target.value === 'item' ? 'item' : 'vendor')}>
    <option value="vendor">Vendor</option><option value="item">Item</option>
   </select>
  </label>
  {group === 'vendor' ? <DocumentTrendsView {...props} kind="purchases" /> : <PurchaseItemTrendsView {...props} />}
 </div>;
}
export function PurchaseTrendsView(props: Props) {
 const uid = useAuthStore(state => state.user?.uid), workspaceId = useAuthStore(state => state.currentWorkspaceId);
 return <ScopedPurchaseTrendsView key={`${uid}:${workspaceId}`} {...props} />;
}
