import { useDialog } from '../../hooks/useDialog';
import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { Invoice } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { calculateAmountDue } from '../../lib/documentMath';
import { resolveAccountRole } from '../../lib/accountUtils';
import { toast } from 'sonner';
import { describeError } from '../../lib/errorRemedies';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import { runCommand, type CommandBody } from '../../lib/runCommand';

interface WriteOffModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
}

export default function WriteOffModal({ isOpen, onClose, invoice }: WriteOffModalProps) {
  const user = useAuthStore(s => s.user);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const accounts = useLedgerStore(s => s.accounts) || [];
  const expenseAccounts = accounts.filter(a => resolveAccountRole(a) === 'expense' && !a.isArchived);
  const defaultBadDebt = expenseAccounts.find(a => /bad debt|uncollectible|doubtful/i.test(a.name));

  const [badDebtAccountId, setBadDebtAccountId] = useState<string>(defaultBadDebt?.id || '');
  const [reason, setReason] = useState('Uncollectible bad debt');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { dialogProps, titleId } = useDialog(onClose, isOpen && !!invoice);
  if (!isOpen || !invoice) return null;

  const remainingCents = calculateAmountDue(invoice);

  // The server posts DR bad debt / CR receivables and settles the invoice in one database
  // transaction (src/server/services/badDebtService.ts). The sale itself stays: it was earned.
  const handleWriteOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspaceId || !user || !invoice.id) return;
    if (remainingCents <= 0) {
      toast.error('Invoice has no remaining balance to write off');
      return;
    }

    setIsSubmitting(true);
    try {
      await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(currentWorkspaceId)}/invoices/${encodeURIComponent(invoice.id)}/write-off`, method: 'POST', body: { reason, ...(badDebtAccountId ? { badDebtAccountId } : {}) } });
      toast.success(`Written off ${formatCurrency(remainingCents, invoice.currency)} as bad debt`);
      onClose();
    } catch (err) {
      const described = describeError(err, 'create', uiLanguageNow());
      toast.error(`Not written off: ${described.title.charAt(0).toLowerCase()}${described.title.slice(1)}`, { description: described.remedy });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800 bg-amber-50 dark:bg-amber-950/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-white">
                Bad Debt Write-off
              </h2>
              <p className="text-xs text-[var(--muted)] dark:text-slate-400">
                Invoice #{invoice.number || invoice.id}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-slate-600 p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleWriteOff} className="p-6 space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs space-y-1">
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Customer:</span>
              <strong className="text-slate-900 dark:text-white">{invoice.customerName || 'Customer'}</strong>
            </div>
            <div className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Outstanding Balance:</span>
              <strong className="font-mono text-amber-600 dark:text-amber-400 font-bold">
                {formatCurrency(remainingCents, invoice.currency)}
              </strong>
            </div>
          </div>

          <div>
            <label htmlFor="write-off-account" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Bad Debt Expense Account
            </label>
            <select
              id="write-off-account"
              value={badDebtAccountId}
              onChange={e => setBadDebtAccountId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            >
              {!badDebtAccountId && <option value="">Choose the bad debt account…</option>}
              {expenseAccounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.code ? `${acc.code} - ` : ''}{acc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="write-off-reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Write-off Reason / Notes
            </label>
            <textarea
              id="write-off-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              required
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
            />
          </div>

          <p className="text-xs text-[var(--muted)] dark:text-slate-400">
            Debits the bad debt expense account and credits Accounts Receivable for what is still due. The sale stays in your reports. If the customer pays later, reverse the write-off first.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !badDebtAccountId}
              className="px-4 py-2 text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting ? 'Writing off...' : 'Confirm Bad Debt Write-off'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
