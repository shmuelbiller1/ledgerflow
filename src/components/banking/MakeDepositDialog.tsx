import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import { isUndepositedFundsAccount, resolveAccountRole } from '../../lib/accountUtils';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useDialog } from '../../hooks/useDialog';

type WaitingPayment = { id: string; number?: string; contactName?: string; date?: string; amountCents: number; holdingId: string };

/** Take payments waiting in Undeposited Funds to the bank as one deposit (matches the bank's single line). */
export default function MakeDepositDialog({ onClose }: { onClose: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const payments = useLedgerStore(s => s.payments);
  const accounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('payments');
  const [bankAccountId, setBankAccountId] = useState('');
  const [date, setDate] = useState(getLocalDateISO());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose);

  const holdingIds = useMemo(() => new Set((accounts || []).filter(isUndepositedFundsAccount).map(a => a.id)), [accounts]);
  const bankAccounts = useMemo(() => (accounts || []).filter(a => resolveAccountRole(a) === 'cash'), [accounts]);
  const waiting = useMemo(() => (payments || []).flatMap(p => {
    const raw = p as typeof p & { depositTransactionId?: string; cashAccountId?: string; entityName?: string };
    const holdingId = raw.depositAccountId || raw.cashAccountId || '';
    if (!holdingIds.has(holdingId) || raw.depositTransactionId || p.status === 'void' || p.direction === 'made') return [];
    return [{ id: p.id, number: p.number, contactName: p.contactName || raw.entityName, date: p.date, amountCents: p.amountCents, holdingId } as WaitingPayment];
  }), [payments, holdingIds]);
  const total = waiting.filter(p => chosen.has(p.id)).reduce((sum, p) => sum + p.amountCents, 0);

  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountId) return toast.error('Choose the bank account');
    if (chosen.size === 0) return toast.error('Choose the payments you took to the bank');
    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const res = await fetch('/api/v1/payments/deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workspaceId, bankAccountId, date, paymentIds: [...chosen] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The deposit could not be recorded');
      toast.success(`Deposit of ${formatCurrency(total)} recorded`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--text)]">
        <div>
          <h2 id={titleId} className="text-lg font-bold">Make deposit</h2>
          <p className="text-xs text-[var(--muted)]">Payments received into Undeposited Funds, taken to the bank together.</p>
        </div>
        {holdingIds.size === 0 ? (
          <p className="text-sm text-[var(--muted)]">Add an asset account named “Undeposited Funds” in the Chart of Accounts, then receive payments into it.</p>
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold">Waiting to be deposited</legend>
              {waiting.length === 0 && <p className="text-xs text-[var(--muted)]">Nothing is waiting.</p>}
              {waiting.map(p => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <input id={`dep-${p.id}`} type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                  <label htmlFor={`dep-${p.id}`} className="flex-1 truncate">{p.date} · {p.contactName || p.number || p.id}</label>
                  <span className="font-mono">{formatCurrency(p.amountCents)}</span>
                </div>
              ))}
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="deposit-bank" className="text-xs font-bold">Bank account</label>
                <select id="deposit-bank" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm">
                  <option value="">Choose…</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="deposit-date" className="text-xs font-bold">Date</label>
                <input id="deposit-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm" />
              </div>
            </div>
            <p className="text-sm font-bold">Deposit total: <span className="font-mono">{formatCurrency(total)}</span></p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy || holdingIds.size === 0} className="rounded-lg bg-[var(--brass)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Saving…' : 'Record deposit'}</button>
        </div>
      </form>
    </div>
  );
}
