import React, { useState } from 'react';
import { BadgePercent } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useLedgerCollections } from '../../../hooks/useLedgerCollections';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken } from '../../../firebase';
import { formatCurrency } from '../../../lib/utils';
import { listCurrency, priceListsProblem, type PriceList } from '../../../lib/priceLists';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/** A list being edited: amounts as typed. */
interface Draft { id?: string; name: string; currency: string; discount: string; prices: Array<{ key: string; itemId: string; price: string }>; customerIds: string[] }

const newKey = () => globalThis.crypto.randomUUID();
const toCents = (text: string) => Math.round(Number(text.replace(',', '.')) * 100);
const toDraft = (l: PriceList): Draft => ({
  id: l.id, name: l.name, currency: l.currency || '', discount: l.discountPercent ? String(l.discountPercent) : '', customerIds: [...(l.customerIds || [])],
  prices: Object.entries(l.prices || {}).map(([itemId, cents]) => ({ key: newKey(), itemId, price: (cents / 100).toFixed(2) })),
});
const fromDraft = (d: Draft) => ({
  ...(d.id ? { id: d.id } : {}), name: d.name,
  ...(d.currency.trim() ? { currency: d.currency.trim().toUpperCase() } : {}),
  ...(d.discount.trim() ? { discountPercent: Number(d.discount.replace(',', '.')) } : {}),
  ...(d.prices.some(p => p.itemId) ? { prices: Object.fromEntries(d.prices.filter(p => p.itemId).map(p => [p.itemId, p.price.trim() === '' ? Number.NaN : toCents(p.price)])) } : {}),
  ...(d.customerIds.length ? { customerIds: d.customerIds } : {}),
});

/**
 * Settings → Price lists (M-11): named prices for some customers, e.g. "Wholesale": 10% off every
 * item, and its own price for some items. A customer is on one list at most. On their invoices and
 * estimates, picking an item fills the list's price (it can still be changed on the line); nothing
 * posted changes. Owners and accountants keep them (saved by the server, priceListService.ts).
 */
export default function PriceListsSettings() {
  useLedgerCollections('customers', 'inventory');
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const customers = useLedgerStore(s => s.customers);
  const items = useLedgerStore(s => s.inventory);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  if (!workspace) return null;
  const lists = workspace.priceLists || [];
  const currency = workspace.currency || 'USD';
  const itemName = (id: string) => (items || []).find(i => i.id === id)?.name || id;
  const customerName = (id: string) => (customers || []).find(c => c.id === id)?.name || id;

  const save = async (next: Array<ReturnType<typeof fromDraft> | PriceList>, done: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/price-lists`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: JSON.stringify({ lists: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'The price lists were not saved');
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, priceLists: data.lists } : w)));
      toast.success(done);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const draft = editing?.draft;
  const nextLists = (d: Draft) => {
    const list: Array<ReturnType<typeof fromDraft> | PriceList> = [...lists];
    if (editing?.index === null || editing?.index === undefined) list.push(fromDraft(d)); else list[editing.index] = fromDraft(d);
    return list;
  };
  const problem = draft ? priceListsProblem(nextLists(draft), currency) : null;
  const set = (change: Partial<Draft>) => setEditing(e => e && ({ ...e, draft: { ...e.draft, ...change } }));
  const setPrice = (i: number, change: Partial<Draft['prices'][number]>) => setEditing(e => e && ({ ...e, draft: { ...e.draft, prices: e.draft.prices.map((p, j) => (j === i ? { ...p, ...change } : p)) } }));
  const liveItems = (items || []).filter(i => !(i as { isArchived?: boolean }).isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const shownCustomers = (customers || []).filter(c => !search.trim() || c.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100);

  return (
    <section aria-labelledby="price-lists-title" className="space-y-4">
      <div>
        <h2 id="price-lists-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><BadgePercent className="w-5 h-5" aria-hidden="true" /> Price lists</h2>
        <p className="text-sm text-[var(--muted)]">Prices for some customers, e.g. wholesale: a discount on every item, or a price of its own for some. On their invoices and estimates, picking an item fills the list's price; it can still be changed on the line.</p>
        {!canChange && <p className="text-sm text-[var(--muted)]">Owners and accountants keep the price lists.</p>}
      </div>
      <ul className="rounded-xl border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">
        {lists.length === 0 && <li className="p-4 text-sm text-[var(--muted)]">No price lists yet.</li>}
        {lists.map((l, index) => {
          const listCur = listCurrency(l, currency);
          return (
            <li key={l.id} className="p-4 flex flex-wrap items-start justify-between gap-2 text-sm">
              <div>
                <p className="font-semibold text-[var(--text)]">
                  <bdi>{l.name}</bdi>
                  {l.currency ? <span className="ml-2 text-xs font-mono text-[var(--muted)]">({listCur})</span> : null}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {[l.discountPercent ? `${l.discountPercent}% off every item` : '', ...Object.entries(l.prices || {}).slice(0, 5).map(([id, cents]) => `${itemName(id)} ${formatCurrency(cents, listCur)}`)].filter(Boolean).join(' · ')}
                  {Object.keys(l.prices || {}).length > 5 ? ` and ${Object.keys(l.prices || {}).length - 5} more` : ''}
                  {' · '}{(l.customerIds || []).length === 0 ? 'no customers yet' : `for ${(l.customerIds || []).slice(0, 3).map(customerName).join(', ')}${(l.customerIds || []).length > 3 ? ` and ${(l.customerIds || []).length - 3} more` : ''}`}
                </p>
              </div>
              {canChange && (
                <div className="flex gap-2 text-xs">
                  <button type="button" disabled={busy} onClick={() => setEditing({ index, draft: toDraft(l) })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Change<span className="sr-only"> {l.name}</span></button>
                  <button type="button" disabled={busy} onClick={() => void save(lists.filter((_, i) => i !== index), `Price list ${l.name} removed`)} className="text-rose-600 hover:underline">Remove<span className="sr-only"> {l.name}</span></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canChange && draft && (
        <fieldset disabled={busy} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3 text-sm">
          <legend className="px-1 font-semibold text-[var(--text)]">{editing?.index === null ? 'New price list' : 'Change the price list'}</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[var(--muted)]">Name<input value={draft.name} onChange={e => set({ name: e.target.value })} className={field} /></label>
            <label className="flex flex-col gap-1 text-[var(--muted)]">Currency<input aria-label="Currency" value={draft.currency} onChange={e => set({ currency: e.target.value })} placeholder={currency} maxLength={3} className={`${field} w-24 uppercase`} /></label>
            <label className="flex flex-col gap-1 text-[var(--muted)]">Discount on every item, %<input inputMode="decimal" value={draft.discount} onChange={e => set({ discount: e.target.value })} placeholder="none" className={`${field} w-28`} /></label>
          </div>
          <div role="group" aria-label="Prices of their own" className="space-y-2">
            <p className="text-xs text-[var(--muted)]">Items with a price of their own on this list (the discount does not apply to them):</p>
            {draft.prices.map((p, i) => (
              <div key={p.key} className="flex flex-wrap items-center gap-2">
                <select aria-label={`Item ${i + 1}`} value={p.itemId} onChange={e => setPrice(i, { itemId: e.target.value })} className={field}>
                  <option value="">Choose an item</option>
                  {liveItems.map(it => <option key={it.id} value={it.id}>{it.name} ({formatCurrency(it.unitPriceCents, currency)})</option>)}
                </select>
                <input inputMode="decimal" aria-label={`Item ${i + 1} price`} value={p.price} onChange={e => setPrice(i, { price: e.target.value })} className={`${field} w-28 text-right`} />
                <button type="button" onClick={() => set({ prices: draft.prices.filter((_, j) => j !== i) })} className="text-xs text-rose-600 hover:underline">Remove item {i + 1}</button>
              </div>
            ))}
            <button type="button" onClick={() => set({ prices: [...draft.prices, { key: newKey(), itemId: '', price: '' }] })} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Add an item's price</button>
          </div>
          <div role="group" aria-label="Customers on this list" className="space-y-1">
            <p className="text-xs text-[var(--muted)]">Customers on this list ({draft.customerIds.length}); a customer is on one list at most:</p>
            <input aria-label="Find a customer" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a customer" className={field} />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {shownCustomers.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-[var(--text)]">
                  <input type="checkbox" checked={draft.customerIds.includes(c.id)} onChange={e => set({ customerIds: e.target.checked ? [...draft.customerIds, c.id] : draft.customerIds.filter(x => x !== c.id) })} />
                  <bdi>{c.name}</bdi>
                </label>
              ))}
            </div>
          </div>
          {problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={Boolean(problem)} onClick={() => void save(nextLists(draft), `Price list ${draft.name.trim()} saved`)} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save price list</button>
            <button type="button" onClick={() => setEditing(null)} className="text-[var(--muted)] hover:underline">Cancel</button>
          </div>
        </fieldset>
      )}
      {canChange && !draft && (
        <button type="button" onClick={() => setEditing({ index: null, draft: { name: '', currency: '', discount: '', prices: [], customerIds: [] } })}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--elevated)]">New price list</button>
      )}
    </section>
  );
}
