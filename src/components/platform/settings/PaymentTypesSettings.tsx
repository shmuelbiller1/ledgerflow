import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { getIdToken } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../../lib/accountDefaults';
import { MAX_PAYMENT_TYPES, MAX_PAYMENT_TYPE_NAME, normalizePaymentTypes, paymentTypeNameKey, type PaymentType } from '../../../lib/paymentTypes';
import InlineEdit from '../../ui/InlineEdit';

/**
 * CC-09: the workspace's own payment types (for example "PayPal" under Card). Record payment offers
 * them next to the five methods; the payment keeps the type's name and posts under its method.
 * Owners and accountants change the list; others read it. Removing a type does not change payments
 * already recorded with it.
 */
export function PaymentTypesSettings() {
  const id = useId();
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const saved = normalizePaymentTypes(useAuthStore(s => s.getCurrentWorkspace()?.paymentTypes));
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant';
  const [name, setName] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [saving, setSaving] = useState(false);

  const clean = name.trim();
  const duplicate = clean !== '' && saved.some(t => paymentTypeNameKey(t.name) === paymentTypeNameKey(clean));
  const full = saved.length >= MAX_PAYMENT_TYPES;
  const canAdd = canEdit && !saving && clean !== '' && clean.length <= MAX_PAYMENT_TYPE_NAME && !duplicate && !full;

  // One change at a time, sent to the server, which applies it to the list as it is in the database
  // inside a transaction (so another person's change made meanwhile is kept) and refuses one that no
  // longer fits (the name was taken, the type removed). The reply is ignored after a sign-out or
  // account switch, and its message and draft clearing only belong to the workspace still open. It
  // rejects when the save fails (after saying why), so an inline edit stays open with what was typed.
  type Change = { op: 'add'; name: string; method: PaymentMethod } | { op: 'rename'; id: string; name: string } | { op: 'remove'; id: string };
  const save = (change: Change, done: string, onSaved?: () => void): Promise<void> => {
    if (!workspaceId || saving || !canEdit) return Promise.reject(new Error('Not saved'));
    setSaving(true);
    const startedBy = useAuthStore.getState().user?.uid;
    return getIdToken().catch(() => null).then(token => fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/payment-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(change),
    })).then(async res => {
      const data = await res.json().catch(() => ({})) as { message?: string; paymentTypes?: unknown };
      if (!res.ok) throw Object.assign(new Error(data.message || 'Payment types could not be saved (owners and accountants can change them).'), { shown: true });
      const paymentTypes = normalizePaymentTypes(data.paymentTypes);
      const now = useAuthStore.getState();
      if (now.user?.uid !== startedBy) return;
      now.setWorkspaces(now.workspaces.map(w => (w.id === workspaceId ? { ...w, paymentTypes } : w)));
      if (now.currentWorkspaceId !== workspaceId) return;
      onSaved?.();
      toast.success(done);
    }).catch((err: unknown) => {
      if (!(err as { shown?: boolean }).shown) console.error('[Settings] Failed to save payment types:', err);
      toast.error((err as { shown?: boolean }).shown ? (err as Error).message : 'Payment types could not be saved. Check the connection and try again.');
      throw err;
    }).finally(() => setSaving(false));
  };

  const rename = (t: PaymentType, next: string | number): Promise<void> => {
    const name = String(next).trim();
    return save({ op: 'rename', id: t.id, name }, `Renamed to ${name}`);
  };
  const renameProblem = (t: PaymentType, next: string | number): string | null => {
    const clean = String(next).trim();
    if (!clean) return 'Enter a name';
    if (clean.length > MAX_PAYMENT_TYPE_NAME) return `Up to ${MAX_PAYMENT_TYPE_NAME} characters`;
    if (saved.some(x => x.id !== t.id && paymentTypeNameKey(x.name) === paymentTypeNameKey(clean))) return `${clean} is already a payment type`;
    return null;
  };

  const add = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canAdd) return;
    save({ op: 'add', name: clean, method }, `${clean} added`, () => setName('')).catch(() => undefined); // the failure was already said
  };

  const hint = duplicate ? `${clean} is already a payment type.` : full ? `Up to ${MAX_PAYMENT_TYPES} payment types.` : clean.length > MAX_PAYMENT_TYPE_NAME ? `Up to ${MAX_PAYMENT_TYPE_NAME} characters.` : '';

  return (
    <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3 md:col-span-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">Payment types</h3>
      <p className="text-[10px] text-[var(--muted)]">
        Name the ways you are paid or pay (for example PayPal, Bit or a payment app). Each belongs to a payment method, which decides the default account and how reports group it. Removing one does not change payments already recorded with it.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Your payment types">
        {saved.length === 0 && <li className="text-xs text-[var(--muted)]">No payment types of your own yet.</li>}
        {saved.map(t => (
          <li key={t.id} className="flex items-center gap-1 px-3 py-1 rounded-full border border-[var(--line)] text-sm text-[var(--text)]">
            <InlineEdit value={t.name} label={`Name of payment type ${t.name}`} canEdit={canEdit && !saving}
              onSave={next => rename(t, next)} validate={next => renameProblem(t, next)} display={<bdi>{t.name}</bdi>} />
            <span className="text-xs text-[var(--muted)]">({PAYMENT_METHOD_LABELS[t.method]})</span>
            {canEdit && (
              <button
                type="button"
                disabled={saving}
                aria-label={`Remove ${t.name}`}
                onClick={() => { save({ op: 'remove', id: t.id }, `${t.name} removed`).catch(() => undefined); }}
                className="min-h-11 min-w-11 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`${id}-name`} className="text-xs text-[var(--muted)]">Name</label>
            <input
              id={`${id}-name`}
              value={name}
              maxLength={MAX_PAYMENT_TYPE_NAME + 10}
              onChange={e => setName(e.target.value)}
              aria-describedby={`${id}-hint`}
              className="w-48 bg-[var(--surface)] text-[var(--text)] text-sm p-2.5 rounded-lg border border-[var(--line)]"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-method`} className="text-xs text-[var(--muted)]">Method</label>
            <select
              id={`${id}-method`}
              value={method}
              onChange={e => setMethod(e.target.value as PaymentMethod)}
              className="bg-[var(--surface)] text-[var(--text)] text-sm p-2.5 rounded-lg border border-[var(--line)]"
            >
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={!canAdd}
            aria-busy={saving}
            className="min-h-11 px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] disabled:opacity-50"
          >
            Add type
          </button>
          <p id={`${id}-hint`} className="w-full text-[10px] text-[var(--muted)]" role={hint ? 'status' : undefined}>{hint}</p>
        </form>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">Owners and accountants can change these.</p>
      )}
    </div>
  );
}
