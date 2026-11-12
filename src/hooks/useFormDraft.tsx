/**
 * EU-B3: never lose typed work. An open invoice, bill or journal-entry form is kept in this browser's storage
 * (per form and workspace, and per document when it already exists) while it has unsaved changes. Opening the
 * same form again offers "Continue your unsaved …?"; saving or discarding clears it. Storage that refuses
 * (private mode, full) only means nothing is kept — the form works as before.
 */
import React, { useCallback, useEffect, useState } from 'react';

export const DRAFT_PREFIX = 'lf_form_draft';
/** a kept draft older than this is not offered (and is removed) */
export const DRAFT_MAX_AGE_MS = 14 * 86_400_000;

export const draftKey = (form: string, workspaceId: string, documentId?: string) => `${DRAFT_PREFIX}:${workspaceId}:${form}:${documentId || 'new'}`;

interface Stored<T> { savedAt: number; value: T }

function read<T>(key: string, now = Date.now()): Stored<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || typeof parsed.savedAt !== 'number' || now - parsed.savedAt > DRAFT_MAX_AGE_MS) { localStorage.removeItem(key); return null; }
    return parsed;
  } catch {
    return null; // unreadable storage offers nothing; the form opens empty as before
  }
}

function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); return true; } catch { return false; }
}

/** false when storage refused (then nothing was kept either) */
export function clearFormDraft(key: string): boolean {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}

/**
 * `value` is what to keep (only while `dirty`); `restore` puts a kept value back into the form.
 * Returns the offer to show (or null) and `clear()` for after a save or a discard.
 */
export function useFormDraft<T>(opts: { form: string; label: string; workspaceId?: string | null; documentId?: string; open: boolean; dirty: boolean; value: T; restore: (value: T) => void }) {
  const { form, label, workspaceId, documentId, open, dirty, value, restore } = opts;
  const key = workspaceId ? draftKey(form, workspaceId, documentId) : '';
  const [offer, setOffer] = useState<Stored<T> | null>(null);
  // the offer is made once per opening (adjusting state during render), before anything typed now is kept over it
  const [offeredFor, setOfferedFor] = useState('');
  const want = open && key ? key : '';
  if (offeredFor !== want) {
    setOfferedFor(want);
    setOffer(want ? read<T>(want) : null);
  }

  useEffect(() => {
    if (!open || !key || !dirty || offer) return; // an open offer is not overwritten until it is answered
    write(key, value);
  }, [open, key, dirty, value, offer]);

  const clear = useCallback(() => { if (key) clearFormDraft(key); setOffer(null); }, [key]);
  const accept = useCallback(() => { if (offer) restore(offer.value); setOffer(null); }, [offer, restore]);
  const decline = useCallback(() => clear(), [clear]);

  const banner = offer ? (
    <div role="status" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span className="flex-1">Continue your unsaved {label}? (kept in this browser {new Date(offer.savedAt).toLocaleString()})</span>
      <button type="button" onClick={accept} className="rounded border border-amber-400 bg-white px-2.5 py-1 font-semibold">Continue</button>
      <button type="button" onClick={decline} className="rounded px-2.5 py-1 font-semibold underline">Discard</button>
    </div>
  ) : null;

  return { banner, clear, hasOffer: Boolean(offer) };
}
