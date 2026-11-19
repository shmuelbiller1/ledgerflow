import React, { useMemo, useState } from 'react';
import { Users, Download, Printer, RefreshCw, CalendarClock, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { useAccessReview } from '../../../hooks/useAccessReview';
import {
  ACCESS_REVIEW_HEADERS, ACCESS_ROLE_LABELS, TWO_STEP_LABELS, accessReviewCalendarIcs, accessReviewCsvRows,
  accessReviewReminderState, readLastAccessReviewAt, recordAccessReviewCompleted, twoStepLimitNote,
  type AccessReviewRow,
} from '../../../lib/accessReview';
import { TanStackDataGrid } from '../../ui/TanStackDataGrid';
import type { ColumnDef } from '@tanstack/react-table';
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
  const workspaceName = useAuthStore(s => s.getCurrentWorkspace()?.name || 'Workspace');
  const [lastReviewedAt, setLastReviewedAt] = useState<string | null>(() => readLastAccessReviewAt(workspaceId));
  const reminder = useMemo(() => accessReviewReminderState(lastReviewedAt), [lastReviewedAt]);
  const exportCsv = () => downloadCsv(`access-review-${getLocalDateISO()}.csv`, [...ACCESS_REVIEW_HEADERS], accessReviewCsvRows(review.rows));
  const markReviewed = () => setLastReviewedAt(recordAccessReviewCompleted(workspaceId));
  const downloadReminderIcs = () => {
    const ics = accessReviewCalendarIcs(workspaceName, reminder.nextDueDate);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `access-review-monthly-${reminder.nextDueDate}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * One row per person: who they are, their role, when they last signed in, whether two-step login is
   * on, and when the role last changed. The person names the row. Every cell prints exactly what the
   * old table printed, and the CSV rows come from the shared `accessReviewCsvRows`, so the export did
   * not gain a second definition.
   */
  const columns: ColumnDef<AccessReviewRow, unknown>[] = [
    { id: 'person', accessorFn: row => `${row.email || row.uid} ${row.uid}`, header: 'Person', cell: info => {
      const row = info.row.original as AccessReviewRow;
      return (
        <div className="min-w-40">
          <div className="font-bold break-all">{row.email || row.uid}</div>
          {row.email && <div className="text-[10px] text-[var(--muted)] break-all">{row.uid}</div>}
          {row.isSelf && <span className="text-[10px] font-bold text-[var(--brass)]">You</span>}
          {row.roleOnly && <div className="text-[10px] text-amber-400">Role on record; not in the workspace member list — this person still has access, review it</div>}
        </div>
      );
    } },
    { id: 'role', accessorFn: row => ACCESS_ROLE_LABELS[row.role], header: 'Role' },
    { id: 'signIn', accessorFn: row => (row.lastSignInAt ? row.lastSignInAt.toISOString() : ''), header: 'Last sign-in', cell: info => {
      const row = info.row.original as AccessReviewRow;
      return row.lastSignInAt
        ? <time dateTime={row.lastSignInAt.toISOString()}>{row.lastSignInAt.toLocaleString()}</time>
        : <span className="text-[var(--muted)]">Not in the recent audit entries</span>;
    } },
    { id: 'twoStep', accessorFn: row => TWO_STEP_LABELS[row.twoStep], header: 'Two-step login' },
    { id: 'roleChanged', accessorFn: row => (row.roleChangedAt ? row.roleChangedAt.toISOString() : ''), header: 'Role last changed', cell: info => {
      const row = info.row.original as AccessReviewRow;
      if (!row.roleChangedAt) return <span className="text-[var(--muted)]">No role change recorded</span>;
      return (
        <>
          <time dateTime={row.roleChangedAt.toISOString()}>{row.roleChangedAt.toLocaleString()}</time>
          {row.roleChangedFrom && row.roleChangedTo && (
            <div className="text-[10px] text-[var(--muted)]">{ACCESS_ROLE_LABELS[row.roleChangedFrom]} → {ACCESS_ROLE_LABELS[row.roleChangedTo]}{row.roleChangedBy ? ` by ${row.roleChangedBy}` : ''}</div>
          )}
        </>
      );
    } },
  ];

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

      {review.status === 'ready' && (
        <div
          data-print-hide
          className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
            reminder.status === 'ok'
              ? 'border-emerald-500/25 bg-emerald-500/5'
              : 'border-amber-500/35 bg-amber-500/10'
          }`}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            {reminder.status === 'ok'
              ? <CheckCircle2 aria-hidden="true" size={16} className="text-emerald-500 mt-0.5 shrink-0" />
              : <CalendarClock aria-hidden="true" size={16} className="text-amber-500 mt-0.5 shrink-0" />}
            <div className="space-y-0.5 text-xs">
              <div className="font-bold text-[var(--text)]">Monthly access review cadence</div>
              <p className="text-[var(--muted)]">{reminder.summary}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={markReviewed} className="min-h-11 px-3 border border-[var(--line)] bg-[var(--surface)] rounded-xl text-xs font-bold flex items-center gap-1.5">
              <CheckCircle2 aria-hidden="true" size={14} /> Mark monthly review done
            </button>
            <button type="button" onClick={downloadReminderIcs} className="min-h-11 px-3 border border-[var(--line)] bg-[var(--surface)] rounded-xl text-xs font-bold flex items-center gap-1.5">
              <CalendarClock aria-hidden="true" size={14} /> Monthly reminder (.ics)
            </button>
          </div>
        </div>
      )}

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
          <TanStackDataGrid
            caption="Access review: every person in this workspace with their role, last sign-in, two-step login and last role change."
            data={review.rows}
            columns={columns}
            rowHeaderColumn="person"
            pageSize={25}
            searchPlaceholder="Search people, roles and sign-ins..."
            searchLabel="Search the access review"
            columnScope="access-review"
            columnLabel="Access review columns"
            columnNames={['Person', 'Role', 'Last sign-in', 'Two-step login', 'Role last changed']}
            filteredEmptyState={<EmptyState title="No person matches your search" description="Try another name, email or role." />}
          />
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
