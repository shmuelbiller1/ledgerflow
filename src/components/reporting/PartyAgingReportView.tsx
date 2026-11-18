import { fill, useReportText } from './useReportText';
import { useDialog } from '../../hooks/useDialog';
import React, { useState, useMemo, useRef } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useServerOperationalReport, collectionStamp } from '../../hooks/useServerOperationalReport';
import { currencyChartValue, formatCurrency, getCurrencyFractionDigits, getLocalDateISO } from '../../lib/utils';
import { AGING_BUCKETS, computePartyAging, daysOverdue, emptyAging, outstandingBaseCents, type AgingBucketKey, type PartyAgingRow } from '../../lib/aging';
import { calculateAmountDue } from '../../lib/documentMath';
import { FileText, ArrowLeft, Download, ChevronRight, Users, Clock, Search, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { downloadCsv } from '../../lib/csvExport';
import { useUIStore } from '../../stores/useUIStore';
import { useBrowserProvenance } from '../../hooks/useBrowserProvenance';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';
import { ReportProvenanceNote } from './ReportProvenanceNote';
import { useReportDates } from './useReportDates';

interface PartyAgingReportViewProps {
  side: 'customer' | 'vendor';
}


export default function PartyAgingReportView({ side }: PartyAgingReportViewProps) {
  const reportText = useReportText();
  const reportDates = useReportDates();
  const isCustomer = side === 'customer';
  // A-270: the keyboard path. Opening a row's drill-down must leave focus on that row when it
  // closes, whichever control opened it (the row itself, its arrow, or Enter on either).
  const rowId = (partyId: string) => `aging-row-${side}-${partyId}`;
  const openerRef = useRef<HTMLElement | null>(null);
  /** Closes the drill-down and puts focus back on whatever opened it (the row or its arrow). */
  const closeDrillDown = () => {
    setSelectedPartyId(null);
    // the row never unmounts, so the control that opened the drawer is still there to return to
    requestAnimationFrame(() => openerRef.current?.focus());
  };
  
  // Get data from store
  const rawCustomers = useLedgerStore(s => s.customers) || [];
  const rawVendors = useLedgerStore(s => s.vendors) || [];
  const rawInvoices = useLedgerStore(s => s.invoices) || [];
  const rawBills = useLedgerStore(s => s.bills) || [];
  // N-12: the documents behind an aging row open themselves, add up to the row, and say when the list is partial
  const openRecord = useUIStore(s => s.openRecord);
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const keys = isCustomer ? ['customers', 'invoices'] as const : ['vendors', 'bills'] as const;
  useLedgerCollections(...keys);
  const health = useScreenDataHealth(keys);
  const provenance = useBrowserProvenance(keys, false);
  const docsPartial = provenance.completeness !== 'complete';

  const parties = isCustomer ? rawCustomers : rawVendors;
  const documents = isCustomer ? rawInvoices : rawBills;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);

  // Sorting state
  const [sortBy, setSortBy] = useState<'partyName' | AgingBucketKey | 'total'>('partyName');
  const today = getLocalDateISO();
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const agingUrl = workspaceId ? `/api/v1/reports/party-aging?${new URLSearchParams({ workspaceId, side, asOfDate: today })}` : '';
  const serverRows = useServerOperationalReport<PartyAgingRow[]>(
    docsPartial && Boolean(workspaceId),
    agingUrl,
    `${workspaceId}:${side}:${today}:${currency}:${collectionStamp(parties, documents)}`,
    body => (Array.isArray(body.rows) ? (body.rows as PartyAgingRow[]) : undefined),
  );

  // open documents with something still owed (src/lib/aging.ts, shared with the /aging API; L-159)
  const outstandingDocs = useMemo(() => documents.filter(doc => outstandingBaseCents(doc, side, currency) > 0), [documents, side, currency]);
  const localAgingRows: PartyAgingRow[] = useMemo(() => computePartyAging(parties, documents, side, today, currency), [parties, documents, side, today, currency]);
  const agingRows = serverRows || localAgingRows;
  const partial = docsPartial && !serverRows;
  const canShowFigures = Boolean(serverRows) || health.ready;

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
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(closeDrillDown, !!(canShowFigures && selectedPartyId && selectedParty));
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
    if (partial || !canShowFigures) return;
    const decimal = (minor: number) => currencyChartValue(minor, currency).toFixed(getCurrencyFractionDigits(currency));
    downloadCsv(`${isCustomer ? 'ar' : 'ap'}_aging_report.csv`,
      [isCustomer ? 'Customer' : 'Vendor', ...AGING_BUCKETS.map(b => b.key === 'current' ? 'Current' : `${b.label} overdue`), 'Total Outstanding'],
      sortedAndFilteredRows.map(r => [r.partyName, ...AGING_BUCKETS.map(b => decimal(r.buckets[b.key])), decimal(r.total)]));
    toast.success('Aging report exported successfully to CSV');
  };

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Clock aria-hidden="true" className="w-6 h-6 text-indigo-500" />
            {isCustomer ? reportText('r.accounts-receivable-ar-aging', 'Accounts Receivable (AR) Aging') : reportText('r.accounts-payable-ap-aging', 'Accounts Payable (AP) Aging')}
          </h2>
          <p className="text-sm text-[var(--muted)] dark:text-slate-400">
            {reportText('r.aging-schedule-of-outstanding', 'Aging schedule of outstanding ')}{isCustomer ? reportText('r.customer-invoices', 'customer invoices') : reportText('r.vendor-bills', 'vendor bills')} {reportText('r.grouped-by-days-past-the-due-date-in-the-base-cu', 'grouped by days past the due date, in the base currency.')}
          </p>
          <p className="text-sm text-[var(--muted)]">{fill(reportText('r.aging-current-date', 'Current unpaid balances on {day}, across all documents. Changing the report period does not change this aging.'), { day: reportDates.dateText(today) })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportToCSV}
            disabled={partial || !canShowFigures}
            className="min-h-11 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-lg flex items-center gap-2 text-sm shadow-sm transition-colors border border-slate-200 dark:border-slate-800"
          >
            <Download aria-hidden="true" className="w-4 h-4" />
            {reportText('r.export-csv', 'Export CSV')}
          </button>
        </div>
      </div>

      {!serverRows && <ScreenDataNotice failedKeys={health.failedKeys} message={health.message} onRetry={health.retry} what="this aging report" />}
      {!canShowFigures && health.loadingKeys.length > 0 && <p role="status">{reportText('r.loading-aging-documents', 'Loading documents for this aging report…')}</p>}
      {partial && <ReportProvenanceNote provenance={provenance} />}
      {canShowFigures && <>
      {/* Visual Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
          <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">{reportText('r.total-outstanding', 'Total Outstanding')}</span>
          <span className="text-xl font-mono font-black text-slate-900 dark:text-white tracking-tight block mt-1">
            <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(grandTotal, currency)}</bdi>
          </span>
        </div>
        {AGING_BUCKETS.map((b, i) => (
          <div key={b.key} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider block">{b.key === 'current' ? reportText('r.not-yet-due', 'Not yet due') : fill(reportText('r.bucket-overdue', '{bucket} overdue'), { bucket: b.label })}</span>
            <span className={`text-xl font-mono font-black tracking-tight block mt-1 ${['text-emerald-600 dark:text-emerald-400', 'text-amber-600', 'text-amber-600', 'text-orange-600', 'text-rose-600 dark:text-rose-400'][i]}`}>
              <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(bucketTotals[b.key], currency)}</bdi>
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
            <input aria-label={isCustomer ? reportText('r.search-customer', 'Search by customer') : reportText('r.search-vendor', 'Search by vendor')}
              type="text"
              placeholder={isCustomer ? reportText('r.search-customer-dots', 'Search by customer...') : reportText('r.search-vendor-dots', 'Search by vendor...')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="min-h-11 w-full pl-9 pr-4 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <caption className="sr-only">{isCustomer ? reportText('r.receivables-aging-by-customer', 'Receivables aging by customer') : reportText('r.payables-aging-by-vendor', 'Payables aging by vendor')}</caption>
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                <th scope="col" className="p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" onClick={() => handleSort('partyName')}>
                  <span className="flex items-center gap-1">
                    {isCustomer ? reportText('r.customer', 'Customer') : reportText('r.vendor', 'Vendor')}
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
                    {reportText('r.total-outstanding', 'Total Outstanding')}
                    <ArrowUpDown aria-hidden="true" className="w-3 h-3 text-[var(--muted)]" />
                  </span>
                </th>
                <th scope="col" className="p-4 w-10"><span className="sr-only">{reportText('r.actions', 'Actions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {sortedAndFilteredRows.map(row => (
                <tr
                  key={row.partyId}
                  id={rowId(row.partyId)}
                  onClick={e => { openerRef.current = (e.target as HTMLElement).closest('button'); setSelectedPartyId(row.partyId); }}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openerRef.current = e.currentTarget; setSelectedPartyId(row.partyId); } }}
                  tabIndex={0}
                  aria-label={fill(isCustomer ? reportText('r.open-customer-aging', 'Open the customer aging detail for {name}') : reportText('r.open-vendor-aging', 'Open the vendor aging detail for {name}'), { name: row.partyName })}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors group focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                >
                  <td className="p-4 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Users aria-hidden="true" className="w-4 h-4 text-[var(--muted)]" />
                    {row.partyName}
                  </td>
                  {AGING_BUCKETS.map(b => (
                    <td key={b.key} className="p-4 text-right font-mono text-slate-600 dark:text-slate-400">
                      <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{row.buckets[b.key] > 0 ? formatCurrency(row.buckets[b.key], currency) : '-'}</bdi>
                    </td>
                  ))}
                  <td className="p-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                    <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(row.total, currency)}</bdi>
                  </td>
                  <td className="p-4 text-right">
                    <button type="button" aria-label={fill(reportText('r.open-name', 'Open {name}'), { name: row.partyName })} onClick={e => { e.stopPropagation(); openerRef.current = e.currentTarget; setSelectedPartyId(row.partyId); }} className="min-h-11 min-w-11 inline-flex items-center justify-center p-1 rounded-md">
                      <ChevronRight aria-hidden="true" className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-white transition-colors" />
                    </button>
                  </td>
                </tr>
              ))}

              {sortedAndFilteredRows.length === 0 && (
                <tr>
                  <td data-report-empty-state colSpan={AGING_BUCKETS.length + 3} className="p-8 text-center text-[var(--muted)] dark:text-slate-400">
                    {partial
                      ? (isCustomer ? reportText('r.partial-invoices', 'Loaded invoice history is incomplete. Clear the search, then load full invoice history before treating this report as empty; an open document may be outside the loaded records.') : reportText('r.partial-bills', 'Loaded bill history is incomplete. Clear the search, then load full bill history before treating this report as empty; an open document may be outside the loaded records.'))
                      : (isCustomer ? reportText('r.empty-receivables', 'No outstanding receivables found matching criteria. Clear the search to see every party, or record an open customer invoice in Sales; this report reads saved documents.') : reportText('r.empty-payables', 'No outstanding payables found matching criteria. Clear the search to see every party, or record an open vendor bill in Purchases; this report reads saved documents.'))}
                  </td>
                </tr>
              )}
            </tbody>
            {sortedAndFilteredRows.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 dark:bg-slate-800/30 font-bold text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-800">
                  <td className="p-4">{reportText('r.grand-total', 'Grand Total')}</td>
                  {AGING_BUCKETS.map(b => <td key={b.key} className="p-4 text-right font-mono"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(bucketTotals[b.key], currency)}</bdi></td>)}
                  <td className="p-4 text-right font-mono text-lg"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(grandTotal, currency)}</bdi></td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      </>}

      {/* Drill-down Drawer */}
      {canShowFigures && selectedPartyId && selectedParty && (
        <div {...overlayDialogProps} className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
              <div>
                <button
                  onClick={closeDrillDown}
                  className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-bold mb-1"
                >
                  <ArrowLeft aria-hidden="true" className="w-3 h-3" /> {reportText('r.back-to-aging-schedule', 'Back to Aging Schedule')}
                </button>
                <h3 id={overlayTitleId} className="text-xl font-black text-slate-900 dark:text-white">
                  {reportText('r.outstanding-ledger', 'Outstanding Ledger: ')}{selectedParty.name}
                </h3>
              </div>
              <button
                onClick={closeDrillDown}
                className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg"
              >
                {reportText('r.close', 'Close')}
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
                          {overdue > 0 ? fill(reportText('r.n-days-overdue', '{n} days overdue'), { n: overdue }) : reportText('r.not-yet-due', 'Not yet due')}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--muted)] dark:text-slate-400">
                        {reportText('r.date', 'Date: ')}{doc.date?.slice(0, 10)} {reportText('r.due-date', '| Due Date: ')}{doc.dueDate || doc.date?.slice(0, 10)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-mono font-black text-slate-900 dark:text-white">
                        <bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(owed, doc.currency)}</bdi>
                      </div>
                      <button type="button" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        onClick={() => { setSelectedPartyId(null); openRecord({ type: isCustomer ? 'invoice' : 'bill', id: doc.id }); }}>
                        {reportText('r.open', 'Open')}<span className="sr-only"> {isCustomer ? reportText('r.invoice', 'invoice') : reportText('r.bill', 'bill')} {doc.number || doc.id}</span>
                      </button>
                      <div className="text-xs text-[var(--muted)]">
                        {reportText('r.total-sp', 'Total ')}<bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(docTotal, doc.currency)}</bdi> {reportText('r.still-owed', '| Still owed ')}<bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(owed, doc.currency)}</bdi>
                      </div>
                    </div>
                  </div>
                );
              })}

              {selectedPartyDocs.length === 0 && (
                <div className="text-center py-12 text-[var(--muted)]">
                  {reportText('r.no-unpaid-records-found', 'No unpaid records found.')}
                </div>
              )}
              {selectedPartyDocs.length > 0 && (
                <div className="flex items-center justify-between border-t border-[var(--line)] pt-3 text-sm font-semibold">
                  <span>{fill(selectedPartyDocs.length === 1 ? reportText('r.still-owed-one', 'Still owed in all ({n} document, in the base currency)') : reportText('r.still-owed-many', 'Still owed in all ({n} documents, in the base currency)'), { n: selectedPartyDocs.length })}</span>
                  <span className="font-mono"><bdi dir="auto" style={{ unicodeBidi: 'isolate' }}>{formatCurrency(selectedPartyDocs.reduce((sum, d) => sum + outstandingBaseCents(d, side, currency), 0), currency)}</bdi></span>
                </div>
              )}
              {docsPartial && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{isCustomer ? reportText('r.part-invoices-loaded', 'Only part of the invoices is loaded on this screen, so this list and the row may be short. Load the full history to be sure.') : reportText('r.part-bills-loaded', 'Only part of the bills is loaded on this screen, so this list and the row may be short. Load the full history to be sure.')}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
