import { RowTable } from '../ui/RowTable';
import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { resolveSellerProfile, type TaxProfiles } from '../../lib/tax/profile';
import {
  IL_ADVANCE_TAX_SCHEDULE,
  ilAdvanceTaxCalendarCsvRows,
  IL_ADVANCE_TAX_CALENDAR_CSV_HEADERS,
  ilAdvanceTaxEstimateCents,
  ilAdvanceTaxPeriods,
  ilAdvanceTaxPeriodStatus,
  type IlAdvanceTaxFrequency,
} from '../../lib/tax/ilAdvanceTaxCalendar';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { useReportText, fill } from './useReportText';

function shekelsToCents(input: string): number | undefined {
  const t = input.trim().replace(/[,\s₪]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const cents = Math.round(Number(t) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

/**
 * A-101: Israel — Advance Income-Tax Payment (Mikdamot) reminder calendar and per-entity rate calculation.
 * Under Section 175 of the Income Tax Ordinance [New Version], 5721-1961.
 * Planning and calculation status only; nothing here posts, files, assesses, or transfers funds.
 */
export default function IsraelAdvanceTaxReportView() {
  const reportText = useReportText();
  const workspace = useAuthStore(state => state.getCurrentWorkspace());
  const dimensionNodes = useLedgerStore(state => state.dimensionNodes);
  const profiles: TaxProfiles = useMemo(() => workspace?.taxProfiles || {}, [workspace?.taxProfiles]);

  // Build target options: the books + every configured label in taxProfiles or dimensionNodes
  const labelNames = useMemo(() => {
    return new Map(dimensionNodes.map(node => [`${node.dimensionId}:${node.id}`, node.description]));
  }, [dimensionNodes]);

  const targets = useMemo(() => {
    return ['books', ...Object.keys(profiles.labels || {})];
  }, [profiles.labels]);

  const [target, setTarget] = useState('books');
  const [year, setYear] = useState<number>(2026);
  const [asOfDate, setAsOfDate] = useState<string>(getLocalDateISO());

  // Resolve profile for the selected target
  const resolved = useMemo(() => {
    if (target === 'books') return resolveSellerProfile(profiles, {}, []);
    const [dim, node] = target.split(':');
    return resolveSellerProfile(profiles, { [dim]: node }, [dim]);
  }, [profiles, target]);

  // Default frequency from profile or 'bimonthly'
  const [overrideFreq, setOverrideFreq] = useState<IlAdvanceTaxFrequency | ''>('');
  const activeFrequency: IlAdvanceTaxFrequency = overrideFreq || resolved.advanceTaxFrequency || 'bimonthly';

  // Advance rate from profile or manual what-if input
  const [customRate, setCustomRate] = useState<string>('');
  const effectiveRatePercent: number | undefined = customRate.trim() !== ''
    ? Number(customRate)
    : resolved.advanceTaxRatePercent;

  // Turnover input for what-if advance calculation
  const [turnoverInput, setTurnoverInput] = useState<string>('100000');
  const turnoverCents = shekelsToCents(turnoverInput);

  // Generate calendar periods
  const periods = useMemo(() => {
    return ilAdvanceTaxPeriods(year, activeFrequency);
  }, [year, activeFrequency]);

  // Find next upcoming / active period
  const nextPeriod = useMemo(() => {
    return periods.find(p => p.adjustedDueDate >= asOfDate);
  }, [periods, asOfDate]);

  const scheduleRow = IL_ADVANCE_TAX_SCHEDULE.find(s => s.frequency === activeFrequency);

  const handleExportCsv = () => {
    const rows = ilAdvanceTaxCalendarCsvRows(year, activeFrequency);
    downloadCsv(`israel-advance-tax-calendar-${year}-${activeFrequency}`, [...IL_ADVANCE_TAX_CALENDAR_CSV_HEADERS], rows);
  };

  return (
    <section aria-label={reportText('r.israel-advance-tax-payment-calendar', 'Israel advance tax payment calendar')} className="p-4 space-y-4 min-w-0">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">{reportText('r.israel-advance-income-tax-payment-mikdamot-calen', 'Israel: Advance Income-Tax Payment (Mikdamot) Calendar')}</h2>
        <p className="text-sm text-[var(--muted)]">
          {reportText('r.statutory-reminder-calendar-and-planning-tool-fo', 'Statutory reminder calendar and planning tool for Israeli advance income-tax payments (מקדמות מס הכנסה) under Section 175 of the Income Tax Ordinance [New Version], 5721-1961 (פקודת מס הכנסה, סעיף 175: מקדמות). Advances are determined by the Israel Tax Authority on turnover (מחזור עסקאות) and are due by the 15th of the month following the period.')}
        </p>
        <p className="text-xs text-[var(--muted)]">
          <b>{reportText('r.shabbat-and-holiday-postponement', 'Shabbat and holiday postponement:')}</b> {reportText('r.under-israeli-administrative-law-interpretation', 'Under Israeli administrative law (Interpretation Law, 5741-1981, s. 10(c)), when the statutory 15th deadline falls on Friday or Saturday (Shabbat), the filing and payment due date moves to the following Sunday. Digital filers often receive administrative grace dates, but the statutory anchor remains the 15th. Nothing on this screen posts, files, assesses or transfers funds.')}
        </p>
      </div>

      {/* Control panel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <label className="block text-sm">
          <span className="font-semibold block mb-1">{reportText('r.entity-tax-profile', 'Entity / Tax Profile')}</span>
          <select
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={target}
            onChange={e => setTarget(e.target.value)}
          >
            {targets.map(key => (
              <option key={key} value={key}>
                {key === 'books' ? reportText('r.the-books', 'The books') : `${labelNames.get(key) || key} (${key})`}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">{reportText('r.calendar-tax-year', 'Calendar / Tax Year')}</span>
          <select
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
          >
            {[2024, 2025, 2026, 2027].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">{reportText('r.reporting-frequency', 'Reporting Frequency')}</span>
          <select
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={activeFrequency}
            onChange={e => setOverrideFreq(e.target.value as IlAdvanceTaxFrequency)}
          >
            <option value="bimonthly">{reportText('r.bi-monthly', 'Bi-monthly (דו-חודשי)')}</option>
            <option value="monthly">{reportText('r.monthly', 'Monthly (חודשי)')}</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">{reportText('r.advance-tax-rate', 'Advance Tax Rate (%)')}</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={customRate !== '' ? customRate : (resolved.advanceTaxRatePercent !== undefined ? String(resolved.advanceTaxRatePercent) : '')}
            placeholder={resolved.advanceTaxRatePercent !== undefined ? fill(reportText('r.rate-configured', '{rate}% (configured)'), { rate: resolved.advanceTaxRatePercent }) : reportText('r.e-g-3-5', 'e.g. 3.5')}
            onChange={e => setCustomRate(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">{reportText('r.period-turnover', 'Period Turnover (₪)')}</span>
          <input
            inputMode="decimal"
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={turnoverInput}
            placeholder={reportText('r.e-g-100000', 'e.g. 100000')}
            onChange={e => setTurnoverInput(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">{reportText('r.as-of-assessment-date', 'As-of Assessment Date')}</span>
          <input
            type="date"
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={asOfDate}
            onChange={e => setAsOfDate(e.target.value)}
          />
        </label>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm space-y-1">
          <div className="font-semibold text-[var(--text)]">{reportText('r.entity-profile-status', 'Entity Profile Status')}</div>
          <div className="text-[var(--muted)]">
            {reportText('r.entity', 'Entity:')} <b>{resolved.name || (target === 'books' ? reportText('r.the-books', 'The books') : target)}</b>
          </div>
          <div>
            {reportText('r.declared-rate', 'Declared Rate:')}{' '}
            {resolved.advanceTaxRatePercent !== undefined ? (
              <span className="font-bold text-[var(--text)]">
                {resolved.advanceTaxRatePercent}%
                {target !== 'books' && profiles.labels?.[target]?.advanceTaxRatePercent === undefined && (
                  <span className="font-normal text-xs text-[var(--muted)] ml-1">
                    {reportText('r.inherited-from-the-books', '(inherited from the books)')}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[var(--muted)] italic">
                {reportText('r.none-configured-set-in-settings-tax-profiles-usi', 'None configured (set in Settings → Tax profiles). Using manual rate:')} {effectiveRatePercent ?? 0}%.
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--muted)]">
            {reportText('r.basis-section-175-turnover-rate-frequency', 'Basis: Section 175 turnover rate. Frequency:')} {activeFrequency === 'bimonthly' ? reportText('r.bi-monthly-2', 'Bi-monthly') : reportText('r.monthly-2', 'Monthly')}.
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm space-y-1">
          <div className="font-semibold text-[var(--text)]">{reportText('r.next-scheduled-deadline', 'Next Scheduled Deadline')}</div>
          {nextPeriod ? (
            <div>
              <div className="font-bold text-[var(--text)]">
                {nextPeriod.name} (<bdi>{nextPeriod.nameHe}</bdi>)
              </div>
              <div className="text-xs text-[var(--muted)]">
                {reportText('r.statutory', 'Statutory:')} {nextPeriod.statutoryDueDate} {reportText('r.15th', '(15th)')}
                {nextPeriod.wasPostponedForRestDay && (
                  <span className="ml-1 text-amber-700 font-medium">
                    {reportText('r.postponed-to', '→ Postponed to')} {nextPeriod.adjustedDueDate} {reportText('r.sunday', '(Sunday)')}
                  </span>
                )}
              </div>
              {effectiveRatePercent !== undefined && turnoverCents !== undefined && (
                <div className="text-xs text-[var(--text)] mt-1">
                  {reportText('r.estimated-advance', 'Estimated advance:')} <b>{formatCurrency(ilAdvanceTaxEstimateCents(turnoverCents, effectiveRatePercent), 'ILS')}</b> {reportText('r.on', '(on')} {formatCurrency(turnoverCents, 'ILS')} {reportText('r.turnover', 'turnover)')}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[var(--muted)]">{reportText('r.no-remaining-periods-in', 'No remaining periods in')} {year} {reportText('r.after', 'after')} {asOfDate}.</div>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h3 className="font-bold text-sm">
          {reportText('r.advance-payment-periods-for', 'Advance Payment Periods for')} {year} ({activeFrequency === 'bimonthly' ? reportText('r.6-bi-monthly-periods', '6 bi-monthly periods') : reportText('r.12-monthly-periods', '12 monthly periods')})
        </h3>
        <button
          type="button"
          onClick={handleExportCsv}
          className="min-h-11 px-4 rounded border border-[var(--line)] bg-[var(--panel)] text-sm font-semibold hover:bg-[var(--surface)]"
        >
          {reportText('r.export-csv', 'Export CSV')}
        </button>
      </div>

      {/* Schedule Table */}
      <ReportTableScroll allowDisplayedExport={false}>
        <RowTable
          caption={
            <>
              {reportText('r.israel-advance-income-tax-payment-mikdamot-sched', 'Israel Advance Income-Tax Payment (Mikdamot) Schedule for')} {year} ({activeFrequency})
            </>
          }
          captionClassName="sr-only"
          tableClassName="w-full text-sm border-collapse"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)] bg-[var(--surface)]"
          bodyClassName=""
          rowClassName="border-b border-[var(--line)]/50 hover:bg-[var(--surface)]/50"
          rows={periods.map((period) => {
            const status = ilAdvanceTaxPeriodStatus(period, asOfDate);
            const estimate = effectiveRatePercent !== undefined && turnoverCents !== undefined ? ilAdvanceTaxEstimateCents(turnoverCents, effectiveRatePercent) : undefined;
            return { period, status, estimate };
          })}
          rowKey={({ period }) => period.periodKey}
          columns={[
            {
              header: reportText('r.period', 'Period'),
              headClassName: 'text-left py-2 px-3', className: 'py-2 px-3 font-medium text-left',
              cell: ({ period }) => (
                <>
                  <span>{period.name}</span>{' '}
                  <span className="text-xs text-[var(--muted)]">
                    (<bdi>{period.nameHe}</bdi>)
                  </span>
                </>
              ),
            },
            {
              header: reportText('r.date-range', 'Date Range'),
              headClassName: 'text-left py-2 px-3', className: 'py-2 px-3 text-xs whitespace-nowrap text-[var(--muted)]',
              cell: ({ period }) => (
                <>
                  {period.startDate} {reportText('r.to-2', 'to')} {period.endDate}
                </>
              ),
            },
            {
              header: reportText('r.statutory-due-date', 'Statutory Due Date'),
              headClassName: 'text-left py-2 px-3', className: 'py-2 px-3 text-xs whitespace-nowrap',
              cell: ({ period }) => period.statutoryDueDate,
            },
            {
              header: reportText('r.adjusted-due-date', 'Adjusted Due Date'),
              headClassName: 'text-left py-2 px-3', className: 'py-2 px-3 text-xs whitespace-nowrap',
              cell: ({ period }) => (
                <>
                  <span className={period.wasPostponedForRestDay ? 'font-semibold text-amber-700' : ''}>{period.adjustedDueDate}</span>
                  {period.wasPostponedForRestDay && <span className="text-[10px] text-amber-600 block">{reportText('r.postponed-to-sunday', 'Postponed to Sunday')}</span>}
                </>
              ),
            },
            {
              header: reportText('r.status', 'Status'),
              headClassName: 'text-left py-2 px-3', className: 'py-2 px-3 whitespace-nowrap',
              cell: ({ status }) => (
                <>
                  {status === 'due-soon' && (
                    <span className="px-2 py-0.5 rounded text-xs bg-amber-500/10 text-amber-700 font-semibold">{reportText('r.due-soon', 'Due soon')}</span>
                  )}
                  {status === 'active' && <span className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-700 font-medium">{reportText('r.active', 'Active')}</span>}
                  {status === 'upcoming' && <span className="px-2 py-0.5 rounded text-xs bg-zinc-500/10 text-[var(--muted)]">{reportText('r.upcoming', 'Upcoming')}</span>}
                  {status === 'past' && <span className="px-2 py-0.5 rounded text-xs bg-zinc-500/10 text-[var(--muted)]">{reportText('r.past', 'Past')}</span>}
                </>
              ),
            },
            {
              header: reportText('r.estimated-advance-2', 'Estimated Advance'),
              headClassName: 'text-right py-2 px-3', className: 'py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium',
              cell: ({ estimate }) => (estimate !== undefined ? formatCurrency(estimate, 'ILS') : '—'),
            },
          ]}
        />
      </ReportTableScroll>

      {/* Statutory footnote */}
      <div className="text-xs text-[var(--muted)] border-t border-[var(--line)] pt-3 space-y-1">
        <div>
          <b>{reportText('r.statutory-basis', 'Statutory Basis:')}</b> {scheduleRow?.statutoryBasis || reportText('r.section-175-income-tax-ordinance', 'Section 175, Income Tax Ordinance')} (
          <bdi>{scheduleRow?.hebrewBasis || 'סעיף 175 לפקודת מס הכנסה'}</bdi>).
        </div>
        <div>
          <b>{reportText('r.official-source', 'Official Source:')}</b>{' '}
          <a
            href={scheduleRow?.source || 'https://www.gov.il/he/departments/israel_tax_authority'}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {reportText('r.israel-tax-authority', 'Israel Tax Authority (רשות המסים בישראל)')}
          </a>
        </div>
        <div>
          <b>{reportText('r.notice', 'Notice:')}</b> {reportText('r.this-screen-provides-planning-reminders-and-adva', 'This screen provides planning reminders and advance calculations. The rate is set on the taxpayer\'s voucher booklet (פנקס מקדמות). Final annual tax liability is reconciled on the annual income tax return (Form 1214 for companies, Form 1301 for individuals).')}
        </div>
      </div>
    </section>
  );
}
