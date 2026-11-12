import React from 'react';
import { Users, Download, Printer, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { useAccessReview } from '../../../hooks/useAccessReview';
import { ACCESS_REVIEW_HEADERS, ACCESS_ROLE_LABELS, TWO_STEP_LABELS, accessReviewCsvRows, twoStepLimitNote } from '../../../lib/accessReview';
import { downloadCsv } from '../../../lib/csvExport';
import { getLocalDateISO } from '../../../lib/utils';
import { EmptyState } from '../../ui/EmptyState';
import { LoadingState } from '../../ui/LoadingState';
import { printElementById } from '../../../lib/printRoot';

/**
 * Settings → Security → Access review (BJ-03 / C-35). Read-only: who is in the workspace, their
 * role, when they last entered, whether two-step login covers them, and when their role last
 * changed — with CSV and print for an auditor. Owners and accountants only.
 *
 * Every value comes from something the browser already holds: the workspace's people and roles
 * (the same server routes Settings → Team uses) and the audit trail screens already read, so the
 * screen and its CSV say the same thing. See src/lib/accessReview.ts for what the two-step column
 * can and cannot prove.
 */

export default function AccessReviewPanel() {
  const role = useCurrentRole();
  const isGuest = useAuthStore(s => s.isGuest);
  const allowed = !isGuest && (role === 'owner' || role === 'accountant');
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  if (isGuest) return <section aria-labelledby="access-review-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-2">
    <h2 id="access-review-title" className="text-base font-black text-[var(--text)]">Access review</h2>
    <p className="text-sm text-[var(--muted)]">The demo workspace has no people or roles to review. Sign in to a workspace to see who has access.</p>
  </section>;
  return allowed
    ? <ScopedAccessReview key={workspaceId} workspaceId={workspaceId} />
    : <section aria-labelledby="access-review-title" className="p-6 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-2">
      <h2 id="access-review-title" className="text-base font-black text-[var(--text)]">Access review</h2>
      <p className="text-sm text-[var(--muted)]">Only owners and accountants can see who has access to this workspace. Ask an owner if you need this report.</p>
    </section>;
}

function ScopedAccessReview({ workspaceId }: { workspaceId: string }) {
  const review = useAccessReview(workspaceId);

  const exportCsv = () => downloadCsv(`access-review-${getLocalDateISO()}.csv`, [...ACCESS_REVIEW_HEADERS], accessReviewCsvRows(review.rows));

  return (
    // H-7/AI #10: this panel is the printed sheet (it had no print root, so Print produced the whole
    // application shell). The heading and the table print; the buttons and notices do not.
    <section id="access-review-sheet" data-print-root aria-labelledby="access-review-title" className="p-6 md:p-8 bg-[var(--surface)] border border-[var(--line)] rounded-2xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2 id="access-review-title" className="text-base font-black text-[var(--text)] flex items-center gap-2">
            <Users aria-hidden="true" size={18} className="text-[var(--brass)]" /> Access review
          </h2>
          <p className="text-xs text-[var(--muted)] max-w-2xl">
            Who can open this workspace, what each person may do, when they last signed in, whether two-step login covers
            them, and when their role last changed. Read-only: change a role in Settings → Team. Owners and accountants can
            see this.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-print-hide>
          <button type="button" onClick={exportCsv} disabled={review.status !== 'ready' || review.rows.length === 0}
            className="min-h-11 px-4 border border-[var(--line)] rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50">
            <Download aria-hidden="true" size={14} /> Export CSV
          </button>
          <button type="button" onClick={() => printElementById('access-review-sheet')} disabled={review.status !== 'ready'}
            className="min-h-11 px-4 border border-[var(--line)] rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50">
            <Printer aria-hidden="true" size={14} /> Print
          </button>
          <button type="button" onClick={() => review.reload()} disabled={review.status === 'loading'}
            className="min-h-11 px-4 border border-[var(--line)] rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-50">
            <RefreshCw aria-hidden="true" size={14} className={review.status === 'loading' ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {review.status === 'loading' && <LoadingState what="the workspace people" />}

      {review.status === 'error' && (
        <div role="alert" className="p-4 border border-rose-500/30 bg-rose-500/5 rounded-xl space-y-2">
          <p className="text-sm text-[var(--text)]">The access review could not be loaded: {review.error}</p>
          <button type="button" onClick={() => review.reload()} className="min-h-11 px-4 border border-[var(--line)] rounded-xl text-xs font-bold">Try again</button>
        </div>
      )}

      {review.status === 'ready' && review.rows.length === 0 && (
        <EmptyState title="No people to review yet"
          description="This workspace has no owner or members on record. Add someone in Settings → Team, then come back." />
      )}

      {review.status === 'ready' && review.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <caption className="sr-only">Access review: every person in this workspace with their role, last sign-in, two-step login and last role change.</caption>
            <thead>
              <tr className="border-b border-[var(--line)]">
                {['Person', 'Role', 'Last sign-in', 'Two-step login', 'Role last changed'].map(header => (
                  <th key={header} scope="col" className="py-2 pr-4 font-black uppercase tracking-wider text-[10px] text-[var(--muted)]">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {review.rows.map(row => (
                <tr key={row.uid} className="border-b border-[var(--line)] align-top">
                  <td className="py-3 pr-4 min-w-40">
                    <div className="font-bold text-[var(--text)] break-all">{row.email || row.uid}</div>
                    {row.email && <div className="text-[10px] text-[var(--muted)] break-all">{row.uid}</div>}
                    {row.isSelf && <span className="text-[10px] font-bold text-[var(--brass)]">You</span>}
                    {row.roleOnly && <div className="text-[10px] text-amber-400">Role on record; not in the workspace member list — this person still has access, review it</div>}
                  </td>
                  <td className="py-3 pr-4">{ACCESS_ROLE_LABELS[row.role]}</td>
                  <td className="py-3 pr-4">
                    {row.lastSignInAt
                      ? <time dateTime={row.lastSignInAt.toISOString()}>{row.lastSignInAt.toLocaleString()}</time>
                      : <span className="text-[var(--muted)]">Not in the recent audit entries</span>}
                  </td>
                  <td className="py-3 pr-4">{TWO_STEP_LABELS[row.twoStep]}</td>
                  <td className="py-3 pr-4">
                    {row.roleChangedAt
                      ? <>
                        <time dateTime={row.roleChangedAt.toISOString()}>{row.roleChangedAt.toLocaleString()}</time>
                        {row.roleChangedFrom && row.roleChangedTo && (
                          <div className="text-[10px] text-[var(--muted)]">{ACCESS_ROLE_LABELS[row.roleChangedFrom]} → {ACCESS_ROLE_LABELS[row.roleChangedTo]}{row.roleChangedBy ? ` by ${row.roleChangedBy}` : ''}</div>
                        )}
                      </>
                      : <span className="text-[var(--muted)]">No role change recorded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-2 text-[11px] text-[var(--muted)]">
        <p>
          A sign-in is recorded when someone enters this workspace in a browser session, and role changes are recorded by the
          server; both are read from the workspace audit trail, which loads the newest 500 entries
          {review.auditTruncated ? ' (this workspace has more, so older ones are not on this screen)' : ''}. “Not in the recent
          audit entries” means no sign-in is among them — it does not mean the person never signed in.
        </p>
        <p>{twoStepLimitNote(review.requireTwoStep)}</p>
        <p>The CSV holds exactly these rows, with times as ISO dates for an auditor.</p>
      </div>
    </section>
  );
}
