import { guestSession, SAMPLE_WORKSPACE_ID } from '../../../lib/db/guestDatabase';
import { readGuestStages, saveGuestStages } from '../../../lib/guestSettings';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getIdToken } from '../../../firebase';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { MAX_STAGES, stagesProblem, type StageKind, type StageSets } from '../../../lib/stages';
import { resetStages } from '../../collaboration/stageStore';

const field = 'px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]';
const LABEL: Record<StageKind, string> = { invoice: 'Invoices', bill: 'Bills' };
const EXAMPLE: Record<StageKind, string> = { invoice: 'Checked, Sent to the client, Followed up', bill: 'Received, Checked, Ready to pay' };

/**
 * Settings → Stages (BG-06): the workspace's own stages for invoices and bills, one per line, in
 * order. Each invoice or bill then shows its stage on its row. Owners and accountants keep them.
 */
export default function StagesSettings() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const role = useCurrentRole();
  const canChange = role === 'owner' || role === 'accountant';
  const [text, setText] = useState<Record<StageKind, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const workspaceId = workspace?.id || '';

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    (async () => {
      if (guestSession()) return readGuestStages(workspaceId, 'bill').sets;
      if (workspaceId === SAMPLE_WORKSPACE_ID) throw new Error('The sample company is closed.');
      const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/stages?kind=bill`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      return res.ok ? ((await res.json()).sets || {}) as StageSets : {};
    })().then(sets => { if (live) setText({ invoice: (sets.invoice || []).join('\n'), bill: (sets.bill || []).join('\n') }); }).catch(() => { if (live) setText({ invoice: '', bill: '' }); });
    return () => { live = false; };
  }, [workspaceId]);

  if (!workspace) return null;
  const sets: StageSets | null = text && { invoice: text.invoice.split('\n').map(s => s.trim()).filter(Boolean), bill: text.bill.split('\n').map(s => s.trim()).filter(Boolean) };
  const problem = sets ? stagesProblem(sets) : null;
  const save = async () => {
    setBusy(true);
    try {
      const sampleSession = guestSession();
      if (sampleSession) {
        if (!sets) throw new Error('Enter stages first');
        saveGuestStages(workspaceId, sets);
      } else {
        if (workspaceId === SAMPLE_WORKSPACE_ID) throw new Error('The sample company is closed.');
        const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/stages/sets`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: JSON.stringify({ sets }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'The stages were not saved');
      }
      if (guestSession() !== sampleSession || useAuthStore.getState().currentWorkspaceId !== workspaceId) return;
      resetStages();
      toast.success('Stages saved');
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="stages-title" className="space-y-4">
      <div>
        <h2 id="stages-title" className="text-lg font-bold text-[var(--text)]">Stages</h2>
        <p className="text-sm text-[var(--muted)]">Your own steps for invoices and bills, e.g. bills: Received, Checked, Ready to pay. Each one then shows its stage on its row. A stage is your team's mark: it changes nothing in the books or in what is paid.</p>
        {!canChange && <p className="text-sm text-[var(--muted)]">Owners and accountants keep the stages.</p>}
      </div>
      {!text && <p role="status" className="text-sm text-[var(--muted)]">Loading…</p>}
      {text && (
        <fieldset disabled={!canChange || busy} className="grid gap-4 md:grid-cols-2">
          {(['invoice', 'bill'] as StageKind[]).map(kind => (
            <label key={kind} className="flex flex-col gap-1 text-sm text-[var(--muted)]">{LABEL[kind]}: one stage a line, in order (up to {MAX_STAGES})
              <textarea rows={5} value={text[kind]} placeholder={EXAMPLE[kind].split(', ').join('\n')} onChange={e => setText(t => t && { ...t, [kind]: e.target.value })} className={field} />
            </label>
          ))}
        </fieldset>
      )}
      {problem && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
      {canChange && text && <button type="button" disabled={Boolean(problem) || busy} onClick={() => void save()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Save stages</button>}
    </section>
  );
}
