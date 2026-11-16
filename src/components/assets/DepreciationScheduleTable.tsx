import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import { depreciationSchedule, scheduleByYear } from '../../lib/depreciationEngine';
import { downloadCsv } from '../../lib/csvExport';
import { formatCurrency } from '../../lib/utils';
import type { FixedAsset } from '../../types';
import { RowTable } from '../ui/RowTable';

/**
 * An asset's depreciation schedule (X-02): by year on screen (depreciation, accumulated and book
 * value at the year end, and whether the month-end run already posted it), month by month in the
 * CSV. Worked out by the same engine the month-end run posts from.
 */
export default function DepreciationScheduleTable({ asset }: { asset: FixedAsset }) {
  const months = useMemo(() => depreciationSchedule(asset), [asset]);
  const years = useMemo(() => scheduleByYear(months), [months]);
  const cents = (c: number) => (c / 100).toFixed(2);
  const download = () => downloadCsv(`depreciation-${asset.name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`,
    ['Month', 'Depreciation', 'Accumulated', 'Book value', 'Posted'],
    months.map(m => [m.month, cents(m.amountCents), cents(m.accumulatedCents), cents(m.bookValueCents), m.posted ? 'yes' : 'no']));

  if (months.length === 0) return <p className="text-xs text-[var(--muted)]">No schedule: the purchase date is missing.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">{months.length} months from {months[0].month} to {months[months.length - 1].month}; the month-end run posts each month.</p>
        <button type="button" onClick={download} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brass)] hover:underline">
          <Download className="w-3.5 h-3.5" aria-hidden="true" /> Monthly schedule (.csv)
        </button>
      </div>
      <RowTable
        caption={(<>Depreciation schedule of {asset.name} by year</>)}
        rows={years}
        rowKey={y => y.year}
        columns={[
          { header: "Year", className: "py-1 font-semibold", headClassName: "py-1", cell: (y) => (<>{y.year}{y.months < 12 ? ` (${y.months} mo)` : ''}</>) },
          { header: "Depreciation", align: 'right', className: "py-1 font-mono", headClassName: "py-1", cell: (y) => formatCurrency(y.amountCents) },
          { header: "Accumulated", align: 'right', className: "py-1 font-mono", headClassName: "py-1", cell: (y) => formatCurrency(y.accumulatedCents) },
          { header: "Book value", align: 'right', className: "py-1 font-mono", headClassName: "py-1", cell: (y) => formatCurrency(y.bookValueCents) },
          { header: "Posted", className: "py-1 pl-3 text-[var(--muted)]", headClassName: "py-1 pl-3", cell: (y) => y.posted ? 'yes' : 'not yet' },
        ]}
      />
    </div>
  );
}
