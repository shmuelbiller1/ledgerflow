import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { getIdToken } from '../../firebase';
import { runCommand } from '../../lib/runCommand';
import { resolveAccountRole } from '../../lib/accountUtils';
import { getLocalDateISO, formatDate } from '../../lib/utils';
import { findAccount, reversalDate } from '../../services/ledgerPost/postingKit';
import { deliveredByLine, deliveryLines, deliveryProblem, newDeliveryId, newReturnId, orderDeliveries, returnProblem } from '../../lib/deliveries';
import type { Estimate } from '../../types';
import { RowTable } from '../ui/RowTable';

const field = 'px-2 py-1 text-sm bg-[var(--ink)] border border-[var(--line)] rounded text-[var(--text)]';

/**
 * Deliver from an order (BF-08 step 2), where stock leaves with deliveries: how many of each item
 * leave now (never more than is left), the date and, if wanted, the location they leave from. The
 * server lowers stock and books their cost once (src/server/services/deliveryService.ts). Earlier
 * deliveries are listed with Undo, which puts their units back. Goods that came back later are
 * recorded under "Came back" (stock in, cost taken back at what the delivery booked; the money is a
 * credit note, made apart). The rules: src/lib/deliveries.ts.
 */
export default function OrderDeliveryDialog({ order, canWrite, onClose }: { order: Estimate; canWrite: boolean; onClose: () => void }) {
  const { dialogProps, titleId } = useDialog(onClose, true);
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  useLedgerCollections('transactions', 'accounts');
  const transactions = useLedgerStore(s => s.transactions);
  const accounts = useLedgerStore(s => s.accounts);
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const delivered = useMemo(() => deliveredByLine(transactions || [], order.id), [transactions, order.id]);
  const deliveries = useMemo(() => orderDeliveries(transactions || [], order.id), [transactions, order.id]);
  const lines = deliveryLines(order, delivered);
  const [now, setNow] = useState<Record<number, string>>(() => Object.fromEntries(lines.map(l => [l.position, String(l.left)])));
  const [date, setDate] = useState(getLocalDateISO());
  const [locationId, setLocationId] = useState('');
  // one id per attempt: a retry after a lost answer is recognised by the server, a new delivery is not
  const [deliveryId, setDeliveryId] = useState(newDeliveryId);
  const [busy, setBusy] = useState(false);
  const quantities = lines.map(l => ({ position: l.position, quantity: now[l.position]?.trim() ? Number(now[l.position]) : 0 }));
  const problem = deliveryProblem(lines, quantities);
  // goods that came back after a delivery
  const [back, setBack] = useState<Record<number, string>>({});
  const [returnId, setReturnId] = useState(newReturnId);
  const backQuantities = lines.map(l => ({ position: l.position, quantity: back[l.position]?.trim() ? Number(back[l.position]) : 0 }));
  const backProblem = returnProblem(lines, backQuantities);
  const anyDelivered = lines.some(l => l.delivered > 0);
  const name = order.number || order.id;

  // the JSON calls go through the one place a screen talks to its server; the delivery-note download
  // below stays a plain fetch because it reads a blob, not JSON
  const request = (path: string, body: Record<string, unknown>) =>
    runCommand<{ warnings?: string[] }>({ path, method: 'POST', body });

  const stockAccounts = () => {
    const mappings = workspace?.defaultAccountMappings || {};
    const inventory = findAccount(accounts || [], mappings, ['inventory', 'stock', 'inventory asset'], a => resolveAccountRole(a) === 'inventory');
    const cogs = findAccount(accounts || [], mappings, ['cogs', 'cost of goods sold', 'direct costs'], a => resolveAccountRole(a) === 'cogs');
    return inventory && cogs ? { inventoryAccountId: inventory.id, cogsAccountId: cogs.id } : null;
  };

  // M-12: the delivery note as a PDF, opened in a new tab to print or save
  const openNote = async (id: string) => {
    if (!workspace) return;
    try {
      const res = await fetch(`/api/v1/inventory/deliveries/${encodeURIComponent(id)}/note?${new URLSearchParams({ workspaceId: workspace.id, orderId: order.id })}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The delivery note could not be made');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const recordReturn = async () => {
    if (backProblem || busy || !workspace) return;
    const accountIds = stockAccounts();
    if (!accountIds) { toast.error('Add an Inventory account and a Cost of Goods Sold account first'); return; }
    setBusy(true);
    try {
      await request('/api/v1/inventory/deliveries/returns', { workspaceId: workspace.id, orderId: order.id, returnId, date, lines: backQuantities.filter(q => q.quantity > 0), ...accountIds });
      toast.success('Recorded: the goods are back in stock. Make a credit note for the money if it is owed back.');
      setBack({});
      setReturnId(newReturnId());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deliver = async () => {
    if (problem || busy || !workspace) return;
    const mappings = workspace.defaultAccountMappings || {};
    const inventory = findAccount(accounts || [], mappings, ['inventory', 'stock', 'inventory asset'], a => resolveAccountRole(a) === 'inventory');
    const cogs = findAccount(accounts || [], mappings, ['cogs', 'cost of goods sold', 'direct costs'], a => resolveAccountRole(a) === 'cogs');
    if (!inventory || !cogs) { toast.error('Add an Inventory account and a Cost of Goods Sold account first'); return; }
    setBusy(true);
    try {
      const data = await request('/api/v1/inventory/deliveries', {
        workspaceId: workspace.id, orderId: order.id, deliveryId, date, lines: quantities.filter(q => q.quantity > 0),
        inventoryAccountId: inventory.id, cogsAccountId: cogs.id, ...(locationId.trim() ? { locationId: locationId.trim() } : {}),
      });
      (data.warnings || []).forEach(w => toast.warning(w));
      toast.success(`Delivered from order ${name}`);
      setDeliveryId(newDeliveryId());
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (id: string, deliveredOn: string) => {
    if (busy || !workspace) return;
    setBusy(true);
    try {
      await request(`/api/v1/inventory/deliveries/${encodeURIComponent(id)}/undo`, { workspaceId: workspace.id, orderId: order.id, date: reversalDate(deliveredOn, getLocalDateISO()) });
      toast.success('Delivery undone: the units are back in stock');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const describe = (position: number) => lines.find(l => l.position === position)?.description || 'item';

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Deliver: order <bdi>{name}</bdi></h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-[var(--muted)]">The units that leave now come out of stock and their cost is booked. Invoicing is separate.</p>
                    <RowTable
            rowHeaderColumn={false}
            rowClassName="border-b border-[var(--line)]/50"
            caption={(<>Items of order {name}</>)}
            rows={lines}
            rowKey={l => l.position}
            headRowClassName="text-[var(--muted)] border-b border-[var(--line)]"
            columns={[
              { header: "Item", className: "font-semibold py-1", cell: (l) => <bdi>{l.description || 'Item'}</bdi> },
              { header: "Ordered", align: 'right', className: "font-semibold py-1 font-mono", cell: (l) => l.ordered },
              { header: "Delivered", align: 'right', className: "font-semibold py-1 font-mono", cell: (l) => l.delivered },
              { header: "Now", align: 'right', className: "font-semibold py-1", cell: (l) => <input aria-label={`Deliver now: ${l.description || 'item'}`} inputMode="decimal" value={now[l.position] ?? ''} disabled={!canWrite || l.left === 0}
                      onChange={e => setNow(n => ({ ...n, [l.position]: e.target.value }))} className={`${field} w-20 text-right font-mono`} /> },
            ]}
          />
          {canWrite && (
            <div className="flex flex-wrap items-end gap-3 text-xs">
              <label className="flex flex-col gap-0.5 text-[var(--muted)]">Date
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-0.5 text-[var(--muted)]">From location (optional)
                <input list="delivery-locations" value={locationId} onChange={e => setLocationId(e.target.value)} className={`${field} w-36`} />
              </label>
              <datalist id="delivery-locations">{(nodes || []).filter(n => n.dimensionId === 'location').map(n => <option key={n.id} value={n.id}>{n.description}</option>)}</datalist>
              <button type="button" onClick={() => void deliver()} disabled={Boolean(problem) || busy}
                className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Deliver</button>
              {problem && <p role="status" className="w-full text-amber-700 dark:text-amber-400">{problem}</p>}
            </div>
          )}
          {canWrite && anyDelivered && (
            <fieldset className="space-y-2 rounded-lg border border-[var(--line)] p-3 text-xs">
              <legend className="px-1 font-semibold text-[var(--muted)]">Came back</legend>
              {lines.filter(l => l.delivered > 0).map(l => (
                <label key={l.position} className="flex items-center justify-between gap-2">
                  <span><bdi>{l.description || 'Item'}</bdi> <span className="text-[var(--muted)]">(of {l.delivered} delivered)</span></span>
                  <input aria-label={`Came back: ${l.description || 'item'}`} inputMode="decimal" value={back[l.position] ?? ''}
                    onChange={e => setBack(b => ({ ...b, [l.position]: e.target.value }))} className={`${field} w-20 text-right font-mono`} />
                </label>
              ))}
              {Object.values(back).some(v => v.trim()) && backProblem && <p role="status" className="text-amber-700 dark:text-amber-400">{backProblem}</p>}
              <button type="button" onClick={() => void recordReturn()} disabled={Boolean(backProblem) || busy}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold text-[var(--text)] disabled:opacity-50">Record what came back</button>
            </fieldset>
          )}
          {deliveries.length > 0 && (
            <section aria-labelledby={`${titleId}-done`}>
              <h3 id={`${titleId}-done`} className="text-xs font-semibold text-[var(--muted)] mb-1">Delivered so far</h3>
              <ul className="space-y-1 text-xs">
                {deliveries.map(d => (
                  <li key={d.deliveryId} className="flex items-center justify-between gap-2 rounded border border-[var(--line)] px-2 py-1">
                    <span>{formatDate(d.date)}: {d.lines.map(l => `${describe(l.position)} × ${l.quantity}`).join(', ')}</span>
                    <span className="flex gap-3">
                      <button type="button" onClick={() => void openNote(d.deliveryId)} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                        Delivery note<span className="sr-only"> of {formatDate(d.date)}</span>
                      </button>
                      {canWrite && (
                        <button type="button" disabled={busy} onClick={() => void undo(d.deliveryId, d.date)} className="text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                          Undo<span className="sr-only"> the delivery of {formatDate(d.date)}</span>
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
