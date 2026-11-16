import React, { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../stores/useAuthStore';
import { workspaceRole } from '../../lib/periodLock';
import { closeStepsProblem, FREQUENCY_LABEL, MAX_CLOSE_STEPS, type CloseStep, type CloseStepFrequency } from '../../lib/closeSteps';
import type { Workspace } from '../../types';
import { runCommand, type CommandBody } from '../../lib/runCommand';

/**
 * A checklist per client (BD-10): owners and accountants keep this workspace's own month-end steps
 * (name, and whether each is due every month, at quarter ends or at the year end), or copy them from
 * another client they keep the books of. Saved through the server; each step then appears in the
 * Month-End Close checklist of the months it is due and needs a sign-off there.
 */
type Draft = Omit<CloseStep, 'id'> & { id?: string };

const FREQUENCIES = Object.keys(FREQUENCY_LABEL) as CloseStepFrequency[];

async function saveSteps(workspaceId: string, steps: Draft[]): Promise<CloseStep[]> {
  const data = await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/periods/close-steps`, method: 'PUT', body: { steps } }) ?? {};
  return data.closeSteps as CloseStep[];
}

interface Props {
  workspace: Workspace;
  workspaces: Workspace[];
  onSaved: (steps: CloseStep[]) => void;
}

export default function CloseStepsEditor({ workspace, workspaces, onSaved }: Props) {
  const uid = useAuthStore(s => s.user?.uid) || '';
  const saved = useMemo(() => workspace.closeSteps || [], [workspace.closeSteps]);
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Draft[]>(saved);
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<CloseStepFrequency>('monthly');
  const [busy, setBusy] = useState(false);
  const id = useId();

  // other clients this person closes the books of, that have steps to copy
  const sources = workspaces.filter(w => w.id !== workspace.id && (w.closeSteps || []).length > 0
    && ['owner', 'accountant'].includes(workspaceRole(w as never, uid)));

  const start = () => { setSteps(saved); setOpen(true); };
  const add = () => {
    const next = [...steps, { title: title.trim(), frequency }];
    const problem = closeStepsProblem(next);
    if (problem) { toast.error(problem); return; }
    setSteps(next);
    setTitle('');
  };
  const copyFrom = (sourceId: string) => {
    const source = workspaces.find(w => w.id === sourceId);
    if (!source) return;
    const have = new Set(steps.map(s => s.title.trim().toLocaleLowerCase()));
    const extra = (source.closeSteps || []).filter(s => !have.has(s.title.trim().toLocaleLowerCase())).map(s => ({ title: s.title, frequency: s.frequency }));
    const next = [...steps, ...extra].slice(0, MAX_CLOSE_STEPS);
    setSteps(next);
    toast.success(extra.length ? `${extra.length} step${extra.length === 1 ? '' : 's'} copied from ${source.name}. Save to keep them.` : `${source.name} has no steps this client does not have`);
  };
  const save = async () => {
    const problem = closeStepsProblem(steps);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      onSaved(await saveSteps(workspace.id, steps));
      setOpen(false);
      toast.success('Month-end steps saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="p-4 border-t border-[var(--line)] flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-[var(--muted)]">
          {saved.length ? `${saved.length} step${saved.length === 1 ? '' : 's'} of this client's own are in the checklist when due.` : 'Add this client\'s own steps (e.g. "Get the payroll report") to the checklist.'}
        </p>
        <button type="button" onClick={start} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text)]">
          <ListChecks className="w-3.5 h-3.5" aria-hidden="true" /> {saved.length ? 'Edit this client\'s steps' : 'Add this client\'s steps'}
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="p-4 border-t border-[var(--line)] space-y-3 bg-[var(--panel)]">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
        <ListChecks className="w-4 h-4" aria-hidden="true" /> This client's own month-end steps
      </h3>
      {steps.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No steps yet.</p>
      ) : (
        <ul className="space-y-2">
          {steps.map((step, i) => (
            <li key={step.id || `new-${i}`} className="flex flex-wrap items-center gap-2">
              <bdi className="flex-1 min-w-[12rem] text-sm text-[var(--text)]">{step.title}</bdi>
              <label className="sr-only" htmlFor={`${id}-freq-${i}`}>How often: {step.title}</label>
              <select id={`${id}-freq-${i}`} value={step.frequency}
                onChange={e => setSteps(steps.map((s, j) => (j === i ? { ...s, frequency: e.target.value as CloseStepFrequency } : s)))}
                className="px-2 py-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-xs text-[var(--text)]">
                {FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
              </select>
              <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label={`Remove ${step.title}`}
                className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--neg)]">
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor={`${id}-new`} className="block text-xs font-semibold text-[var(--muted)] mb-1">New step</label>
          <input id={`${id}-new`} value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            className="w-full px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text)]" />
        </div>
        <div>
          <label htmlFor={`${id}-new-freq`} className="block text-xs font-semibold text-[var(--muted)] mb-1">How often</label>
          <select id={`${id}-new-freq`} value={frequency} onChange={e => setFrequency(e.target.value as CloseStepFrequency)}
            className="px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text)]">
            {FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </select>
        </div>
        <button type="button" onClick={add} disabled={title.trim().length < 2 || steps.length >= MAX_CLOSE_STEPS}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-xs font-semibold text-[var(--text)] disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add step
        </button>
      </div>
      {sources.length > 0 && (
        <div>
          <label htmlFor={`${id}-copy`} className="block text-xs font-semibold text-[var(--muted)] mb-1">Copy the steps of another client</label>
          <select id={`${id}-copy`} value="" onChange={e => e.target.value && copyFrom(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--text)]">
            <option value="">Choose a client…</option>
            {sources.map(w => <option key={w.id} value={w.id}>{w.name} ({(w.closeSteps || []).length})</option>)}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[var(--text)] text-[var(--surface)] text-xs font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Save steps'}
        </button>
      </div>
    </section>
  );
}
