import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { runCommand, type CommandBody } from '../../lib/runCommand';

type BudgetControl = 'off' | 'warn' | 'block';
const CHOICES: Array<{ value: BudgetControl; label: string }> = [
  { value: 'warn', label: 'Warn, and post (default)' },
  { value: 'block', label: 'Refuse the posting' },
  { value: 'off', label: 'Do not check' },
];

/**
 * EG-4: what a bill, expense or journal posted over an account's budget does (budgetGuard.ts on the server). Shows
 * the stored value; an owner changes it through PUT /workspaces/:id/budget-control, everyone else only sees it.
 */
export default function BudgetControlSetting() {
  const id = useId();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const isOwner = useCurrentRole() === 'owner';
  const stored: BudgetControl = workspace?.budgetControl ?? 'warn';
  // the choice being saved; otherwise the stored value is shown
  const [pending, setPending] = useState<BudgetControl | null>(null);
  const value = pending ?? stored;
  const busy = pending !== null;

  const change = async (next: BudgetControl) => {
    if (!workspace?.id || next === stored) return;
    setPending(next);
    try {
      await runCommand<CommandBody>({ path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/budget-control`, method: 'PUT', body: { budgetControl: next } });
      // patch the store as it is now: if the user signed out or switched account meanwhile, the
      // workspace is no longer there and nothing is written back
      const { workspaces: latest, setWorkspaces } = useAuthStore.getState();
      if (latest.some(w => w.id === workspace.id)) {
        setWorkspaces(latest.map(w => (w.id === workspace.id ? { ...w, budgetControl: next } : w)));
      }
      toast.success('Budget control saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--text)]">
      <label htmlFor={id} className="font-semibold">When a posting goes over a budget</label>
      <select id={id} value={value} disabled={!isOwner || busy} onChange={e => change(e.target.value as BudgetControl)}
        className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
        {CHOICES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      {!isOwner && <span className="text-[var(--muted)]">Only owners change this.</span>}
    </div>
  );
}
