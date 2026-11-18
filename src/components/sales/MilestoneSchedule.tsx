import React, { useState } from 'react';
import { toast } from 'sonner';
import { formatDate } from '../../lib/utils';
import { milestonesProblem, nextMilestone, type Milestone } from '../../lib/milestones';
import { saveEstimate } from '../../lib/recordWrites';
import { useAuthStore } from '../../stores/useAuthStore';

const field = 'px-2 py-1 text-xs bg-[var(--ink)] border border-[var(--line)] rounded text-[var(--text)]';
const newId = () => globalThis.crypto.randomUUID().slice(0, 8);

/**
 * The order's milestone schedule (V-09) in its Invoice dialog: the milestones with what is done,
 * "Invoice the next milestone" (fills its percentage), and changing the schedule (writers).
 */
export function MilestoneSchedule({ estimateId, milestones, canWrite, onPick, onSaved }: {
  estimateId: string;
  milestones: Milestone[];
  canWrite: boolean;
  onPick: (m: Milestone) => void;
  onSaved: (list: Milestone[]) => void;
}) {
  // the open workspace: a milestone write names the workspace it belongs to, not the one the tab last saw
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const [editing, setEditing] = useState<Array<Milestone & { percentText: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const next = nextMilestone(milestones);
  const draft = editing?.map(({ percentText, ...m }) => ({ ...m, percent: Number(percentText.replace(',', '.')) })) || [];
  const problem = editing ? milestonesProblem(draft) : null;

  const save = async () => {
    setBusy(true);
    try {
      const list = draft.map(m => ({ id: m.id, label: m.label.trim(), percent: m.percent, ...(m.due ? { due: m.due } : {}), ...(m.invoicedAt ? { invoicedAt: m.invoicedAt } : {}) }));
      await saveEstimate(workspaceId, { id: estimateId, milestones: list });
      onSaved(list);
      setEditing(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  const set = (i: number, change: Partial<Milestone & { percentText: string }>) => setEditing(list => list && list.map((m, j) => (j === i ? { ...m, ...change } : m)));

  if (editing) {
    return (
      <fieldset disabled={busy} className="space-y-2 rounded-lg border border-[var(--line)] p-3">
        <legend className="text-xs font-semibold text-[var(--muted)]">Milestones</legend>
        {editing.map((m, i) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2">
            <input aria-label={`Milestone ${i + 1} name`} value={m.label} disabled={Boolean(m.invoicedAt)} onChange={e => set(i, { label: e.target.value })} placeholder="Halfway" className={field} />
            <input aria-label={`Milestone ${i + 1} percentage`} inputMode="decimal" value={m.percentText} disabled={Boolean(m.invoicedAt)} onChange={e => set(i, { percentText: e.target.value })} className={`${field} w-16 text-right`} />%
            <input aria-label={`Milestone ${i + 1} date`} type="date" value={m.due || ''} disabled={Boolean(m.invoicedAt)} onChange={e => set(i, { due: e.target.value || undefined })} className={field} />
            {m.invoicedAt ? <span className="text-xs text-[var(--muted)]">invoiced</span> : <button type="button" onClick={() => setEditing(list => list && list.filter((_, j) => j !== i))} className="text-xs text-rose-600 hover:underline">Remove milestone {i + 1}</button>}
          </div>
        ))}
        <button type="button" onClick={() => setEditing(list => [...(list || []), { id: newId(), label: '', percent: 0, percentText: '' }])} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Add a milestone</button>
        {problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={Boolean(problem)} onClick={() => void save()} className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">Save milestones</button>
          <button type="button" onClick={() => setEditing(null)} className="text-xs text-[var(--muted)] hover:underline">Cancel</button>
        </div>
      </fieldset>
    );
  }

  return (
    <div className="space-y-1 text-xs">
      {milestones.length > 0 && (
        <ul className="space-y-0.5">
          {milestones.map(m => <li key={m.id} className={m.invoicedAt ? 'text-[var(--muted)] line-through' : 'text-[var(--text)]'}><bdi>{m.label}</bdi>: {m.percent}%{m.due ? `, ${formatDate(m.due)}` : ''}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {next && <button type="button" onClick={() => onPick(next)} className="font-semibold text-emerald-700 hover:underline">Invoice the next milestone: <bdi>{next.label}</bdi> ({next.percent}%)</button>}
        {canWrite && <button type="button" onClick={() => setEditing(milestones.map(m => ({ ...m, percentText: String(m.percent) })))} className="text-indigo-600 dark:text-indigo-400 hover:underline">{milestones.length ? 'Change the milestones' : 'Set milestones'}</button>}
      </div>
    </div>
  );
}
