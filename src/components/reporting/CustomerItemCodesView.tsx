/**
 * A-122: Customer-specific item codes — map internal catalogue items to each customer's part code
 * and buyer description, search either side instantly, flag duplicate codes for the same buyer, and
 * export CSV.
 */
import React, { useMemo, useState } from 'react';
import { Barcode, Download, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { downloadCsv } from '../../lib/csvExport';
import {
  buildCustomerItemCodeRows,
  CUSTOMER_ITEM_CODES_CSV_HEADERS,
  customerItemCodesCsvRows,
  customerItemCodesFromItem,
  upsertCustomerItemCode,
} from '../../lib/customerItemCodes';

const field = 'w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white';

export default function CustomerItemCodesView() {
  const inventory = useLedgerStore(s => s.inventory);
  const customers = useLedgerStore(s => s.customers);
  const { loading } = useLedgerCollections('inventory', 'customers');
  const canWrite = useCurrentRole() !== 'viewer';
  const { updateEntity } = useEntityOperations();

  const [query, setQuery] = useState('');
  const [itemId, setItemId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerDescription, setCustomerDescription] = useState('');

  const rows = useMemo(
    () => buildCustomerItemCodeRows(inventory || [], customers || []),
    [inventory, customers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      `${r.customerName} ${r.customerCode} ${r.customerDescription || ''} ${r.itemName} ${r.internalSku}`
        .toLowerCase()
        .includes(q));
  }, [rows, query]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetItem = (inventory || []).find(i => i.id === itemId);
    if (!targetItem) {
      toast.error('Choose an internal item.');
      return;
    }
    if (!customerId) {
      toast.error('Choose a customer.');
      return;
    }
    if (!customerCode.trim()) {
      toast.error('Enter the customer part code.');
      return;
    }
    const next = upsertCustomerItemCode(customerItemCodesFromItem(targetItem), {
      customerId,
      customerCode,
      customerDescription,
    });
    await updateEntity('inventory', targetItem.id, {
      metadata: { ...(targetItem.metadata || {}), customerItemCodes: next },
    });
    setCustomerCode('');
    setCustomerDescription('');
  };

  const handleRemove = async (targetItemId: string, targetCustomerId: string) => {
    const targetItem = (inventory || []).find(i => i.id === targetItemId);
    if (!targetItem) return;
    const next = upsertCustomerItemCode(customerItemCodesFromItem(targetItem), {
      customerId: targetCustomerId,
      customerCode: '',
    });
    await updateEntity('inventory', targetItem.id, {
      metadata: { ...(targetItem.metadata || {}), customerItemCodes: next },
    });
  };

  if (loading) {
    return <p className="p-6 text-sm text-slate-600 dark:text-slate-400">Loading customer item codes…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Barcode className="w-6 h-6 text-indigo-600" aria-hidden="true" />
            Customer Item Codes
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Cross-reference each buyer&apos;s part numbers and descriptions against your internal SKUs so incoming customer orders resolve cleanly without altering catalogue SKUs or posted invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv('customer-item-codes.csv', CUSTOMER_ITEM_CODES_CSV_HEADERS, customerItemCodesCsvRows(filtered))}
          className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> Export CSV
        </button>
      </div>

      <div>
        <label htmlFor="cic-search" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
          Lookup by buyer part code, customer name, or internal SKU
        </label>
        <input
          id="cic-search"
          type="search"
          placeholder="Search e.g. CUST-9941 or internal SKU…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className={field}
        />
      </div>

      {canWrite && (
        <form onSubmit={handleSave} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Add or update buyer part code mapping</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="cic-customer" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Customer</label>
              <select id="cic-customer" value={customerId} onChange={e => setCustomerId(e.target.value)} className={field}>
                <option value="">Select customer…</option>
                {(customers || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cic-item" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Internal item</label>
              <select id="cic-item" value={itemId} onChange={e => setItemId(e.target.value)} className={field}>
                <option value="">Select item…</option>
                {(inventory || []).map(it => <option key={it.id} value={it.id}>{it.name}{it.sku ? ` (${it.sku})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cic-code" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Buyer part code</label>
              <input id="cic-code" type="text" maxLength={80} placeholder="ACME-PN-402" value={customerCode} onChange={e => setCustomerCode(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="cic-desc" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Buyer item title (optional)</label>
              <input id="cic-desc" type="text" maxLength={160} placeholder="Buyer PO wording" value={customerDescription} onChange={e => setCustomerDescription(e.target.value)} className={field} />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" aria-hidden="true" /> Save mapping
            </button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">No buyer part codes matched</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Add a mapping above to link a customer&apos;s part number to your internal catalogue item.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full text-sm text-start">
            <caption className="sr-only">Customer part numbers cross-reference</caption>
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 text-start">Customer</th>
                <th scope="col" className="px-4 py-3 text-start">Buyer part code</th>
                <th scope="col" className="px-4 py-3 text-start">Buyer title</th>
                <th scope="col" className="px-4 py-3 text-start">Internal item</th>
                <th scope="col" className="px-4 py-3 text-start">Internal SKU</th>
                {canWrite && <th scope="col" className="px-4 py-3 text-end">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filtered.map(r => (
                <tr key={`${r.itemId}-${r.customerId}`}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{r.customerName}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                    {r.customerCode}
                    {r.duplicateForCustomer && (
                      <span className="ml-2 inline-block px-2 py-0.5 text-[11px] font-sans font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Duplicate for buyer
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{r.customerDescription || '—'}</td>
                  <td className="px-4 py-3 text-slate-900 dark:text-white">{r.itemName}</td>
                  <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-400">{r.internalSku || '—'}</td>
                  {canWrite && (
                    <td className="px-4 py-3 text-end">
                      <button
                        type="button"
                        aria-label={`Remove ${r.customerCode} for ${r.customerName}`}
                        onClick={() => handleRemove(r.itemId, r.customerId)}
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
