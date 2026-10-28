import React, { useRef, useMemo, useState } from 'react';
import { operationIdFor } from '../../lib/serverAction';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { getIdToken } from '../../firebase';
import { resolveAccountRole } from '../../lib/accountUtils';
import { advanceAccount } from '../../lib/advancePayments';
import { formatCurrency, getLocalDateISO, readAmountCents } from '../../lib/utils';
import type { Estimate } from '../../types';

const field = 'w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]';
const SHARES = [25, 50, 100];

/**
 * Take a deposit for an estimate (BE-05): a payment from the estimate's customer, linked to it and
 * applied to nothing, so it waits in Customer Deposits (BE-12) until the estimate's invoice is issued
 * ("Apply deposit" on that invoice). The server checks the estimate, the customer and the month.
 */
export default function EstimateDepositDialog({ estimate, onClose }: { estimate: Estimate & { currency?: string }; onClose: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const currency = estimate.currency || workspace?.currency || 'USD';
  const accounts = useLedgerStore(s => s.accounts);
  const bankAccounts = useMemo(() => (accounts || []).filter(a => !a.isArchived && resolveAccountRole(a) === 'cash'), [accounts]);
  const depositsAccount = useMemo(() => advanceAccount(accounts || [], 'received', workspace?.defaultAccountMappings), [accounts, workspace]);
  // #114: the same payment retried after a lost reply is recorded once (server idempotency)
  const paymentOps = useRef(new Map<string, string>());
  const [amount, setAmount] = useState(((Math.round(estimate.amountCents * 0.5)) / 100).toFixed(2));
  const [date, setDate] = useState(getLocalDateISO());
  const [cashAccountId, setCashAccountId] = useState(bankAccounts[0]?.id || '');
  const [method, setMethod] = useState('bank_transfer');
  const [saving, setSaving] = useState(false);
  const { dialogProps, titleId } = useDialog(onClose, true);
  const cents = readAmountCents(amount) ?? 0;
  const problem = cents <= 0 ? 'Enter the deposit' : cents > estimate.amountCents ? 'That is more than the estimate' : !cashAccountId ? 'Choose the bank account it came into' : null;

  const save = async () => {
    if (problem || saving) return;
    setSaving(true);
    try {
      const token = await getIdToken().catch(() => null);
      const paymentBody = JSON.stringify({
          workspaceId, amountCents: cents, paymentDate: date, cashAccountId, paymentMethod: method,
          customerId: estimate.customerId, entityName: estimate.customerName || '', estimateId: estimate.id,
          memo: `Deposit for estimate ${estimate.number || estimate.id}`, allocations: [],
        });
      const operationId = operationIdFor(paymentOps.current, paymentBody);
      const res = await fetch('/api/v1/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-operation-id': operationId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: paymentBody,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The deposit could not be recorded');
      toast.success(`Deposit of ${formatCurrency(cents, currency)} recorded`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-md w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Deposit for estimate {estimate.number || ''}</h2>
          <button type="button" onClick={onClose} aria-label="Close deposit" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-[var(--muted)]">
            From {estimate.customerName || 'the customer'}, of {formatCurrency(estimate.amountCents, currency)}.{' '}
            {depositsAccount ? `It waits in ${depositsAccount.name} until the invoice is issued.` : 'Without a Customer Deposits account it stays on the customer’s balance as a credit until the invoice is issued.'}
          </p>
          <div>
            <label htmlFor="deposit-amount" className="block text-xs font-semibold text-[var(--muted)] mb-1">Deposit ({currency})</label>
            <input id="deposit-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={`${field} font-mono text-right`} />
            <div className="mt-1 flex gap-2">
              {SHARES.map(share => (
                <button key={share} type="button" onClick={() => setAmount((Math.round(estimate.amountCents * share / 100) / 100).toFixed(2))}
                  className="px-2 py-0.5 text-xs rounded border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]">
                  {share === 100 ? 'All of it' : `${share}%`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Received on</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Method</span>
              <select value={method} onChange={e => setMethod(e.target.value)} className={field}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Into bank account</span>
            <select value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} className={field}>
              {bankAccounts.length === 0 && <option value="">No bank account in the chart</option>}
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} – ` : ''}{a.name}</option>)}
            </select>
          </label>
          {problem && <p role="alert" className="text-xs text-rose-600">{problem}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-[var(--muted)] hover:underline">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={Boolean(problem) || saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
              {saving ? 'Recording…' : `Record ${formatCurrency(cents > 0 ? cents : 0, currency)} deposit`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
