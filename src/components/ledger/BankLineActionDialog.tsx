import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { getIdToken } from '../../firebase';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { calculateAmountDue } from '../../lib/documentMath';
import { resolveAccountRole } from '../../lib/accountUtils';
import { formatCurrency } from '../../lib/utils';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useDialog } from '../../hooks/useDialog';

export interface BankLineActionTarget {
  mode: 'pay' | 'split';
  line: { id: string; date: string; description: string; amountCents: number; accountId?: string; currency?: string };
}

const OPEN = (status: string) => !['draft', 'void', 'cancelled', 'rejected', 'paid'].includes(status);
const inputClass = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm';

/**
 * Clear a pending bank line: pay one or more open invoices (deposit) or bills (withdrawal) of one
 * contact, or split it over several accounts. The server records it and marks the line matched.
 */
export default function BankLineActionDialog({ target, onClose }: { target: BankLineActionTarget; onClose: () => void }) {
  const { line, mode } = target;
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const invoices = useLedgerStore(s => s.invoices);
  const bills = useLedgerStore(s => s.bills);
  const accounts = useLedgerStore(s => s.accounts);
  useLedgerCollections('bills', 'invoices');
  const isDeposit = line.amountCents > 0;
  const lineCents = Math.abs(line.amountCents);
  const bankAccounts = useMemo(() => (accounts || []).filter(a => resolveAccountRole(a) === 'cash'), [accounts]);
  const [bankAccountId, setBankAccountId] = useState(line.accountId || (bankAccounts.length === 1 ? bankAccounts[0].id : ''));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const newSplit = () => ({ key: Math.random().toString(36).slice(2), accountId: '', amount: '', description: '' });
  const [splits, setSplits] = useState(() => [newSplit()]);
  const [busy, setBusy] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose);

  const documents = useMemo(() => {
    const list = isDeposit
      ? (invoices || []).map(i => ({ id: i.id, number: i.number, party: i.customerId, partyName: i.customerName, status: i.status, due: calculateAmountDue(i) }))
      : (bills || []).map(b => ({ id: b.id, number: b.number, party: b.vendorId, partyName: b.vendorName, status: b.status, due: calculateAmountDue(b) }));
    return list.filter(d => OPEN(d.status) && d.due > 0);
  }, [invoices, bills, isDeposit]);
  const categoryAccounts = useMemo(() => (accounts || []).filter(a => resolveAccountRole(a) !== 'cash'), [accounts]);

  const cents = (text: string) => TruthEngine.parseAmountToCents(text || '0') || 0;
  const chosen = Object.entries(amounts).map(([documentId, text]) => ({ documentId, amountCents: cents(text) })).filter(a => a.amountCents > 0);
  const chosenParties = new Set(chosen.map(a => documents.find(d => d.id === a.documentId)?.party));
  const total = mode === 'pay' ? chosen.reduce((s, a) => s + a.amountCents, 0) : splits.reduce((s, x) => s + cents(x.amount), 0);

  const toggle = (docId: string, due: number) => setAmounts(prev => {
    const next = { ...prev };
    if (next[docId] !== undefined) delete next[docId];
    else next[docId] = (Math.min(due, Math.max(0, lineCents - total)) / 100).toFixed(2);
    return next;
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccountId) return toast.error('Choose the bank account');
    if (mode === 'pay' && chosen.length === 0) return toast.error(`Choose the ${isDeposit ? 'invoices' : 'bills'} this pays`);
    if (mode === 'pay' && chosenParties.size > 1) return toast.error(`Choose ${isDeposit ? 'invoices of one customer' : 'bills of one vendor'}`);
    if (mode === 'split' && total !== lineCents) return toast.error(`The lines must add up to ${formatCurrency(lineCents)}`);
    setBusy(true);
    try {
      const token = await getIdToken().catch(() => null);
      const body = mode === 'pay'
        ? { workspaceId, bankAccountId, allocations: chosen }
        : { workspaceId, bankAccountId, splits: splits.map(x => ({ accountId: x.accountId, amountCents: cents(x.amount), description: x.description || undefined })) };
      const res = await fetch(`/api/v1/transactions/bank-lines/${encodeURIComponent(line.id)}/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The bank line could not be cleared');
      toast.success(mode === 'pay' ? 'Payment recorded and bank line matched' : 'Bank line split and matched');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'pay' ? `Pay ${isDeposit ? 'invoices' : 'bills'} with this ${isDeposit ? 'deposit' : 'payment'}` : 'Split this bank line';
  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--text)]">
        <div>
          <h2 id={titleId} className="text-lg font-bold">{title}</h2>
          <p className="text-xs text-[var(--muted)]">{line.date} · {line.description} · {formatCurrency(line.amountCents, line.currency)}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="bank-line-account" className="text-xs font-bold">Bank account</label>
          <select id="bank-line-account" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {mode === 'pay' ? (
          <fieldset className="space-y-2">
            <legend className="text-xs font-bold">Open {isDeposit ? 'invoices' : 'bills'}</legend>
            {documents.length === 0 && <p className="text-xs text-[var(--muted)]">Nothing open.</p>}
            {documents.map(d => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <input id={`bl-doc-${d.id}`} type="checkbox" checked={amounts[d.id] !== undefined} onChange={() => toggle(d.id, d.due)} />
                <label htmlFor={`bl-doc-${d.id}`} className="flex-1 truncate">{d.number || d.id} · {d.partyName || d.party} · {formatCurrency(d.due)} due</label>
                {amounts[d.id] !== undefined && (
                  <input aria-label={`Amount for ${d.number || d.id}`} inputMode="decimal" value={amounts[d.id]} onChange={e => setAmounts(p => ({ ...p, [d.id]: e.target.value }))} className="w-28 rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-right font-mono" />
                )}
              </div>
            ))}
          </fieldset>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-xs font-bold">Lines</legend>
            {splits.map((x, i) => (
              <div key={x.key} className="grid grid-cols-[1fr_7rem] gap-2">
                <select aria-label={`Account for line ${i + 1}`} value={x.accountId} onChange={e => setSplits(s => s.map((y, j) => (j === i ? { ...y, accountId: e.target.value } : y)))} className={inputClass}>
                  <option value="">Account…</option>
                  {categoryAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} ` : ''}{a.name}</option>)}
                </select>
                <input aria-label={`Amount for line ${i + 1}`} inputMode="decimal" value={x.amount} onChange={e => setSplits(s => s.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} className={`${inputClass} text-right font-mono`} />
                <input aria-label={`Memo for line ${i + 1}`} placeholder="Memo (optional)" value={x.description} onChange={e => setSplits(s => s.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} className={`${inputClass} col-span-2`} />
              </div>
            ))}
            <button type="button" onClick={() => setSplits(s => [...s, newSplit()])} className="text-xs font-bold underline">Add a line</button>
          </fieldset>
        )}

        <p className={total === lineCents ? 'text-xs text-[var(--pos)]' : 'text-xs text-[var(--muted)]'}>
          {formatCurrency(total)} of {formatCurrency(lineCents)}{mode === 'pay' && total < lineCents && total > 0 ? ' · the rest stays as an unapplied payment' : ''}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-[var(--brass)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50">{busy ? 'Saving…' : mode === 'pay' ? 'Record payment' : 'Split'}</button>
        </div>
      </form>
    </div>
  );
}
