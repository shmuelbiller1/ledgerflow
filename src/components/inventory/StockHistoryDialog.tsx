/**
 * Stock history (W-02) of one item, on Inventory: every change to its quantity on hand, oldest
 * first, with why it changed (sold, sale undone, bought, opening stock, adjusted, counted), the
 * change, the quantity after, its value, and the entry it belongs to. Read-only: the server writes
 * the history with each change (src/server/services/stockMoveService.ts). When the history does not
 * end at the quantity on hand it says so (the same rule as the nightly check).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { db } from '../../firebase';
import { collection, getDocs, query, where } from '../../lib/db/firestore';
import { useDialog } from '../../hooks/useDialog';
import { useUIStore } from '../../stores/useUIStore';
import { NO_LOCATION, orderedMoves, STOCK_MOVE_LABEL, stockByLocation, stockHistoryProblem, transferProblem, type StockMove } from '../../lib/stockMoves';
import { formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { getIdToken } from '../../firebase';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { isCollectionCapped } from '../../lib/ledgerCollections';
import type { LedgerKey } from '../../lib/ledgerCollections';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { resolveDimensionLabel } from '../../lib/dimensionUtils';
import { toast } from 'sonner';
import type { InventoryItem, PurchaseOrder } from '../../types';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useCollection } from '../../hooks/useCollection';
import { stockTrail, stockTrailSummary, type StockTrailDocs, type TrailStep } from '../../lib/stockTrail';

export default function StockHistoryDialog({ item, workspaceId, currency, onClose }: { item: InventoryItem; workspaceId: string; currency: string; onClose: () => void }) {
  const { dialogProps, titleId } = useDialog(onClose, true);
  const openRecord = useUIStore(s => s.openRecord);
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const canMove = ['owner', 'accountant', 'bookkeeper'].includes(useCurrentRole());
  const nodes = useLedgerStore(s => s.dimensionNodes || []);
  const locationName = (id: string) => (id === NO_LOCATION ? 'No location' : resolveDimensionLabel(nodes, 'location', id));
  const [move, setMove] = useState({ from: NO_LOCATION, to: '', quantity: '', date: getLocalDateISO() });
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let live = true;
    getDocs(query(collection(db, 'stockMoves'), where('workspaceId', '==', workspaceId), where('itemId', '==', item.id)))
      .then(snap => { if (live) setMoves(orderedMoves(snap.docs.map(d => ({ ...(d.data() as StockMove), id: d.id })))); })
      .catch(err => { if (live) { setError(err instanceof Error ? err.message : String(err)); setMoves([]); } });
    return () => { live = false; };
  }, [workspaceId, item.id, reload]);

  // DIM-2: where each change came from or went (the document and the party on it), read from what is loaded
  const { loading: docsLoading } = useLedgerCollections('bills', 'invoices', 'creditNotes', 'vendorCredits', 'estimates', 'transactions', 'vendors', 'customers');
  const { data: purchaseOrders, loading: ordersLoading, truncated: ordersTruncated } = useCollection<PurchaseOrder>('purchaseOrders', { workspaceId, limit: 1000 });
  const bills = useLedgerStore(s => s.bills);
  const invoices = useLedgerStore(s => s.invoices);
  const creditNotes = useLedgerStore(s => s.creditNotes);
  const vendorCredits = useLedgerStore(s => s.vendorCredits);
  const orders = useLedgerStore(s => s.estimates);
  const transactions = useLedgerStore(s => s.transactions);
  const vendors = useLedgerStore(s => s.vendors);
  const customers = useLedgerStore(s => s.customers);
  const truncatedCollections = useLedgerStore(s => s.truncatedCollections);
  // #260 review: each list's own completeness, and the trail worked out once per change of its inputs
  const trail = useMemo(() => {
    if (!moves || moves.length === 0) return null;
    const cut = (k: LedgerKey) => docsLoading || isCollectionCapped(truncatedCollections, k);
    return stockTrail(moves, {
      bills, invoices, creditNotes, vendorCredits, orders, purchaseOrders: purchaseOrders || [], transactions, vendors, customers,
      partial: {
        bills: cut('bills'), invoices: cut('invoices'), creditNotes: cut('creditNotes'), vendorCredits: cut('vendorCredits'), orders: cut('estimates'),
        transactions: cut('transactions'), purchaseOrders: ordersLoading || Boolean(ordersTruncated),
      },
    } as unknown as StockTrailDocs);
  }, [moves, bills, invoices, creditNotes, vendorCredits, orders, purchaseOrders, transactions, vendors, customers, truncatedCollections, docsLoading, ordersLoading, ordersTruncated]);
  const stepOf = useMemo(() => new Map<string, TrailStep>((trail?.steps || []).map(st => [st.move.id || st.move.seq, st])), [trail]);
  const problem = moves ? stockHistoryProblem(item, moves) : null;
  // W-01: where the units are (an item without a history has all its stock at no location)
  const at = moves && moves.length > 0 ? stockByLocation(moves) : new Map([[NO_LOCATION, Number(item.quantityAtHand) || 0]]);
  const moveProblem = move.quantity ? transferProblem({ quantity: Number(move.quantity), from: move.from, to: move.to.trim() }, at) : null;
  const doMove = async () => {
    if (moveProblem || !move.quantity) return;
    setMoving(true);
    try {
      const res = await fetch('/api/v1/inventory/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ workspaceId, itemId: item.id, from: move.from, to: move.to.trim(), quantity: Number(move.quantity), date: move.date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The stock was not moved');
      toast.success(`Moved ${move.quantity} to ${locationName(move.to.trim())}`);
      setMove(m => ({ ...m, quantity: '' }));
      setReload(n => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMoving(false);
    }
  };
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Stock history: <bdi>{item.name}</bdi></h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-xs text-[var(--muted)]">{item.quantityAtHand} on hand now. Every change below was recorded with the entry it belongs to.</p>
          {error && <p role="alert" className="text-xs text-rose-600">The history could not be loaded: {error}</p>}
          {problem && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{problem}. Count the stock to set it right.</p>}
          {trail && <p className="text-xs text-[var(--muted)]" data-testid="stock-trail-summary">Where it came from: {stockTrailSummary(trail)}</p>}
          {(at.size > 1 || [...at.keys()].some(k => k !== NO_LOCATION)) && (
            <ul aria-label="By location" className="flex flex-wrap gap-2 text-xs">
              {[...at.entries()].map(([where, n]) => (
                <li key={where || 'none'} className="rounded-full border border-[var(--line)] px-2.5 py-0.5"><bdi>{locationName(where)}</bdi>: <span className="font-mono">{n}</span></li>
              ))}
            </ul>
          )}
          {canMove && moves !== null && (
            <fieldset disabled={moving} className="flex flex-wrap items-end gap-2 text-xs rounded-lg border border-[var(--line)] p-3">
              <legend className="px-1 font-semibold text-[var(--muted)]">Move stock between locations</legend>
              <label className="flex flex-col gap-0.5">From
                <select value={move.from} onChange={e => setMove(m => ({ ...m, from: e.target.value }))} className="rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1">
                  {[...at.keys()].map(where => <option key={where || 'none'} value={where}>{locationName(where)} ({at.get(where)})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">To
                <input list="stock-locations" value={move.to} onChange={e => setMove(m => ({ ...m, to: e.target.value }))} placeholder="Location" className="w-32 rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1" />
              </label>
              <datalist id="stock-locations">{nodes.filter(n => n.dimensionId === 'location').map(n => <option key={n.id} value={n.id}>{n.description}</option>)}</datalist>
              <label className="flex flex-col gap-0.5">How many
                <input inputMode="decimal" value={move.quantity} onChange={e => setMove(m => ({ ...m, quantity: e.target.value }))} className="w-20 rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-right font-mono" />
              </label>
              <label className="flex flex-col gap-0.5">Date
                <input type="date" value={move.date} onChange={e => setMove(m => ({ ...m, date: e.target.value }))} className="rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1" />
              </label>
              <button type="button" onClick={() => void doMove()} disabled={!move.quantity || Boolean(moveProblem)} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Move</button>
              {moveProblem && <p role="status" className="w-full text-amber-700 dark:text-amber-400">{moveProblem}</p>}
            </fieldset>
          )}
          {moves === null ? <p className="text-xs text-[var(--muted)]">Loading…</p> : moves.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No recorded changes yet (changes are recorded from 7 Oct 2026 on).</p>
          ) : (
            <table className="w-full text-xs">
              <caption className="sr-only">Changes to the stock of {item.name}, oldest first</caption>
              <thead>
                <tr className="text-[var(--muted)] border-b border-[var(--line)]">
                  <th scope="col" className="text-left font-semibold py-1">Date</th>
                  <th scope="col" className="text-left font-semibold py-1">What</th>
                  <th scope="col" className="text-right font-semibold py-1">Change</th>
                  <th scope="col" className="text-right font-semibold py-1">On hand after</th>
                  <th scope="col" className="text-right font-semibold py-1">Value</th>
                  <th scope="col" className="text-left font-semibold py-1 pl-3">From / to</th>
                  <th scope="col" className="py-1"><span className="sr-only">Entry</span></th>
                </tr>
              </thead>
              <tbody>
                {moves.map(m => (
                  <tr key={m.id || m.seq} className="border-b border-[var(--line)]/50">
                    <td className="py-1">{formatDate(m.date)}</td>
                    <td className="py-1">{STOCK_MOVE_LABEL[m.kind] || m.kind}{m.locationId ? <span className="text-[var(--muted)]"> · <bdi>{locationName(m.locationId)}</bdi></span> : null}</td>
                    <td className={`py-1 text-right font-mono ${m.quantity < 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{signed(m.quantity)}</td>
                    <td className="py-1 text-right font-mono">{m.quantityAfter}</td>
                    <td className="py-1 text-right font-mono">{formatCurrency(m.valueCents, currency)}</td>
                    <td className="py-1 pl-3"><TrailCell step={stepOf.get(m.id || m.seq)} labelName={(dim, id) => resolveDimensionLabel(nodes, dim, id)} /></td>
                    <td className="py-1 text-right">
                      {m.transactionId && (
                        <button type="button" onClick={() => { onClose(); openRecord({ type: 'transaction', id: String(m.transactionId) }); }} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          Entry<span className="sr-only"> of {formatDate(m.date)}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/** DIM-2: the document and party of one change; a missing link is named, an unrecorded origin says so. */
function TrailCell({ step, labelName }: { step?: TrailStep; labelName: (dimensionId: string, id: string) => string }) {
  if (!step) return null;
  if (step.origin === 'not-recorded') return <span className="text-[var(--muted)]">Origin not recorded</span>;
  if (step.origin === 'internal') return <span className="text-[var(--muted)]">{step.move.kind === 'purchase' || step.move.kind === 'purchase-reversal' ? 'Stock adjustment (no bill)' : 'Inside the business'}{step.purpose ? <>: <bdi>{step.purpose}</bdi></> : null}</span>;
  return (
    <span>
      {step.party && <bdi>{step.party.name}</bdi>}
      {step.document && <span className="text-[var(--muted)]">{step.party ? ' · ' : ''}{step.document.label}</span>}
      {step.sourceLine && <span className="text-[var(--muted)]">{step.document?.type === 'vendor-credit' ? ' · ' : ', '}{step.sourceLine}</span>}
      {step.purchaseOrder && <span className="text-[var(--muted)]"> · {step.purchaseOrder.label}{step.purchaseOrder.receipts.length ? ` (received ${step.purchaseOrder.receipts.join(', ')})` : ''}</span>}
      {step.labels && <span className="block text-[var(--muted)]">{Object.entries(step.labels).map(([dim, id]) => <bdi key={dim}>{labelName(dim, id)}</bdi>).reduce<React.ReactNode[]>((all, el, i) => (i ? [...all, ' · ', el] : [el]), [])}</span>}
      {step.missing.map(m => <span key={m} className="block text-amber-700 dark:text-amber-400">{m}</span>)}
    </span>
  );
}
