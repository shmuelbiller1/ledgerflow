import { isReportTimeEntry } from '../../lib/reportListRows';
import { useCurrentRole } from '../../hooks/useCurrentRole';
import { useReportList } from '../../hooks/useReportList';
import { useMemo, useState } from 'react';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerCollections } from '../../hooks/useLedgerCollections';
import { getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import { formatDuration } from '../../lib/timeEntries';
import {
  timeByPersonProject, timeByProjectCsvRows, TIME_BY_PROJECT_CSV_HEADERS,
} from '../../lib/timeByPersonProject';
import ReportSchedule from './ReportSchedule';
import { fill, useReportText } from './useReportText';

/**
 * A-179: who logged time on which project this month. Reads the same time entries the Time screen
 * keeps (its own API), grouped per person and project for one month. Every state counts toward
 * the minutes — this shows where time went, approval and billing stay on the Time screen.
 */
export default function TimeByProjectReportView() {
  const reportText = useReportText();
  const hoursText = (minutes: number) => fill(reportText('r.duration-hours', '{time} h'), { time: formatDuration(minutes) });
  useLedgerCollections('projects');
  const projects = useLedgerStore(state => state.projects);
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const uid = useAuthStore(s => s.user?.uid);
  const role = useCurrentRole();
  const ownTimeOnly = role !== 'owner' && role !== 'accountant';
  const workspaceId = workspace?.id || '';
  const [month, setMonth] = useState(getLocalDateISO().slice(0, 7));
  const { rows: entries, loading, failed, error, retry } = useReportList(
    workspaceId ? `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/time` : null, 'entries', isReportTimeEntry);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  // listTime returns at most the 5,000 newest entries visible to the reader.
  const capped = !!entries && entries.length >= 5000;
  const report = useMemo(() => timeByPersonProject({
    entries: entries?.filter(e => e.workspaceId === workspaceId && (!ownTimeOnly || (!!uid && e.person === uid))) || [],
    projects: projects.filter(p => !workspaceId || p.workspaceId === workspaceId),
    month,
  }), [entries, projects, workspaceId, month, ownTimeOnly, uid]);

  return <section aria-label={reportText('r.time-by-person-and-project', 'Time by person and project')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.time-by-person-and-project', 'Time by person and project')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.who-logged-time-on-which-project-in-the-chosen-m', 'Who logged time on which project in the chosen month, from the Time screen\'s entries. Every entry counts toward the minutes whatever its state — not submitted, waiting, approved or already invoiced — with the billable part and the part still waiting for approval shown inside it, never added twice. An entry with no project is No project recorded. Approving and billing time stay on the Time screen.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.month', 'Month')}
        <input type="month" aria-label={reportText('r.month', 'Month')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={month} onChange={e => setMonth(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={capped || !report.rows.length}
        onClick={() => downloadCsv('time-by-person-and-project', [...TIME_BY_PROJECT_CSV_HEADERS], timeByProjectCsvRows(report.rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {!validMonth && <p role="alert">{reportText('r.choose-a-real-calendar-month', 'Choose a real calendar month.')}</p>}
    {ownTimeOnly && <p className="text-sm text-[var(--muted)]">{reportText('r.time-personal-scope', 'Only your own time entries are included.')}</p>}
    {capped && <p role="alert">{reportText('r.time-capped', 'Only the newest 5,000 visible entries were returned. This month may be incomplete; CSV is unavailable.')}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">{reportText('r.reading-the-time-entries', 'Reading the time entries…')}</p>}
    {failed && <div className="space-y-2">
      <p role="alert" className="text-sm">{reportText('r.the-time-entries-could-not-be-read', 'The time entries could not be read:')} {error || reportText('r.missing-report-rows', 'The response did not contain report rows.')}</p>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={retry}>{reportText('r.retry', 'Retry')}</button>
    </div>}

    {report.people.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm" aria-label={reportText('r.month-totals-by-person', 'Month totals by person')}>
      {report.people.map(person => (
        <p key={person.person}><b><bdi>{person.person}</bdi>:</b> {hoursText(person.minutes)}
          <span className="text-[var(--muted)]"> · {hoursText(person.billableMinutes)} {reportText('r.billable', 'billable ·')} {person.entries} {reportText('r.entries-3', 'entries')}</span></p>
      ))}
    </div>}

    {report.rows.length > 0 && <ReportSchedule columnControls allowDisplayedExport={!capped} rows={report.rows}
      rowKey={row => JSON.stringify([row.person, row.projectId])}
      caption={<>{reportText('r.time-logged-by-person-and-project', 'Time logged by person and project,')} <bdi>{month}</bdi></>}
      columns={[
        { header: reportText('r.person', 'Person'), cell: row => <bdi>{row.person}</bdi> },
        { header: reportText('r.project', 'Project'), cell: row => <bdi>{row.projectId ? row.projectName : reportText('r.unspecified-project', 'No project recorded')}</bdi> },
        { header: reportText('r.time', 'Time'), align: 'right', cell: row => hoursText(row.minutes) },
        { header: reportText('r.billable-2', 'Billable'), align: 'right', cell: row => hoursText(row.billableMinutes) },
        { header: reportText('r.waiting-for-approval', 'Waiting for approval'), align: 'right', cell: row => row.waitingMinutes ? hoursText(row.waitingMinutes) : '—' },
        { header: reportText('r.entries', 'Entries'), align: 'right', cell: row => row.entries },
      ]} />}
    {entries && validMonth && !capped && !report.rows.length && <p role="status">{reportText('r.no-time-is-logged-in', 'No time is logged in')} <bdi>{month}</bdi>.</p>}

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.time-logged-for-a-customer-without-a-project-is', 'Time logged for a customer without a project is in No project recorded here; the Time screen keeps the customer on each entry. Minutes are exact in the CSV.')}
    </p>
  </section>;
}
