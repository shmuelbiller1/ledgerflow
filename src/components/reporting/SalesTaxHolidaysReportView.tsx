import React, { useMemo, useState } from 'react';
import { getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import {
  HOLIDAY_CSV_HEADERS, bandCapWords, holidayCsvRows, holidayItemAnswer, holidayRowsInForce, holidayStates,
  US_SALES_TAX_HOLIDAYS, type HolidayBand,
} from '../../lib/tax/usSalesTaxHolidays';
import ReportTableScroll from './ReportTableScroll';
import {
  HOLIDAY_CALENDAR_CSV_HEADERS, HOLIDAY_CALENDAR_NOT_STATED, US_SALES_TAX_HOLIDAY_CALENDAR,
  holidayCalendarCsvRows, holidayCalendarMonthsForYear, holidayCalendarStatesForYear, holidayCalendarYears, nextHolidayWindow,
} from '../../lib/tax/usSalesTaxHolidayCalendar';
import { useReportText } from './useReportText';

const field = 'min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]';

const capWords = bandCapWords;

const KIND_WORDS: Record<string, string> = {
  'exempt': 'qualifying items carry no sales tax in the window',
  'reduced-rate': 'the rate falls — it is not zero, and local tax may still apply',
  'restricted-purchaser': 'only a named class of buyer is relieved; the goods are not tax-free',
};

/**
 * A-58: US state sales tax holidays. The dated windows, the categories each one covers and the
 * per-item sales-price cap it sets, every row from the state's own page. The checker answers the
 * table's own question — is an item at this price inside a band's cap on this date? — and says
 * plainly that the source's qualifying-item list governs which items a band covers. Read-only:
 * nothing here posts, files, or changes the tax the engine computes, and a window this table does
 * not state is never assumed absent (the rule pack lists those as rows to add).
 */
export default function SalesTaxHolidaysReportView({ today = '' }: { today?: string }) {
  const reportText = useReportText();
  const [asOf, setAsOf] = useState(today || getLocalDateISO());
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [checkState, setCheckState] = useState<string>('TX');
  const [checkBand, setCheckBand] = useState<string>('clothing-footwear');
  const [checkPrice, setCheckPrice] = useState<string>('45.00');
  const [calYear, setCalYear] = useState<number>(() => {
    const years = holidayCalendarYears();
    const thisYear = Number((today || getLocalDateISO()).slice(0, 4));
    return years.includes(thisYear) ? thisYear : years[years.length - 1];
  });

  const rows = useMemo(() => (
    US_SALES_TAX_HOLIDAYS
      .filter(row => stateFilter === 'all' || row.state === stateFilter)
      .slice()
      .sort((a, b) => b.from.localeCompare(a.from) || a.state.localeCompare(b.state))
  ), [stateFilter]);

  const calendarMonths = useMemo(() => holidayCalendarMonthsForYear(calYear), [calYear]);
  const calendarStates = useMemo(() => holidayCalendarStatesForYear(calYear), [calYear]);
  const nextWindow = useMemo(() => nextHolidayWindow(asOf), [asOf]);

  const inForce = useMemo(() => holidayRowsInForce(checkState, asOf), [checkState, asOf]);
  const checkBands = useMemo(() => {
    const bands: HolidayBand[] = [];
    for (const row of inForce) for (const band of row.bands) if (!bands.some(b => b.id === band.id)) bands.push(band);
    return bands;
  }, [inForce]);
  const priceCents = Math.round(Number(checkPrice || '0') * 100);
  const answer = Number.isFinite(priceCents) && priceCents >= 0
    ? holidayItemAnswer(checkState, asOf, checkBand, priceCents)
    : null;

  return <section aria-label={reportText('r.sales-tax-holidays', 'Sales tax holidays')} className="p-4 space-y-4 min-w-0">
    <h2>{reportText('r.sales-tax-holidays', 'Sales tax holidays')}</h2>
    <p className="text-sm text-[var(--muted)]">
      {reportText('r.the-dated-windows-in-which-us-states-stop-taxing', 'The dated windows in which US states stop taxing qualifying items, with each window\'s categories and its per-item price cap, every row from the state\'s own publication. A cap is on the item\'s sales price — both states count delivery, shipping and handling in it — and the source\'s qualifying-item list decides item by item what a band covers. Read-only: nothing here posts or files, and a holiday this table does not list is one it does not state, never a statement that no holiday exists.')}
    </p>

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">{reportText('r.as-of-2', 'As of')}
        <input aria-label={reportText('r.holiday-checker-date', 'Holiday checker date')} type="date" className={field} value={asOf} onChange={event => setAsOf(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">{reportText('r.state', 'State')}
        <select aria-label={reportText('r.holiday-state-filter', 'Holiday state filter')} className={field} value={stateFilter} onChange={event => setStateFilter(event.target.value)}>
          <option value="all">{reportText('r.all-states-in-this-table', 'All states in this table')}</option>
          {holidayStates().map(entry => <option key={entry.state} value={entry.state}>{entry.stateName} ({entry.state})</option>)}
        </select>
      </label>
      <button type="button" className="btn-secondary min-h-11 px-3" disabled={!rows.length} onClick={() => downloadCsv(
        `sales-tax-holidays.csv`, HOLIDAY_CSV_HEADERS, holidayCsvRows(rows),
      )}>{reportText('r.export-csv', 'Export CSV')}</button>
    </div>

    <h3>{reportText('r.what-is-in-force-on', 'What is in force on')} {asOf}</h3>
    {inForce.length === 0
      ? <p>{reportText('r.no-holiday-from-this-table-is-in-force-in', 'No holiday from this table is in force in')} {checkState} {reportText('r.on-2', 'on')} {asOf}.</p>
      : <p className="text-sm" data-testid="holiday-in-force">{inForce.map(row => (
          <span key={row.id} className="inline-block mr-4"><b>{row.name}</b> ({row.stateName}, {row.from} {reportText('r.to-2', 'to')} {row.to})
            {' — '}{row.bands.map(band => `${band.label.split(' (')[0]} ${capWords(band)}`).join(' · ')}</span>
        ))}</p>}

    <div className="flex flex-wrap items-end gap-3" data-print-hide>
      <label className="flex flex-col gap-1">{reportText('r.checker-state', 'Checker state')}
        <select aria-label={reportText('r.checker-state', 'Checker state')} className={field} value={checkState} onChange={event => {
          setCheckState(event.target.value);
          const first = holidayRowsInForce(event.target.value, asOf)[0]?.bands[0];
          if (first) setCheckBand(first.id);
        }}>
          {holidayStates().map(entry => <option key={entry.state} value={entry.state}>{entry.stateName} ({entry.state})</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">{reportText('r.item-band', 'Item band')}
        <select aria-label={reportText('r.checker-band', 'Checker band')} className={field} value={checkBand} onChange={event => setCheckBand(event.target.value)} disabled={!checkBands.length}>
          {checkBands.length === 0 && <option value="">{reportText('r.no-band-no-holiday-in-force', 'No band — no holiday in force')}</option>}
          {checkBands.map(band => <option key={band.id} value={band.id}>{band.label.split(' (')[0]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">{reportText('r.item-sales-price-major-units', 'Item sales price (major units)')}
        <input aria-label={reportText('r.checker-price', 'Checker price')} type="number" min="0" step="0.01" className={field} value={checkPrice} onChange={event => setCheckPrice(event.target.value)} />
      </label>
    </div>
    {answer && <p role="status" className="text-sm" data-testid="holiday-answer">
      {answer.state === 'within-cap' && <b>{reportText('r.within-the-cap', 'Within the cap.')} </b>}
      {answer.state === 'over-cap' && <b>{reportText('r.over-the-cap', 'Over the cap.')} </b>}
      {answer.because}
    </p>}
    {!answer && <p role="alert">{reportText('r.give-a-price-of-0-or-more-to-check-a-band-s-cap', 'Give a price of 0 or more to check a band\'s cap.')}</p>}

    <h3>{reportText('r.the-calendar-this-table-states', 'The calendar this table states')}</h3>
    <ReportTableScroll><table className="w-full text-sm">
      <caption>{reportText('r.sales-tax-holiday-windows-with-their-item-bands', 'Sales tax holiday windows with their item bands and per-item price caps')}</caption>
      <thead><tr>
        <th scope="col">{reportText('r.state', 'State')}</th><th scope="col">{reportText('r.holiday', 'Holiday')}</th><th scope="col">{reportText('r.window', 'Window')}</th>
        <th scope="col">{reportText('r.what-is-covered-the-source-s-list-governs', 'What is covered (the source\'s list governs)')}</th>
        <th scope="col" className="text-right">{reportText('r.per-item-cap', 'Per-item cap')}</th><th scope="col">{reportText('r.source', 'Source')}</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-t border-[var(--line)] align-top">
        <th scope="row" className="text-left">{row.stateName} ({row.state})</th>
        <td><bdi>{row.name}</bdi><div className="text-xs text-[var(--muted)]"><bdi>{row.note}</bdi></div></td>
        <td className="tabular-nums whitespace-nowrap">{row.from} → {row.to}</td>
        <td><ul className="list-disc ps-4">{row.bands.map(band => <li key={band.id}>
          {band.label} — <b>{capWords(band)}</b>{band.note ? <span className="text-xs text-[var(--muted)]"> ({band.note})</span> : null}
        </li>)}</ul></td>
        <td className="text-right tabular-nums">{row.bands.map(band => <div key={band.id}>{(band.capCents / 100).toFixed(2)}</div>)}</td>
        <td className="text-xs"><a href={row.source.url} target="_blank" rel="noopener noreferrer" className="underline">{row.source.authority}</a><div className="text-[var(--muted)]">{reportText('r.checked', 'checked')} {row.checked}</div></td>
      </tr>)}</tbody>
    </table></ReportTableScroll>

    <p className="text-xs text-[var(--muted)]">
      {reportText('r.windows-not-stated-in-the-table-above-florida-s', 'Windows not stated in the table above (Florida\'s disaster-preparedness and hunting/fishing/camping windows, Texas\' water-efficient products holiday, and every state whose publication this lane has not read) are listed as rows to add in the tax rule pack — never assumed absent. A-109\'s calendar below states WHEN most of them run a window, which is not the same as what the window exempts.')}
    </p>
    <h3>{reportText('r.a-109-the-calendar-which-states-run-a-window-and', 'A-109: the calendar — which states run a window, and when')}</h3>
    <p className="text-sm text-[var(--muted)]">
      {calendarStates.length} {reportText('r.states-and-territories-run', 'states and territories run')} {calendarMonths.reduce((n, m) => n + m.rows.length, 0)} {reportText('r.windows-in', 'windows in')} {calYear}{reportText('r.this-section-answers-when-not-what-a-calendar-ro', '. This section answers WHEN, not WHAT: a calendar row has no item bands and no cap, so it never means nothing is taxed that week. A window turns into a rule only when the table above states its qualifying items and price caps from the state\'s own publication. Read-only; nothing files or posts.')}
    </p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">{reportText('r.calendar-year', 'Calendar year')}
        <select aria-label={reportText('r.calendar-year', 'Calendar year')} className={field} value={String(calYear)} onChange={e => setCalYear(Number(e.target.value))}>
          {holidayCalendarYears().map(y => <option key={y} value={String(y)}>{y}</option>)}
        </select>
      </label>
      <p className="text-sm py-2">{reportText('r.next-window-dated-after', 'Next window dated after')} {asOf}: <b>{nextWindow ? `${nextWindow.stateName} — ${nextWindow.name} (${nextWindow.from} → ${nextWindow.to})` : reportText('r.none-dated', 'none dated')}</b></p>
      <button type="button" className={field} onClick={() => downloadCsv('us-sales-tax-holiday-calendar', HOLIDAY_CALENDAR_CSV_HEADERS, holidayCalendarCsvRows())}>{reportText('r.export-the-calendar-csv', 'Export the calendar (CSV)')}</button>
    </div>
    <div className="space-y-3">
      {calendarMonths.map(month => <div key={month.month} data-calendar-month={month.month}>
        <h4 className="text-sm font-semibold">{month.month}</h4>
        <ul className="space-y-1 text-sm">
          {month.rows.map(row => <li key={row.id} data-calendar-row={row.id}>
            <b>{row.stateName}</b> — <bdi>{row.name}</bdi> <span className="tabular-nums whitespace-nowrap">({row.from} → {row.to})</span>
            <span className="text-xs text-[var(--muted)]"> · {KIND_WORDS[row.kind]}{row.pattern ? ` · ${row.pattern}` : ''}{row.statuteDerived ? ` ${reportText('r.the-agency-had-not-posted-this-year-when-the-sou', '· the agency had not posted this year when the source was compiled, so the date follows the published rule — confirm it')}` : ''}</span>
            {row.statePageUrl ? <> <a className="underline text-xs" href={row.statePageUrl} target="_blank" rel="noopener noreferrer">{row.statePageRead ? reportText('r.the-state-s-own-page-opened-for-this-table', 'the state\'s own page (opened for this table)') : reportText('r.the-state-s-page-listed-by-the-source-not-opened', 'the state\'s page (listed by the source, not opened here)')}</a></> : null}
            {row.note ? <div className="text-xs text-[var(--muted)]"><bdi>{row.note}</bdi></div> : null}
          </li>)}
        </ul>
      </div>)}
      {calendarMonths.length === 0 ? <p className="text-sm">{reportText('r.no-window-of-this-calendar-falls-in', 'No window of this calendar falls in')} {calYear}.</p> : null}
    </div>
    <details data-calendar-gaps>
      <summary className="text-sm">{reportText('r.what-this-calendar-does-not-state', 'What this calendar does not state (')}{HOLIDAY_CALENDAR_NOT_STATED.length} {reportText('r.things', 'things)')}</summary>
      <ul className="text-sm list-disc ps-5 space-y-1">
        {HOLIDAY_CALENDAR_NOT_STATED.map(gap => <li key={gap.row}><b>{gap.row}</b> — {gap.reason}</li>)}
      </ul>
    </details>
    <p className="text-xs text-[var(--muted)]">
      {reportText('r.every-calendar-row-was-read-on', 'Every calendar row was read on')} {US_SALES_TAX_HOLIDAY_CALENDAR[0].source.retrieved} {reportText('r.from-the-federation-of-tax-administrators-dated', 'from the Federation of Tax Administrators\' dated state-by-state table, which lists each state\'s own page beside it; those pages are linked above and only the ones marked as opened were read for this table.')} {US_SALES_TAX_HOLIDAY_CALENDAR.filter(r => r.statePageRead).length} {reportText('r.of', 'of')} {US_SALES_TAX_HOLIDAY_CALENDAR.length} {reportText('r.rows-are-read-from-the-state-s-own-page-a-commer', 'rows are read from the state\'s own page. A commercial calendar listing Virginia\'s 2026 window as August 1-3 is wrong — the Department says August 7-9 and gives the rule that fixes it.')}
    </p>
  </section>;
}
