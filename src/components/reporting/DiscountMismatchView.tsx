import { useMemo, useRef, useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { db } from '../../firebase';
import { discountMismatches } from '../../lib/discountMismatch';
import { formatCurrency } from '../../lib/utils';
import { downloadCsv, csvMoney } from '../../lib/csvExport';
import { useUIStore } from '../../stores/useUIStore';
import type { InventoryItem, Invoice } from '../../types';
import type { PriceList } from '../../lib/priceLists';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';
interface Props { startDate?: string; endDate?: string }
interface Snapshot { invoices: Invoice[]; items: InventoryItem[]; lists: PriceList[]; loadedAt: string }
export default function DiscountMismatchView(props: Props) {
  const uid = useAuthStore(state=>state.user?.uid), workspace = useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedDiscountMismatch key={JSON.stringify([uid,workspace])} {...props} />;
}
function ScopedDiscountMismatch({startDate='',endDate=''}: Props) {
  const reportText = useReportText();
  const workspaceId = useAuthStore(state=>state.currentWorkspaceId), uid = useAuthStore(state=>state.user?.uid), guest = useAuthStore(state=>state.isGuest);
  const workspace = useAuthStore(state=>state.getCurrentWorkspace()), currency = workspace?.currency || 'USD', priceLists = workspace?.priceLists;
  const invoices = useLedgerStore(state=>state.invoices), items = useLedgerStore(state=>state.inventory);
  const {loading} = useLedgerCollections('invoices','inventory');
  const [snapshot,setSnapshot] = useState<Snapshot|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current = ()=>mounted.current && useAuthStore.getState().currentWorkspaceId===workspaceId && useAuthStore.getState().user?.uid===uid;
  const report = useMemo(()=>{
    try { return { ...discountMismatches({invoices:snapshot?.invoices||invoices,items:snapshot?.items||items,lists:snapshot?.lists||priceLists||[],workspaceId:workspaceId||'',currency,startDate,endDate}),problem:'' }; }
    catch (reason) { return {rows:[],uncomparableLines:0,problem:reason instanceof Error?reason.message:'Could not compare current prices.'}; }
  },[snapshot,invoices,items,priceLists,workspaceId,currency,startDate,endDate]);
  async function refresh() {
    if (!workspaceId || !uid || guest || pending.current) return;
    pending.current=true;setBusy(true);setError('');
    const lists=structuredClone(workspace?.priceLists||[]);
    try {
      const [invoiceDocs,itemDocs]=await Promise.all(['invoices','inventory'].map(name=>getDocs(query(collection(db,name),where('workspaceId','==',workspaceId)))));
      if (current()) setSnapshot({invoices:invoiceDocs.docs.map(doc=>({...doc.data(),id:doc.id} as Invoice)),items:itemDocs.docs.map(doc=>({...doc.data(),id:doc.id} as InventoryItem)),lists,loadedAt:new Date().toISOString()});
    } catch { if(current())setError('Could not refresh complete invoice and item history. Retry; no complete export is available.'); }
    finally {pending.current=false;if(current())setBusy(false);}
  }
  const exportCsv=()=>downloadCsv('Current_price_mismatches.csv',['Date','Invoice','Customer','Item','Currency','Invoice unit price','Expected unit price','Difference per unit','Comparison source'],report.rows.map(row=>[row.date,row.number,row.customer,row.item,row.currency,csvMoney(row.actualCents),csvMoney(row.expectedCents),csvMoney(row.differenceCents),row.source]));
  return <section aria-label={reportText('r.discount-mismatch-review', 'Discount mismatch review')} className="p-4 space-y-4 min-w-0"><h2>{reportText('r.discount-mismatch-review', 'Discount mismatch review')}</h2>
    <p>{reportText('r.issued-invoice-unit-prices-for', 'Issued invoice unit prices for')} {startDate} {reportText('r.through-2', 'through')} {endDate}{reportText('r.compared-with-the-customer-s-current-price-list', ', compared with the customer’s current price list or the item’s current catalogue price. The existing list-price helper supplies the expected rate. Difference = invoice unit price − expected unit price; negative means the invoice price is lower.')}</p>
    <p>{reportText('r.this-is-a-current-price-review-not-proof-of-the', 'This is a current-price review, not proof of the discount agreed on the invoice date. Historical lists, separate item discount rules and document-wide discounts are not stored here. Credits, opening balances, drafts, voids and foreign-currency lines are outside this comparison. No prices, amounts or postings are changed.')}</p>
    {!snapshot&&<p role="status">{reportText('r.loaded-records-are-a-provisional-preview-refresh', 'Loaded records are a provisional preview. Refresh complete history before exporting.')}</p>}{snapshot&&<p>{reportText('r.complete-invoice-item-reads-retrieved', 'Complete invoice/item reads retrieved')} {snapshot.loadedAt}{reportText('r.current-price-lists-copied-when-refresh-started', '; current price lists copied when refresh started. These separate reads are not an atomic historical snapshot.')}</p>}
    {loading&&!snapshot&&<p role="status">{reportText('r.loading-preview', 'Loading preview…')}</p>}{report.problem&&<p role="alert">{report.problem}</p>}{error&&<p role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!uid||guest||!workspaceId} onClick={()=>void refresh()} className="min-h-11 border rounded px-3">{busy?reportText('r.refreshing', 'Refreshing…'):reportText('r.refresh-complete-history', 'Refresh complete history')}</button><button type="button" disabled={!snapshot||busy||Boolean(error||report.problem)} onClick={exportCsv} className="min-h-11 border rounded px-3">{reportText('r.export-csv', 'Export CSV')}</button></div>
    <p>{report.uncomparableLines} {reportText('r.issued-lines-cannot-be-compared-because-their-cu', 'issued lines cannot be compared because their currency, item reference or price is unavailable or invalid.')}</p>
    <ReportTableScroll><RowTable
        caption={reportText('r.current-price-mismatch-review', 'Current price mismatch review')}
        captionClassName=""
        tableClassName="w-full text-sm"
        bodyClassName=""
        rows={report.rows}
        rowKey={row => JSON.stringify([row.invoiceId, row.line])}
        columns={[
          { header: reportText('r.date-2', 'Date'), headClassName: "", cell: row => row.date },
          { rowHeader: true, header: reportText('r.invoice-2', 'Invoice'), headClassName: "", cell: row => (
            <button type="button" onClick={() => useUIStore.getState().openRecord({ type: 'invoice', id: row.invoiceId })} className="min-h-11 underline"><bdi>{row.number}</bdi></button>
          ) },
          { header: reportText('r.customer', 'Customer'), headClassName: "", cell: row => <bdi>{row.customer}</bdi> },
          { header: reportText('r.item', 'Item'), headClassName: "", cell: row => <bdi>{row.item}</bdi> },
          { header: reportText('r.invoice-unit-price', 'Invoice unit price'), headClassName: "", cell: row => <bdi dir="auto">{formatCurrency(row.actualCents, row.currency)}</bdi> },
          { header: reportText('r.expected-unit-price', 'Expected unit price'), headClassName: "", cell: row => <bdi dir="auto">{formatCurrency(row.expectedCents, row.currency)}</bdi> },
          { header: reportText('r.difference-per-unit', 'Difference per unit'), headClassName: "", cell: row => <bdi dir="auto">{formatCurrency(row.differenceCents, row.currency)}</bdi> },
          { header: reportText('r.comparison-source', 'Comparison source'), headClassName: "", cell: row => <bdi>{row.source}</bdi> },
        ]}
      /></ReportTableScroll>
    {!report.problem&&!loading&&report.rows.length===0&&<p>{reportText('r.no-comparable-unit-price-mismatches-in-the-selec', 'No comparable unit-price mismatches in the selected period.')}</p>}
  </section>;
}
