import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { db } from '../../../firebase';
import { doc, updateDoc } from '../../../lib/db/firestore';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { MAX_TERM_DAYS, STANDARD_TERM_DAYS, normalizeTermDays } from '../../../lib/paymentTerms';

/**
 * CC-08: the workspace's own payment terms (Net N days), offered on invoices next to Due on Receipt
 * and the standard Net 15 / 30 / 60. Owners and accountants change the list; others read it.
 * Removing a term never changes an invoice that already uses it.
 */
export function PaymentTermsSettings() {
  const id = useId();
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const saved = normalizeTermDays(useAuthStore(s => s.getCurrentWorkspace()?.paymentTermDays));
  const role = useCurrentRole();
  const canEdit = role === 'owner' || role === 'accountant';
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const draftDays = Number(draft);
  const draftValid = draft.trim() !== '' && Number.isInteger(draftDays) && draftDays >= 1 && draftDays <= MAX_TERM_DAYS;
  const draftKnown = draftValid && (STANDARD_TERM_DAYS.includes(draftDays) || saved.includes(draftDays));

  // one save at a time; the reply is ignored after a sign-out or account switch
  const save = (next: number[], done: string, onSaved?: () => void): void => {
    if (!workspaceId || saving || !canEdit) return;
    setSaving(true);
    const startedBy = useAuthStore.getState().user?.uid;
    const paymentTermDays = normalizeTermDays(next);
    updateDoc(doc(db, 'workspaces', workspaceId), { paymentTermDays }).then(() => {
      const now = useAuthStore.getState();
      if (now.user?.uid !== startedBy) return;
      now.setWorkspaces(now.workspaces.map(w => (w.id === workspaceId ? { ...w, paymentTermDays } : w)));
      onSaved?.();
      toast.success(done);
    }, (err: unknown) => {
      console.error('[Settings] Failed to save payment terms:', err);
      toast.error('Payment terms could not be saved (owners and accountants can change them).');
    }).finally(() => setSaving(false));
  };

  const add = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!draftValid || draftKnown) return;
    save([...saved, draftDays], `Net ${draftDays} added`, () => setDraft(''));
  };

  return (
    <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3 md:col-span-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text)]">Payment terms</h3>
      <p className="text-[10px] text-[var(--muted)]">
        Invoices always offer Due on Receipt, Net 15, Net 30 and Net 60. Add your own (for example Net 7 or Net 90); the due date is the invoice date plus that many days. Removing one does not change invoices that already use it.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Your payment terms">
        {saved.length === 0 && <li className="text-xs text-[var(--muted)]">No terms of your own yet.</li>}
        {saved.map(d => (
          <li key={d} className="flex items-center gap-1 px-3 py-1 rounded-full border border-[var(--line)] text-sm text-[var(--text)]">
            Net {d}
            {canEdit && (
              <button
                type="button"
                disabled={saving}
                aria-label={`Remove Net ${d}`}
                onClick={() => save(saved.filter(x => x !== d), `Net ${d} removed`)}
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
            <label htmlFor={`${id}-days`} className="text-xs text-[var(--muted)]">Days</label>
            <input
              id={`${id}-days`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_TERM_DAYS}
              step={1}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              aria-describedby={`${id}-hint`}
              className="w-28 bg-[var(--surface)] text-[var(--text)] text-sm p-2.5 rounded-lg border border-[var(--line)]"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !draftValid || draftKnown}
            aria-busy={saving}
            className="min-h-11 px-4 rounded-lg border border-[var(--line)] text-sm font-medium text-[var(--text)] disabled:opacity-50"
          >
            Add term
          </button>
          <p id={`${id}-hint`} className="w-full text-[10px] text-[var(--muted)]" role={draft && (!draftValid || draftKnown) ? 'status' : undefined}>
            {draft && !draftValid ? `Enter a whole number of days from 1 to ${MAX_TERM_DAYS}.` : draftKnown ? `Net ${draftDays} is already offered.` : 'A whole number of days from 1 to 365.'}
          </p>
        </form>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">Owners and accountants can change these.</p>
      )}
    </div>
  );
}
