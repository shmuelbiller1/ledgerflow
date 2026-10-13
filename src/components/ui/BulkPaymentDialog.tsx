import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { resolveAccountRole } from '../../lib/accountUtils';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { paymentPlan, type BulkDocument, type BulkSide } from '../../lib/bulkDocuments';
import { recordPayments } from '../../services/bulkDocumentActions';

interface BulkPaymentDialogProps {
  side: BulkSide;
  documents: BulkDocument[];
  onClose: () => void;
  /** Called with the ids of the documents now paid. */
  onDone: (paidIds: string[]) => void;
}

/**
 * Pay many invoices or bills in full at once (K-06): one payment per customer or vendor into (or
 * out of) the chosen bank account. The server checks each one (amount due, locked months, role).
 */
export default function BulkPaymentDialog({ side, documents, onClose, onDone }: BulkPaymentDialogProps) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const currency = useAuthStore(s => s.getCurrentWorkspace()?.currency) || 'USD';
  const accounts = useLedgerStore(s => s.accounts);
  const bankAccounts = useMemo(() => accounts.filter(a => !a.isArchived && resolveAccountRole(a) === 'cash'), [accounts]);
  const [cashAccountId, setCashAccountId] = useState(bankAccounts[0]?.id || '');
  const [date, setDate] = useState(getLocalDateISO());
  const [method, setMethod] = useState('bank_transfer');
  const [remittance, setRemittance] = useState(false);
  const [saving, setSaving] = useState(false);
  const operationIds = useRef(new Map<string, string>());
  const { dialogProps, titleId } = useDialog(onClose, true);
  const { payments, skipped } = useMemo(() => paymentPlan(documents, side, currency), [documents, side, currency]);
  const total = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const noun = side === 'invoice' ? 'invoice' : 'bill';
  const field = 'w-full px-3 py-2 text-sm bg-[var(--ink)] border border-[var(--line)] rounded-lg text-[var(--text)]';

  const submit = async () => {
    if (!cashAccountId || payments.length === 0) return;
    setSaving(true);
    try {
      const { done, failed, remittancesSent } = await recordPayments(payments, { workspaceId, side, cashAccountId, date, method, sendRemittance: remittance, operationIds: operationIds.current });
      const paidIds = done.flatMap(p => p.allocations.map(a => a.documentId));
      if (done.length) toast.success(`${paidIds.length} ${noun}${paidIds.length === 1 ? '' : 's'} paid (${formatCurrency(done.reduce((s, p) => s + p.amountCents, 0), currency)})`);
      if (remittance && side === 'bill') toast.info(`${remittancesSent} remittance advice email${remittancesSent === 1 ? '' : 's'} sent (vendors without an email address get none)`);
      for (const f of failed) toast.error(`${f.payment.partyName}: ${f.message}`);
      onDone(paidIds);
      if (!failed.length) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[var(--surface)] rounded-xl shadow-xl max-w-lg w-full border border-[var(--line)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-lg font-bold text-[var(--text)]">{side === 'invoice' ? 'Receive payment for' : 'Pay'} {documents.length} {noun}{documents.length === 1 ? '' : 's'}</h2>
          <button type="button" onClick={onClose} aria-label="Close payment" className="p-1 rounded-lg text-[var(--muted)] hover:text-[var(--text)]">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor="bulk-pay-account" className="block text-xs font-semibold text-[var(--muted)] mb-1">{side === 'invoice' ? 'Into bank account' : 'From bank account'}</label>
              <select id="bulk-pay-account" value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} className={field}>
                {bankAccounts.length === 0 && <option value="">Add a bank account first</option>}
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ${a.name}` : a.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bulk-pay-date" className="block text-xs font-semibold text-[var(--muted)] mb-1">Payment date</label>
              <input id="bulk-pay-date" type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="bulk-pay-method" className="block text-xs font-semibold text-[var(--muted)] mb-1">Method</label>
              <select id="bulk-pay-method" value={method} onChange={e => setMethod(e.target.value)} className={field}>
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>
          {side === 'bill' && (
            <label className="flex items-center gap-2 text-[var(--text)]">
              <input type="checkbox" checked={remittance} onChange={e => setRemittance(e.target.checked)} />
              Email each vendor a remittance advice (what was paid, for which bills)
            </label>
          )}
          <ul aria-label="Payments" className="divide-y divide-[var(--line)] border border-[var(--line)] rounded-lg">
            {payments.map(p => (
              <li key={p.partyId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-[var(--text)]"><span className="font-semibold">{p.partyName}</span> <span className="text-xs text-[var(--muted)]">{p.allocations.map(a => a.label).join(', ')}</span></span>
                <span className="tabular-nums font-semibold text-[var(--text)]">{formatCurrency(p.amountCents, currency)}</span>
              </li>
            ))}
            {payments.length === 0 && <li className="px-3 py-2 text-[var(--muted)]">Nothing to pay among the chosen {noun}s.</li>}
          </ul>
          {skipped.length > 0 && (
            <div role="note" className="text-xs text-[var(--muted)]">
              Left out: {skipped.map(s => `${s.label} (${s.reason})`).join('; ')}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold text-[var(--text)]">Total {formatCurrency(total, currency)}</span>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-[var(--text)] hover:bg-[var(--ink)]">Cancel</button>
              <button type="button" disabled={saving || !cashAccountId || payments.length === 0} onClick={submit} className="px-4 py-2 font-semibold rounded-lg bg-[var(--brass)] text-[var(--ink)] disabled:opacity-50">
                {saving ? 'Recording…' : `Record ${payments.length} payment${payments.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
