import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { runCommand, commandErrorMessage } from '../../lib/runCommand';
import { uiLanguageNow } from '../../lib/i18n/uiLanguageNow';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatDate } from '../../lib/utils';
import { practiceWork, type PracticeRow } from '../../lib/practice';
import { computeCloseReadiness, computeFirmNoTouchSummary } from '../../lib/practiceAutomation';
import { PLAN_ADD_ON_PRICING } from '../../lib/plans';
import type { PinnedPage } from '../../lib/pinnedPages';
import { byCodeUnit } from '../../lib/codeUnitOrder';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * The Practice view (BD-01): every workspace you can open, with what is waiting there (bank lines,
 * banks to log in to again, questions, drafts, last month not closed, the next recurring item),
 * most work first. A count opens that workspace on that screen. Counted by the server from each
 * workspace's own records (src/server/services/practiceService.ts); Data Health is the nightly check's
 * count of serious problems. Type to find one; filter by group.
 */
export default function PracticeView() {
  const setCurrentWorkspaceId = useAuthStore(s => s.setCurrentWorkspaceId);
  const goToPage = useUIStore(s => s.goToPage);
  const [rows, setRows] = useState<PracticeRow[] | null>(null);
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const [group, setGroup] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      const body = await runCommand<{ rows?: PracticeRow[] }>({ path: '/api/v1/account/practice' });
      if (!Array.isArray(body.rows)) throw new Error('The practice view could not be loaded');
      return body.rows;
    })().then(r => { if (live) { setRows(r); setError(''); } }).catch(err => { if (live) { setRows([]); setError(commandErrorMessage(err, uiLanguageNow())); } });
    return () => { live = false; };
  }, []);
  const groups = useMemo(() => [...new Set((rows || []).flatMap(r => r.groups))].sort(byCodeUnit), [rows]);
  const shown = (rows || []).filter(r => (!group || r.groups.includes(group)) && (!find.trim() || r.name.toLocaleLowerCase().includes(find.trim().toLocaleLowerCase())));
  const firmSummary = useMemo(() => computeFirmNoTouchSummary(shown.map(r => ({
    noTouch: r.noTouch,
    closeReadiness: r.closeReadiness ?? computeCloseReadiness(r),
  }))), [shown]);
  const open = (r: PracticeRow, page: PinnedPage) => { setCurrentWorkspaceId(r.workspaceId); goToPage(page); };
  const count = (r: PracticeRow, n: number, label: string, page: PinnedPage) => (n > 0
    ? <button type="button" onClick={() => open(r, page)} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">{n}<span className="sr-only"> {label} in {r.name}: open</span></button>
    : <span className="text-[var(--muted)]">0</span>);

  return (
    <section aria-labelledby="practice-title" className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="practice-title" className="text-xl font-bold text-[var(--text)]">All my books</h1>
          <p className="text-sm text-[var(--muted)]">Every set of books you can open, with what is waiting there, most work first. A number opens that workspace on that screen. Data Health is from the nightly check.</p>
        </div>
        {rows !== null && shown.length > 0 && (
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <span className="block text-[var(--muted)]">Firm no-touch rate</span>
              <span className="font-mono font-bold text-sm text-[var(--text)]">
                {firmSummary.firmNoTouchPercent !== null
                  ? `${firmSummary.firmNoTouchPercent}% (${firmSummary.totalNoTouchLines}/${firmSummary.totalBankLines})`
                  : 'No bank lines yet'}
              </span>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <span className="block text-[var(--muted)]">Avg close readiness</span>
              <span className="font-mono font-bold text-sm text-[var(--text)]">{firmSummary.averageCloseReadiness}/100</span>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <span className="block text-[var(--muted)]">Client books</span>
              <span className="font-mono font-bold text-sm text-[var(--text)]">
                {firmSummary.totalClients} (${PLAN_ADD_ON_PRICING.extraFirmClientMonthlyUsd}/mo extra)
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1 text-[var(--muted)]">Find
          <input value={find} onChange={e => setFind(e.target.value)} placeholder="Part of a name" className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]" />
        </label>
        {groups.length > 0 && (
          <label className="flex flex-col gap-1 text-[var(--muted)]">Group
            <select value={group} onChange={e => setGroup(e.target.value)} className="px-2 py-1.5 border border-[var(--line)] rounded bg-[var(--panel)] text-[var(--text)]">
              <option value="">All</option>
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {rows === null ? <p className="text-sm text-[var(--muted)]">Loading…</p> : (
        <div className="overflow-x-auto">
          <TanStackDataGrid
caption={"Your books and what is waiting in each"}
data={shown.map((r) => { const readiness = r.closeReadiness ?? computeCloseReadiness(r);
return { r, readiness }; })}
getRowId={({ r }) => r.workspaceId}
columnScope="practice-books"
columnLabel={"Your books and what is waiting in each"}
rowHeaderColumn="books"
hidePaginationOnSinglePage
enableGlobalFilter={false}
emptyState={<div className="p-4 text-center">No books match.</div>}
getRowProps={() => ({ className: "border-b border-[var(--line)]/50" })}
columns={[
{ id: 'books', header: "Books", accessorFn: ({ r }) => r.name, cell: ({ row: { original: { r } } }) => (<><button type="button" onClick={() => open(r, { tab: 'dashboard' })} className="font-semibold text-[var(--text)] hover:underline"><bdi>{r.name}</bdi></button>
                    <span className="block text-xs text-[var(--muted)]">{r.role} · {r.currency}{r.groups.length ? ` · ${r.groups.join(', ')}` : ''}{practiceWork(r) === 0 ? ' · nothing waiting' : ''}</span></>) },
{ id: 'bank-lines', header: "Bank lines", accessorFn: ({ r }) => r.bankLines, cell: ({ row: { original: { r } } }) => (<div className="text-end tabular-nums">{count(r, r.bankLines, 'bank lines to review', { tab: 'reconciliation' })}</div>) },
{ id: 'bank-logins', header: "Bank logins", accessorFn: ({ r }) => r.bankLogins, cell: ({ row: { original: { r } } }) => (<div className="text-end tabular-nums">{count(r, r.bankLogins, 'banks to log in to again', { tab: 'banking' })}</div>) },
{ id: 'questions', header: "Questions", accessorFn: ({ r }) => r.questions, cell: ({ row: { original: { r } } }) => (<div className="text-end tabular-nums">{count(r, r.questions, 'questions waiting', { tab: 'client-queries' })}</div>) },
{ id: 'drafts', header: "Drafts", accessorFn: ({ r }) => r.drafts, cell: ({ row: { original: { r } } }) => (<div className="text-end tabular-nums">{count(r, r.drafts, 'drafts', { tab: 'transactions' })}</div>) },
{ id: 'bills-without-a-file', header: "Bills without a file", accessorFn: ({ r }) => r.billsWithoutFile, cell: ({ row: { original: { r } } }) => (<div className="text-end tabular-nums">{count(r, r.billsWithoutFile, 'bills without a file', { tab: 'purchases' })}</div>) },
{ id: 'data-health', header: "Data Health", enableSorting: false, cell: ({ row: { original: { r } } }) => (<div title={r.health ? `Checked ${formatDate(r.health.checkedAt.slice(0, 10))}; ${r.health.warnings} warning${r.health.warnings === 1 ? '' : 's'}` : 'Not checked yet'}>{r.health ? count(r, r.health.serious, 'serious problems', { tab: 'data-health' }) : <span className="text-[var(--muted)]">—</span>}</div>) },
{ id: 'no-touch', header: "No-touch", enableSorting: false, cell: ({ row: { original: { r } } }) => (<div className="text-end tabular-nums">{r.noTouch && r.noTouch.ratePercent !== null ? (
                      <span title={`${r.noTouch.noTouchCount} of ${r.noTouch.totalBankLines} bank lines posted from a rule or history without human edits`}>
                        {r.noTouch.ratePercent}%
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}</div>) },
{ id: 'close-ready', header: "Close ready", enableSorting: false, cell: ({ row: { original: { readiness } } }) => (<div className="text-end tabular-nums">{<span className={readiness.grade === 'ready' ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : readiness.grade === 'almost_ready' ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--muted)]'}>
                      {readiness.score}%
                    </span>}</div>) },
{ id: 'last-month', header: "Last month", enableSorting: false, cell: ({ row: { original: { r } } }) => (r.lastMonthClosed ? <span className="text-[var(--muted)]">{monthName(r.lastMonth)} closed</span>
                      : <button type="button" onClick={() => open(r, { tab: 'month-end-close' })} className="text-amber-700 dark:text-amber-400 hover:underline">{monthName(r.lastMonth)} open<span className="sr-only"> in {r.name}: close it</span></button>) },
{ id: 'next-recurring', header: "Next recurring", enableSorting: false, cell: ({ row: { original: { r } } }) => (r.nextRecurring ? <button type="button" onClick={() => open(r, { tab: 'recurring' })} className="hover:underline">{formatDate(r.nextRecurring.date)}: <bdi>{r.nextRecurring.description}</bdi></button> : <span className="text-[var(--muted)]">—</span>) }
]}
/>
        </div>
      )}
    </section>
  );
}
