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
    <section aria-label="Israel advance tax payment calendar" className="p-4 space-y-4 min-w-0">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Israel: Advance Income-Tax Payment (Mikdamot) Calendar</h2>
        <p className="text-sm text-[var(--muted)]">
          Statutory reminder calendar and planning tool for Israeli advance income-tax payments (מקדמות מס הכנסה)
          under Section 175 of the Income Tax Ordinance [New Version], 5721-1961 (פקודת מס הכנסה, סעיף 175: מקדמות).
          Advances are determined by the Israel Tax Authority on turnover (מחזור עסקאות) and are due by the 15th
          of the month following the period.
        </p>
        <p className="text-xs text-[var(--muted)]">
          <b>Shabbat and holiday postponement:</b> Under Israeli administrative law (Interpretation Law, 5741-1981,
          s. 10(c)), when the statutory 15th deadline falls on Friday or Saturday (Shabbat), the filing and payment
          due date moves to the following Sunday. Digital filers often receive administrative grace dates, but
          the statutory anchor remains the 15th. Nothing on this screen posts, files, assesses or transfers funds.
        </p>
      </div>

      {/* Control panel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <label className="block text-sm">
          <span className="font-semibold block mb-1">Entity / Tax Profile</span>
          <select
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={target}
            onChange={e => setTarget(e.target.value)}
          >
            {targets.map(key => (
              <option key={key} value={key}>
                {key === 'books' ? 'The books' : `${labelNames.get(key) || key} (${key})`}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">Calendar / Tax Year</span>
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
          <span className="font-semibold block mb-1">Reporting Frequency</span>
          <select
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={activeFrequency}
            onChange={e => setOverrideFreq(e.target.value as IlAdvanceTaxFrequency)}
          >
            <option value="bimonthly">Bi-monthly (דו-חודשי)</option>
            <option value="monthly">Monthly (חודשי)</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">Advance Tax Rate (%)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={customRate !== '' ? customRate : (resolved.advanceTaxRatePercent !== undefined ? String(resolved.advanceTaxRatePercent) : '')}
            placeholder={resolved.advanceTaxRatePercent !== undefined ? `${resolved.advanceTaxRatePercent}% (configured)` : 'e.g. 3.5'}
            onChange={e => setCustomRate(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">Period Turnover (₪)</span>
          <input
            inputMode="decimal"
            className="min-h-11 w-full rounded border border-[var(--line)] bg-[var(--panel)] px-3 text-sm"
            value={turnoverInput}
            placeholder="e.g. 100000"
            onChange={e => setTurnoverInput(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="font-semibold block mb-1">As-of Assessment Date</span>
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
          <div className="font-semibold text-[var(--text)]">Entity Profile Status</div>
          <div className="text-[var(--muted)]">
            Entity: <b>{resolved.name || (target === 'books' ? 'The books' : target)}</b>
          </div>
          <div>
            Declared Rate:{' '}
            {resolved.advanceTaxRatePercent !== undefined ? (
              <span className="font-bold text-[var(--text)]">
                {resolved.advanceTaxRatePercent}%
                {target !== 'books' && profiles.labels?.[target]?.advanceTaxRatePercent === undefined && (
                  <span className="font-normal text-xs text-[var(--muted)] ml-1">
                    (inherited from the books)
                  </span>
                )}
              </span>
            ) : (
              <span className="text-[var(--muted)] italic">
                None configured (set in Settings → Tax profiles). Using manual rate: {effectiveRatePercent ?? 0}%.
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--muted)]">
            Basis: Section 175 turnover rate. Frequency: {activeFrequency === 'bimonthly' ? 'Bi-monthly' : 'Monthly'}.
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-sm space-y-1">
          <div className="font-semibold text-[var(--text)]">Next Scheduled Deadline</div>
          {nextPeriod ? (
            <div>
              <div className="font-bold text-[var(--text)]">
                {nextPeriod.name} (<bdi>{nextPeriod.nameHe}</bdi>)
              </div>
              <div className="text-xs text-[var(--muted)]">
                Statutory: {nextPeriod.statutoryDueDate} (15th)
                {nextPeriod.wasPostponedForRestDay && (
                  <span className="ml-1 text-amber-700 font-medium">
                    → Postponed to {nextPeriod.adjustedDueDate} (Sunday)
                  </span>
                )}
              </div>
              {effectiveRatePercent !== undefined && turnoverCents !== undefined && (
                <div className="text-xs text-[var(--text)] mt-1">
                  Estimated advance: <b>{formatCurrency(ilAdvanceTaxEstimateCents(turnoverCents, effectiveRatePercent), 'ILS')}</b> (on {formatCurrency(turnoverCents, 'ILS')} turnover)
                </div>
              )}
            </div>
          ) : (
            <div className="text-[var(--muted)]">No remaining periods in {year} after {asOfDate}.</div>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h3 className="font-bold text-sm">
          Advance Payment Periods for {year} ({activeFrequency === 'bimonthly' ? '6 bi-monthly periods' : '12 monthly periods'})
        </h3>
        <button
          type="button"
          onClick={handleExportCsv}
          className="min-h-11 px-4 rounded border border-[var(--line)] bg-[var(--panel)] text-sm font-semibold hover:bg-[var(--surface)]"
        >
          Export CSV
        </button>
      </div>

      {/* Schedule Table */}
      <ReportTableScroll>
        <table className="w-full text-sm border-collapse">
          <caption className="sr-only">
            Israel Advance Income-Tax Payment (Mikdamot) Schedule for {year} ({activeFrequency})
          </caption>
          <thead>
            <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)] bg-[var(--surface)]">
              <th scope="col" className="text-left py-2 px-3">Period</th>
              <th scope="col" className="text-left py-2 px-3">Date Range</th>
              <th scope="col" className="text-left py-2 px-3">Statutory Due Date</th>
              <th scope="col" className="text-left py-2 px-3">Adjusted Due Date</th>
              <th scope="col" className="text-left py-2 px-3">Status</th>
              <th scope="col" className="text-right py-2 px-3">Estimated Advance</th>
            </tr>
          </thead>
          <tbody>
            {periods.map(period => {
              const status = ilAdvanceTaxPeriodStatus(period, asOfDate);
              const estimate = effectiveRatePercent !== undefined && turnoverCents !== undefined
                ? ilAdvanceTaxEstimateCents(turnoverCents, effectiveRatePercent)
                : undefined;

              return (
                <tr key={period.periodKey} className="border-b border-[var(--line)]/50 hover:bg-[var(--surface)]/50">
                  <th scope="row" className="py-2 px-3 font-medium text-left">
                    <span>{period.name}</span>{' '}
                    <span className="text-xs text-[var(--muted)]">(<bdi>{period.nameHe}</bdi>)</span>
                  </th>
                  <td className="py-2 px-3 text-xs whitespace-nowrap text-[var(--muted)]">
                    {period.startDate} to {period.endDate}
                  </td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap">
                    {period.statutoryDueDate}
                  </td>
                  <td className="py-2 px-3 text-xs whitespace-nowrap">
                    <span className={period.wasPostponedForRestDay ? 'font-semibold text-amber-700' : ''}>
                      {period.adjustedDueDate}
                    </span>
                    {period.wasPostponedForRestDay && (
                      <span className="text-[10px] text-amber-600 block">Postponed to Sunday</span>
                    )}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {status === 'due-soon' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-amber-500/10 text-amber-700 font-semibold">
                        Due soon
                      </span>
                    )}
                    {status === 'active' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-700 font-medium">
                        Active
                      </span>
                    )}
                    {status === 'upcoming' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-zinc-500/10 text-[var(--muted)]">
                        Upcoming
                      </span>
                    )}
                    {status === 'past' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-zinc-500/10 text-[var(--muted)]">
                        Past
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium">
                    {estimate !== undefined ? formatCurrency(estimate, 'ILS') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ReportTableScroll>

      {/* Statutory footnote */}
      <div className="text-xs text-[var(--muted)] border-t border-[var(--line)] pt-3 space-y-1">
        <div>
          <b>Statutory Basis:</b> {scheduleRow?.statutoryBasis || 'Section 175, Income Tax Ordinance'} (
          <bdi>{scheduleRow?.hebrewBasis || 'סעיף 175 לפקודת מס הכנסה'}</bdi>).
        </div>
        <div>
          <b>Official Source:</b>{' '}
          <a
            href={scheduleRow?.source || 'https://www.gov.il/he/departments/israel_tax_authority'}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Israel Tax Authority (רשות המסים בישראל)
          </a>
        </div>
        <div>
          <b>Notice:</b> This screen provides planning reminders and advance calculations. The rate is set on the
          taxpayer&apos;s voucher booklet (פנקס מקדמות). Final annual tax liability is reconciled on the annual
          income tax return (Form 1214 for companies, Form 1301 for individuals).
        </div>
      </div>
    </section>
  );
}
