import React, { useMemo, useState } from 'react';
import { US_FILING_CALENDAR, filingDueDate, type FilingFrequency } from '../../lib/tax/usFilingCalendar';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
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

    <ReportTableScroll>
      <table className="w-full text-sm">
        <caption className="text-left font-semibold text-[var(--text)] pb-1">{reportText('r.state-filing-frequencies-and-due-days-weekend-mo', 'State filing frequencies and due days — weekend move to Monday, holidays not moved')}</caption>
        <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">{[reportText('r.state', 'State'), reportText('r.name', 'Name'), reportText('r.common-frequencies', 'Common frequencies'), reportText('r.due-2', 'Due'), reportText('r.weekend-adjusted-due-for-period-end', 'Weekend-adjusted due for period end'), reportText('r.note', 'Note'), reportText('r.source', 'Source')].map(h => <th key={h} scope="col" className="text-left py-1 px-2">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(row => {
            const due = validPeriod ? filingDueDate(row.state, periodEnd) : undefined;
            return <tr key={row.state} className="border-b border-[var(--line)]/50 align-top">
              <th scope="row" className="text-left font-normal py-1 px-2 font-mono">{row.state}</th>
              <td className="py-1 px-2"><bdi>{row.stateName}</bdi></td>
              <td className="py-1 px-2">{row.frequencies.join(', ') || reportText('r.no-state-tax', '— no state tax —')}</td>
              <td className="py-1 px-2 whitespace-nowrap">{row.dueDay === 'none' ? reportText('r.none-3', 'none') : row.dueDay === 'last-day' ? reportText('r.last-day', 'last day') : fill(reportText('r.the-0-th', 'the {0}th'), { 0: row.dueDay })}</td>
              <td className="py-1 px-2 whitespace-nowrap">{due || '—'}</td>
              <td className="py-1 px-2 text-xs max-w-[32ch]">{row.note || '—'}</td>
              <td className="py-1 px-2"><a href={row.source} target="_blank" rel="noopener noreferrer" className="underline break-all">{row.state} {reportText('r.source-2', 'source')}</a><div className="text-xs text-[var(--muted)]">{reportText('r.checked', 'checked')} {row.checked}</div></td>
            </tr>;
          })}
        </tbody>
      </table>
      {!rows.length && <p className="text-sm text-[var(--muted)]">{reportText('r.no-state-matches-that-filter-clear-the-state-or', 'No state matches that filter. Clear the state or frequency to see all 51 rows.')}</p>}
    </ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">{reportText('r.capability', 'Capability:')} <b>{reportText('r.internal-test-or-demo-only', 'Internal, test or demo only')}</b> {reportText('r.planning-rows-only-filing-payment-and-holiday-mo', '— planning rows only; filing, payment and holiday moves are the state’s. Table problems: none (')}{US_FILING_CALENDAR.length} {reportText('r.rows-5-with-no-state-filing-each-with-https-sour', 'rows, 5 with no state filing, each with https source).')}</p>
  </section>;
}
