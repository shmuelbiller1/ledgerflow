import { runCommand } from '../../../lib/runCommand';
import React, { useState } from 'react';
import { Split } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { allocationRulesProblem, type AllocationRule } from '../../../lib/allocationRules';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/** A rule being edited: percentages as typed. */
interface Draft { id?: string; name: string; match: string; shares: Array<{ key: string; percent: string; accountId: string; labels: Record<string, string> }> }

const newKey = () => globalThis.crypto.randomUUID();

const toDraft = (r: AllocationRule): Draft => ({ id: r.id, name: r.name, match: r.match, shares: r.shares.map(s => ({ key: newKey(), percent: String(s.percent), accountId: s.accountId || '', labels: { ...(s.labels || {}) } })) });
const fromDraft = (d: Draft) => ({
  ...(d.id ? { id: d.id } : {}), name: d.name, match: d.match,
  shares: d.shares.map(s => {
    const labels = Object.fromEntries(Object.entries(s.labels).filter(([, v]) => v));
    return { percent: Number(s.percent), ...(s.accountId ? { accountId: s.accountId } : {}), ...(Object.keys(labels).length ? { labels } : {}) };
  }),
});

/**
 * Settings → Split rules (Q-05): saved ways to split a cost, e.g. the landlord's rent 60/40 between two
 * properties. A rule is suggested on a bill whose vendor or description contains its text, and only
 * changes the lines on screen when applied; nothing is posted by a rule. Owners and accountants keep
 * them (saved by the server, allocationRuleService.ts); others see them.
 */
export default function AllocationRulesSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const accounts = useLedgerStore(s => s.accounts);
  const nodes = useLedgerStore(s => s.dimensionNodes);
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [editing, setEditing] = useState<{ index: number | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;
  const rules = workspace.allocationRules || [];
  const dimensions = workspace.dimensions || [];
  const live = (accounts || []).filter(a => !a.isArchived).sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = (id: string) => live.find(a => a.id === id)?.name || id;

  const save = async (next: Array<ReturnType<typeof fromDraft> | AllocationRule>, done: string) => {
    setBusy(true);
    try {
      const data = await runCommand<{ rules?: AllocationRule[] }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/allocation-rules`,
        method: 'PUT',
        body: { rules: next },
      });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, allocationRules: data.rules || [] } : w)));
      toast.success(done);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const draft = editing?.draft;
  const nextRules = (d: Draft) => {
    const list: Array<ReturnType<typeof fromDraft> | AllocationRule> = [...rules];
    if (editing?.index === null || editing?.index === undefined) list.push(fromDraft(d)); else list[editing.index] = fromDraft(d);
    return list;
  };
  const problem = draft ? allocationRulesProblem(nextRules(draft)) : null;
  const setShare = (i: number, change: Partial<Draft['shares'][number]>) => setEditing(e => e && ({ ...e, draft: { ...e.draft, shares: e.draft.shares.map((s, j) => (j === i ? { ...s, ...change } : s)) } }));

  return (
    <section aria-labelledby="split-rules-title" className="space-y-4">
      <div>
        <h2 id="split-rules-title" className="text-lg font-bold text-[var(--text)] flex items-center gap-2"><Split className="w-5 h-5" aria-hidden="true" /> Split rules</h2>
        <p className="text-sm text-[var(--muted)]">Saved ways to split a cost, e.g. the landlord's rent 60/40 between two properties. A rule is suggested on a bill whose vendor or description contains its text; applying it changes the lines on screen, and nothing is posted until you save the bill.</p>
        {!canChange && <p className="text-sm text-[var(--muted)]">Owners and accountants keep the split rules.</p>}
      </div>
      <ul className="rounded-xl border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]">
        {rules.length === 0 && <li className="p-4 text-sm text-[var(--muted)]">No split rules yet.</li>}
        {rules.map((r, index) => (
          <li key={r.id} className="p-4 flex flex-wrap items-start justify-between gap-2 text-sm">
            <div>
              <p className="font-semibold text-[var(--text)]"><bdi>{r.name}</bdi></p>
              <p className="text-xs text-[var(--muted)]">When the vendor or description contains “<bdi>{r.match}</bdi>”: {r.shares.map(s => `${s.percent}%${s.accountId ? ` to ${nameOf(s.accountId)}` : ''}${s.labels ? ` (${Object.values(s.labels).join(', ')})` : ''}`).join(' · ')}</p>
            </div>
            {canChange && (
              <div className="flex gap-2 text-xs">
                <button type="button" disabled={busy} onClick={() => setEditing({ index, draft: toDraft(r) })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Change<span className="sr-only"> {r.name}</span></button>
                <button type="button" disabled={busy} onClick={() => void save(rules.filter((_, i) => i !== index), `Rule ${r.name} removed`)} className="text-rose-600 hover:underline">Remove<span className="sr-only"> {r.name}</span></button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canChange && draft && (
        <fieldset disabled={busy} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3 text-sm">
          <legend className="px-1 font-semibold text-[var(--text)]">{editing?.index === null ? 'New split rule' : 'Change the rule'}</legend>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-[var(--muted)]">Name
              <input value={draft.name} onChange={e => setEditing(x => x && ({ ...x, draft: { ...x.draft, name: e.target.value } }))} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[var(--muted)]">Vendor or description contains
              <input value={draft.match} onChange={e => setEditing(x => x && ({ ...x, draft: { ...x.draft, match: e.target.value } }))} className={field} />
            </label>
          </div>
          <div role="group" aria-label="Shares" className="space-y-2">
            {draft.shares.map((s, i) => (
              <div key={s.key} className="flex flex-wrap items-center gap-2">
                <input inputMode="decimal" aria-label={`Share ${i + 1} percentage`} value={s.percent} onChange={e => setShare(i, { percent: e.target.value })} className={`${field} w-20 text-right`} />%
                <select aria-label={`Share ${i + 1} account`} value={s.accountId} onChange={e => setShare(i, { accountId: e.target.value })} className={field}>
                  <option value="">The line's own account</option>
                  {live.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {dimensions.map(d => (
                  <select key={d.id} aria-label={`Share ${i + 1} ${d.name}`} value={s.labels[d.id] || ''} onChange={e => setShare(i, { labels: { ...s.labels, [d.id]: e.target.value } })} className={field}>
                    <option value="">No {d.name}</option>
                    {(nodes || []).filter(n => n.dimensionId === d.id && n.status !== 'archived').map(n => <option key={n.id} value={n.id}>{n.description || n.id}</option>)}
                  </select>
                ))}
                {draft.shares.length > 2 && (
                  <button type="button" onClick={() => setEditing(x => x && ({ ...x, draft: { ...x.draft, shares: x.draft.shares.filter((_, j) => j !== i) } }))} className="text-xs text-rose-600 hover:underline">Remove share {i + 1}</button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setEditing(x => x && ({ ...x, draft: { ...x.draft, shares: [...x.draft.shares, { key: newKey(), percent: '', accountId: '', labels: {} }] } }))} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Add a share</button>
          </div>
          {problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={Boolean(problem)} onClick={() => void save(nextRules(draft), `Rule ${draft.name.trim()} saved`)} className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save rule</button>
            <button type="button" onClick={() => setEditing(null)} className="text-[var(--muted)] hover:underline">Cancel</button>
          </div>
        </fieldset>
      )}
      {canChange && !draft && (
        <button type="button" onClick={() => setEditing({ index: null, draft: { name: '', match: '', shares: [{ key: newKey(), percent: '50', accountId: '', labels: {} }, { key: newKey(), percent: '50', accountId: '', labels: {} }] } })}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] hover:bg-[var(--elevated)]">New split rule</button>
      )}
    </section>
  );
}
