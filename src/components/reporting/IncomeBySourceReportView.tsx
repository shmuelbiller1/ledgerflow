import { ReportInputBoundary } from './ReportInputBoundary';
import React, { useMemo } from 'react';
import { formatCurrency } from '../../lib/utils';
import { useServerIncomeBySource } from '../../hooks/useServerIncomeBySource';
import { AccountReportResult } from './AccountReportResult';
import { TrendingUp } from 'lucide-react';
import { TanStackDataGrid } from '../ui/TanStackDataGrid';
import { EmptyState } from '../ui/EmptyState';
import { csvMoney } from '../../lib/csvExport';
import type { ColumnDef } from '@tanstack/react-table';
import { useReportText } from './useReportText';
import { percentWidthStyle } from '../../lib/percentBar';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

const LoadedReport: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const reportText = useReportText();
  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4e: with the loaded lists capped, the breakdown comes from the server (every entry of the range)
  const { sources: breakdowns, ...read } = useServerIncomeBySource(start, end);

  /** One row per customer or source: how much came in, and what share of the period it is. */
  const columns: ColumnDef<(typeof breakdowns)[number], unknown>[] = [
    { id: 'source', accessorFn: row => row.source, header: reportText('r.customer-revenue-source', 'Customer / Revenue Source'), cell: info => (
      <span className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
        <bdi>{String(info.getValue())}</bdi>
      </span>
    ) },
    { id: 'count', accessorFn: row => row.transactionCount, header: reportText('r.invoices-entries', 'Invoices / Entries'), cell: info => <span className="font-mono">{String(info.getValue())}</span> },
    { id: 'share', accessorFn: row => row.percentage, header: reportText('r.revenue-contribution', 'Revenue Contribution'), cell: info => (
      <span className="flex items-center justify-end gap-2">
        <span className="w-24 bg-neutral-100 rounded-full h-1.5 overflow-hidden" aria-hidden="true">
          <span className="block bg-emerald-500 h-full rounded-full" style={percentWidthStyle(info.getValue())} />
        </span>
        <span className="font-mono w-12 text-right">{Number(info.getValue()).toFixed(1)}%</span>
      </span>
    ) },
    { id: 'total', accessorFn: row => row.totalAmountCents, header: reportText('r.total-inflow', 'Total Inflow'), cell: info => <span className="font-mono font-semibold text-emerald-600">{formatCurrency(Number(info.getValue()))}</span> },
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
            {reportText('r.income-by-source-customer', 'Income by Source & Customer')}
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            {reportText('r.concentration-and-revenue-generation-breakdown-a', 'Concentration and revenue generation breakdown across clients, revenue channels, and payees.')}
          </p>
        </div>
        {read.source !== 'loaded-incomplete' && <div className="text-right">
          <div className="text-xs text-neutral-500 uppercase font-semibold">{reportText('r.total-revenue', 'Total Revenue')}</div>
          <div className="text-lg font-mono font-bold text-emerald-600">
            {formatCurrency(totalIncomeCents)}
          </div>
        </div>}
      </div>

      <AccountReportResult read={read} testId="income-source-source" hasRows={breakdowns.length > 0}>
        <TanStackDataGrid
          caption={reportText('r.income-by-source-caption', 'Income by source')}
          data={breakdowns}
          columns={columns}
          rowHeaderColumn="source"
          pageSize={25}
          searchPlaceholder={reportText('r.search-customers-and-sources', 'Search customers and sources...')}
          searchLabel="Search customers and sources"
          columnScope="report-income-by-source"
          columnLabel="Income by source columns"
          columnNames={['Customer / Revenue Source', 'Invoices / Entries', 'Revenue Contribution', 'Total Inflow']}
          exportConfig={read.source === 'loaded-incomplete' ? undefined : {
            filename: 'income-by-source.csv',
            label: reportText('r.export-csv', 'Export CSV'),
            headers: ['Customer / Revenue Source', 'Invoices / Entries', 'Share of inflow %', 'Total Inflow'],
            mapRow: row => [row.source, row.transactionCount, row.percentage.toFixed(1), csvMoney(row.totalAmountCents)],
          }}
          emptyState={<EmptyState title={reportText('r.no-income-in-this-period', 'No income in this period')} description={reportText('r.try-a-wider-period', 'Try a wider period.')} />}
          filteredEmptyState={<EmptyState title={reportText('r.no-source-matches-your-search', 'No source matches your search')} description={reportText('r.try-another-customer-name', 'Try another customer name.')} />}
        />
      </AccountReportResult>
    </div>
  );
};

export function IncomeBySourceReportView(props: Props) {
  return <ReportInputBoundary><LoadedReport {...props} /></ReportInputBoundary>;
}

export default IncomeBySourceReportView;
