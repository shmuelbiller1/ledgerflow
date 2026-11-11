import { guestSession } from './db/guestDatabase';
import { toast } from 'sonner';

/**
 * Delete with Undo (BO-08 / C-26): the record leaves the screen at once and a "Deleted · Undo" note
 * shows for a few seconds; only then is it really deleted. Undo cancels the delete, so nothing has to
 * be restored from a copy, and no posted money can come back by mistake: callers use this only for
 * records that hold no postings (customers, vendors, items, drafts).
 *
 * If the page closes before the time is up, the record stays (the safe way to fail). If the delete is
 * refused when it finally runs, the record comes back on screen with the reason.
 */
export const UNDO_WINDOW_MS = 8000;
let windowForTests: number | null = null;
/** Tests shorten the window instead of waiting 8 seconds; null restores it. */
export function setUndoWindowForTests(ms: number | null): void { windowForTests = ms; }

export interface UndoableDelete {
  /** one per record, e.g. "customers/c1": deleting it again while pending does nothing */
  key: string;
  /** "Customer \"Acme\"": shown as `${label} deleted` */
  label: string;
  /** take it off the screen now */
  hide: () => void;
  /** put it back on screen (Undo, or the delete was refused) */
  restore: () => void;
  /** the real delete; throws to refuse */
  commit: () => Promise<void>;
  windowMs?: number;
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; restore: () => void; sampleSession: object | null }>();

export function isDeletePending(key: string): boolean {
  return pending.has(key);
}

export function deleteWithUndo(d: UndoableDelete): void {
  if (pending.has(d.key)) return;
  const sampleSession = guestSession();
  d.hide();
  const windowMs = d.windowMs ?? windowForTests ?? UNDO_WINDOW_MS;
  const timer = setTimeout(async () => {
    pending.delete(d.key);
    if (sampleSession && guestSession() !== sampleSession) return;
    try {
      await d.commit();
    } catch (err) {
      d.restore();
      toast.error(`${d.label} was not deleted: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, windowMs);
  pending.set(d.key, { timer, restore: d.restore, sampleSession });
  toast(`${d.label} deleted`, {
    duration: windowMs,
    action: { label: 'Undo', onClick: () => undoDelete(d.key, d.label) },
  });
}

export function undoDelete(key: string, label?: string): boolean {
  const entry = pending.get(key);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(key);
  if (entry.sampleSession && guestSession() !== entry.sampleSession) return false;
  entry.restore();
  if (label) toast.success(`${label} kept`);
  return true;
}
