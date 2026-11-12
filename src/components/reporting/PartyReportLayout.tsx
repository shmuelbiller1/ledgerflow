import React from 'react';
import { Download, Search, LucideIcon } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { ShowMoreRows } from '../common/ShowMoreRows';
import { usePagedRows } from '../../hooks/usePagedRows';

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render?: (item: T) => React.ReactNode;
}

export interface PartyReportLayoutProps<T> {
  title: string;
  description: string;
  icon: LucideIcon;
  totalLabel: string;
  totalAmountCents: number;
  /** shown instead of the amount when the total is not known (never a made-up 0) */
  totalDisplay?: string;
  secondaryTotalLabel?: string;
  secondaryTotalCents?: number;
  exportFilename: string;
  onExportCSV: () => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  asOfDate?: string;
  onAsOfDateChange?: (val: string) => void;
  startDate?: string;
  endDate?: string;
  onStartDateChange?: (val: string) => void;
  onEndDateChange?: (val: string) => void;
  columns: ColumnDef<T>[];
  data: T[];
  emptyMessage?: string;
  getRowId?: (item: T, index: number) => string;
  /** Columns (cents) to total in a footer row over the rows shown, e.g. ['balanceCents'] (I-14) */
  sumKeys?: Array<keyof T & string>;
}

export function PartyReportLayout<T>({
  title,
  description,
  icon: Icon,
  totalLabel,
  totalAmountCents,
  totalDisplay,
  secondaryTotalLabel,
  secondaryTotalCents,
  onExportCSV,
  searchTerm,
  onSearchChange,
  searchPlaceholder = 'Search...',
  asOfDate,
  onAsOfDateChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  columns,
  data,
  emptyMessage = 'No records found matching criteria.',
  getRowId = (_, i) => String(i),
  sumKeys = [],
}: PartyReportLayoutProps<T>) {
  // R-5: a year of rows draws its first page at once; the footer totals and the export keep every row
  const paged = usePagedRows(data, `${startDate || ''}|${endDate || ''}|${asOfDate || ''}|${searchTerm || ''}`);
  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-5">
        <div>
          <h2 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2.5">
            <Icon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            {title}
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-2xl">
            {description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-4 py-2 rounded-xl">
            <div className="text-[10px] uppercase font-bold tracking-wider text-neutral-500 dark:text-neutral-400">
              {totalLabel}
            </div>
            <div className="text-base font-mono font-bold text-neutral-900 dark:text-white">
              {totalDisplay ?? formatCurrency(totalAmountCents)}
            </div>
          </div>

          {secondaryTotalLabel && secondaryTotalCents !== undefined && (
            <div className="text-right bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-4 py-2 rounded-xl">
              <div className="text-[10px] uppercase font-bold tracking-wider text-neutral-500 dark:text-neutral-400">
                {secondaryTotalLabel}
              </div>
              <div className="text-base font-mono font-bold text-emerald-700 dark:text-emerald-400">
                {formatCurrency(secondaryTotalCents)}
              </div>
            </div>
          )}

          <button
            onClick={onExportCSV}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl flex items-center gap-2 text-xs shadow-sm transition-colors cursor-pointer"
          >
            <Download aria-hidden="true" className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input aria-label={searchPlaceholder || "Search report"}
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {onAsOfDateChange && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500 text-[11px] font-semibold uppercase">As of Date:</span>
            <input aria-label="As of Date"
              type="date"
              value={asOfDate || ''}
              onChange={(e) => onAsOfDateChange(e.target.value)}
              className="px-2.5 py-1 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-neutral-900 dark:text-white"
            />
          </div>
        )}

        {onStartDateChange && onEndDateChange && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500 text-[11px] font-semibold uppercase">From:</span>
            <input aria-label="From date"
              type="date"
              value={startDate || ''}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="px-2.5 py-1 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-neutral-900 dark:text-white"
            />
            <span className="text-neutral-500 text-[11px] font-semibold uppercase">To:</span>
            <input aria-label="To date"
              type="date"
              value={endDate || ''}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="px-2.5 py-1 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg text-neutral-900 dark:text-white"
            />
          </div>
        )}
      </div>

      {/* Report Table */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden shadow-xs">
        {/* the table scrolls inside its box so the header (and totals) stay in view (I-14) */}
        <div role="region" aria-label="Scrollable party report" tabIndex={0} className="overflow-auto max-h-[70vh] print:max-h-none print:overflow-visible">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`px-4 py-3 ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    } ${col.className || ''}`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-10 text-neutral-400 text-xs">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                paged.visible.map((item, index) => {
                  const rowKey = getRowId(item, index);
                  return (
                    <tr
                      key={rowKey}
                      className="hover:bg-neutral-50/60 dark:hover:bg-neutral-800/40 transition-colors"
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-4 py-3 ${
                            col.align === 'right'
                              ? 'text-right font-mono'
                              : col.align === 'center'
                              ? 'text-center'
                              : 'text-left'
                          } ${col.className || ''}`}
                        >
                          {col.render ? col.render(item) : String((item as Record<string, unknown>)[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            {sumKeys.length > 0 && data.length > 0 && (
              <tfoot className="sticky bottom-0 bg-neutral-50 dark:bg-neutral-800 border-t-2 border-neutral-300 dark:border-neutral-700 font-bold text-neutral-900 dark:text-white">
                <tr>
                  {columns.map((col, i) => (
                    <td key={col.key} className={`px-4 py-3 ${col.align === 'right' ? 'text-right font-mono' : col.align === 'center' ? 'text-center' : 'text-left'}`}>
                      {(sumKeys as string[]).includes(col.key)
                        ? formatCurrency(data.reduce((sum, item) => sum + (Number((item as Record<string, unknown>)[col.key]) || 0), 0))
                        : i === 0 ? `Total (${data.length})` : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          <ShowMoreRows shown={paged.visible.length} total={paged.total} noun="rows" onMore={paged.more} onAll={paged.all} />
        </div>
      </div>
    </div>
  );
}
