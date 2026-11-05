import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { calculateAmountDue } from '../../lib/documentMath';
import { resolveAccountRole } from '../../lib/accountUtils';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useDialog } from '../../hooks/useDialog';

export interface CreditActionTarget {
  kind: 'customer' | 'vendor';
  mode: 'apply' | 'refund';
  id: string;
  number?: string;
  partyId: string;
  partyName?: string;
  remainingCents: number;
  currency?: string;
}

const CLOSED = new Set(['draft', 'void', 'cancelled', 'rejected', 'paid']);

/** Apply a credit to an open invoice/bill, or refund it; the server does both in one database transaction. */
export default function CreditActionDialog({ target, onClose }: { target: CreditActionTarget; onClose: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const accounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('bills', 'invoices');
  const [documentId, setDocumentId] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [amount, setAmount] = useState((target.remainingCents / 100).toFixed(2));
  const [date, setDate] = useState(getLocalDateISO());
  const [busy, setBusy] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose);

  const openDocuments = useMemo(() => {
    const docs: { id: string; number?: string; status: string; currency?: string; amountCents: number; amountPaidCents?: number; party?: string }[] =
      target.kind === 'customer'
        ? (invoices || []).map(i => ({ ...i, party: i.customerId }))
        : (bills || []).map(b => ({ ...b, party: b.vendorId }));
    return docs
      .filter(d => d.party === target.partyId && !CLOSED.has(d.status) && (d.currency || 'USD') === (target.currency || 'USD'))
      .map(d => ({ id: d.id, label: d.number || d.id, dueCents: calculateAmountDue(d) }))
      .filter(d => d.dueCents > 0);
  }, [invoices, bills, target]);
  const cashAccounts = useMemo(() => (accounts || []).filter(a => resolveAccountRole(a) === 'cash'), [accounts]);
  const documentLabel = target.kind === 'customer' ? 'invoice' : 'bill';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = TruthEngine.parseAmountToCents(amount || '0');
    if (!amountCents || amountCents <= 0) return toast.error('Enter an amount');
    if (amountCents > target.remainingCents) return toast.error(`Only ${formatCurrency(target.remainingCents)} is left on this credit`);
    if (target.mode === 'apply' && !documentId) return toast.error(`Choose the ${documentLabel}`);
    if (target.mode === 'refund' && !cashAccountId) return toast.error('Choose the bank or cash account');
    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const body = target.mode === 'apply'
        ? { workspaceId, kind: target.kind, creditId: target.id, documentId, amountCents }
        : { workspaceId, kind: target.kind, creditId: target.id, amountCents, cashAccountId, date };
      const res = await fetch(`/api/v1/payments/credits/${target.mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The credit could not be processed');
      toast.success(target.mode === 'apply' ? `Applied ${formatCurrency(amountCents)} to the ${documentLabel}` : `Refund of ${formatCurrency(amountCents)} recorded`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const title = `${target.mode === 'apply' ? 'Apply' : 'Refund'} ${target.number || 'credit'}`;
  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--text)]">
        <div>
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <p className="text-xs text-[var(--muted)]">{target.partyName} · {formatCurrency(target.remainingCents)} left</p>
        </div>
        {target.mode === 'apply' ? (
          <div className="space-y-1">
            <label htmlFor="credit-document" className="text-xs font-bold">Open {documentLabel}</label>
            <select id="credit-document" value={documentId} onChange={e => setDocumentId(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="">Choose…</option>
              {openDocuments.map(d => <option key={d.id} value={d.id}>{d.label} · {formatCurrency(d.dueCents)} due</option>)}
            </select>
            {openDocuments.length === 0 && <p className="text-xs text-[var(--muted)]">No open {documentLabel}s for {target.partyName || 'this contact'} in this currency.</p>}
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label htmlFor="credit-cash" className="text-xs font-bold">{target.kind === 'customer' ? 'Paid from' : 'Received into'}</label>
              <select id="credit-cash" value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm">
                <option value="">Choose a bank or cash account…</option>
                {cashAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="credit-date" className="text-xs font-bold">Date</label>
              <input id="credit-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm" />
            </div>
          </>
        )}
        <div className="space-y-1">
          <label htmlFor="credit-amount" className="text-xs font-bold">Amount</label>
          <input id="credit-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-sm" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-[var(--brass)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Saving…' : title}</button>
        </div>
      </form>
    </div>
  );
}
