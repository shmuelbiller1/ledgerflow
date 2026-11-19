/**
 * A-119: Vendor quotes compare — record and compare supplier quotes per item (price, MOQ, lead
 * days, validity date, currency) alongside each vendor's last actual billed unit price.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Download, Plus, Scale, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { anyCollectionCapped } from '../../lib/ledgerCollections';
import type { InventoryItem } from '../../types';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO, readAmountCents } from '../../lib/utils';
import {
  compareVendorQuotes,
  VENDOR_QUOTES_CSV_HEADERS,
  vendorQuoteProblem,
  vendorQuotesCsvRows,
  vendorQuotesFromItem,
  type VendorQuoteEntry,
} from '../../lib/vendorQuotesCompare';
import { fill, useReportText } from './useReportText';
import { RowTable } from '../ui/RowTable';
import { useUIStore } from '../../stores/useUIStore';
import ReportTableScroll from './ReportTableScroll';
import ReportEmptyState from './ReportEmptyState';

const field = 'min-h-11 w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';
const COMMON_CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP', 'CAD', 'AUD'];

function ScopedVendorQuotesCompareView() {
  const reportText = useReportText();
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const inventory = useLedgerStore(s => s.inventory);
  const vendors = useLedgerStore(s => s.vendors);
  const bills = useLedgerStore(s => s.bills);
  const capped = useLedgerStore(s => anyCollectionCapped(s.truncatedCollections, ['bills', 'inventory']));
  const { loading } = useLedgerCollections('inventory', 'vendors', 'bills');
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const canWrite = useCurrentRole() !== 'viewer';
  const { updateEntity } = useEntityOperations();

  const [asOfDate, setAsOfDate] = useState(() => getLocalDateISO());
  const [itemFilter, setItemFilter] = useState('ALL');
  const [itemId, setItemId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [currency, setCurrency] = useState(workspaceCurrency);
  const [priceInput, setPriceInput] = useState('');
  const [minOrderQty, setMinOrderQty] = useState('1');
  const [leadDays, setLeadDays] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const allCompared = useMemo(
    () => compareVendorQuotes({ items: inventory || [], bills: bills || [], asOfDate, defaultCurrency: workspaceCurrency }),
    [inventory, bills, asOfDate, workspaceCurrency],
  );

  const visibleRows = useMemo(
    () => (itemFilter === 'ALL' ? allCompared : allCompared.filter(r => r.itemId === itemFilter)),
    [allCompared, itemFilter],
  );

  const saveQuotes = async (target: InventoryItem, next: VendorQuoteEntry[]) => {
    if (!canWrite || pending.current) return false;
    pending.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const saved = await updateEntity('inventory', target.id, { metadata: { ...target.metadata, vendorQuotes: next } });
      if (!saved) setSaveFailed(true);
      return saved;
    } catch {
      // The command handler reports the refusal. Keep the draft in place for a retry.
      setSaveFailed(true);
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const handleAddQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetItem = (inventory || []).find(i => i.id === itemId);
    const vendor = (vendors || []).find(v => v.id === vendorId);
    if (!targetItem) {
      toast.error(reportText('r.pick-quote-item', 'Choose an item first.'));
      return;
    }
    const unitPriceCents = readAmountCents(priceInput);
    if (unitPriceCents === null) {
      toast.error(reportText('r.enter-quote-price', 'Enter the unit price, for example 4.20'));
      return;
    }
    const moq = Number(minOrderQty);
    const lead = leadDays.trim() === '' ? undefined : Number(leadDays);
    const problem = vendorQuoteProblem({
      vendorId: vendor?.id,
      unitPriceCents,
      minOrderQty: moq,
      leadDays: lead,
      validUntil: validUntil || undefined,
    }, {
      vendor: reportText('r.pick-quote-vendor', 'Choose a vendor.'),
      price: reportText('r.positive-quote-price', 'Enter a quoted unit price above zero.'),
      quantity: reportText('r.positive-quote-quantity', 'Minimum order quantity must be above zero.'),
      lead: reportText('r.negative-lead-time', 'Lead time in days cannot be negative.'),
      date: reportText('r.invalid-quote-date', 'Valid-until date must be YYYY-MM-DD.'),
    });
    if (problem || !vendor) {
      toast.error(problem || reportText('r.pick-quote-vendor', 'Choose a vendor.'));
      return;
    }
    const entry: VendorQuoteEntry = {
      id: `vq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      unitPriceCents,
      currency: currency.toUpperCase(),
      minOrderQty: Math.max(1, Math.round(moq)),
      ...(lead !== undefined ? { leadDays: Math.round(lead) } : {}),
      ...(validUntil ? { validUntil } : {}),
      ...(notes.trim() ? { notes: notes.trim().slice(0, 240) } : {}),
      updatedAt: new Date().toISOString(),
    };
    const nextQuotes = [
      ...vendorQuotesFromItem(targetItem).filter(q => !(q.vendorId === vendor.id && q.currency === entry.currency)),
      entry,
    ];
    if (await saveQuotes(targetItem, nextQuotes)) {
      setPriceInput('');
      setNotes('');
    }
  };

  const handleDeleteQuote = async (targetItemId: string, quoteId: string) => {
    const targetItem = (inventory || []).find(i => i.id === targetItemId);
    if (!targetItem) return;
    const nextQuotes = vendorQuotesFromItem(targetItem).filter(q => q.id !== quoteId);
    await saveQuotes(targetItem, nextQuotes);
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">{reportText('r.loading-vendor-quotes', 'Loading vendor quotes…')}</p>;
  }

  const formTitle = reportText('r.record-or-update-supplier-quote', 'Record or update supplier quote');
  const noQuotes = allCompared.length === 0;
  const canRecord = canWrite && (!noQuotes || (inventory.length > 0 && vendors.length > 0));
  const needsVendor = canWrite && inventory.length > 0 && vendors.length === 0;
  return (
    <div className="min-w-0 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Scale className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            {reportText('r.vendor-quotes-compare', 'Vendor Quotes Compare')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {reportText('r.compare-supplier-unit-prices-minimum-order-quant', 'Compare supplier unit prices, minimum order quantities, lead times, and quote expiry dates per item alongside each supplier\'s most recent billed unit cost. Lowest-price badges compare quotes strictly in the same currency.')}
          </p>
        </div>
        {visibleRows.length > 0 && <button
          type="button"
          onClick={() => downloadCsv(`vendor-quotes-${asOfDate}.csv`, VENDOR_QUOTES_CSV_HEADERS, vendorQuotesCsvRows(visibleRows))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> {reportText('r.export-csv', 'Export CSV')}
        </button>}
      </div>

      {!noQuotes && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div>
          <label htmlFor="vq-filter-item" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            {reportText('r.filter-by-item', 'Filter by item')}
          </label>
          <select id="vq-filter-item" value={itemFilter} onChange={e => setItemFilter(e.target.value)} className={field}>
            <option value="ALL">{reportText('r.all-items', 'All items (')}{(inventory || []).length})</option>
            {(inventory || []).map(it => (
              <option key={it.id} value={it.id}>{it.name}{it.sku ? ` (${it.sku})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vq-as-of" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            {reportText('r.quote-validity-as-of-date', 'Quote validity as of date')}
          </label>
          <input id="vq-as-of" type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className={field} />
        </div>
      </div>}

      {capped && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.loaded-quotes-only', 'Some inventory or bills are not loaded. Quotes and last billed costs may be incomplete.')}</p>}
      {saveFailed && <p role="alert">{reportText('r.quote-save-failed', 'Could not confirm the change. Check the quote before trying again.')}</p>}
      {noQuotes && !capped && <ReportEmptyState
        title={reportText('r.no-supplier-quotes-recorded-yet', 'No supplier quotes recorded yet')}
        actionLabel={needsVendor ? reportText('r.open-purchases', 'Open Purchases') : reportText('r.open-inventory', 'Open Inventory')}
        onAction={canRecord ? undefined : () => setActiveTab(needsVendor ? 'purchases' : 'inventory')}
      />}
      {canRecord && (
        <details className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4">
          <summary className="min-h-11 py-3 cursor-pointer text-sm font-semibold">{formTitle}</summary>
          <form onSubmit={handleAddQuote} className="space-y-4 pb-4">
            <fieldset disabled={saving} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <legend className="sr-only">{formTitle}</legend>
              <div>
                <label htmlFor="vq-item" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.item', 'Item')}</label>
                <select id="vq-item" value={itemId} onChange={e => setItemId(e.target.value)} className={field}>
                  <option value="">{reportText('r.select-item', 'Select item…')}</option>
                  {(inventory || []).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="vq-vendor" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.vendor', 'Vendor')}</label>
                <select id="vq-vendor" value={vendorId} onChange={e => setVendorId(e.target.value)} className={field}>
                  <option value="">{reportText('r.select-vendor', 'Select vendor…')}</option>
                  {(vendors || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="vq-currency" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.currency-2', 'Currency')}</label>
                <select id="vq-currency" value={currency} onChange={e => setCurrency(e.target.value)} className={field}>
                  {[...new Set([workspaceCurrency, ...COMMON_CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="vq-price" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.unit-price', 'Unit price')}</label>
                <input id="vq-price" type="text" inputMode="decimal" placeholder="18.50" value={priceInput} onChange={e => setPriceInput(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="vq-moq" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.min-order-qty-moq', 'Min order qty (MOQ)')}</label>
                <input id="vq-moq" type="number" min="1" step="1" value={minOrderQty} onChange={e => setMinOrderQty(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="vq-lead" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.lead-time-days', 'Lead time (days)')}</label>
                <input id="vq-lead" type="number" min="0" step="1" placeholder="7" value={leadDays} onChange={e => setLeadDays(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="vq-valid" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.valid-until', 'Valid until')}</label>
                <input id="vq-valid" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={field} />
              </div>
              <div>
                <label htmlFor="vq-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{reportText('r.terms-notes', 'Terms / notes')}</label>
                <input id="vq-notes" type="text" maxLength={240} placeholder={reportText('r.fob-origin', 'FOB origin')} value={notes} onChange={e => setNotes(e.target.value)} className={field} />
              </div>
            </fieldset>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" aria-hidden="true" /> {reportText('r.save-quote', 'Save quote')}
              </button>
            </div>
          </form>
        </details>
      )}

      {!noQuotes && visibleRows.length === 0 && <ReportEmptyState
        title={reportText('r.no-quotes-for-item', 'No supplier quotes for this item.')}
        actionLabel={reportText('r.show-all-quotes', 'Show all quotes')} onAction={() => setItemFilter('ALL')}
      />}
      {visibleRows.length > 0 && (
        <div className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-2">
          <ReportTableScroll>
            <RowTable
              caption={reportText('r.supplier-quotes-comparison-table', 'Supplier quotes comparison table')}
              rows={visibleRows}
              rowKey={row => row.id}
              tableClassName="comparison-report-table w-full text-sm text-start"
              headRowClassName="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400"
              bodyClassName="divide-y divide-slate-200 dark:divide-slate-800"
              columns={[
                { header: reportText('r.item', 'Item'), headClassName: 'text-start', className: 'text-start font-medium', cell: row => <>
                  <bdi>{row.itemName}</bdi>{row.sku && <> <bdi className="whitespace-nowrap text-xs text-[var(--muted)]">({row.sku})</bdi></>}
                </> },
                { header: reportText('r.vendor', 'Vendor'), headClassName: 'text-start', cell: row => <bdi>{row.vendorName}</bdi> },
                { header: reportText('r.quoted-price', 'Quoted price'), align: 'right', className: 'tabular-nums font-semibold', cell: row => <>
                  <bdi dir="ltr" className="whitespace-nowrap">{formatCurrency(row.unitPriceCents, row.currency)}</bdi>
                  {row.lowestInCurrency && <> <span className="inline-block px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {reportText('r.lowest', 'Lowest (')}{row.currency})
                  </span></>}
                </> },
                { header: reportText('r.spread-vs-lowest', 'Spread vs lowest'), align: 'right', className: 'tabular-nums', cell: row => row.deltaFromLowestCents === null
                  ? '—' : row.deltaFromLowestCents === 0 ? reportText('r.best', 'Best') : <bdi dir="ltr">+{formatCurrency(row.deltaFromLowestCents, row.currency)}</bdi> },
                { header: reportText('r.moq', 'MOQ'), align: 'right', className: 'tabular-nums', cell: row => row.minOrderQty },
                { header: reportText('r.lead-days', 'Lead days'), align: 'right', className: 'tabular-nums', cell: row => row.leadDays !== undefined ? fill(reportText('r.0-d', '{0}d'), { 0: row.leadDays }) : '—' },
                { header: reportText('r.valid-until', 'Valid until'), headClassName: 'text-start', cell: row => <>
                  {row.validUntil || reportText('r.open', 'Open')}
                  {row.expired && <> <span className="inline-block px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{reportText('r.expired', 'Expired')}</span></>}
                </> },
                { header: reportText('r.last-billed-cost', 'Last billed cost'), align: 'right', className: 'tabular-nums', cell: row => row.lastBill
                  ? <bdi dir="ltr">{formatCurrency(row.lastBill.unitCostCents, row.lastBill.currency)} ({row.lastBill.billNumber})</bdi> : '—' },
                canWrite ? { header: reportText('r.actions', 'Actions'), headClassName: 'text-end', className: 'text-end', cell: row => {
                  const label = fill(reportText('r.remove-quote-from-0-for-1', 'Remove quote from {0} for {1}'), { 0: row.vendorName, 1: row.itemName });
                  return <button type="button" title={label} aria-label={label} disabled={saving} onClick={() => handleDeleteQuote(row.itemId, row.id)}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg">
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>;
                } } : false,
              ]}
            />
          </ReportTableScroll>
        </div>
      )}
    </div>
  );
}

/** A draft and a late reply belong to the person and workspace that opened the form. */
export default function VendorQuotesCompareView() {
  const workspace = useAuthStore(s => s.currentWorkspaceId), actor = useAuthStore(s => s.user?.uid);
  const guest = useAuthStore(s => s.isGuest);
  return <ScopedVendorQuotesCompareView key={JSON.stringify([workspace, actor, guest])} />;
}
