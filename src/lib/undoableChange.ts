/**
 * EU-B5: undo instead of "Are you sure?". A reversible change (archive, restore, categorise, set a label…) is made
 * at once; when it saved, "Done · Undo" shows for ten seconds and Undo saves the exact previous value back.
 * Confirmations stay for void and delete.
 */
import { toast } from 'sonner';

export const UNDO_MS = 10_000;

export async function changeWithUndo<V>(opts: {
  /** what the screen says when it is done, e.g. `"Acme" archived` */
  done: string;
  /** what it says after Undo */
  undone: string;
  before: V;
  after: V;
  /** saves a value; false (or a throw) means it was not saved and the save already said why */
  save: (value: V) => Promise<boolean>;
}): Promise<boolean> {
  const { done, undone, before, after, save } = opts;
  if (!(await save(after))) return false;
  toast.success(done, {
    duration: UNDO_MS,
    action: { label: 'Undo', onClick: () => { void save(before).then(ok => { if (ok) toast.success(undone); }); } },
  });
  return true;
}
