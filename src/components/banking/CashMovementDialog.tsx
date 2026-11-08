import { useDialog } from '../../hooks/useDialog';
import React, { useId, useMemo, useState } from 'react';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useAuthStore } from '../../stores/useAuthStore';
import { useTimeout } from '../../hooks/useTimeout';
import { descriptionSuggestions } from '../../lib/accountChoices';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { TruthEngine } from '../../modules/integrity/TruthEngine';
import {
  CASH_MOVEMENT_LABELS, cashAccountOptions, cashMovementProblem, cashMovementSentence, counterAccountChoices, createCashMovement,
  type CashMovementDirection,
} from '../../lib/cashMovement';
import { BudgetLeft } from '../common/BudgetLeft';
import { Labelled } from '../ui/Labelled';
import { ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react';
import { byCodeUnit } from '../../lib/codeUnitOrder';

interface CashMovementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  direction: CashMovementDirection;
}

/**
 * Money in / money out (BA-17): the amount, the account it lands in or leaves, what it is for, and a
 * name if somebody is involved. It posts one balanced entry through the ordinary path, so the server
 * checks it and it survives a reload; the sentences about what cannot be done here are in
 * `src/lib/cashMovement.ts`, where they are tested.
 */
const CashMovementDialog: React.FC<CashMovementDialogProps> = ({ isOpen, onClose, direction }) => {
  const { dialogProps, titleId } = useDialog(onClose, isOpen);
  const amountId = useId();
  const labels = CASH_MOVEMENT_LABELS[direction];
  // the names in the who-paid box are asked for, not assumed (AGENTS: a screen asks for what it reads)
  useLedgerCollections('customers', 'vendors');
  const accounts = useLedgerStore(s => s.accounts);
  const transactions = useLedgerStore(s => s.transactions);
  const customers = useLedgerStore(s => s.customers);
  const vendors = useLedgerStore(s => s.vendors);
  const txActions = useTransactionActions();
  const getCurrentWorkspace = useAuthStore(s => s.getCurrentWorkspace);
  const user = useAuthStore(s => s.user);
  const role = useCurrentRole();
  const { setSafeTimeout } = useTimeout();
  const money = (cents: number) => formatCurrency(cents, getCurrentWorkspace()?.currency);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getLocalDateISO());
  const [cashAccountId, setCashAccountId] = useState('');
  const [counterAccountId, setCounterAccountId] = useState('');
  const [contactName, setContactName] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [posted, setPosted] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const cashAccounts = useMemo(() => cashAccountOptions(accounts), [accounts]);
  const counterAccounts = useMemo(() => counterAccountChoices(accounts, transactions), [accounts, transactions]);
  const suggestions = useMemo(() => descriptionSuggestions(transactions), [transactions]);
  // names the workspace already holds, for who paid / who was paid; the entry keeps the name in its
  // description rather than a link, so a renamed contact does not leave this entry pointing at nothing
  const names = useMemo(() => [...new Set([...customers, ...vendors].map(p => (p.name || '').trim()).filter(Boolean))].sort(byCodeUnit).slice(0, 200), [customers, vendors]);
  const amountCents = useMemo(() => (amount.trim() ? TruthEngine.parseAmountToCents(amount) : 0), [amount]);
  const cashAccount = accounts.find(a => a.id === cashAccountId);
  const counterAccount = accounts.find(a => a.id === counterAccountId);
  // only say it once there is something to say it about: an empty form is not an error
  const problem = amountCents > 0
    ? cashMovementProblem({ direction, amountCents, date, cashAccountId, counterAccountId }, accounts)
    : null;
  const canPost = role !== 'viewer';

  if (!isOpen) return null;

  const submit = async () => {
    const cents = amount.trim() ? TruthEngine.parseAmountToCents(amount) : 0;
    const why = cashMovementProblem({ direction, amountCents: cents, date, cashAccountId, counterAccountId }, accounts);
    if (why || !cashAccount || !counterAccount || !user) {
      setRefused(why || 'This needs you to be signed in.');
      return;
    }
    const input = {
      workspaceId: getCurrentWorkspace()?.id || '', uid: user.uid, direction,
      amountCents: cents, date,
      cashAccount: { id: cashAccount.id, name: cashAccount.name },
      counterAccount: { id: counterAccount.id, name: counterAccount.name },
      currency: getCurrentWorkspace()?.currency || 'USD',
      description: description.trim() || undefined,
      contactName: contactName.trim() || undefined,
      reference: reference.trim() || undefined,
    };
    const sentence = cashMovementSentence(input, money);
    setRefused(null);
    await txActions.handleQuickAdd(createCashMovement(input));
    setPosted(sentence);
    setSafeTimeout(() => { setPosted(null); onClose(); }, 1800);
  };

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 p-4">
          <div className="flex items-center gap-2">
            {direction === 'in'
              ? <ArrowDownToLine aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              : <ArrowUpFromLine aria-hidden="true" className="h-4 w-4 text-rose-700" />}
            <h2 id={titleId} className="text-sm font-bold text-neutral-900">{labels.title}</h2>
          </div>
          <button onClick={onClose} aria-label={`Close ${labels.title} dialog`} className="rounded-md p-1.5 text-neutral-400 hover:text-neutral-700">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Amount">
              <input
                id={amountId}
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={e => { setAmount(e.target.value); setRefused(null); }}
                placeholder="0.00"
                className="h-9 w-full rounded-lg border border-neutral-200 px-2 text-sm"
              />
            </Labelled>
            <Labelled label="Date">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 w-full rounded-lg border border-neutral-200 px-2 text-sm" />
            </Labelled>
          </div>

          <Labelled label={direction === 'in' ? 'Money goes into' : 'Money comes out of'}>
            <select value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm">
              <option value="">Choose an account…</option>
              {cashAccounts.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </Labelled>

          <Labelled label={labels.whatFor}>
            <select value={counterAccountId} onChange={e => setCounterAccountId(e.target.value)} className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm">
              <option value="">Choose an account…</option>
              {counterAccounts.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </Labelled>
          {direction === 'out' && <BudgetLeft accountId={counterAccountId} date={date} addingCents={amountCents} />}

          <div className="grid grid-cols-2 gap-3">
            <Labelled label={direction === 'in' ? 'Who paid it (optional)' : 'Who you paid (optional)'}>
              <input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Acme Ltd" className="h-9 w-full rounded-lg border border-neutral-200 px-2 text-sm" list="lf-cash-movement-contacts" />
            </Labelled>
            <Labelled label="Cheque or bank reference (optional)">
              <input value={reference} onChange={e => setReference(e.target.value)} placeholder="1042" className="h-9 w-full rounded-lg border border-neutral-200 px-2 text-sm" />
            </Labelled>
          </div>

          <Labelled label="What to call it (optional)">
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder={counterAccount ? `${labels.verb}: ${counterAccount.name}` : labels.verb} className="h-9 w-full rounded-lg border border-neutral-200 px-2 text-sm" list="lf-cash-movement-descriptions" />
          </Labelled>
          <datalist id="lf-cash-movement-descriptions">
            {suggestions.map(s => <option key={s} value={s} />)}
          </datalist>
          <datalist id="lf-cash-movement-contacts">
            {names.map(n => <option key={n} value={n} />)}
          </datalist>

          {direction === 'in' && (
            <p className="text-[11px] leading-snug text-neutral-500">
              Money someone paid before their invoice exists goes to the customer deposits account — the
              invoice draws it back out, so it is counted once.
            </p>
          )}

          {problem && !posted && (
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">{problem}</p>
          )}
          {refused && !posted && (
            <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-[11px] leading-snug text-rose-900">{refused}</p>
          )}
          {posted && (
            <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-[11px] leading-snug text-emerald-900">{posted}</p>
          )}

          {!canPost ? (
            <p className="text-[11px] leading-snug text-neutral-500">
              You can look, not post. Someone who keeps the books records money in and out.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => { void submit(); }}
              disabled={!!problem || !amountCents}
              className="h-9 w-full rounded-lg bg-neutral-900 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              {labels.button}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CashMovementDialog;
