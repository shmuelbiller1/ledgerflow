/**
 * A-119: Vendor quotes compare — record and compare supplier quotes per item (price, MOQ, lead
 * days, validity date, currency) alongside each vendor's last actual billed unit price.
 */
import React, { useMemo, useState } from 'react';
import { Download, Plus, Scale, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, parseAmountToCents } from '../../lib/utils';
import {
  compareVendorQuotes,
  VENDOR_QUOTES_CSV_HEADERS,
  vendorQuoteProblem,
  vendorQuotesCsvRows,
  vendorQuotesFromItem,
  type VendorQuoteEntry,
} from '../../lib/vendorQuotesCompare';

const field = 'w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';
const COMMON_CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP', 'CAD', 'AUD'];

export default function VendorQuotesCompareView() {
  const inventory = useLedgerStore(s => s.inventory);
  const vendors = useLedgerStore(s => s.vendors);
  const bills = useLedgerStore(s => s.bills);
  const { loading } = useLedgerCollections('inventory', 'vendors', 'bills');
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const canWrite = useCurrentRole() !== 'viewer';
  const { updateEntity } = useEntityOperations();

  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [itemFilter, setItemFilter] = useState('ALL');
  const [itemId, setItemId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [currency, setCurrency] = useState(workspaceCurrency);
  const [priceInput, setPriceInput] = useState('');
  const [minOrderQty, setMinOrderQty] = useState('1');
  const [leadDays, setLeadDays] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const allCompared = useMemo(
    () => compareVendorQuotes({ items: inventory || [], bills: bills || [], asOfDate, defaultCurrency: workspaceCurrency }),
    [inventory, bills, asOfDate, workspaceCurrency],
  );

  const visibleRows = useMemo(
    () => (itemFilter === 'ALL' ? allCompared : allCompared.filter(r => r.itemId === itemFilter)),
    [allCompared, itemFilter],
  );

  const handleAddQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetItem = (inventory || []).find(i => i.id === itemId);
    const vendor = (vendors || []).find(v => v.id === vendorId);
    if (!targetItem) {
      toast.error('Choose an item first.');
      return;
    }
    const unitPriceCents = parseAmountToCents(priceInput);
    const moq = Number(minOrderQty);
    const lead = leadDays.trim() === '' ? undefined : Number(leadDays);
    const problem = vendorQuoteProblem({
      vendorId: vendor?.id,
      unitPriceCents,
      minOrderQty: moq,
      leadDays: lead,
      validUntil: validUntil || undefined,
    });
    if (problem || !vendor) {
      toast.error(problem || 'Choose a vendor.');
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
    setSaving(true);
    try {
      await updateEntity('inventory', targetItem.id, {
        metadata: { ...(targetItem.metadata || {}), vendorQuotes: nextQuotes },
      });
      setPriceInput('');
      setNotes('');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuote = async (targetItemId: string, quoteId: string) => {
    const targetItem = (inventory || []).find(i => i.id === targetItemId);
    if (!targetItem) return;
    const nextQuotes = vendorQuotesFromItem(targetItem).filter(q => q.id !== quoteId);
    await updateEntity('inventory', targetItem.id, {
      metadata: { ...(targetItem.metadata || {}), vendorQuotes: nextQuotes },
    });
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">Loading vendor quotes…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Scale className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            Vendor Quotes Compare
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Compare supplier unit prices, minimum order quantities, lead times, and quote expiry dates per item alongside each supplier&apos;s most recent billed unit cost. Lowest-price badges compare quotes strictly in the same currency.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(`vendor-quotes-${asOfDate}.csv`, VENDOR_QUOTES_CSV_HEADERS, vendorQuotesCsvRows(visibleRows))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div>
          <label htmlFor="vq-filter-item" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Filter by item
          </label>
          <select id="vq-filter-item" value={itemFilter} onChange={e => setItemFilter(e.target.value)} className={field}>
            <option value="ALL">All items ({(inventory || []).length})</option>
            {(inventory || []).map(it => (
              <option key={it.id} value={it.id}>{it.name}{it.sku ? ` (${it.sku})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vq-as-of" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Quote validity as of date
          </label>
          <input id="vq-as-of" type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} className={field} />
        </div>
      </div>

      {canWrite && (
        <form onSubmit={handleAddQuote} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Record or update supplier quote</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="vq-item" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Item</label>
              <select id="vq-item" value={itemId} onChange={e => setItemId(e.target.value)} className={field}>
                <option value="">Select item…</option>
                {(inventory || []).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="vq-vendor" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Vendor</label>
              <select id="vq-vendor" value={vendorId} onChange={e => setVendorId(e.target.value)} className={field}>
                <option value="">Select vendor…</option>
                {(vendors || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="vq-currency" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Currency</label>
              <select id="vq-currency" value={currency} onChange={e => setCurrency(e.target.value)} className={field}>
                {[...new Set([workspaceCurrency, ...COMMON_CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="vq-price" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Unit price</label>
              <input id="vq-price" type="text" inputMode="decimal" placeholder="18.50" value={priceInput} onChange={e => setPriceInput(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="vq-moq" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Min order qty (MOQ)</label>
              <input id="vq-moq" type="number" min="1" step="1" value={minOrderQty} onChange={e => setMinOrderQty(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="vq-lead" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Lead time (days)</label>
              <input id="vq-lead" type="number" min="0" step="1" placeholder="7" value={leadDays} onChange={e => setLeadDays(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="vq-valid" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Valid until</label>
              <input id="vq-valid" type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="vq-notes" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Terms / notes</label>
              <input id="vq-notes" type="text" maxLength={240} placeholder="FOB origin" value={notes} onChange={e => setNotes(e.target.value)} className={field} />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> Save quote
            </button>
          </div>
        </form>
      )}

      {visibleRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No supplier quotes recorded yet</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Add two or more supplier quotes for an item above to compare unit prices, MOQ, lead times, and last billed cost side by side.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full text-sm text-start">
            <caption className="sr-only">Supplier quotes comparison table</caption>
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 text-start">Item</th>
                <th scope="col" className="px-4 py-3 text-start">Vendor</th>
                <th scope="col" className="px-4 py-3 text-end">Quoted price</th>
                <th scope="col" className="px-4 py-3 text-end">Spread vs lowest</th>
                <th scope="col" className="px-4 py-3 text-end">MOQ</th>
                <th scope="col" className="px-4 py-3 text-end">Lead days</th>
                <th scope="col" className="px-4 py-3 text-start">Valid until</th>
                <th scope="col" className="px-4 py-3 text-end">Last billed cost</th>
                {canWrite && <th scope="col" className="px-4 py-3 text-end">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {visibleRows.map(row => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {row.itemName}
                    {row.sku && <span className="ml-1.5 text-xs text-slate-500">({row.sku})</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-200">{row.vendorName}</td>
                  <td className="px-4 py-3 text-end tabular-nums font-semibold text-slate-900 dark:text-white">
                    {formatCurrency(row.unitPriceCents, row.currency)}
                    {row.lowestInCurrency && (
                      <span className="ml-2 inline-block px-2 py-0.5 text-[11px] font-bold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Lowest ({row.currency})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-slate-600 dark:text-slate-400">
                    {row.deltaFromLowestCents === null
                      ? '—'
                      : row.deltaFromLowestCents === 0
                        ? 'Best'
                        : `+${formatCurrency(row.deltaFromLowestCents, row.currency)}`}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">{row.minOrderQty}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{row.leadDays !== undefined ? `${row.leadDays}d` : '—'}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {row.validUntil || 'Open'}
                    {row.expired && (
                      <span className="ml-2 inline-block px-2 py-0.5 text-[11px] font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Expired
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-slate-600 dark:text-slate-400">
                    {row.lastBill
                      ? `${formatCurrency(row.lastBill.unitCostCents, row.lastBill.currency)} (${row.lastBill.billNumber})`
                      : '—'}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-3 text-end">
                      <button
                        type="button"
                        aria-label={`Remove quote from ${row.vendorName} for ${row.itemName}`}
                        onClick={() => handleDeleteQuote(row.itemId, row.id)}
                        className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
