import { runCommand } from '../../../lib/runCommand';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { formatDate, getLocalDateISO } from '../../../lib/utils';
import { delegationProblem, type ApprovalDelegate } from '../../../lib/approvalDelegation';
import { useHandOvers } from '../../collaboration/useHandOvers';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';

/**
 * "While I'm away" (BG-07) under Invoice approval: an owner or accountant names someone to approve
 * invoices over the limit in their place until a date, or takes it back. Whoever is approving in
 * someone's place sees until when.
 */
export default function ApprovalDelegatePanel() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const uid = useAuthStore(s => s.user?.uid) || '';
  const role = useCurrentRole();
  const { people } = useHandOvers();
  const [to, setTo] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;
  const today = getLocalDateISO();
  const live = (workspace.approvalDelegates || []).filter(d => d.until >= today);
  const mine = live.find(d => d.from === uid);
  const forMe = live.filter(d => d.to === uid);
  const nameOf = (id: string) => people.find(p => p.uid === id)?.email || 'a teammate';
  const canHand = role === 'owner' || role === 'accountant';
  const problem = delegationProblem(workspace, uid, { to, until }, today);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const data = await runCommand<{ approvalDelegates?: ApprovalDelegate[] }>({
        path: `/api/v1/workspaces/${encodeURIComponent(workspace.id)}/approval-delegate`,
        method: 'PUT',
        body,
      });
      setWorkspaces(useAuthStore.getState().workspaces.map(w => (w.id === workspace.id ? { ...w, approvalDelegates: data.approvalDelegates || [] } : w)));
      toast.success(body.clear ? 'You approve your invoices again' : `${nameOf(String(body.to))} approves in your place until ${formatDate(String(body.until))}`);
      setTo(''); setUntil('');
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 text-sm">
      {forMe.map(d => <p key={d.from} className="text-[var(--text)]">You approve invoices in the place of {nameOf(d.from)} until {formatDate(d.until)}.</p>)}
      {canHand && (mine ? (
        <p className="text-[var(--text)]">{nameOf(mine.to)} approves in your place until {formatDate(mine.until)}. <button type="button" disabled={busy} onClick={() => void save({ clear: true })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Take it back</button></p>
      ) : (
        <fieldset disabled={busy} className="flex flex-wrap items-end gap-2">
          <legend className="mb-1 text-xs font-semibold text-[var(--muted)]">While you are away, someone approves in your place</legend>
          <label className="flex flex-col gap-1 text-[var(--muted)]">Who
            <select value={to} onChange={e => setTo(e.target.value)} className={field}>
              <option value="">Choose…</option>
              {people.filter(p => p.uid !== uid && p.role !== 'viewer').map(p => <option key={p.uid} value={p.uid}>{p.email || `A teammate (${p.role})`}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[var(--muted)]">Until (that day included)<input type="date" value={until} onChange={e => setUntil(e.target.value)} className={field} /></label>
          <button type="button" disabled={Boolean(problem)} onClick={() => void save({ to, until })} className="rounded-lg border border-[var(--line)] px-3 py-1.5 font-semibold text-[var(--text)] disabled:opacity-50">Hand over</button>
          {to && until && problem && <p role="status" className="w-full text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
        </fieldset>
      ))}
    </div>
  );
}
