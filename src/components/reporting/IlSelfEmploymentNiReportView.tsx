import React, { useState } from 'react';
import {
  IL_SELF_EMPLOYMENT_NI_ROWS,
  ilSelfEmploymentNiMonthlyAdvanceCents,
  ilSelfEmploymentNiPeriodSettlementCents,
  ilSelfEmploymentNiRowOn,
  type IlSelfEmploymentNiFigure,
} from '../../lib/tax/ilSelfEmploymentNationalInsurance';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency, getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

const CSV_HEADERS = ['Valid from', 'Valid until', 'Minimum income a month', 'Reduced grade a month', 'Maximum income a month', 'National insurance (reduced)', 'National insurance (regular)', 'Health insurance (reduced)', 'Health insurance (regular)', 'Advance floor a month', 'Advance ceiling a month', 'Source', 'Read on', 'Note'];

const pct = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.00$/, '')}%`;
const money = (cents: number | undefined) => (cents === undefined ? '—' : formatCurrency(cents, 'ILS'));

function shekelsToCents(input: string): number | undefined {
  const t = input.trim().replace(/[,\s₪]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const cents = Math.round(Number(t) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

function FigureLine({ label, figure, months = 1 }: { label: string; figure: IlSelfEmploymentNiFigure | undefined; months?: number }) {
  if (!figure) return null;
  return (
    <div className="text-sm" data-figure={label}>
      <b>{label}</b>: {money(figure.totalCents)}
      {months > 1 ? ` for the period (${money(figure.totalCents / months)} a month on average)` : ''} —
      national insurance {money(figure.niCents)}, health insurance {money(figure.healthCents)}, charged on{' '}
      {money(figure.baseCents)} of which {money(figure.reducedBaseCents)} at the reduced rate and {money(figure.fullBaseCents)} at the regular rate
      {figure.clampedToMinimum ? ' (the income was below the minimum assessable income, so the minimum was charged)' : ''}
      {figure.clampedToMaximum ? ' (the income was above the maximum assessable income, so only up to it is charged)' : ''}.
    </div>
  );
}

/**
 * A-102: Israel — what a self-employed person pays National Insurance, by income band and by date.
 * A dated reference table with two estimates next to it. Nothing posts, files, pays or assesses;
 * the Authority assesses on the annual figure, and this screen says which of its numbers it shows.
 */
export default function IlSelfEmploymentNiReportView() {
  const [date, setDate] = useState(getLocalDateISO());
  const [income, setIncome] = useState('12000');
  const row = ilSelfEmploymentNiRowOn(date);
  const incomeCents = shekelsToCents(income);
  const advance = row && incomeCents !== undefined ? ilSelfEmploymentNiMonthlyAdvanceCents(incomeCents, date) : undefined;
  const settlement = row && incomeCents !== undefined ? ilSelfEmploymentNiPeriodSettlementCents(incomeCents * 3, date, 3) : undefined;

  return (
    <section aria-label="Israel self-employed national insurance" className="p-4 space-y-4 min-w-0">
      <h2>Israel: what a self-employed person pays National Insurance</h2>
      <p className="text-sm text-[var(--muted)]">
        The monthly income is split at a grade: up to it the reduced rates, above it the regular rates, and nothing at all above the maximum
        assessable income. Both the National Insurance contribution and health insurance are charged on that same split. A person whose income
        is below the minimum assessable income is charged on the minimum, so a weak month still keeps the insurance record.{' '}
        <a className="underline" href={row?.source.url ?? IL_SELF_EMPLOYMENT_NI_ROWS[0].source.url}>The Authority publishes these figures</a>.
      </p>
      <p className="text-sm text-[var(--muted)]">
        <b>Two different numbers, and the difference matters.</b> While the year runs the Authority charges a monthly <i>advance</i> — the rates
        on the income. After the income tax assessment the <i>settlement</i> is computed on a base from which 52% of the National Insurance
        contribution itself is deducted (section 345), which is why it is lower. Pension deductions (the other part of the same section) are not
        known here, so the settlement shown is before them. Nothing here posts, files or pays: this is calculation status, and the Authority
        assesses on the annual figure. Someone who is also an employee, a minor, of retirement age or receives an old-age benefit is charged
        differently and is not what this table answers.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">Check a date
          <input aria-label="Check date" type="date" value={date} onChange={e => setDate(e.target.value)} className="min-h-11 border rounded px-3 bg-[var(--panel)]" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Income a month (₪)
          <input aria-label="Monthly income" inputMode="decimal" value={income} onChange={e => setIncome(e.target.value)} className="min-h-11 border rounded px-3 bg-[var(--panel)] w-40" />
        </label>
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('il-self-employment-national-insurance', CSV_HEADERS, IL_SELF_EMPLOYMENT_NI_ROWS.map(r => [r.validFrom, r.validTo || '', String(r.minMonthlyIncomeCents), String(r.reducedBandCeilingCents), String(r.maxMonthlyIncomeCents), pct(r.niReducedBp), pct(r.niFullBp), pct(r.healthReducedBp), pct(r.healthFullBp), r.publishedMinMonthlyAdvanceCents === undefined ? '' : String(r.publishedMinMonthlyAdvanceCents), r.publishedMaxMonthlyAdvanceCents === undefined ? '' : String(r.publishedMaxMonthlyAdvanceCents), r.source.url, r.source.retrieved, r.note]))}>
          Export CSV
        </button>
      </div>

      {row ? (
        <div className="space-y-1">
          <p className="text-sm">
            In force on {date}: reduced to <b>{money(row.reducedBandCeilingCents)}</b> a month at {pct(row.niReducedBp + row.healthReducedBp)},
            above it <b>{pct(row.niFullBp + row.healthFullBp)}</b> up to <b>{money(row.maxMonthlyIncomeCents)}</b>; minimum income charged{' '}
            <b>{money(row.minMonthlyIncomeCents)}</b>.
            {row.publishedMinMonthlyAdvanceCents !== undefined
              ? ` The Authority's published advance for 2026 runs from ${money(row.publishedMinMonthlyAdvanceCents)} to ${money(row.publishedMaxMonthlyAdvanceCents)} a month.`
              : ' No advance floor or ceiling is recorded for this year, because this table only carries what was read from the Authority for it.'}
          </p>
          <FigureLine label="Advance, a month" figure={advance} />
          <FigureLine label="Settlement, a quarter" figure={settlement} months={3} />
          {incomeCents === undefined && <p className="text-sm text-[var(--danger)]">Type a whole-shekel or agorot amount, such as 12000 or 12000.50.</p>}
          <p className="text-xs text-[var(--muted)]" data-authority-example>
            The Authority's own example, read with this change: a self-employed person with ₪12,000 a month in January 2026 gets a quarterly base
            of ₪34,690 and pays ₪3,864 for the quarter — the same arithmetic as above, so typing 12000 here should land on those figures.
          </p>
        </div>
      ) : (
        <p className="text-sm">No row of this table covers {date}. The table carries the years read from the Authority — an earlier year is not
          guessed, and its amounts and rates are published back to 1986 in{' '}
          <a className="underline" href="https://www.btl.gov.il/Mediniyut/GeneralData/rates_1954_2007/Hachnasa/Pages/ovedAtzmaii.aspx">the Authority&apos;s own list</a>,
          one row per date, each needing the circular of its year for the percentages.</p>
      )}

      <ReportTableScroll>
        <RowTable
          rowHeaderColumn={false}
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>Self-employed contribution rates by income band, dated</>)}
          rows={IL_SELF_EMPLOYMENT_NI_ROWS}
          rowKey={r => r.validFrom}
          captionClassName="text-left font-semibold pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: "From", className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => r.validFrom },
            { header: "Until", className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => r.validTo || '—' },
            { header: "Minimum income", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => money(r.minMonthlyIncomeCents) },
            { header: "Reduced grade", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => money(r.reducedBandCeilingCents) },
            { header: "Maximum income", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => money(r.maxMonthlyIncomeCents) },
            { header: "National insurance", className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => (<>{pct(r.niReducedBp)} / {pct(r.niFullBp)}</>) },
            { header: "Health insurance", className: "py-1 px-2 tabular-nums whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => (<>{pct(r.healthReducedBp)} / {pct(r.healthFullBp)}</>) },
            { header: "Advance floor", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => money(r.publishedMinMonthlyAdvanceCents) },
            { header: "Advance ceiling", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => money(r.publishedMaxMonthlyAdvanceCents) },
            { header: "Source", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => (<><a className="underline break-all" href={r.source.url}>{r.source.authority}</a> · read {r.source.retrieved}
                  <ul className="text-xs text-[var(--muted)] mt-1">
                    {r.corroboratedBy.map(c => <li key={c.url}><a className="underline break-all" href={c.url}>{c.note}</a></li>)}
                  </ul></>) },
            { header: "Note", className: "py-1 px-2 text-[var(--muted)]", headClassName: "text-left py-1 px-2", cell: (r) => r.note },
          ]}
        />
      </ReportTableScroll>
      <p className="text-xs text-[var(--muted)]">
        Reduced and regular rates are shown as one column each, in that order. An advance figure of — means the Authority's circular for that year
        was not read, not that there is none. This table does not cover the reduced rates for a minor or a person of retirement age, the flat
        health-insurance payment of a person who does not work (₪123 a month from 1 January 2026), or an employee who is also self-employed, whose
        self-employed income is charged at the regular rate on everything above the grade.
      </p>
    </section>
  );
}
