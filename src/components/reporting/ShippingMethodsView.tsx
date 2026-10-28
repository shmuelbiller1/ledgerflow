/**
 * A-124: Shipping methods and rates table — configure service catalogue items for shipping with
 * carrier, zone, transit days, flat charge, and optional free-shipping order threshold, plus a
 * live whole-cent rate calculator per currency.
 */
import React, { useMemo, useState } from 'react';
import { Download, Plus, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, readAmountCents } from '../../lib/utils';
import {
  quoteShippingCharge,
  SHIPPING_METHODS_CSV_HEADERS,
  shippingMethodProblem,
  shippingMethodsCsvRows,
  shippingMethodsFromInventory,
} from '../../lib/shippingMethods';

const field = 'w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';
const COMMON_CURRENCIES = ['USD', 'ILS', 'EUR', 'GBP', 'CAD', 'AUD'];

export default function ShippingMethodsView() {
  const inventory = useLedgerStore(s => s.inventory);
  const { loading } = useLedgerCollections('inventory');
  const workspaceCurrency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const canWrite = useCurrentRole() !== 'viewer';
  const { addEntity, deleteEntity } = useEntityOperations();

  const [name, setName] = useState('');
  const [carrier, setCarrier] = useState('');
  const [zone, setZone] = useState('Domestic');
  const [currency, setCurrency] = useState(workspaceCurrency);
  const [rateInput, setRateInput] = useState('');
  const [freeAboveInput, setFreeAboveInput] = useState('');
  const [minDays, setMinDays] = useState('');
  const [maxDays, setMaxDays] = useState('');
  const [calcSubtotalInput, setCalcSubtotalInput] = useState('100.00');
  const [calcCurrency, setCalcCurrency] = useState(workspaceCurrency);

  const rows = useMemo(
    () => shippingMethodsFromInventory(inventory || [], workspaceCurrency),
    [inventory, workspaceCurrency],
  );

  // null while the subtotal is not an amount: no fee is shown for an amount that was never read
  const calcSubtotalCents = readAmountCents(calcSubtotalInput);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const rateCents = readAmountCents(rateInput);
    const freeAboveCents = freeAboveInput.trim() === '' ? null : readAmountCents(freeAboveInput);
    if (rateCents === null) {
      toast.error('Enter the rate as an amount, for example 12.50');
      return;
    }
    if (freeAboveInput.trim() !== '' && freeAboveCents === null) {
      toast.error('Enter the free-shipping threshold as an amount, for example 100.00, or leave it empty');
      return;
    }
    const min = minDays.trim() === '' ? undefined : Number(minDays);
    const max = maxDays.trim() === '' ? undefined : Number(maxDays);
    const problem = shippingMethodProblem({ name, rateCents, freeAboveCents, minDays: min, maxDays: max });
    if (problem) {
      toast.error(problem);
      return;
    }
    const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 16);
    await addEntity('inventory', {
      name: name.trim(),
      sku: `SHIP-${slug || Date.now()}`,
      category: 'Shipping',
      itemType: 'service',
      unitPriceCents: rateCents,
      unitCostCents: 0,
      quantityAtHand: 0,
      metadata: {
        shippingMethod: {
          carrier: carrier.trim() || 'Standard carrier',
          zone: zone.trim() || 'Domestic',
          currency: currency.toUpperCase(),
          ...(freeAboveCents !== null ? { freeAboveCents } : {}),
          ...(min !== undefined ? { minDays: Math.round(min) } : {}),
          ...(max !== undefined ? { maxDays: Math.round(max) } : {}),
        },
      },
    });
    setName('');
    setRateInput('');
    setFreeAboveInput('');
    toast.success('Added shipping method to service items catalogue');
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">Loading shipping methods…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            Shipping Methods &amp; Rates
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Each method is saved as a service item in your catalogue so it can be added directly as a line on invoices, estimates, and purchase orders with standard tax rules.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('shipping-methods.csv', SHIPPING_METHODS_CSV_HEADERS, shippingMethodsCsvRows(rows))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div>
          <label htmlFor="ship-calc-sub" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Preview order subtotal (rate calculator)
          </label>
          <input id="ship-calc-sub" type="text" inputMode="decimal" value={calcSubtotalInput} onChange={e => setCalcSubtotalInput(e.target.value)} className={field} aria-invalid={calcSubtotalCents === null} aria-describedby={calcSubtotalCents === null ? 'ship-calc-sub-error' : undefined} />
          {calcSubtotalCents === null && <p id="ship-calc-sub-error" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">Enter the subtotal as an amount, for example 100.00</p>}
        </div>
        <div>
          <label htmlFor="ship-calc-ccy" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Order currency
          </label>
          <select id="ship-calc-ccy" value={calcCurrency} onChange={e => setCalcCurrency(e.target.value)} className={field}>
            {[...new Set([workspaceCurrency, ...COMMON_CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {canWrite && (
        <form onSubmit={handleAdd} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Add shipping method</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="sm-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Method name</label>
              <input id="sm-name" type="text" placeholder="Express 2-Day" value={name} onChange={e => setName(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sm-carrier" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Carrier</label>
              <input id="sm-carrier" type="text" placeholder="UPS / DHL / Israel Post" value={carrier} onChange={e => setCarrier(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sm-zone" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Zone</label>
              <input id="sm-zone" type="text" placeholder="Domestic / EU / US" value={zone} onChange={e => setZone(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sm-ccy" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Currency</label>
              <select id="sm-ccy" value={currency} onChange={e => setCurrency(e.target.value)} className={field}>
                {[...new Set([workspaceCurrency, ...COMMON_CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sm-rate" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Standard rate</label>
              <input id="sm-rate" type="text" inputMode="decimal" placeholder="14.95" value={rateInput} onChange={e => setRateInput(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sm-free" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Free above (optional)</label>
              <input id="sm-free" type="text" inputMode="decimal" placeholder="150.00" value={freeAboveInput} onChange={e => setFreeAboveInput(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sm-min" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Min days</label>
              <input id="sm-min" type="number" min="0" step="1" placeholder="2" value={minDays} onChange={e => setMinDays(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sm-max" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Max days</label>
              <input id="sm-max" type="number" min="0" step="1" placeholder="4" value={maxDays} onChange={e => setMaxDays(e.target.value)} className={field} />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> Add method
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No shipping methods configured</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Add carrier rates above to make them selectable on invoices, estimates, and purchase orders.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full text-sm text-start">
            <caption className="sr-only">Shipping methods and calculated charges</caption>
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 text-start">Method</th>
                <th scope="col" className="px-4 py-3 text-start">Carrier / Zone</th>
                <th scope="col" className="px-4 py-3 text-start">Transit</th>
                <th scope="col" className="px-4 py-3 text-end">Standard rate</th>
                <th scope="col" className="px-4 py-3 text-end">Free from</th>
                <th scope="col" className="px-4 py-3 text-end">Calculated fee ({calcCurrency})</th>
                {canWrite && <th scope="col" className="px-4 py-3 text-end">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map(r => {
                const quote = calcSubtotalCents === null ? null : quoteShippingCharge(r, calcSubtotalCents, calcCurrency);
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {r.name}
                      {r.sku && <span className="ml-1.5 text-xs text-slate-500">({r.sku})</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.carrier} · {r.zone}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {r.minDays !== undefined && r.maxDays !== undefined
                        ? `${r.minDays}–${r.maxDays} days`
                        : r.minDays !== undefined
                          ? `${r.minDays}d`
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums font-semibold">{formatCurrency(r.rateCents, r.currency)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-slate-600 dark:text-slate-400">
                      {r.freeAboveCents !== null ? formatCurrency(r.freeAboveCents, r.currency) : '—'}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums font-semibold">
                      {quote === null ? (
                        <span className="text-xs font-normal text-slate-500">—</span>
                      ) : quote.chargeCents === null ? (
                        <span className="text-xs font-normal text-amber-700 dark:text-amber-300">{r.currency} only</span>
                      ) : (
                        <>
                          {formatCurrency(quote.chargeCents, r.currency)}
                          {quote.freeApplied && (
                            <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[11px] rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              Free threshold met
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-end">
                        <button
                          type="button"
                          aria-label={`Remove shipping method ${r.name}`}
                          onClick={() => deleteEntity('inventory', r.id)}
                          className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
