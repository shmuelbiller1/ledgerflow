import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Check, X, RotateCcw, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { runCommand, ServerCommandError } from '../../lib/runCommand';
import { formatCurrency } from '../../lib/moneyFormat';
import { getLocalDateISO } from '../../lib/calendarDate';
import { formatDate } from '../../lib/utils';
import { useAuthStore } from '../../stores/useAuthStore';
import { RowTable } from '../ui/RowTable';

/**
 * SBX-1, the review screen: what the assistant proposed, kept apart from the books until the signed-in
 * person accepts it.
 *
 * Three panes, each a read of the same sandbox:
 *  - the step list (what each step would record, in order, with its state and the reason when the
 *    sandbox could not rebuild it);
 *  - the books with this applied (any report through the sandbox handle, here the trial balance and
 *    the balance sheet as the two the person asks for first);
 *  - the conflict view (steps the books moved under since review, with the server's own words).
 *
 * The screen never calculates: each figure comes from the same report route as the live screen, run
 * on the sandbox handle, and each acceptance is the server's own command replay. A high-risk step is
 * accepted alone and asked about twice (SANDBOX_HIGH_RISK_CONFIRM), as the command router does.
 */

type StepState = 'pending' | 'accepted' | 'rejected' | 'needs-recheck' | 'failed' | 'undone';
interface StepPreview { title: string; lines: string[]; accounts?: Array<{ accountId: string; accountName?: string; amountCents: number; description?: string }>; effectiveDate?: string; provisionalNumber?: string }
interface Step { id: string; position: number; command: string; input: unknown; preview: StepPreview; state: StepState; failureReason: string | null; inverse: { command: string; input: unknown } | null }
interface Review { id: string; revision: string; steps: Step[]; accepted: string[]; skipped: string[]; outcome: 'review' | 'review-changed' | 'accepted' | 'closed' }
interface OpenSandbox { id: string; createdAt: string; expiresAt: string; pendingSteps: number }
/** One line of the trial balance route's answer (`computeTrialBalance`): whole cents. */
interface BalanceRow { id: string; name: string; code?: string; type: string; debit: number; credit: number; netSigned: number }
interface TrialBalance { accounts: BalanceRow[]; totalDebit: number; totalCredit: number; isBalanced: boolean }

const STATE_LABEL: Record<StepState, string> = {
  pending: 'Ready to accept', accepted: 'Accepted', rejected: 'Rejected', 'needs-recheck': 'Books changed: recheck', failed: 'Could not be rebuilt', undone: 'Undone',
};
const STATE_CLASS: Record<StepState, string> = {
  pending: 'text-[var(--text)]', accepted: 'text-emerald-700 dark:text-emerald-400', rejected: 'text-[var(--muted)]',
  'needs-recheck': 'text-amber-700 dark:text-amber-400', failed: 'text-rose-700 dark:text-rose-400', undone: 'text-[var(--muted)]',
};
const button = 'rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-[var(--text)] hover:bg-[var(--panel)] disabled:opacity-50';
const primary = 'rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';

function parseReview(raw: unknown): Review {
  const body = raw as Review;
  if (!body || !Array.isArray(body.steps) || typeof body.revision !== 'string') throw new ServerCommandError(200, 'The sandbox could not be read');
  return body;
}

function message(err: unknown): string {
  if (err instanceof ServerCommandError) {
    const body = err.body as { message?: string; error?: string } | undefined;
    return body?.message || body?.error || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function parseTrialBalance(raw: unknown): TrialBalance {
  const body = raw as TrialBalance;
  if (!body || !Array.isArray(body.accounts)) throw new ServerCommandError(200, 'The trial balance could not be calculated');
  return body;
}

export default function SandboxReviewView() {
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const currency = workspace?.currency || 'USD';
  const workspaceId = workspace?.id;
  const [open, setOpen] = useState<OpenSandbox[] | null>(null);
  const [sandboxId, setSandboxId] = useState<string>('');
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ stepId: string; preview: StepPreview } | null>(null);
  const [books, setBooks] = useState<{ revision: string; data?: TrialBalance; error?: string } | null>(null);
  const base = workspaceId && sandboxId ? `/api/v1/workspaces/${workspaceId}/sandboxes/${sandboxId}` : '';

  // Reads are effects keyed by what they read (and a tick for an explicit refresh); the answers land
  // asynchronously, so a stale answer for an earlier sandbox is dropped by `on`.
  const [listTick, setListTick] = useState(0);
  const [reviewTick, setReviewTick] = useState(0);
  const refreshList = useCallback(() => setListTick(t => t + 1), []);
  /** Read the sandbox again from the server: the review and the list of open sandboxes. */
  const refresh = useCallback(() => { setListTick(t => t + 1); setReviewTick(t => t + 1); }, []);
  useEffect(() => {
    if (!workspaceId) return;
    let on = true;
    runCommand<{ sandboxes: OpenSandbox[] }>({ path: `/api/v1/workspaces/${workspaceId}/sandboxes` })
      .then(body => {
        if (!on) return;
        setOpen(body.sandboxes);
        setSandboxId(current => current && body.sandboxes.some(s => s.id === current) ? current : (body.sandboxes[0]?.id || ''));
      })
      .catch(err => { if (on) setError(message(err)); });
    return () => { on = false; };
  }, [workspaceId, listTick]);
  useEffect(() => {
    if (!base) return;
    let on = true;
    runCommand({ path: base, parse: parseReview })
      .then(next => { if (on) { setReview(next); setError(null); } })
      .catch(err => { if (on) setError(message(err)); });
    return () => { on = false; };
  }, [base, reviewTick]);
  // a review is only shown for the sandbox it was read from
  const shownReview = review && base && review.id === sandboxId ? review : null;

  // the same trial balance route as the Reports tab, run through the sandbox handle (SBX-1 read tool)
  const revision = shownReview?.revision || '';
  useEffect(() => {
    if (!base || !revision) return;
    let on = true;
    const today = getLocalDateISO();
    runCommand({ path: `${base}/tools/run_report`, method: 'POST', body: { report: 'trial-balance', source: 'reports', params: { asOfDate: today } }, parse: parseTrialBalance })
      .then(data => { if (on) setBooks({ revision, data }); })
      .catch(err => { if (on) setBooks({ revision, error: message(err) }); });
    return () => { on = false; };
  }, [base, revision]);

  const act = async (work: () => Promise<Review | void>, done?: string) => {
    setBusy(true);
    try {
      const next = await work();
      // an action's answer is the fresh review; only the list of open sandboxes is read again
      if (next) { setReview(next); refreshList(); } else refresh();
      if (done) toast.success(done);
      setSelected(new Set());
    } catch (err) {
      const body = err instanceof ServerCommandError ? err.body as { code?: string; details?: { stepId?: string; preview?: StepPreview } } : undefined;
      if (body?.code === 'SANDBOX_HIGH_RISK_CONFIRM' && body.details?.stepId && body.details.preview) {
        setConfirming({ stepId: body.details.stepId, preview: body.details.preview });
      } else {
        toast.error(message(err));
        refresh();
      }
    } finally { setBusy(false); }
  };

  const accept = (stepIds?: string[], confirmHighRisk?: string) => review && act(async () => {
    const rechecked = (stepIds || []).filter(id => review.steps.find(s => s.id === id)?.state === 'needs-recheck');
    const next = await runCommand({ path: `${base}/accept`, method: 'POST', parse: parseReview,
      body: { revision: review.revision, ...(stepIds ? { stepIds } : {}), ...(rechecked.length ? { confirmRechecked: rechecked } : {}), ...(confirmHighRisk ? { confirmHighRisk } : {}) } });
    setConfirming(null);
    if (next.outcome === 'review-changed') toast.warning('The books changed since review. Look at the marked steps, then accept again.');
    return next;
  }, undefined);
  const reject = (stepIds?: string[]) => review && act(() => runCommand({ path: `${base}/reject`, method: 'POST', parse: parseReview, body: { revision: review.revision, ...(stepIds ? { stepIds } : {}) } }),
    stepIds ? 'Step removed from the draft' : 'Draft rejected');
  const undo = (stepId: string) => review && act(async () => {
    await runCommand({ path: `${base}/steps/${stepId}/undo`, method: 'POST' });
  }, 'Step undone');
  const openNew = () => workspaceId && act(async () => {
    const body = await runCommand<{ sandbox: Review }>({ path: `/api/v1/workspaces/${workspaceId}/sandboxes`, method: 'POST', body: {} });
    setSandboxId(body.sandbox.id);
  }, 'Sandbox opened');

  const steps = useMemo(() => shownReview?.steps || [], [shownReview]);
  const active = useMemo(() => steps.filter(s => s.state !== 'accepted' && s.state !== 'rejected' && s.state !== 'undone'), [steps]);
  const conflicts = useMemo(() => steps.filter(s => s.state === 'needs-recheck' || s.state === 'failed'), [steps]);
  const shownBooks = books && books.revision === revision ? books : null;
  const current = open?.find(s => s.id === sandboxId);
  const toggle = (id: string, on: boolean) => setSelected(prev => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });

  return (
    <section aria-labelledby="sandbox-review-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 id="sandbox-review-title" className="text-2xl font-bold tracking-tight text-[var(--text)] flex items-center gap-2"><FlaskConical className="w-6 h-6" aria-hidden="true" /> Assistant drafts</h1>
          <p className="text-sm text-[var(--muted)]">What the assistant proposed is kept apart from your books until you accept it. Each step is listed as it would be recorded; the books below are shown with the draft applied.</p>
        </div>
        <div className="flex items-center gap-2">
          {open && open.length > 1 && (
            <>
              <label className="sr-only" htmlFor="sandbox-pick">Sandbox</label>
              <select id="sandbox-pick" className="px-2 py-1.5 text-sm border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" value={sandboxId} onChange={e => setSandboxId(e.target.value)}>
                {open.map(s => <option key={s.id} value={s.id}>{new Date(s.createdAt).toLocaleString()} · {s.pendingSteps} pending</option>)}
              </select>
            </>
          )}
          <button type="button" className={button} onClick={refresh} disabled={!base || busy}><RefreshCw className="inline w-3.5 h-3.5 me-1" aria-hidden="true" />Recheck</button>
          <button type="button" className={button} onClick={() => void openNew()} disabled={busy || (open?.length ?? 0) >= 3}>Open a sandbox</button>
        </div>
      </div>
      {!workspaceId && <p className="text-sm text-[var(--muted)]">Sign in to a workspace to see the assistant's drafts.</p>}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      {open && open.length === 0 && !error && <p className="text-sm text-[var(--muted)]">No open draft. The assistant opens one when it proposes work, or open one yourself.</p>}
      {current && <p className="text-xs text-[var(--muted)]">This draft expires {new Date(current.expiresAt).toLocaleString()}. Unaccepted steps are deleted then.</p>}

      {shownReview && (
        <>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-[var(--text)]">Steps</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primary} disabled={busy || active.length === 0} onClick={() => void accept()}><Check className="inline w-4 h-4 me-1" aria-hidden="true" />Accept all ready steps</button>
                <button type="button" className={button} disabled={busy || selected.size === 0} onClick={() => void accept([...selected])}>Accept selected ({selected.size})</button>
                <button type="button" className={button} disabled={busy || selected.size === 0} onClick={() => void reject([...selected])}>Remove selected</button>
                <button type="button" className={button} disabled={busy || active.length === 0} onClick={() => { if (window.confirm('Reject the whole draft? Nothing is recorded.')) void reject(); }}><X className="inline w-3.5 h-3.5 me-1" aria-hidden="true" />Reject draft</button>
              </div>
            </div>
            <p className="text-xs text-[var(--muted)]">Accepting a step also accepts the earlier steps it depends on. A step the books moved under since review must be opened and confirmed first.</p>
            {steps.length === 0 ? <p className="text-sm text-[var(--muted)]">The draft is empty.</p> : (
              <ol className="divide-y divide-[var(--line)]">
                {steps.map(step => (
                  <li key={step.id} className="py-3 flex gap-3">
                    <div className="pt-0.5">
                      {step.state === 'pending' || step.state === 'needs-recheck' ? (
                        <input type="checkbox" aria-label={`Select ${step.preview.title}`} checked={selected.has(step.id)} onChange={e => toggle(step.id, e.target.checked)} />
                      ) : <span className="inline-block w-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs text-[var(--muted)]">{step.position}.</span>
                        <span className="font-medium text-[var(--text)]">{step.preview.title}</span>
                        <span className="text-xs text-[var(--muted)]">{step.command}{step.preview.effectiveDate ? ` · ${formatDate(step.preview.effectiveDate)}` : ''}{step.preview.provisionalNumber ? ` · provisional ${step.preview.provisionalNumber}` : ''}</span>
                        <span className={`text-xs font-semibold ${STATE_CLASS[step.state]}`}>{STATE_LABEL[step.state]}</span>
                      </div>
                      {step.preview.lines.length > 0 && <ul className="text-sm text-[var(--text)] list-disc ps-5">{step.preview.lines.map(line => <li key={line}>{line}</li>)}</ul>}
                      {step.preview.accounts && step.preview.accounts.length > 0 && (
                        <ul className="text-xs text-[var(--muted)] grid sm:grid-cols-2 gap-x-4">
                          {step.preview.accounts.map(line => <li key={`${line.accountId}:${line.amountCents}:${line.description ?? ''}`} className="flex justify-between gap-2"><bdi>{line.accountName || line.accountId}</bdi><span className="tabular-nums">{formatCurrency(line.amountCents, currency)}</span></li>)}
                        </ul>
                      )}
                      {step.failureReason && <p className="text-xs text-rose-700 dark:text-rose-400"><AlertTriangle className="inline w-3.5 h-3.5 me-1" aria-hidden="true" />{step.failureReason}</p>}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      {(step.state === 'pending' || step.state === 'needs-recheck') && <button type="button" className={button} disabled={busy} onClick={() => void accept([step.id])}>Accept</button>}
                      {step.state !== 'accepted' && step.state !== 'rejected' && step.state !== 'undone' && <button type="button" className={button} disabled={busy} onClick={() => void reject([step.id])}>Remove</button>}
                      {step.state === 'accepted' && step.inverse && <button type="button" className={button} disabled={busy} onClick={() => void undo(step.id)}><RotateCcw className="inline w-3.5 h-3.5 me-1" aria-hidden="true" />Undo</button>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-[var(--surface)] p-4 space-y-2" aria-labelledby="sandbox-conflicts-title">
              <h3 id="sandbox-conflicts-title" className="font-semibold text-amber-800 dark:text-amber-300">Changed since review</h3>
              <p className="text-xs text-[var(--muted)]">The books moved under these steps, or the step could not be rebuilt on today's books. Each was re-run on the current books; accept it only after reading it again.</p>
              <ul className="text-sm space-y-1">
                {conflicts.map(step => <li key={step.id}><span className="font-medium text-[var(--text)]">{step.position}. {step.preview.title}</span>{step.failureReason ? <span className="text-[var(--muted)]"> — {step.failureReason}</span> : <span className="text-[var(--muted)]"> — rebuilt; the figures above are the current ones</span>}</li>)}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 space-y-3">
            <h3 className="font-semibold text-[var(--text)]">The books with this applied</h3>
            <p className="text-xs text-[var(--muted)]">The trial balance as of today, calculated by the same report as the Reports tab, with the draft's steps included. Nothing here is recorded until you accept.</p>
            {!shownBooks ? <p className="text-sm text-[var(--muted)]">Calculating…</p>
              : shownBooks.error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{shownBooks.error}</p>
                : (
                  <RowTable<BalanceRow>
                    caption="Trial balance with the draft applied"
                    rows={shownBooks.data?.accounts || []}
                    rowKey={row => row.id}
                    tableClassName="w-full text-sm"
                    rowClassName="border-t border-[var(--line)]"
                    columns={[
                      { header: 'Account', cell: row => <bdi>{[row.code, row.name].filter(Boolean).join(' ')}</bdi> },
                      { header: 'Debit', align: 'right', cell: row => formatCurrency(row.debit, currency) },
                      { header: 'Credit', align: 'right', cell: row => formatCurrency(row.credit, currency) },
                    ]}
                    footer={shownBooks.data && (
                      <tr className="border-t border-[var(--line)] font-semibold">
                        <td className="py-1">Total{shownBooks.data.isBalanced ? '' : ' (out of balance)'}</td>
                        <td className="py-1 text-end tabular-nums">{formatCurrency(shownBooks.data.totalDebit, currency)}</td>
                        <td className="py-1 text-end tabular-nums">{formatCurrency(shownBooks.data.totalCredit, currency)}</td>
                      </tr>
                    )}
                  />
                )}
          </div>
        </>
      )}

      {confirming && (
        <div role="alertdialog" aria-labelledby="sandbox-confirm-title" aria-describedby="sandbox-confirm-body" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-lg w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3">
            <h3 id="sandbox-confirm-title" className="font-semibold text-[var(--text)] flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />This step is high-risk</h3>
            <div id="sandbox-confirm-body" className="text-sm text-[var(--text)] space-y-1">
              <p className="font-medium">{confirming.preview.title}</p>
              <ul className="list-disc ps-5">{confirming.preview.lines.map(line => <li key={line}>{line}</li>)}</ul>
              <p className="text-[var(--muted)]">It is applied on its own, and only after you confirm it here.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={button} onClick={() => setConfirming(null)}>Keep in the draft</button>
              <button type="button" className={primary} disabled={busy} onClick={() => void accept([confirming.stepId], confirming.stepId)}>Apply this step</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
