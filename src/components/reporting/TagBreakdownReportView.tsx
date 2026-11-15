import React from 'react';
import { formatCurrency } from '../../lib/utils';
import { useServerTagBreakdown } from '../../hooks/useServerTagBreakdown';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { Tag, Hash } from 'lucide-react';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoney } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

export const TagBreakdownReportView: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4g: with the loaded lists capped, the tags come from the server (every entry of the range)
  const { tags: tagData, source } = useServerTagBreakdown(start, end);

  /**
   * The tag, how many items carry it, and what they came to. The tag names the row, so it is drawn as
   * a row header; money leaves the export as plain decimals, never the display format.
   */
  const columns: ColumnDef<(typeof tagData)[number], unknown>[] = [
    { id: 'tag', accessorFn: row => row.tag, header: 'Tag', cell: info => (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md">
        <Hash className="w-3 h-3 text-indigo-500" aria-hidden="true" />
        <bdi>{String(info.getValue())}</bdi>
      </span>
    ) },
    { id: 'count', accessorFn: row => row.count, header: 'Tagged Items', cell: info => <span className="font-mono">{String(info.getValue())}</span> },
    { id: 'income', accessorFn: row => row.incomeCents, header: 'Revenue Inflow', cell: info => <span className="font-mono text-emerald-600">{formatCurrency(Number(info.getValue()))}</span> },
    { id: 'expense', accessorFn: row => row.expenseCents, header: 'Expense Outflow', cell: info => <span className="font-mono text-rose-600">{formatCurrency(Number(info.getValue()))}</span> },
    { id: 'net', accessorFn: row => row.netCents, header: 'Net Financial Impact', cell: info => (
      <span className={`font-mono font-bold ${Number(info.getValue()) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(Number(info.getValue()))}</span>
    ) },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="tag-breakdown-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-600" />
            Tag & Analytical Dimension Breakdown
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Aggregated financials across multi-dimensional transaction and line item tags.
          </p>
        </div>
      </div>

      <RangeReportSourceNote source={source} testId="tag-breakdown-source" />

      <TanStackDataGrid
        caption="Totals by tag"
        data={tagData}
        columns={columns}
        rowHeaderColumn="tag"
        pageSize={25}
        searchPlaceholder="Search tags..."
        searchLabel="Search tags"
        columnScope="report-tag-breakdown"
        columnLabel="Tag breakdown columns"
        columnNames={['Tag', 'Tagged Items', 'Revenue Inflow', 'Expense Outflow', 'Net Financial Impact']}
        exportConfig={{
          filename: 'tag-breakdown.csv',
          label: 'Export CSV',
          headers: ['Tag', 'Tagged Items', 'Revenue Inflow', 'Expense Outflow', 'Net Financial Impact'],
          mapRow: row => [row.tag, row.count, csvMoney(row.incomeCents), csvMoney(row.expenseCents), csvMoney(row.netCents)],
        }}
        emptyState={<EmptyState title="No tagged transactions in this period" description="Try a wider period, or tag some transactions first." />}
        filteredEmptyState={<EmptyState title="No tag matches your search" description="Try another word." />}
      />
    </div>
  );
};

export default TagBreakdownReportView;
