/**
 * Payroll approval (U-10) on Payroll → Pay runs. Owners turn on "an owner approves pay runs that
 * others prepare", and see the runs waiting with what each pays and costs: Approve posts exactly
 * those amounts; Send back keeps nothing posted and tells whoever prepared it why. Whoever prepared
 * a run can withdraw it while it waits. With the two-person rule (P-05) every run waits, an accountant
 * may decide too, and nobody approves a run they prepared. The server decides who may do what
 * (src/server/services/payRunService.ts); this panel only asks.
 */
import { runCommand } from '../../lib/runCommand';
import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { formatCurrency, formatDate, safeConfirm } from '../../lib/utils';
import { mayApprove, twoPersonOn } from '../../lib/twoPersonRule';
import type { PayRun } from '../../types';

async function call(workspaceId: string, path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  return runCommand<{ transactionId?: string; required?: boolean }>({
    path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/pay-runs${path}`,
    method: method as 'POST' | 'PUT',
    body,
  });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function PayRunApprovals() {
  const id = useId();
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const workspaces = useAuthStore(s => s.workspaces);
  const setWorkspaces = useAuthStore(s => s.setWorkspaces);
  const uid = useAuthStore(s => s.user?.uid);
  const role = useCurrentRole();
  const payRuns = useLedgerStore(s => (s.payRuns || []) as PayRun[]);
  const setPayRuns = useLedgerStore(s => s.setPayRuns);
  useLedgerCollections('payRuns');
  const [busy, setBusy] = useState('');
  const [sendingBack, setSendingBack] = useState('');
  const [note, setNote] = useState('');

  if (!workspace) return null;
  const isOwner = role === 'owner';
  const required = workspace.payrollApproval === true;
  const twoPerson = twoPersonOn(workspace);
  const canDecide = isOwner || (twoPerson && role === 'accountant');
  const waiting = payRuns.filter(r => r.status === 'awaiting_approval').sort((a, b) => a.date.localeCompare(b.date));
  const currency = workspace.currency || 'USD';
  const change = (runId: string, patch: Partial<PayRun>) => setPayRuns(payRuns.map(r => (r.id === runId ? { ...r, ...patch } : r)));

  const toggle = async (next: boolean) => {
    setBusy('setting');
    try {
      await call(workspace.id, '/approval', 'PUT', { required: next });
      setWorkspaces(workspaces.map(w => (w.id === workspace.id ? { ...w, payrollApproval: next } : w)));
      toast.success(next ? 'Pay runs prepared by others now wait for an owner' : 'Pay runs no longer need approval');
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(''); }
  };

  const approve = async (run: PayRun, again = false): Promise<void> => {
    setBusy(run.id);
    try {
      const data = await call(workspace.id, `/${encodeURIComponent(run.id)}/approve`, 'POST', again ? { again } : {});
      change(run.id, { status: 'processed', transactionId: data.transactionId, approvedBy: uid, approvedAt: new Date().toISOString() });
      toast.success(`Pay run of ${formatDate(run.date)} approved and posted`);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409 && !again && /already posted/.test(errorText(err)) && safeConfirm(`${errorText(err)}. Approve and post this one as well?`)) {
        setBusy('');
        return approve(run, true);
      }
      toast.error(errorText(err));
    } finally { setBusy(''); }
  };

  const sendBack = async (run: PayRun) => {
    setBusy(run.id);
    try {
      await call(workspace.id, `/${encodeURIComponent(run.id)}/reject`, 'POST', note.trim() ? { note: note.trim() } : {});
      change(run.id, { status: 'rejected', rejectionNote: note.trim(), rejectedAt: new Date().toISOString() });
      setSendingBack('');
      setNote('');
      toast.success(`Pay run of ${formatDate(run.date)} sent back; nothing was posted`);
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(''); }
  };

  const withdraw = async (run: PayRun) => {
    if (!safeConfirm(`Withdraw the pay run of ${formatDate(run.date)}? Nothing was posted.`)) return;
    setBusy(run.id);
    try {
      await call(workspace.id, `/${encodeURIComponent(run.id)}`, 'DELETE');
      change(run.id, { status: 'withdrawn', withdrawnAt: new Date().toISOString() });
      toast.success('Pay run withdrawn');
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(''); }
  };

  if (!isOwner && waiting.length === 0) {
    if (twoPerson) return <p className="text-xs text-neutral-600">Pay runs wait for someone other than whoever prepared them (two-person rule).</p>;
    return required ? <p className="text-xs text-neutral-600">Pay runs you prepare wait for an owner's approval before they are posted.</p> : null;
  }

  return (
    <section aria-labelledby={`${id}-title`} className="bg-white border border-neutral-200 rounded-lg p-4 space-y-3">
      <h2 id={`${id}-title`} className="text-sm font-bold text-neutral-900">Approval</h2>
      {isOwner && (
        <label className="flex items-start gap-2 text-xs text-neutral-800">
          <input type="checkbox" className="mt-0.5" checked={required} disabled={busy === 'setting'} onChange={e => void toggle(e.target.checked)} />
          <span>An owner approves pay runs that others prepare (an accountant's run is posted only after an owner approves it; owners' own runs post straight away)</span>
        </label>
      )}
      {waiting.length === 0 ? (
        <p className="text-xs text-neutral-500">No pay run is waiting for approval.</p>
      ) : (
        <ul className="space-y-2" aria-label="Pay runs waiting for approval">
          {waiting.map(run => {
            const mine = run.uid === uid;
            return (
              <li key={run.id} className="border border-amber-200 bg-amber-50/60 rounded-lg p-3 text-xs space-y-2">
                <p className="font-semibold text-neutral-900">
                  Pay run of {formatDate(run.date)}{run.schedule && run.schedule !== 'all' ? ` (${run.schedule.toLowerCase()})` : ''}: {run.employeeCount} {run.employeeCount === 1 ? 'person' : 'people'}
                </p>
                <p className="text-neutral-700">
                  Gross {formatCurrency(run.grossCents || 0, currency)} · paid out {formatCurrency(run.netCents || 0, currency)} · costs {formatCurrency(run.totalAmountCents, currency)}
                  {run.submittedByEmail ? ` · prepared by ${run.submittedByEmail}` : ''}
                </p>
                <details>
                  <summary className="cursor-pointer text-neutral-700">Who is paid</summary>
                  <ul className="mt-1 space-y-0.5">
                    {(run.employees || []).map(e => (
                      <li key={e.employeeId}>{e.name}: {formatCurrency(e.netCents, currency)} net of {formatCurrency(e.grossCents, currency)}</li>
                    ))}
                  </ul>
                </details>
                <div className="flex flex-wrap gap-2">
                  {canDecide && (
                    <>
                      {mayApprove(twoPerson, uid, run.uid) ? (
                        <button type="button" disabled={busy === run.id} onClick={() => void approve(run)} className="min-h-9 px-3 rounded-lg bg-neutral-900 text-white font-semibold disabled:opacity-50">
                          Approve and post<span className="sr-only"> the pay run of {formatDate(run.date)}</span>
                        </button>
                      ) : <span className="self-center text-neutral-600">Someone else approves it (two-person rule)</span>}
                      <button type="button" disabled={busy === run.id} aria-expanded={sendingBack === run.id} onClick={() => { setSendingBack(sendingBack === run.id ? '' : run.id); setNote(''); }} className="min-h-9 px-3 rounded-lg border border-neutral-300 font-semibold disabled:opacity-50">
                        Send back<span className="sr-only"> the pay run of {formatDate(run.date)}</span>
                      </button>
                    </>
                  )}
                  {(mine || isOwner) && (
                    <button type="button" disabled={busy === run.id} onClick={() => void withdraw(run)} className="min-h-9 px-3 rounded-lg text-neutral-600 hover:underline disabled:opacity-50">
                      Withdraw<span className="sr-only"> the pay run of {formatDate(run.date)}</span>
                    </button>
                  )}
                </div>
                {sendingBack === run.id && (
                  <div className="space-y-2">
                    <label className="block text-neutral-700" htmlFor={`${id}-note-${run.id}`}>Why (whoever prepared it is told)</label>
                    <textarea id={`${id}-note-${run.id}`} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border border-neutral-300 p-2" rows={2} />
                    <button type="button" disabled={busy === run.id} onClick={() => void sendBack(run)} className="min-h-9 px-3 rounded-lg border border-rose-300 text-rose-700 font-semibold disabled:opacity-50">
                      Send it back
                    </button>
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
