import React, { useMemo } from 'react';
import { formatCurrency } from '../../lib/utils';
import { useServerIncomeBySource } from '../../hooks/useServerIncomeBySource';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { TrendingUp } from 'lucide-react';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoney } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

export const IncomeBySourceReportView: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4e: with the loaded lists capped, the breakdown comes from the server (every entry of the range)
  const { sources: breakdowns, source } = useServerIncomeBySource(start, end);

  /** One row per customer or source: how much came in, and what share of the period it is. */
  const columns: ColumnDef<(typeof breakdowns)[number], unknown>[] = [
    { id: 'source', accessorFn: row => row.source, header: 'Customer / Revenue Source', cell: info => (
      <span className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
        <bdi>{String(info.getValue())}</bdi>
      </span>
    ) },
    { id: 'count', accessorFn: row => row.transactionCount, header: 'Invoices / Entries', cell: info => <span className="font-mono">{String(info.getValue())}</span> },
    { id: 'share', accessorFn: row => row.percentage, header: 'Revenue Contribution', cell: info => (
      <span className="flex items-center justify-end gap-2">
        <span className="w-24 bg-neutral-100 rounded-full h-1.5 overflow-hidden" aria-hidden="true">
          <span className="block bg-emerald-500 h-full rounded-full" style={{ width: `${Math.min(100, Number(info.getValue()))}%` }} />
        </span>
        <span className="font-mono w-12 text-right">{Number(info.getValue()).toFixed(1)}%</span>
      </span>
    ) },
    { id: 'total', accessorFn: row => row.totalAmountCents, header: 'Total Inflow', cell: info => <span className="font-mono font-semibold text-emerald-600">{formatCurrency(Number(info.getValue()))}</span> },
  ];

  const totalIncomeCents = useMemo(() => {
    return breakdowns.reduce((sum, b) => sum + b.totalAmountCents, 0);
  }, [breakdowns]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="income-by-source-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            Income by Source & Customer
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Concentration and revenue generation breakdown across clients, revenue channels, and payees.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500 uppercase font-semibold">Total Revenue</div>
          <div className="text-lg font-mono font-bold text-emerald-600">
            {formatCurrency(totalIncomeCents)}
          </div>
        </div>
      </div>

      <RangeReportSourceNote source={source} testId="income-source-source" />

      <TanStackDataGrid
        caption="Income by source"
        data={breakdowns}
        columns={columns}
        rowHeaderColumn="source"
        pageSize={25}
        searchPlaceholder="Search customers and sources..."
        searchLabel="Search customers and sources"
        columnScope="report-income-by-source"
        columnLabel="Income by source columns"
        columnNames={['Customer / Revenue Source', 'Invoices / Entries', 'Revenue Contribution', 'Total Inflow']}
        exportConfig={{
          filename: 'income-by-source.csv',
          label: 'Export CSV',
          headers: ['Customer / Revenue Source', 'Invoices / Entries', 'Share of inflow %', 'Total Inflow'],
          mapRow: row => [row.source, row.transactionCount, row.percentage.toFixed(1), csvMoney(row.totalAmountCents)],
        }}
        emptyState={<EmptyState title="No income in this period" description="Try a wider period." />}
        filteredEmptyState={<EmptyState title="No source matches your search" description="Try another customer name." />}
      />
    </div>
  );
};

export default IncomeBySourceReportView;
