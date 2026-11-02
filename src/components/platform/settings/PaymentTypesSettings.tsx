import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { db } from '../../../firebase';
import { doc, getDoc, updateDoc } from '../../../lib/db/firestore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../../lib/accountDefaults';
import { MAX_PAYMENT_TYPES, MAX_PAYMENT_TYPE_NAME, newPaymentTypeId, normalizePaymentTypes, renamePaymentType, type PaymentType } from '../../../lib/paymentTypes';
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

  const clean = name.trim().replace(/\s+/g, ' ');
  const duplicate = clean !== '' && saved.some(t => t.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
  const full = saved.length >= MAX_PAYMENT_TYPES;
  const canAdd = canEdit && !saving && clean !== '' && clean.length <= MAX_PAYMENT_TYPE_NAME && !duplicate && !full;

  // One save at a time. Each change is applied to the list as it is in the database just before the
  // write (not to this screen's copy), so another person's addition or rename made meanwhile is kept.
  // A change that no longer fits the current list (the name was taken meanwhile) is refused. The reply
  // is ignored after a sign-out or account switch, and its message and draft clearing only belong to
  // the workspace still open. It rejects when the save fails (after saying so), so an inline edit
  // stays open with what was typed.
  const save = (change: (current: PaymentType[]) => PaymentType[] | string, done: string, onSaved?: () => void): Promise<void> => {
    if (!workspaceId || saving || !canEdit) return Promise.reject(new Error('Not saved'));
    setSaving(true);
    const startedBy = useAuthStore.getState().user?.uid;
    const ref = doc(db, 'workspaces', workspaceId);
    let paymentTypes: PaymentType[] = [];
    return getDoc(ref).then(snap => {
      const next = change(normalizePaymentTypes((snap.data() as { paymentTypes?: unknown } | undefined)?.paymentTypes));
      if (typeof next === 'string') throw Object.assign(new Error(next), { shown: true });
      paymentTypes = normalizePaymentTypes(next);
      return updateDoc(ref, { paymentTypes });
    }).then(() => {
      const now = useAuthStore.getState();
      if (now.user?.uid !== startedBy) return;
      now.setWorkspaces(now.workspaces.map(w => (w.id === workspaceId ? { ...w, paymentTypes } : w)));
      if (now.currentWorkspaceId !== workspaceId) return;
      onSaved?.();
      toast.success(done);
    }, (err: unknown) => {
      if ((err as { shown?: boolean }).shown) toast.error((err as Error).message);
      else {
        console.error('[Settings] Failed to save payment types:', err);
        toast.error('Payment types could not be saved (owners and accountants can change them).');
      }
      throw err;
    }).finally(() => setSaving(false));
  };

  const taken = (list: PaymentType[], name: string, exceptId?: string) =>
    list.some(x => x.id !== exceptId && x.name.toLocaleLowerCase() === name.toLocaleLowerCase());

  const rename = (t: PaymentType, next: string | number): Promise<void> => {
    const name = String(next).trim().replace(/\s+/g, ' ');
    return save(current => {
      if (!current.some(x => x.id === t.id)) return `${t.name} was removed meanwhile.`;
      if (taken(current, name, t.id)) return `${name} is already a payment type.`;
      return renamePaymentType(current, t.id, name);
    }, `Renamed to ${name}`);
  };
  const renameProblem = (t: PaymentType, next: string | number): string | null => {
    const clean = String(next).trim().replace(/\s+/g, ' ');
    if (!clean) return 'Enter a name';
    if (clean.length > MAX_PAYMENT_TYPE_NAME) return `Up to ${MAX_PAYMENT_TYPE_NAME} characters`;
    if (saved.some(x => x.id !== t.id && x.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return `${clean} is already a payment type`;
    return null;
  };

  const add = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canAdd) return;
    const added = { name: clean, method };
    save(current => {
      if (taken(current, added.name)) return `${added.name} is already a payment type.`;
      if (current.length >= MAX_PAYMENT_TYPES) return `Up to ${MAX_PAYMENT_TYPES} payment types.`;
      return [...current, { id: newPaymentTypeId(current), ...added }];
    }, `${clean} added`, () => setName('')).catch(() => undefined); // the failure was already said
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
                onClick={() => { save(current => current.filter(x => x.id !== t.id), `${t.name} removed`).catch(() => undefined); }}
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
