import { useDialog } from '../../hooks/useDialog';
import { toast } from 'sonner';
import { getIdToken } from '../../firebase';
import { runOnce } from '../../lib/serverAction';
import React, { useState, useMemo, useId, useRef } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { createAccountTransfer, detectPotentialTransfers, TransferMatchCandidate } from '../../lib/transferEngine';
import { getLocalDateISO, formatCurrency } from '../../lib/utils';
import { isCashAccount } from '../../lib/txFilters';
import { useTimeout } from '../../hooks/useTimeout';
import { ArrowRightLeft, Check, X, Sparkles, HelpCircle, DollarSign } from 'lucide-react';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import { Labelled } from '../ui/Labelled';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFromAccountId?: string;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  defaultFromAccountId
}) => {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const amountId = useId();
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const txActions = useTransactionActions();
  const { addEntity } = useEntityOperations();
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const user = useAuthStore(s => s.user);
  const currentWorkspace = getCurrentWorkspace();

  const [activeTab, setActiveTab] = useState<'create' | 'detect'>('create');

  // Form state
  const [fromAccountId, setFromAccountId] = useState<string>(defaultFromAccountId || '');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [date, setDate] = useState<string>(getLocalDateISO());
  const [description, setDescription] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const retryRef = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const { setSafeTimeout } = useTimeout();

  // Cash / Bank accounts filter
  const cashAccounts = useMemo(() => {
    return accounts.filter(isCashAccount);
  }, [accounts]);

  // Detected candidates
  const candidates = useMemo(() => {
    if (!isOpen) return [];
    return detectPotentialTransfers(transactions, accounts, 4);
  }, [isOpen, transactions, accounts]);

  if (!isOpen) return null;

  const handleCreateTransfer = async () => {
    if (saving) return;
    if (!fromAccountId || !toAccountId || !amount || Number.parseFloat(amount) <= 0) {
      return;
    }

    if (fromAccountId === toAccountId) {
      alert('Source and destination accounts must be different.');
      return;
    }

    const fromAcc = accounts.find(a => a.id === fromAccountId);
    const toAcc = accounts.find(a => a.id === toAccountId);

    if (!fromAcc || !toAcc) return;

    const amountCents = TruthEngine.parseAmountToCents(amount);

    const transferTx = createAccountTransfer({
      workspaceId: currentWorkspace?.id || 'default',
      uid: user?.uid || 'system',
      fromAccountId,
      fromAccountName: fromAcc.name,
      toAccountId,
      toAccountName: toAcc.name,
      amountCents,
      date,
      description: description || undefined
    });

    // saved through the normal posting path (server-checked, survives a reload); it only changed
    // the list on screen before, so the transfer was gone after a reload (L-181)
    // #105: success only when the server saved it; a second click while saving is ignored
    const fingerprint = JSON.stringify([user?.uid, currentWorkspace?.id, fromAccountId, toAccountId, amountCents, date, description, currentWorkspace?.currency]);
    if (retryRef.current?.fingerprint !== fingerprint) {
      retryRef.current = { fingerprint, operationId: crypto.randomUUID() };
    }
    const operationId = retryRef.current.operationId;
    setSaving(true);
    try {
      // The same payload retains its operation ID after an uncertain response. The server
      // uses this ID for the transaction and its atomic idempotency record.
      const saved = await runOnce(`transfer:${fingerprint}`, () => txActions.handleQuickAdd({ ...transferTx, currency: currentWorkspace?.currency || transferTx.currency }, operationId));
      if (saved !== true) return;
      retryRef.current = null;
      setSuccessMessage(`Transferred ${formatCurrency(amountCents, currentWorkspace?.currency)} from ${fromAcc.name} to ${toAcc.name}`);
      setSafeTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 1500);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Two entries that are one transfer (money out of one bank account, the same amount into
   * another): both keep their bank line, and their other side moves to Transfer Clearing, which
   * nets to zero, so the expense and the income they were booked to disappear. Saved through the
   * server (it only changed the screen before, and left the expense and income in place; L-181).
   */
  const handleMergeCandidate = async (candidate: TransferMatchCandidate) => {
    const clearing = await transferClearingAccount();
    if (!clearing) return false;
    const transferDetails = { fromAccountId: candidate.fromAccount.id, toAccountId: candidate.toAccount.id };
    // #106: both halves in ONE server request, saved together or not at all (the batch route checks
    // every line, keeps totals and writes in a single transaction)
    const updates = [candidate.outflowTx, candidate.inflowTx].map(tx => ({
      id: tx.id,
      expectedUpdatedAt: tx.updatedAt,
      data: { lines: (tx.lines || []).map(l => (isCashAccount(accounts.find(a => a.id === l.accountId)) ? l : { ...l, accountId: clearing.id, accountName: clearing.name })), isTransfer: true, transferDetails },
    }));
    try {
      const res = await fetch('/api/v1/transactions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        body: JSON.stringify({ workspaceId: currentWorkspace?.id, updates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'The transfer was not paired');
      toast.success('Paired as one transfer between your accounts');
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const transferClearingAccount = async (): Promise<{ id: string; name: string } | null> => {
    const existing = accounts.find(a => !a.isArchived && /transfer clearing|transfers in transit|inter-?account transfer/i.test(a.name));
    if (existing) return existing;
    const codes = new Set(accounts.map(a => a.code));
    const code = ['1095', '1096', '1097', '1098', '1099'].find(c => !codes.has(c)) || '';
    const ref = await addEntity('chartAccounts', { name: 'Transfer Clearing', type: 'asset', category: 'Current Assets', code, description: 'Money moving between your own bank accounts; nets to zero' }, 'Account "Transfer Clearing" added');
    return ref ? { id: ref.id, name: 'Transfer Clearing' } : null;
  };

  return (
    <div {...overlayDialogProps} className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden border border-neutral-200">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
          <div className="flex items-center gap-2">
            <ArrowRightLeft aria-hidden="true" className="w-4 h-4 text-neutral-800" />
            <h2 id={overlayTitleId} className="text-sm font-bold text-neutral-900">Inter-Account Transfer</h2>
          </div>
          <button onClick={onClose} aria-label="Close transfer dialog" className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-md">
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-neutral-200 bg-neutral-100/60 p-1">
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeTab === 'create' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            Record Transfer
          </button>
          <button
            onClick={() => setActiveTab('detect')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'detect' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Sparkles aria-hidden="true" className="w-3 h-3 text-amber-600" />
            Transfer Suggestions ({candidates.length})
          </button>
        </div>

        <div className="p-5">
          {successMessage ? (
            <div className="py-8 text-center space-y-2">
              <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <Check aria-hidden="true" className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-neutral-900">{successMessage}</p>
            </div>
          ) : activeTab === 'create' ? (
            <div className="space-y-4 text-xs">
              <div>
                <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="From Account (Source)">
                  <select
                    value={fromAccountId}
                    onChange={e => setFromAccountId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg text-xs focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                  >
                    <option value="">Select source bank/cash account...</option>
                    {cashAccounts.map(a => (
                      <option key={a.id} value={a.id} disabled={a.id === toAccountId}>
                        {a.name} ({a.code || a.category})
                      </option>
                    ))}
                  </select>
                </Labelled>
              </div>

              <div>
                <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="To Account (Destination)">
                  <select
                    value={toAccountId}
                    onChange={e => setToAccountId(e.target.value)}
                    className="w-full p-2.5 bg-white border border-neutral-300 rounded-lg text-xs focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                  >
                    <option value="">Select destination bank/cash account...</option>
                    {cashAccounts.map(a => (
                      <option key={a.id} value={a.id} disabled={a.id === fromAccountId}>
                        {a.name} ({a.code || a.category})
                      </option>
                    ))}
                  </select>
                </Labelled>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={amountId} className="block font-semibold text-neutral-700 mb-1">Amount ($)</label>
                  <div className="relative">
                    <DollarSign aria-hidden="true" className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-400" />
                    <input
                      id={amountId}
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs focus:ring-1 focus:ring-neutral-500 focus:outline-hidden font-mono"
                    />
                  </div>
                </div>
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Transfer Date">
                    <input
                      type="date"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      className="w-full p-2 bg-white border border-neutral-300 rounded-lg text-xs focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    />
                  </Labelled>
                </div>
              </div>

              <div>
                <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Reference / Note (Optional)">
                  <input
                    type="text"
                    placeholder="e.g. Sweep to high-yield savings"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full p-2 bg-white border border-neutral-300 rounded-lg text-xs focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                  />
                </Labelled>
              </div>

              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-[11px] text-neutral-600 flex items-start gap-2">
                <HelpCircle aria-hidden="true" className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                <span>
                  Inter-account transfers are recorded as balanced double-entry journals without affecting your Profit & Loss income or operational expenses.
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateTransfer}
                  disabled={saving || !fromAccountId || !toAccountId || !amount || Number.parseFloat(amount) <= 0}
                  className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
                >
                  <Check aria-hidden="true" className="w-3.5 h-3.5" />
                  {saving ? 'Recording…' : 'Post Transfer'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-neutral-500">
                The smart transfer detector found these matched transactions between cash accounts that look like internal money movements:
              </p>

              {candidates.length === 0 ? (
                <div className="text-center py-8 text-neutral-400 text-xs">
                  No unmatched inter-account transfer pairs detected in the current ledger.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {candidates.map(cand => (
                    <div key={JSON.stringify([cand.outflowTx.id, cand.inflowTx.id])} className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg flex items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                          <span>{cand.fromAccount.name}</span>
                          <span className="text-neutral-400">&rarr;</span>
                          <span>{cand.toAccount.name}</span>
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {formatCurrency(cand.amountCents)} &bull; {cand.outflowTx.date}
                          {cand.dateDiffDays > 0 ? ` (+${cand.dateDiffDays}d)` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => handleMergeCandidate(cand)}
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-neutral-300 hover:bg-neutral-100 text-neutral-800 rounded-md transition-colors whitespace-nowrap"
                      >
                        Link as Transfer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TransferModal;
