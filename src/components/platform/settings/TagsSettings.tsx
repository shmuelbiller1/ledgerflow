import React, { useEffect, useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { toast } from 'sonner';
import { getIdToken } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { safeConfirm } from '../../../lib/utils';

/**
 * Settings → Tags (K-15): every tag in use in the workspace — on customers, vendors, projects,
 * documents and entries — with how many records carry it, and renaming one everywhere at once
 * (typing the name of another tag merges the two) or removing it from every record. Tags ignore case,
 * as the tag filters do. Only the tags change; nothing is re-posted.
 */
interface TagUse { tag: string; total: number; byKind: Record<string, number> }

const KIND: Record<string, string> = {
  customers: 'customers', vendors: 'vendors', projects: 'projects', invoices: 'invoices', bills: 'bills',
  creditNotes: 'credit notes', vendorCredits: 'vendor credits', transactions: 'entries', journalEntries: 'journal entries',
};
const field = 'px-2 py-1 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

async function api(workspaceId: string, path: string, body?: unknown) {
  const token = await getIdToken().catch(() => '');
  const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/tags${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'The tags could not be reached');
  return data.data;
}

export default function TagsSettings() {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant' || role === 'bookkeeper';
  const [tags, setTags] = useState<TagUse[] | null>(null);
  const [error, setError] = useState('');
  const [asked, setAsked] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    void (async () => {
      try {
        const data = await api(workspaceId, '');
        if (!live) return;
        setTags(data.tags as TagUse[]);
        setError('');
      } catch (err) {
        if (!live) return;
        setError(err instanceof Error ? err.message : String(err));
        setTags([]);
      }
    })();
    return () => { live = false; };
  }, [workspaceId, asked]);

  const shown = useMemo(() => (tags || []).filter(t => t.tag.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [tags, search]);
  const existing = (value: string) => (tags || []).find(t => t.tag.toLocaleLowerCase() === value.trim().toLocaleLowerCase());

  const change = async (from: string, to: string | null) => {
    setBusy(true);
    try {
      const { changed } = await api(workspaceId, '/change', { from, to });
      toast.success(to === null ? `"${from}" removed from ${changed} records` : `"${from}" is now "${to}" on ${changed} records`);
      setEditing(null);
      setAsked(n => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="tags-title" className="space-y-4">
      <div>
        <h2 id="tags-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><Tag className="w-5 h-5" aria-hidden="true" /> Tags</h2>
        <p className="text-xs text-[var(--muted)]">Labels group line amounts in reports; tags help you find records.</p>
        <p className="text-sm text-[var(--muted)]">Every tag used in this workspace and where. Rename one everywhere at once; renaming it to another tag&apos;s name merges the two.</p>
      </div>
      <input type="search" aria-label="Find a tag" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a tag" className={`${field} w-64`} dir="auto" />
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {tags === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{tags.length === 0 ? 'No tags yet. Tags typed on customers, vendors, projects or documents show here.' : 'No tag matches.'}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          {shown.map(t => {
            const merging = editing === t.tag && name.trim() && existing(name) && existing(name)!.tag !== t.tag ? existing(name)!.tag : null;
            return (
              <li key={t.tag} className="p-3 text-sm space-y-1">
                <div className="flex items-center gap-3">
                  <bdi className="font-semibold text-[var(--text)]">{t.tag}</bdi>
                  <span className="text-xs text-[var(--muted)] flex-1">
                    {Object.entries(t.byKind).map(([kind, n]) => `${n} ${KIND[kind] || kind}`).join(' · ')}
                  </span>
                  {canChange && editing !== t.tag && (
                    <>
                      <button type="button" onClick={() => { setEditing(t.tag); setName(t.tag); }} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline" aria-label={`Rename ${t.tag}`}>Rename</button>
                      <button type="button" disabled={busy} onClick={() => { if (safeConfirm(`Remove the tag "${t.tag}" from ${t.total} records?`)) void change(t.tag, null); }}
                        className="text-xs text-[var(--muted)] hover:text-rose-600" aria-label={`Remove ${t.tag}`}>Remove</button>
                    </>
                  )}
                </div>
                {editing === t.tag && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label={`New name for ${t.tag}`} value={name} onChange={e => setName(e.target.value)} maxLength={50} className={field} dir="auto" />
                    <button type="button" disabled={busy || !name.trim() || name.trim() === t.tag} onClick={() => void change(t.tag, merging || name.trim())}
                      className="px-2 py-1 text-xs rounded bg-indigo-600 text-white font-semibold disabled:opacity-50">
                      {merging ? `Merge into "${merging}"` : 'Rename everywhere'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
