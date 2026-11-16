import { runCommand } from '../../../lib/runCommand';
import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';

/**
 * The two-person rule (P-05), for owners, under Settings → Security: nobody approves what they
 * prepared. Invoices over the approval limit wait for someone other than whoever issued them, and
 * every pay run waits for an owner or accountant other than whoever prepared it. The server checks
 * there are two people who can approve before it turns on (src/lib/twoPersonRule.ts).
 */
export default function TwoPersonRulePanel() {
  const id = useId();
  const role = useCurrentRole();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!workspace || role !== 'owner') return null;
  const on = workspace.twoPersonRule === true;

  const change = async (next: boolean) => {
    setBusy(true);
    setError('');
    try {
      await runCommand({
        path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/security/two-person`,
        method: 'PUT',
        body: { on: next },
      });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, twoPersonRule: next } : w)));
      toast.success(next ? 'From now on, someone else approves what each person prepares' : 'The two-person rule is off');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="ledger-card p-6 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-3">
      <h2 id={`${id}-title`} className="text-lg font-black text-[var(--text)]">Two-person rule</h2>
      <label className="flex items-start gap-3 text-sm text-[var(--text)]">
        <input type="checkbox" className="mt-1" checked={on} disabled={busy} onChange={e => void change(e.target.checked)} />
        <span>Nobody approves what they prepared. Invoices over the approval limit wait for someone other than whoever issued them, and every pay run waits for an owner or accountant other than whoever prepared it.</span>
      </label>
      <p className="text-xs text-[var(--muted)]">It needs a second owner or accountant in the workspace.</p>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  );
}
