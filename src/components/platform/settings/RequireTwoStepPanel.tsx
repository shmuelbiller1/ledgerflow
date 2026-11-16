import { runCommand } from '../../../lib/runCommand';
import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';

/**
 * Two-step login for everyone in this workspace (Y-30), for owners. Once on, anyone in the workspace
 * who has not set up an authenticator app is asked to before they can open the books, and everyone
 * signs in with a code. Turning it on needs the owner's own two-step login first (the server checks
 * the session), so an owner cannot lock themselves out.
 */
export default function RequireTwoStepPanel() {
  const id = useId();
  const role = useCurrentRole();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!workspace || role !== 'owner') return null;
  const required = workspace.requireTwoStep === true;

  const change = async (next: boolean) => {
    setBusy(true);
    setError('');
    try {
      await runCommand({
        path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/security/two-step`,
        method: 'PUT',
        body: { required: next },
      });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, requireTwoStep: next } : w)));
      toast.success(next ? 'Everyone in this workspace now signs in with two-step login' : 'Two-step login is no longer required here');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="ledger-card p-6 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-3">
      <h2 id={`${id}-title`} className="text-lg font-black text-[var(--text)]">Sign-in rule for this workspace</h2>
      <label className="flex items-start gap-3 text-sm text-[var(--text)]">
        <input type="checkbox" className="mt-1" checked={required} disabled={busy} onChange={e => void change(e.target.checked)} />
        <span>Everyone in {workspace.name || 'this workspace'} must use two-step login. Anyone without an authenticator app is asked to set one up before they can open the books.</span>
      </label>
      <p className="text-xs text-[var(--muted)]">Turn on two-step login for your own account first (Two-step login, below) and sign in again with a code.</p>
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  );
}
