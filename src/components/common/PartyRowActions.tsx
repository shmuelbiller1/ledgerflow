import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { getIdToken } from '../../firebase';
import { isArchivedParty } from '../../lib/contacts';
import { deleteWithUndo } from '../../lib/undoableDelete';
import type { Customer, Vendor } from '../../types';
import type { PartySide } from './PartyModal';

/**
 * Archive, restore or delete a customer or vendor right in the list (I-22). Delete asks the server
 * first, which refuses when anything refers to the contact (invoices, payments, schedules…) and says
 * what; then "Archive" keeps it on those records and out of the list. Otherwise the contact leaves the
 * list with an Undo for a few seconds before it is really deleted (BO-08).
 */
export default function PartyRowActions({ side, party }: { side: PartySide; party: Customer | Vendor }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId);
  const { updateEntity } = useEntityOperations();
  const [busy, setBusy] = useState(false);
  const path = side === 'customer' ? 'customers' : 'vendors';
  const archived = isArchivedParty(party);

  const setArchived = (on: boolean) =>
    updateEntity(path, party.id, { status: on ? 'inactive' : 'active' }, on ? `"${party.name}" archived` : `"${party.name}" restored`);

  const remove = async () => {
    if (!workspaceId) return;
    setBusy(true);
    const url = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/contacts/${side}/${encodeURIComponent(party.id)}`;
    const send = async (check: boolean) => {
      const res = await fetch(check ? `${url}?check=1` : url, { method: 'DELETE', headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.message || 'The contact was not deleted'), { status: res.status });
    };
    try {
      // ask first, so a contact in use is never hidden and then brought back
      await send(true);
      const list = side === 'customer' ? 'customers' : 'vendors';
      const keep = useLedgerStore.getState()[list] as Array<Customer | Vendor>;
      const at = keep.findIndex(p => p.id === party.id);
      deleteWithUndo({
        key: `${path}/${party.id}`,
        label: `${side === 'customer' ? 'Customer' : 'Vendor'} "${party.name}"`,
        hide: () => useLedgerStore.setState(s => ({ [list]: (s[list] as Array<Customer | Vendor>).filter(p => p.id !== party.id) })),
        restore: () => useLedgerStore.setState(s => {
          const rows = (s[list] as Array<Customer | Vendor>).filter(p => p.id !== party.id);
          rows.splice(at < 0 ? rows.length : Math.min(at, rows.length), 0, party);
          return { [list]: rows };
        }),
        commit: () => send(false),
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) toast.error((err as Error).message, archived ? undefined : { action: { label: 'Archive', onClick: () => { void setArchived(true); } } });
      else toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // A-233: a 44 px tap target at 390 px — the icon is 16 px, the box around it is the target.
  const button = 'inline-flex items-center justify-center min-h-11 min-w-11 p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--ink)] disabled:opacity-50';
  return (
    <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()} role="presentation">
      <button type="button" className={button} onClick={() => setArchived(!archived)}
        aria-label={`${archived ? 'Restore' : 'Archive'} ${party.name}`} title={archived ? 'Restore (show in lists again)' : 'Archive (hide from lists; records keep it)'}>
        {archived ? <ArchiveRestore aria-hidden="true" className="w-4 h-4" /> : <Archive aria-hidden="true" className="w-4 h-4" />}
      </button>
      <button type="button" className={`${button} hover:text-rose-600`} disabled={busy} onClick={remove}
        aria-label={`Delete ${party.name}`} title="Delete (only when nothing refers to it)">
        <Trash2 aria-hidden="true" className="w-4 h-4" />
      </button>
    </span>
  );
}

/** "Show archived (3)" above a contact list; nothing when none are archived. */
export function ShowArchivedToggle({ count, on, onChange, noun }: { count: number; on: boolean; onChange: (on: boolean) => void; noun: string }) {
  if (count === 0) return null;
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className="mx-4 mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[var(--line)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]">
      <Archive aria-hidden="true" className="w-3.5 h-3.5" /> {on ? `Hide archived ${noun}s` : `Show archived ${noun}s (${count})`}
    </button>
  );
}

/** The small "Archived" mark next to an archived contact's name. */
export function ArchivedBadge({ party }: { party: { status?: string } }) {
  return isArchivedParty(party)
    ? <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--ink)] text-[var(--muted)] border border-[var(--line)]">Archived</span>
    : null;
}
