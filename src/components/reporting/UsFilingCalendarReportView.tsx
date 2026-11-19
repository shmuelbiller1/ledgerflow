import React, { useMemo, useState } from 'react';
import { US_FILING_CALENDAR, filingDueDate, type FilingFrequency } from '../../lib/tax/usFilingCalendar';
import { downloadCsv } from '../../lib/csvExport';
import ReportSchedule from './ReportSchedule';
import { useReportText, fill } from './useReportText';

/** Code names, form numbers, paths and identifiers shown as-is: they are not words to translate (EU-G1). */
const CODE_NAMES = { c0: 'src/lib/tax/usFilingCalendar.ts', c1: 'dueDay none', c2: 'e.g. TX or Texas' } as const;


const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';
const CSV_HEADERS = ['State', 'Name', 'Frequencies', 'Due day', 'Note', 'Source', 'Checked'] as const;

/**
 * C-122: US Sales Tax Filing Calendar — planning table for 50 states + DC.
 * Weekend move only; holidays not known; frequency assigned by state.
 */
export default function UsFilingCalendarReportView() {
  const reportText = useReportText();
  const [stateFilter, setStateFilter] = useState('');
  const [freqFilter, setFreqFilter] = useState<'' | FilingFrequency>('');
  const [periodEnd, setPeriodEnd] = useState('2026-09-30');

  const rows = useMemo(() => {
    return US_FILING_CALENDAR.filter(r => {
      if (stateFilter && !r.state.toLowerCase().includes(stateFilter.toLowerCase()) && !r.stateName.toLowerCase().includes(stateFilter.toLowerCase())) return false;
      if (freqFilter && !r.frequencies.includes(freqFilter)) return false;
      return true;
    });
  }, [stateFilter, freqFilter]);

  const csvRows = useMemo(() => rows.map(r => [r.state, r.stateName, r.frequencies.join('/'), String(r.dueDay), r.note || '', r.source, r.checked]), [rows]);

  const validPeriod = /^\d{4}-\d{2}-\d{2}$/.test(periodEnd);

  return <section aria-label={reportText('r.us-sales-tax-filing-calendar', 'US sales tax filing calendar')} className="p-4 space-y-4 min-w-0">
    <div className="space-y-1">
      <h2>{reportText('r.us-sales-tax-filing-calendar-2', 'US Sales Tax Filing Calendar')}</h2>
      <p className="text-sm text-[var(--muted)]">
        {reportText('r.a-planning-table-plan-us-1-when-each-state-s-sal', 'A planning table (PLAN US-1): when each state’s sales-tax return is commonly due — frequencies the state often assigns, the day of the following month, and the state’s own revenue-department source (same source as the rate table).')} <b>{reportText('r.it-does-not-file-or-pay-anything', 'It does not file or pay anything.')}</b> {reportText('r.the-state-assigns-the-filing-frequency-from-your', 'The state assigns the filing frequency from your liability and tells you on the account or return; a weekend due date moves to Monday here, but holidays still govern on the state’s own calendar. Nothing here posts, verifies a registration, or determines nexus.')}
      </p>
      <p className="text-xs text-[var(--muted)]">{reportText('r.source-table', 'Source table:')} <code>{CODE_NAMES.c0}</code> {reportText('r.51-rows-50-dc-checked-2026-10-11-five-states-hav', '— 51 rows (50 + DC), checked 2026-10-11; five states have no state sales tax (')}<code>{CODE_NAMES.c1}</code>{reportText('r.see-also-us-state-sales-tax-rate-table-nexus-wat', '). See also: US state sales-tax rate table, nexus watch, and the US quarter journey.')}</p>
    </div>

    <div className="flex flex-wrap gap-3 items-end p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]" data-print-hide>
      <label className="block text-sm">{reportText('r.state-code-or-name', 'State (code or name)')}
        <input className={field + ' w-full mt-1'} value={stateFilter} onChange={e => setStateFilter(e.target.value)} placeholder={CODE_NAMES.c2} />
      </label>
      <label className="block text-sm">{reportText('r.frequency', 'Frequency')}
        <select className={field + ' mt-1'} value={freqFilter} onChange={e => setFreqFilter(e.target.value as FilingFrequency | '')}>
          <option value="">{reportText('r.any', 'Any')}</option>
          <option value="monthly">{reportText('r.monthly-3', 'monthly')}</option>
          <option value="quarterly">{reportText('r.quarterly', 'quarterly')}</option>
          <option value="semiannual">{reportText('r.semiannual', 'semiannual')}</option>
          <option value="annual">{reportText('r.annual', 'annual')}</option>
        </select>
      </label>
      <label className="block text-sm">{reportText('r.period-end-for-due-date-preview', 'Period end (for due-date preview)')}
        <input type="date" className={field + ' mt-1'} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
      </label>
      <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('us-filing-calendar', [...CSV_HEADERS], csvRows)}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <ReportSchedule
      columnControls
      allowDisplayedExport={validPeriod}
      caption={reportText('r.state-filing-frequencies-and-due-days-weekend-mo', 'State filing frequencies and due days — weekend move to Monday, holidays not moved')}
      captionClassName="text-start font-semibold text-[var(--text)] pb-1"
      headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
      rowClassName="border-b border-[var(--line)]/50 align-top"
      bodyClassName=""
      rows={rows} rowKey={row => row.state}
      columns={[
        { header: reportText('r.state', 'State'), className: 'font-mono', cell: row => row.state },
        { header: reportText('r.name', 'Name'), cell: row => <bdi>{row.stateName}</bdi> },
        { header: reportText('r.common-frequencies', 'Common frequencies'), cell: row => row.frequencies.join(', ') || reportText('r.no-state-tax', '— no state tax —') },
        { header: reportText('r.due-2', 'Due'), className: 'whitespace-nowrap', cell: row => row.dueDay === 'none' ? reportText('r.none-3', 'none') : row.dueDay === 'last-day' ? reportText('r.last-day', 'last day') : fill(reportText('r.the-0-th', 'the {0}th'), { 0: row.dueDay }) },
        { header: reportText('r.weekend-adjusted-due-for-period-end', 'Weekend-adjusted due for period end'), className: 'whitespace-nowrap', cell: row => { const due = validPeriod ? filingDueDate(row.state, periodEnd) : undefined; return due || '—'; } },
        { header: reportText('r.note', 'Note'), className: 'text-xs max-w-[32ch]', cell: row => row.note || '—' },
        { header: reportText('r.source', 'Source'), cell: row => <><a href={row.source} target="_blank" rel="noopener noreferrer" className="underline break-all">{row.state} {reportText('r.source-2', 'source')}</a><div className="text-xs text-[var(--muted)]">{reportText('r.checked', 'checked')} {row.checked}</div></> },
      ]} />

    <p className="text-xs text-[var(--muted)]">{reportText('r.capability', 'Capability:')} <b>{reportText('r.internal-test-or-demo-only', 'Internal, test or demo only')}</b> {reportText('r.planning-rows-only-filing-payment-and-holiday-mo', '— planning rows only; filing, payment and holiday moves are the state’s. Table problems: none (')}{US_FILING_CALENDAR.length} {reportText('r.rows-5-with-no-state-filing-each-with-https-sour', 'rows, 5 with no state filing, each with https source).')}</p>
  </section>;
}
