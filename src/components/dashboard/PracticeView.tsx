import React, { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../../firebase';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { formatDate } from '../../lib/utils';
import { practiceWork, type PracticeRow } from '../../lib/practice';
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
      const res = await fetch('/api/v1/account/practice', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.rows)) throw new Error(body.message || 'The practice view could not be loaded');
      return body.rows as PracticeRow[];
    })().then(r => { if (live) { setRows(r); setError(''); } }).catch(err => { if (live) { setRows([]); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { live = false; };
  }, []);
  const groups = useMemo(() => [...new Set((rows || []).flatMap(r => r.groups))].sort(byCodeUnit), [rows]);
  const shown = (rows || []).filter(r => (!group || r.groups.includes(group)) && (!find.trim() || r.name.toLocaleLowerCase().includes(find.trim().toLocaleLowerCase())));
  const open = (r: PracticeRow, page: PinnedPage) => { setCurrentWorkspaceId(r.workspaceId); goToPage(page); };
  const count = (r: PracticeRow, n: number, label: string, page: PinnedPage) => (n > 0
    ? <button type="button" onClick={() => open(r, page)} className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">{n}<span className="sr-only"> {label} in {r.name}: open</span></button>
    : <span className="text-[var(--muted)]">0</span>);

  return (
    <section aria-labelledby="practice-title" className="space-y-4 p-6">
      <div>
        <h1 id="practice-title" className="text-xl font-bold text-[var(--text)]">All my books</h1>
        <p className="text-sm text-[var(--muted)]">Every set of books you can open, with what is waiting there, most work first. A number opens that workspace on that screen. Data Health is from the nightly check.</p>
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
          <table className="w-full text-sm">
            <caption className="sr-only">Your books and what is waiting in each</caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                <th scope="col" className="text-left font-semibold py-2">Books</th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Bank lines</th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Bank logins</th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Questions</th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Drafts</th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Bills without a file</th>
                <th scope="col" className="text-right font-semibold py-2 px-2">Data Health</th>
                <th scope="col" className="text-left font-semibold py-2 px-2">Last month</th>
                <th scope="col" className="text-left font-semibold py-2 px-2">Next recurring</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={9} className="py-3 text-[var(--muted)]">No books match.</td></tr>}
              {shown.map(r => (
                <tr key={r.workspaceId} className="border-b border-[var(--line)]/50">
                  <th scope="row" className="text-left font-normal py-2">
                    <button type="button" onClick={() => open(r, { tab: 'dashboard' })} className="font-semibold text-[var(--text)] hover:underline"><bdi>{r.name}</bdi></button>
                    <span className="block text-xs text-[var(--muted)]">{r.role} · {r.currency}{r.groups.length ? ` · ${r.groups.join(', ')}` : ''}{practiceWork(r) === 0 ? ' · nothing waiting' : ''}</span>
                  </th>
                  <td className="text-right py-2 px-2">{count(r, r.bankLines, 'bank lines to review', { tab: 'reconciliation' })}</td>
                  <td className="text-right py-2 px-2">{count(r, r.bankLogins, 'banks to log in to again', { tab: 'banking' })}</td>
                  <td className="text-right py-2 px-2">{count(r, r.questions, 'questions waiting', { tab: 'client-queries' })}</td>
                  <td className="text-right py-2 px-2">{count(r, r.drafts, 'drafts', { tab: 'transactions' })}</td>
                  <td className="text-right py-2 px-2">{count(r, r.billsWithoutFile, 'bills without a file', { tab: 'purchases' })}</td>
                  <td className="text-right py-2 px-2" title={r.health ? `Checked ${formatDate(r.health.checkedAt.slice(0, 10))}; ${r.health.warnings} warning${r.health.warnings === 1 ? '' : 's'}` : 'Not checked yet'}>
                    {r.health ? count(r, r.health.serious, 'serious problems', { tab: 'data-health' }) : <span className="text-[var(--muted)]">—</span>}
                  </td>
                  <td className="py-2 px-2">
                    {r.lastMonthClosed ? <span className="text-[var(--muted)]">{monthName(r.lastMonth)} closed</span>
                      : <button type="button" onClick={() => open(r, { tab: 'month-end-close' })} className="text-amber-700 dark:text-amber-400 hover:underline">{monthName(r.lastMonth)} open<span className="sr-only"> in {r.name}: close it</span></button>}
                  </td>
                  <td className="py-2 px-2 text-xs">
                    {r.nextRecurring ? <button type="button" onClick={() => open(r, { tab: 'recurring' })} className="hover:underline">{formatDate(r.nextRecurring.date)}: <bdi>{r.nextRecurring.description}</bdi></button> : <span className="text-[var(--muted)]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
