import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { formatCurrency } from '../../lib/utils';
import { MAX_LINK_NOTE, otherEnd, type EntryLink } from '../../lib/entryLinks';
import { runCommand, type CommandBody } from '../../lib/runCommand';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call<T = CommandBody>(workspaceId: string, path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  return runCommand<T>({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/entry-links${path}`,
    method,
    ...(body === undefined ? {} : { body }),
  }) ?? {} as T;
}

/**
 * Linked entries (M-10) in an entry's edit window: the entries said to belong with this one (a
 * refund and its sale, a transfer's two sides), each opening from here, and "Link another entry"
 * for owners, accountants and bookkeepers. A link changes nothing in the books.
 */
export default function EntryLinks({ transactionId }: { transactionId: string }) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const uid = useAuthStore(s => s.user?.uid) || '';
  if (!workspaceId || !uid) return null;
  return <EntryLinksForScope key={JSON.stringify([workspaceId, uid, transactionId])} workspaceId={workspaceId} uid={uid} transactionId={transactionId} />;
}

function EntryLinksForScope({ workspaceId, uid, transactionId }: { workspaceId: string; uid: string; transactionId: string }) {
  const role = useCurrentRole();
  const transactions = useLedgerStore(s => s.transactions);
  const openRecord = useUIStore(s => s.openRecord);
  const [read, setRead] = useState<{ key: string; links?: EntryLink[]; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const readKey = JSON.stringify([workspaceId, uid, transactionId, version]);
  const currentRead = read?.key === readKey ? read : null;
  const links = currentRead?.links || [];
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alive = useRef(false);
  const canLink = ['owner', 'accountant', 'bookkeeper'].includes(role);

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!workspaceId || !uid) return;
    let live = true;
    call<{ links?: EntryLink[] }>(workspaceId, `?transactionId=${encodeURIComponent(transactionId)}`).then(data => {
      if (!Array.isArray(data?.links) || data.links.some(l => !l || typeof l.id !== 'string' || !l.id || typeof l.a !== 'string' || typeof l.b !== 'string' || !otherEnd(l, transactionId))) throw new Error('The server returned an invalid link list.');
      if (live) setRead({ key: readKey, links: data.links });
    }).catch(err => { if (live) setRead({ key: readKey, error: err instanceof Error ? err.message : 'The links could not be loaded.' }); });
    return () => { live = false; };
  }, [workspaceId, uid, transactionId, readKey]);

  if (!workspaceId || !uid || (!canLink && currentRead?.links && links.length === 0)) return null;
  const describe = (id: string) => {
    const t = (transactions || []).find(x => x.id === id);
    return t ? `${t.date} · ${t.description || 'Entry'} · ${formatCurrency(t.totalAmountCents || 0, t.currency)}` : 'An entry not loaded here';
  };
  const linked = new Set(links.map(l => otherEnd(l, transactionId)));
  const choices = [...(transactions || [])].filter(t => t.id !== transactionId && !linked.has(t.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);

  const stillCurrent = () => alive.current && useAuthStore.getState().currentWorkspaceId === workspaceId && useAuthStore.getState().user?.uid === uid;
  const link = async () => {
    if (!canLink || busyRef.current || !currentRead?.links || !choices.some(choice => choice.id === other)) return;
    busyRef.current = true; setBusy(true);
    try {
      const data = await call<{ link: EntryLink }>(workspaceId, '', 'POST', { a: transactionId, b: other, ...(note.trim() ? { note } : {}) });
      if (!data?.link?.id || otherEnd(data.link, transactionId) !== other) throw new Error('The server returned an invalid link. Reload linked entries before trying again.');
      if (!stillCurrent()) return;
      setRead(previous => previous?.key === readKey && previous.links ? { key: readKey, links: [...previous.links.filter(l => l.id !== data.link.id), data.link] } : previous);
      setOther(''); setNote(''); setAdding(false);
    } catch (err) {
      if (stillCurrent()) {
        toast.error(err instanceof Error ? err.message : String(err));
        setRead({ key: readKey, error: 'The link request did not complete reliably. Reload before trying again.' });
      }
    }
    finally { busyRef.current = false; if (stillCurrent()) setBusy(false); }
  };
  const unlink = async (l: EntryLink) => {
    if (!canLink || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      await call(workspaceId, `/${encodeURIComponent(l.id)}`, 'DELETE');
      if (!stillCurrent()) return;
      setRead(previous => previous?.key === readKey && previous.links ? { key: readKey, links: previous.links.filter(x => x.id !== l.id) } : previous);
    } catch (err) {
      if (stillCurrent()) {
        toast.error(err instanceof Error ? err.message : String(err));
        setRead({ key: readKey, error: 'The unlink request did not complete reliably. Reload to check the current links.' });
      }
    }
    finally { busyRef.current = false; if (stillCurrent()) setBusy(false); }
  };

  return (
    <section aria-label="Linked entries" className="space-y-2 rounded-xl border border-[var(--line)] p-3 text-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--muted)]"><Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Linked entries ({currentRead?.links ? links.length : '…'})</h3>
      {currentRead?.error ? <div role="alert" className="text-xs text-[var(--neg)]">Could not load linked entries: {currentRead.error} <button type="button" className="min-h-11 underline" onClick={() => setVersion(v => v + 1)}>Retry loading linked entries</button></div> : !currentRead?.links && <p className="text-xs text-[var(--muted)]">Loading linked entries…</p>}
      <ul className="space-y-1">
        {links.map(l => {
          const id = otherEnd(l, transactionId)!;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <button type="button" onClick={() => openRecord({ type: 'transaction', id })} className="text-indigo-600 dark:text-indigo-400 hover:underline"><bdi>{describe(id)}</bdi></button>
                {l.note && <span className="text-xs text-[var(--muted)]"> · <bdi>{l.note}</bdi></span>}
              </span>
              {canLink && <button type="button" disabled={busy} onClick={() => void unlink(l)} className="text-xs text-rose-600 hover:underline disabled:opacity-50">Unlink<span className="sr-only"> {describe(id)}</span></button>}
            </li>
          );
        })}
      </ul>
      {canLink && !adding && <button type="button" disabled={busy || !currentRead?.links} onClick={() => setAdding(true)} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">Link another entry</button>}
      {canLink && adding && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)] flex-1 min-w-60">Entry
            <select value={other} onChange={e => setOther(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
              <option value="">Choose…</option>
              {choices.map(t => <option key={t.id} value={t.id}>{describe(t.id)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Why (optional)<input value={note} maxLength={MAX_LINK_NOTE} onChange={e => setNote(e.target.value)} placeholder="Refund of the sale" className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" /></label>
          <button type="button" disabled={busy || !currentRead?.links || !choices.some(choice => choice.id === other)} onClick={() => void link()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Link</button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        </div>
      )}
    </section>
  );
}
