import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency } from '../../lib/utils';
import { MAX_LINK_NOTE, otherEnd, type EntryLink } from '../../lib/entryLinks';

async function call(workspaceId: string, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/entry-links${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'That did not work');
  return data;
}

/**
 * Linked entries (M-10) in an entry's edit window: the entries said to belong with this one (a
 * refund and its sale, a transfer's two sides), each opening from here, and "Link another entry"
 * for owners, accountants and bookkeepers. A link changes nothing in the books.
 */
export default function EntryLinks({ transactionId }: { transactionId: string }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const uid = useAuthStore(s => s.user?.uid) || '';
  const role = useCurrentRole();
  const transactions = useLedgerStore(s => s.transactions);
  const openRecord = useUIStore(s => s.openRecord);
  const [links, setLinks] = useState<EntryLink[]>([]);
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const canLink = ['owner', 'accountant', 'bookkeeper'].includes(role);

  useEffect(() => {
    if (!workspaceId || !uid) return;
    let live = true;
    call(workspaceId, `?transactionId=${encodeURIComponent(transactionId)}`).then(data => { if (live) setLinks(data.links || []); }).catch((err) => { console.warn('[EntryLinks] Could not load entry links:', err); });
    return () => { live = false; };
  }, [workspaceId, uid, transactionId]);

  if (!workspaceId || !uid || (!canLink && links.length === 0)) return null;
  const describe = (id: string) => {
    const t = (transactions || []).find(x => x.id === id);
    return t ? `${t.date} · ${t.description || 'Entry'} · ${formatCurrency(t.totalAmountCents || 0, t.currency)}` : 'An entry not loaded here';
  };
  const linked = new Set(links.map(l => otherEnd(l, transactionId)));
  const choices = [...(transactions || [])].filter(t => t.id !== transactionId && !linked.has(t.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);

  const link = async () => {
    try {
      const data = await call(workspaceId, '', 'POST', { a: transactionId, b: other, ...(note.trim() ? { note } : {}) });
      setLinks(list => [...list.filter(l => l.id !== data.link.id), data.link]);
      setOther(''); setNote(''); setAdding(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };
  const unlink = async (l: EntryLink) => {
    try {
      await call(workspaceId, `/${encodeURIComponent(l.id)}`, 'DELETE');
      setLinks(list => list.filter(x => x.id !== l.id));
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  };

  return (
    <section aria-label="Linked entries" className="space-y-2 rounded-xl border border-[var(--line)] p-3 text-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)]"><Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Linked entries ({links.length})</h3>
      <ul className="space-y-1">
        {links.map(l => {
          const id = otherEnd(l, transactionId)!;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <button type="button" onClick={() => openRecord({ type: 'transaction', id })} className="text-indigo-600 dark:text-indigo-400 hover:underline"><bdi>{describe(id)}</bdi></button>
                {l.note && <span className="text-xs text-[var(--muted)]"> · <bdi>{l.note}</bdi></span>}
              </span>
              {canLink && <button type="button" onClick={() => void unlink(l)} className="text-xs text-rose-600 hover:underline">Unlink<span className="sr-only"> {describe(id)}</span></button>}
            </li>
          );
        })}
      </ul>
      {canLink && !adding && <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Link another entry</button>}
      {canLink && adding && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)] flex-1 min-w-60">Entry
            <select value={other} onChange={e => setOther(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
              <option value="">Choose…</option>
              {choices.map(t => <option key={t.id} value={t.id}>{describe(t.id)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Why (optional)<input value={note} maxLength={MAX_LINK_NOTE} onChange={e => setNote(e.target.value)} placeholder="Refund of the sale" className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" /></label>
          <button type="button" disabled={!other} onClick={() => void link()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Link</button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        </div>
      )}
    </section>
  );
}
