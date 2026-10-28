import React, { useState } from 'react';
import { toast } from 'sonner';
import { db, getIdToken } from '../../firebase';
import { doc, updateDoc } from '../../lib/db/firestore';
import { useDialog } from '../../hooks/useDialog';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { formatCurrency, formatDate, isAmountText, parseAmountToCents } from '../../lib/utils';
import type { ChartAccount, FixedAsset } from '../../types';

/**
 * Construction in progress on the Fixed Asset Register (X-09). While an asset is being built:
 * "Add cost" records what it cost so far (post the bill itself to the construction-in-progress
 * account, as for any purchase), and "Place in service" asks the server to move the cost into the
 * asset account it belongs in and start depreciating it. Once placed, "Undo placing in service" works
 * until it is depreciated, sold in part or moved.
 */
const field = 'w-full p-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] text-sm text-[var(--text)]';

export function ConstructionActions({ asset, accounts, workspaceId, today, currency }: { asset: FixedAsset; accounts: ChartAccount[]; workspaceId: string; today: string; currency: string }) {
  const [mode, setMode] = useState<'' | 'cost' | 'service'>('');
  const { dialogProps, titleId } = useDialog(() => setMode(''), mode !== '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState('');
  const [years, setYears] = useState(String(asset.usefulLifeYears || 5));
  const [salvage, setSalvage] = useState(String((asset.salvageValueCents || 0) / 100));
  const [busy, setBusy] = useState(false);
  const assetAccounts = accounts.filter(a => !a.isArchived && String(a.type).toLowerCase() === 'asset' && a.id !== asset.assetAccountId && !/accumulated/i.test(a.name));

  const open = (next: 'cost' | 'service') => { setAmount(''); setNote(''); setDate(today); setMode(next); };

  const addCost = async () => {
    const cents = isAmountText(amount, { complete: true }) ? parseAmountToCents(amount) : 0;
    if (!(cents > 0)) { toast.error('Enter what it cost'); return; }
    setBusy(true);
    try {
      const costAdditions = [...(asset.costAdditions || []), { date, amountCents: cents, ...(note.trim() ? { note: note.trim().slice(0, 120) } : {}) }];
      const purchasePriceCents = (asset.purchasePriceCents || 0) + cents;
      await updateDoc(doc(db, 'assets', asset.id), { purchasePriceCents, costAdditions, updatedAt: new Date().toISOString() });
      useLedgerStore.setState(state => ({ assets: state.assets.map(a => (a.id === asset.id ? { ...a, purchasePriceCents, costAdditions } : a)) }));
      toast.success(`${formatCurrency(cents, currency)} added to ${asset.name}`);
      setMode('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const call = async (method: 'POST' | 'DELETE', body?: unknown) => {
    const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(asset.id)}/in-service`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'That did not work');
    return data as { description?: string };
  };

  const placeInService = async () => {
    if (salvage.trim() && !isAmountText(salvage, { complete: true })) { toast.error('Enter the salvage value as an amount'); return; }
    setBusy(true);
    try {
      const data = await call('POST', { date, assetAccountId: accountId, usefulLifeYears: Number(years), salvageValueCents: parseAmountToCents(salvage) || 0 });
      toast.success(data.description || `${asset.name} is in service`);
      setMode('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    try {
      await call('DELETE');
      toast.success(`${asset.name} is being built again`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (asset.status === 'active' && asset.placedInService) {
    const undoable = !(asset.accumulatedDepreciationCents || 0) && !asset.depreciatedThrough;
    return undoable ? (
      <button type="button" disabled={busy} onClick={() => void undo()} className="block ml-auto mt-1 text-xs font-semibold text-[var(--muted)] hover:underline disabled:opacity-50">
        Undo placing in service<span className="sr-only"> {asset.name}</span>
      </button>
    ) : null;
  }
  if (asset.status !== 'in_progress') return null;

  return (
    <>
      <button type="button" onClick={() => open('cost')} className="block ml-auto text-xs font-semibold text-[var(--brass)] hover:underline">
        Add cost<span className="sr-only"> to {asset.name}</span>
      </button>
      <button type="button" onClick={() => open('service')} className="block ml-auto mt-1 text-xs font-semibold text-[var(--brass)] hover:underline">
        Place in service<span className="sr-only"> {asset.name}</span>
      </button>
      {mode && (
        <div {...dialogProps} className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 text-left">
          <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)] p-5 space-y-3 text-xs whitespace-normal">
            <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">{mode === 'cost' ? `Add a cost to ${asset.name}` : `Place ${asset.name} in service`}</h2>
            <div>
              <label htmlFor={`cip-date-${asset.id}`} className="block font-semibold text-[var(--text)] mb-1">{mode === 'cost' ? 'Day' : 'Ready to use on'}</label>
              <input id={`cip-date-${asset.id}`} type="date" value={date} max={today} onChange={e => setDate(e.target.value)} className={field} />
            </div>
            {mode === 'cost' ? (
              <>
                <div>
                  <label htmlFor={`cip-amount-${asset.id}`} className="block font-semibold text-[var(--text)] mb-1">Amount</label>
                  <input id={`cip-amount-${asset.id}`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={`${field} font-mono`} />
                </div>
                <div>
                  <label htmlFor={`cip-note-${asset.id}`} className="block font-semibold text-[var(--text)] mb-1">What for (optional)</label>
                  <input id={`cip-note-${asset.id}`} value={note} maxLength={120} onChange={e => setNote(e.target.value)} className={field} />
                </div>
                <p className="text-[var(--muted)]">Post the bill itself to the construction-in-progress account; this keeps the register's total.</p>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor={`cip-account-${asset.id}`} className="block font-semibold text-[var(--text)] mb-1">Asset account it belongs in</label>
                  <select id={`cip-account-${asset.id}`} value={accountId} onChange={e => setAccountId(e.target.value)} className={field}>
                    <option value="">Choose…</option>
                    {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ''}{a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`cip-years-${asset.id}`} className="block font-semibold text-[var(--text)] mb-1">Useful life (years)</label>
                    <input id={`cip-years-${asset.id}`} type="number" min="0.5" step="0.5" value={years} onChange={e => setYears(e.target.value)} className={field} />
                  </div>
                  <div>
                    <label htmlFor={`cip-salvage-${asset.id}`} className="block font-semibold text-[var(--text)] mb-1">Value at the end</label>
                    <input id={`cip-salvage-${asset.id}`} inputMode="decimal" value={salvage} onChange={e => setSalvage(e.target.value)} className={`${field} font-mono`} />
                  </div>
                </div>
                <p role="status" className="text-[var(--text)] bg-[var(--ink)] border border-[var(--line)] rounded-lg p-3">
                  {formatCurrency(asset.purchasePriceCents || 0, currency)} moves out of construction in progress on {date ? formatDate(date) : 'that day'}; depreciation starts the month after.
                </p>
              </>
            )}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setMode('')} className="px-4 py-2 text-sm rounded-lg text-[var(--text)]">Cancel</button>
              <button type="button" disabled={busy || (mode === 'service' && !accountId)} onClick={() => void (mode === 'cost' ? addCost() : placeInService())} className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--brass)] text-[var(--ink)] disabled:opacity-50">
                {mode === 'cost' ? 'Add' : 'Place in service'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
