import React, { useState } from 'react';
import { US_MILEAGE_RATES, mileageRateOn } from '../../lib/tax/usMileageRates';
import { downloadCsv } from '../../lib/csvExport';
import { getLocalDateISO } from '../../lib/utils';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

const CSV_HEADERS = ['Valid from', 'Valid to', 'Tenths of a cent per mile', 'Rate per mile', 'Source', 'Note'];

/** The table stores the rate in tenths of a cent (6550 = 65.5¢), because a mileage rate needs three decimals of a dollar. */
const centsPerMile = (tenthsOfCent: number) => `${(tenthsOfCent / 10).toFixed(1)}¢ per mile`;

function rowsToCsv(rows: typeof US_MILEAGE_RATES) {
  return rows.map(r => [r.validFrom, r.validTo || '', String(r.rateCentsPerMile), centsPerMile(r.rateCentsPerMile), r.source.url, r.note || '']);
}

/**
 * A-108: US standard mileage rates by year (IRS) — read-only reference table.
 * Nothing posts, files or pays; a mileage claim still records the rate the person typed.
 */
export default function MileageRatesReportView() {
  const [date, setDate] = useState(() => getLocalDateISO());
  const active = mileageRateOn(date);
  return (
    <section aria-label="US mileage rates" className="p-4 space-y-4 min-w-0">
      <h2>US standard mileage rates (business)</h2>
      <p className="text-sm text-[var(--muted)]">
        The IRS business standard mileage rate that was in force on a date. This table is a dated reference
        from <a className="underline" href="https://www.irs.gov/tax-professionals/standard-mileage-rates">IRS standard mileage rates</a>.
        An expense claim still records the rate the person typed; the rate shown here is a suggestion only.
        2022 had a mid-year increase; 2026 is provisional until the 2026 IRS Notice is checked.
        Nothing here posts, files or calculates tax — it is calculation status only.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">Check a date
          <input aria-label="Check date" type="date" value={date} onChange={e => setDate(e.target.value)} className="min-h-11 border rounded px-3 bg-[var(--panel)]" />
        </label>
        <p className="text-sm py-2">
          In force on {date}: <b>{active ? centsPerMile(active.rateCentsPerMile) : 'No row covers that date'}</b>
          {active?.note ? ` — ${active.note}` : ''}
        </p>
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('us-mileage-rates', CSV_HEADERS, rowsToCsv(US_MILEAGE_RATES))}>Export CSV</button>
      </div>

      <ReportTableScroll>
        <RowTable
          rowHeaderColumn={false}
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>IRS business standard mileage rates, dated</>)}
          rows={US_MILEAGE_RATES}
          rowKey={r => r.validFrom}
          captionClassName="text-left font-semibold pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: "Valid from", className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => r.validFrom },
            { header: "Valid to", className: "py-1 px-2 whitespace-nowrap", headClassName: "text-left py-1 px-2", cell: (r) => r.validTo || '—' },
            { header: "Rate", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => centsPerMile(r.rateCentsPerMile) },
            { header: "Tenths of a cent per mile", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => r.rateCentsPerMile },
            { header: "Source", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => (<><a className="underline break-all" href={r.source.url}>{r.source.authority}</a> · {r.source.retrieved}</>) },
            { header: "Note", className: "py-1 px-2 text-[var(--muted)]", headClassName: "text-left py-1 px-2", cell: (r) => r.note },
          ]}
        />
      </ReportTableScroll>
      <p className="text-xs text-[var(--muted)]">Source: IRS standard mileage rates page. Medical/moving (22¢ from 2022) and charitable (14¢) are not in this business table. Verify the 2026 rate with the IRS Notice for 2026 before relying on it.</p>
    </section>
  );
}
