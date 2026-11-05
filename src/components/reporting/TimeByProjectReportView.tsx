import React, { useEffect, useMemo, useState } from 'react';
import { getIdToken } from '../../firebase';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { formatDuration, type TimeEntry } from '../../lib/timeEntries';
import {
  timeByPersonProject, timeByProjectCsvRows, TIME_BY_PROJECT_CSV_HEADERS,
} from '../../lib/timeByPersonProject';
import ReportTableScroll from './ReportTableScroll';
import { inBackground } from '../../lib/inBackground';

const hoursText = (minutes: number) => `${formatDuration(minutes)} h`;

/**
 * A-179: who logged time on which project this month. Reads the same time entries the Time screen
 * keeps (its own API), grouped per person and project for one month. Every state counts toward
 * the minutes — this shows where time went, approval and billing stay on the Time screen.
 */
export default function TimeByProjectReportView() {
  useLedgerCollections('projects');
  const projects = useLedgerStore(state => state.projects);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const workspaceId = workspace?.id || '';
  const [month, setMonth] = useState(getLocalDateISO().slice(0, 7));
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ workspaceId: string; entries?: TimeEntry[]; error?: string } | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    inBackground((async () => {
      try {
        const res = await fetch(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/time`, {
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || data.error || `The time entries could not be read (${res.status})`);
        if (alive) setState({ workspaceId, entries: data.entries || [] });
      } catch (error) {
        if (alive) setState({ workspaceId, error: error instanceof Error ? error.message : String(error) });
      }
    })());
    return () => { alive = false; };
  }, [workspaceId, attempt]);

  const current = state && state.workspaceId === workspaceId ? state : null;
  const loading = Boolean(workspaceId) && !current;
  const report = useMemo(() => timeByPersonProject({
    entries: current?.entries || [],
    projects: projects.filter(p => !workspaceId || p.workspaceId === workspaceId),
    month,
  }), [current, projects, workspaceId, month]);

  return <section aria-label="Time by person and project" className="p-4 space-y-4 min-w-0">
    <h2>Time by person and project</h2>
    <p className="text-sm text-[var(--muted)]">
      Who logged time on which project in the chosen month, from the Time screen&apos;s entries. Every entry
      counts toward the minutes whatever its state — not submitted, waiting, approved or already invoiced —
      with the billable part and the part still waiting for approval shown inside it, never added twice.
      An entry with no project is No project recorded. Approving and billing time stay on the Time screen.
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">Month
        <input type="month" aria-label="Month" className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={month} onChange={e => setMonth(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!report.rows.length}
        onClick={() => downloadCsv('time-by-person-and-project', [...TIME_BY_PROJECT_CSV_HEADERS], timeByProjectCsvRows(report.rows))}>Export CSV</button>
    </div>

    {loading && <p role="status" className="text-sm text-[var(--muted)]">Reading the time entries…</p>}
    {current?.error && <div className="space-y-2">
      <p role="alert" className="text-sm">The time entries could not be read: {current.error}</p>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => setAttempt(n => n + 1)}>Retry</button>
    </div>}

    {report.people.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm" aria-label="Month totals by person">
      {report.people.map(person => (
        <p key={person.person}><b><bdi>{person.person}</bdi>:</b> {hoursText(person.minutes)}
          <span className="text-[var(--muted)]"> · {hoursText(person.billableMinutes)} billable · {person.entries} entries</span></p>
      ))}
    </div>}

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption>Time logged by person and project, {month}</caption>
        <thead>
          <tr>
            {['Person', 'Project', 'Time', 'Billable', 'Waiting for approval', 'Entries'].map((head, i) =>
              <th key={head} scope="col" className={`${i < 2 ? 'text-left' : 'text-right'} py-1 px-2`}>{head}</th>)}
          </tr>
        </thead>
        <tbody>
          {report.rows.map(row => (
            <tr key={`${row.person}-${row.projectId}`} className="border-b border-[var(--line)]/50">
              <th scope="row" className="text-left font-normal py-1 px-2"><bdi>{row.person}</bdi></th>
              <td className="py-1 px-2"><bdi>{row.projectName}</bdi></td>
              <td className="py-1 px-2 text-right tabular-nums">{hoursText(row.minutes)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{hoursText(row.billableMinutes)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{row.waitingMinutes ? hoursText(row.waitingMinutes) : '—'}</td>
              <td className="py-1 px-2 text-right tabular-nums">{row.entries}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {current?.entries && !report.rows.length && <p className="text-sm text-[var(--muted)]">No time is logged in {month}.</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      Time logged for a customer without a project is in No project recorded here; the Time screen keeps
      the customer on each entry. Minutes are exact in the CSV.
    </p>
  </section>;
}
