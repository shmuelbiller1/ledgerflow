import { useDialog } from '../../hooks/useDialog';
import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { AGING_BUCKETS, computePartyAging, daysOverdue, emptyAging, outstandingBaseCents, type AgingBucketKey, type PartyAgingRow } from '../../lib/aging';
import { calculateAmountDue } from '../../lib/documentMath';
import { FileText, ArrowLeft, Download, ChevronRight, Users, Clock, Search, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { useUIStore } from '../../stores/useUIStore';

interface PartyAgingReportViewProps {
  side: 'customer' | 'vendor';
}


export default function PartyAgingReportView({ side }: PartyAgingReportViewProps) {
  const isCustomer = side === 'customer';
  
  // Get data from store
  const rawCustomers = useLedgerStore(s => s.customers) || [];
  const rawVendors = useLedgerStore(s => s.vendors) || [];
  const rawInvoices = useLedgerStore(s => s.invoices) || [];
  const rawBills = useLedgerStore(s => s.bills) || [];
  useLedgerCollections('bills', 'customers', 'invoices', 'vendors');
  // N-12: the documents behind an aging row open themselves, add up to the row, and say when the list is partial
  const openRecord = useUIStore(s => s.openRecord);
  const docsPartial = useLedgerStore(s => Boolean(s.truncatedCollections?.[side === 'customer' ? 'invoices' : 'bills']));

  const parties = isCustomer ? rawCustomers : rawVendors;
  const documents = isCustomer ? rawInvoices : rawBills;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);

  // Sorting state
  const [sortBy, setSortBy] = useState<'partyName' | AgingBucketKey | 'total'>('partyName');
  const today = getLocalDateISO();
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // open documents with something still owed (src/lib/aging.ts, shared with the /aging API; L-159)
  const outstandingDocs = useMemo(() => documents.filter(doc => outstandingBaseCents(doc, side) > 0), [documents, side]);
  const agingRows: PartyAgingRow[] = useMemo(() => computePartyAging(parties, documents, side, today), [parties, documents, side, today]);

  // Search filter and Sorting
  const sortedAndFilteredRows = useMemo(() => {
    const filtered = agingRows.filter(row => 
      row.partyName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      const value = (r: PartyAgingRow) => (sortBy === 'partyName' ? r.partyName : sortBy === 'total' ? r.total : r.buckets[sortBy]);
      let valA = value(a);
      let valB = value(b);

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB as string).toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [agingRows, searchTerm, sortBy, sortOrder]);

  // Totals
  const bucketTotals = useMemo(() => sortedAndFilteredRows.reduce((sum, r) => {
    for (const b of AGING_BUCKETS) sum[b.key] += r.buckets[b.key];
    return sum;
  }, emptyAging()), [sortedAndFilteredRows]);
  const grandTotal = useMemo(() => sortedAndFilteredRows.reduce((sum, r) => sum + r.total, 0), [sortedAndFilteredRows]);

  // Selected party documents for drill down
  const selectedParty = parties.find(p => p.id === selectedPartyId);
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(() => setSelectedPartyId(null), !!(selectedPartyId && selectedParty));
  const selectedPartyDocs = useMemo(() => {
    return selectedPartyId
      ? outstandingDocs.filter(d => {
          const matchId = isCustomer ? (d as typeof d & { customerId?: string; vendorId?: string }).customerId : (d as typeof d & { customerId?: string; vendorId?: string }).vendorId;
          return matchId === selectedPartyId;
        })
      : [];
  }, [selectedPartyId, outstandingDocs, isCustomer]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const exportToCSV = () => {
    downloadCsv(`${isCustomer ? 'ar' : 'ap'}_aging_report.csv`,
      [isCustomer ? 'Customer' : 'Vendor', ...AGING_BUCKETS.map(b => b.key === 'current' ? 'Current' : `${b.label} overdue`), 'Total Outstanding'],
      sortedAndFilteredRows.map(r => [r.partyName, ...AGING_BUCKETS.map(b => csvMoney(r.buckets[b.key])), csvMoney(r.total)]));
    toast.success('Aging report exported successfully to CSV');
  };

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Clock aria-hidden="true" className="w-6 h-6 text-indigo-500" />
            {isCustomer ? 'Accounts Receivable (AR) Aging' : 'Accounts Payable (AP) Aging'}
          </h2>
          <p className="text-sm text-[var(--muted)] dark:text-slate-400">
            Aging schedule of outstanding {isCustomer ? 'customer invoices' : 'vendor bills'} grouped by days past the due date, in the base currency.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportToCSV}
            className="min-h-11 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-lg flex items-center gap-2 text-sm shadow-sm transition-colors border border-slate-200 dark:border-slate-800"
          >
            <Download aria-hidden="true" className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Visual Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">Total Outstanding</span>
          <span className="text-xl font-mono font-black text-slate-900 dark:text-white tracking-tight block mt-1">
            <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(grandTotal)}</bdi>
          </span>
        </div>
        {AGING_BUCKETS.map((b, i) => (
          <div key={b.key} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">{b.key === 'current' ? 'Not yet due' : `${b.label} overdue`}</span>
            <span className={`text-xl font-mono font-black tracking-tight block mt-1 ${['text-emerald-600 dark:text-emerald-400', 'text-amber-600', 'text-amber-600', 'text-orange-600', 'text-rose-600 dark:text-rose-400'][i]}`}>
              <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(bucketTotals[b.key])}</bdi>
            </span>
          </div>
        ))}
      </div>

      {/* Main Filter & Table area */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:max-w-xs">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search aria-hidden="true" className="h-4 w-4 text-[var(--muted)]" />
            </span>
            <input aria-label={`Search by ${isCustomer ? "customer" : "vendor"}`}
              type="text"
              placeholder={`Search by ${isCustomer ? 'customer' : 'vendor'}...`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="min-h-11 w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">{isCustomer ? 'Receivables aging by customer' : 'Payables aging by vendor'}</caption>
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                <th scope="col" className="p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" onClick={() => handleSort('partyName')}>
                  <span className="flex items-center gap-1">
                    {isCustomer ? 'Customer' : 'Vendor'}
                    <ArrowUpDown aria-hidden="true" className="w-3 h-3 text-[var(--muted)]" />
                  </span>
                </th>
                {AGING_BUCKETS.map(b => (
                  <th key={b.key} scope="col" className="p-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" onClick={() => handleSort(b.key)}>
                    <span className="flex items-center justify-end gap-1">
                      {b.label}
                      <ArrowUpDown aria-hidden="true" className="w-3 h-3 text-[var(--muted)]" />
                    </span>
                  </th>
                ))}
                <th scope="col" className="p-4 text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" onClick={() => handleSort('total')}>
                  <span className="flex items-center justify-end gap-1">
                    Total Outstanding
                    <ArrowUpDown aria-hidden="true" className="w-3 h-3 text-[var(--muted)]" />
                  </span>
                </th>
                <th scope="col" className="p-4 w-10"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {sortedAndFilteredRows.map(row => (
                <tr 
                  key={row.partyId}
                  onClick={() => setSelectedPartyId(row.partyId)}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group"
                >
                  <td className="p-4 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Users aria-hidden="true" className="w-4 h-4 text-[var(--muted)]" />
                    {row.partyName}
                  </td>
                  {AGING_BUCKETS.map(b => (
                    <td key={b.key} className="p-4 text-right font-mono text-slate-600 dark:text-slate-400">
                      <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{row.buckets[b.key] > 0 ? formatCurrency(row.buckets[b.key]) : '-'}</bdi>
                    </td>
                  ))}
                  <td className="p-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                    <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(row.total)}</bdi>
                  </td>
                  <td className="p-4 text-right">
                    <button type="button" aria-label={`Open ${row.partyName}`} onClick={e => { e.stopPropagation(); setSelectedPartyId(row.partyId); }} className="min-h-11 min-w-11 inline-flex items-center justify-center p-1 rounded-md">
                      <ChevronRight aria-hidden="true" className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-white transition-colors" />
                    </button>
                  </td>
                </tr>
              ))}

              {sortedAndFilteredRows.length === 0 && (
                <tr>
                  <td data-report-empty-state colSpan={AGING_BUCKETS.length + 3} className="p-8 text-center text-[var(--muted)] dark:text-slate-400">
                    {docsPartial
                      ? `Loaded ${isCustomer ? 'invoice' : 'bill'} history is incomplete. Clear the search, then load full ${isCustomer ? 'invoice' : 'bill'} history before treating this report as empty; an open document may be outside the loaded records.`
                      : `No outstanding ${isCustomer ? 'receivables' : 'payables'} found matching criteria. Clear the search to see every party, or record an open ${isCustomer ? 'customer invoice' : 'vendor bill'} in ${isCustomer ? 'Sales' : 'Purchases'}; this report reads saved documents.`}
                  </td>
                </tr>
              )}
            </tbody>
            {sortedAndFilteredRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/30 font-bold text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-800">
                  <td className="p-4">Grand Total</td>
                  {AGING_BUCKETS.map(b => <td key={b.key} className="p-4 text-right font-mono"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(bucketTotals[b.key])}</bdi></td>)}
                  <td className="p-4 text-right font-mono text-lg"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(grandTotal)}</bdi></td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Drill-down Drawer */}
      {selectedPartyId && selectedParty && (
        <div {...overlayDialogProps} className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
              <div>
                <button 
                  onClick={() => setSelectedPartyId(null)}
                  className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-bold mb-1"
                >
                  <ArrowLeft aria-hidden="true" className="w-3 h-3" /> Back to Aging Schedule
                </button>
                <h3 id={overlayTitleId} className="text-xl font-black text-slate-900 dark:text-white">
                  Outstanding Ledger: {selectedParty.name}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedPartyId(null)}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
            </div>

            {/* Document list */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedPartyDocs.map(doc => {
                const docTotal = doc.amountCents || 0;
                const owed = calculateAmountDue(doc);
                const overdue = daysOverdue(doc, today);

                return (
                  <div 
                    key={doc.id}
                    className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/30 flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText aria-hidden="true" className="w-4 h-4 text-indigo-500" />
                        <span className="font-bold text-slate-900 dark:text-white">
                          #{doc.number || doc.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase tracking-wider">
                          {overdue > 0 ? `${overdue} days overdue` : 'Not yet due'}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted)] dark:text-slate-400">
                        Date: {doc.date?.slice(0, 10)} | Due Date: {doc.dueDate || doc.date?.slice(0, 10)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-mono font-black text-slate-900 dark:text-white">
                        <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(owed, doc.currency)}</bdi>
                      </div>
                      <button type="button" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        onClick={() => { setSelectedPartyId(null); openRecord({ type: isCustomer ? 'invoice' : 'bill', id: doc.id }); }}>
                        Open<span className="sr-only"> {isCustomer ? 'invoice' : 'bill'} {doc.number || doc.id}</span>
                      </button>
                      <div className="text-xs text-[var(--muted)]">
                        Total <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(docTotal, doc.currency)}</bdi> | Still owed <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(owed, doc.currency)}</bdi>
                      </div>
                    </div>
                  </div>
                );
              })}

              {selectedPartyDocs.length === 0 && (
                <div className="text-center py-12 text-[var(--muted)]">
                  No unpaid records found.
                </div>
              )}
              {selectedPartyDocs.length > 0 && (
                <div className="flex items-center justify-between border-t border-[var(--line)] pt-3 text-sm font-semibold">
                  <span>Still owed in all ({selectedPartyDocs.length} document{selectedPartyDocs.length === 1 ? '' : 's'}, in the base currency)</span>
                  <span className="font-mono"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(selectedPartyDocs.reduce((sum, d) => sum + outstandingBaseCents(d, side), 0))}</bdi></span>
                </div>
              )}
              {docsPartial && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">Only part of the {isCustomer ? 'invoices' : 'bills'} is loaded on this screen, so this list and the row may be short. Load the full history to be sure.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
