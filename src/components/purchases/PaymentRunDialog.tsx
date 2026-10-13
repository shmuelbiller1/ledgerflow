import React, { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { resolveAccountRole } from '../../lib/accountUtils';
import { calculateAmountDue } from '../../lib/documentMath';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { paymentPlan, type BulkDocument } from '../../lib/bulkDocuments';
import { bankFileRows, billsDueBy, missingBankDetails } from '../../lib/paymentRun';
import { recordPayments } from '../../services/bulkDocumentActions';
import type { Bill, Vendor } from '../../types';

const field = 'w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]';

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/**
 * Payment run (K-24): every open bill due by a date, ticked; one payment per vendor out of the chosen
 * bank account (the same server payments as "Pay bills", K-06) and a bank file to upload to online
 * banking: one line per vendor with their bank details (from the vendor's page), amount and the bills
 * it pays. Bills in another currency are left out with the reason.
 */
export default function PaymentRunDialog({ bills, vendors, onClose }: { bills: Bill[]; vendors: Vendor[]; onClose: () => void }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const accounts = useLedgerStore(s => s.accounts);
  const bankAccounts = useMemo(() => (accounts || []).filter(a => !a.isArchived && resolveAccountRole(a) === 'cash'), [accounts]);
  const today = getLocalDateISO();
  const [dueBy, setDueBy] = useState(addDays(today, 7));
  const [payDate, setPayDate] = useState(today);
  const [cashAccountId, setCashAccountId] = useState(bankAccounts[0]?.id || '');
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const operationIds = useRef(new Map<string, string>());
  const { dialogProps, titleId } = useDialog(onClose, true);

  const due = useMemo(() => billsDueBy(bills, dueBy), [bills, dueBy]);
  const chosen = due.filter(b => !left.has(b.id));
  const { payments, skipped } = useMemo(() => paymentPlan(chosen as unknown as BulkDocument[], 'bill', currency), [chosen, currency]);
  const total = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const vendorById = useMemo(() => new Map(vendors.map(v => [v.id, v])), [vendors]);
  const bank = (vendorId: string) => vendorById.get(vendorId)?.bankDetails;
  const missing = missingBankDetails(payments, bank);
  const paidCount = payments.reduce((n, p) => n + p.allocations.length, 0);

  const toggle = (id: string) => setLeft(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const downloadBankFile = (only: typeof payments = payments) => {
    const { headers, rows } = bankFileRows(only, bank, { date: payDate, currency });
    downloadCsv(`payment-run-${payDate}.csv`, headers, rows);
  };

  const pay = async (withFile: boolean) => {
    if (!cashAccountId || payments.length === 0 || saving) return;
    setSaving(true);
    try {
      // #109: the server records first; the bank file then holds only the payments it accepted, and
      // those bills leave the run, so pressing Pay again after a partial failure cannot pay twice
      const { done, failed } = await recordPayments(payments, { workspaceId, side: 'bill', cashAccountId, date: payDate, method: 'bank_transfer', operationIds: operationIds.current });
      if (withFile && done.length) downloadBankFile(done);
      if (done.length) setLeft(prev => new Set([...prev, ...done.flatMap(p => p.allocations.map(a => a.documentId))]));
      if (done.length) toast.success(`${done.length} payment${done.length === 1 ? '' : 's'} recorded (${formatCurrency(done.reduce((s, p) => s + p.amountCents, 0), currency)})`);
      for (const f of failed) toast.error(`${f.payment.partyName}: ${f.message}`);
      if (!failed.length) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">Payment run</h2>
          <button type="button" onClick={onClose} aria-label="Close payment run" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Bills due by</span>
              <input type="date" value={dueBy} onChange={e => { setDueBy(e.target.value); setLeft(new Set()); }} className={field} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Pay on</span>
              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className={field} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">From bank account</span>
              <select value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} className={field}>
                {bankAccounts.length === 0 && <option value="">No bank account in the chart</option>}
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} – ` : ''}{a.name}</option>)}
              </select>
            </label>
          </div>

          {due.length === 0 ? (
            <p className="text-[var(--muted)]">No open bills are due by {dueBy}.</p>
          ) : (
            <fieldset className="space-y-1">
              <legend className="text-xs font-semibold text-[var(--muted)] mb-1">{due.length} bill{due.length === 1 ? '' : 's'} due by {dueBy}</legend>
              {due.map(b => (
                <label key={b.id} className="flex items-center gap-2 py-1 border-t border-[var(--line)] first:border-t-0">
                  <input type="checkbox" checked={!left.has(b.id)} onChange={() => toggle(b.id)} aria-label={`Pay bill ${b.number || b.id} from ${b.vendorName || 'vendor'}`} />
                  <span className="flex-1 truncate">{b.vendorName || 'Vendor'} · {b.number || b.id} · due {String(b.dueDate || b.date || '').slice(0, 10)}</span>
                  <span className="font-mono">{formatCurrency(calculateAmountDue(b), b.currency || currency)}</span>
                </label>
              ))}
            </fieldset>
          )}

          {skipped.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
              {skipped.map(s => <li key={s.id}>{s.label}: {s.reason}</li>)}
            </ul>
          )}
          {missing.length > 0 && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              No bank details for {missing.map(p => p.partyName).join(', ')}: add them on the vendor’s page, or their line in the bank file has no account to pay into.
            </p>
          )}

          <p className="font-semibold text-[var(--text)]">
            {payments.length} payment{payments.length === 1 ? '' : 's'} to {payments.length} vendor{payments.length === 1 ? '' : 's'} for {paidCount} bill{paidCount === 1 ? '' : 's'}: {formatCurrency(total, currency)}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => downloadBankFile()} disabled={payments.length === 0}
              className="px-3 py-2 rounded-lg border border-[var(--line)] text-[var(--text)] disabled:opacity-50">
              Bank file only
            </button>
            <button type="button" onClick={() => void pay(true)} disabled={payments.length === 0 || !cashAccountId || saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
              {saving ? 'Recording…' : 'Pay and download bank file'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
