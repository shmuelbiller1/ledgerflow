import React, { useMemo, useState } from 'react';
import { getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import {
  BANK_CALENDARS, BANK_CALENDAR_IDS, BANK_HOLIDAYS_CSV_HEADERS,
  bankHolidays, bankHolidaysCsvRows, isBankWorkingDay, moveDueDate,
  type BankCalendarId,
} from '../../lib/bankHolidays';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';
import { useReportText } from './useReportText';

const weekdayText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const banksText = (kind: 'closed' | 'short-day' | 'note') =>
  kind === 'closed' ? 'Closed' : kind === 'short-day' ? 'Short day' : 'Open (see note)';

/**
 * A-137: bank holiday calendars and the due-date move. The lists are generated from each
 * authority's own rules (see src/lib/bankHolidays.ts for the sources and the limits) and a due
 * date can be checked against the chosen calendar here: it is kept when banks work that day and
 * moved to the next day they do. Reference only — no document's date is changed from this screen.
 */
export default function BankHolidaysReportView() {
  const reportText = useReportText();
  const today = getLocalDateISO();
  const thisYear = Number(today.slice(0, 4));
  const [calendar, setCalendar] = useState<BankCalendarId>('IL');
  const [year, setYear] = useState(thisYear);
  const [dueDate, setDueDate] = useState(today);

  const meta = BANK_CALENDARS[calendar];
  const rows = useMemo(() => bankHolidays(calendar, year), [calendar, year]);
  const moved = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? moveDueDate(calendar, dueDate) : '';
  const working = moved !== '' && isBankWorkingDay(calendar, dueDate);

  return <section aria-label={reportText('r.bank-holidays-and-due-dates', 'Bank holidays and due dates')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.bank-holidays-and-due-dates', 'Bank holidays and due dates')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.the-days-banks-are-closed-in-each-calendar-gener', 'The days banks are closed in each calendar, generated from the authority\'s own rules, and what happens to a due date that falls on one: it moves forward to the next day banks work (the "following" convention). Check a date below before promising it. Nothing on this screen changes a document — it is the reference the move follows.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.calendar', 'Calendar')}
        <select aria-label={reportText('r.bank-calendar', 'Bank calendar')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={calendar} onChange={e => setCalendar(e.target.value as BankCalendarId)}>
          {BANK_CALENDAR_IDS.map(id => <option key={id} value={id}>{BANK_CALENDARS[id].name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.year', 'Year')}
        <select aria-label={reportText('r.year', 'Year')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={year} onChange={e => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">{reportText('r.due-date-to-check', 'Due date to check')}
        <input type="date" aria-label={reportText('r.due-date-to-check', 'Due date to check')} className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]"
          value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" disabled={!rows.length}
        onClick={() => downloadCsv('bank-holidays', [...BANK_HOLIDAYS_CSV_HEADERS], bankHolidaysCsvRows(calendar, rows))}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    {moved && <p className="text-sm" role="status">
      {working
        ? <>{reportText('r.banks-work-on', 'Banks work on')} <b>{weekdayText(dueDate)}</b> {reportText('r.in-this-calendar-so-a-due-date-stays', 'in this calendar, so a due date stays')} {dueDate}.</>
        : <>{reportText('r.banks-do-not-work-on', 'Banks do not work on')} <b>{weekdayText(dueDate)}</b> {reportText('r.in-this-calendar-the-due-date-moves-to', 'in this calendar. The due date moves to')} <b>{weekdayText(moved)}</b> ({moved}).</>}
    </p>}
    {!moved && <p role="alert" className="text-sm">{reportText('r.choose-a-valid-due-date-to-check-it', 'Choose a valid due date to check it.')}</p>}

    <ReportTableScroll>
      <RowTable
        rowClassName="border-b border-[var(--line)]/50"
        caption={(<>{meta.name}{reportText('r.bank-holidays-in', ': bank holidays in')} {year}</>)}
        rows={rows}
        rowKey={row => `${row.date}-${row.name}`}
        captionClassName=""
        tableClassName="w-full text-sm"
        headRowClassName=""
        bodyClassName=""
        columns={[
          { header: reportText('r.date-2', 'Date'), className: "text-left font-normal py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (row) => row.date },
          { header: reportText('r.day', 'Day'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => new Date(`${row.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) },
          { header: reportText('r.holiday', 'Holiday'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => (<>{row.name}{row.nameHe ? <> · <bdi lang="he">{row.nameHe}</bdi></> : null}</>) },
          { header: reportText('r.banks', 'Banks'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => banksText(row.kind) },
          { header: reportText('r.note', 'Note'), className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (row) => row.note || '—' },
        ]}
      />
      {!rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-calendar-is-generated-for', 'No calendar is generated for')} {year}.</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.source-4', 'Source:')} {meta.source.authority} — <a className="underline" href={meta.source.url} target="_blank" rel="noopener noreferrer">{meta.source.url}</a>{reportText('r.read-4', ', read')} {meta.source.retrieved}. {meta.note} {reportText('r.a-one-off-holiday-an-authority-announces-an-elec', 'A one-off holiday an authority announces (an election, a royal occasion) is not generated by any rule: check the authority\'s list before relying on a date.')}
    </p>
  </section>;
}
