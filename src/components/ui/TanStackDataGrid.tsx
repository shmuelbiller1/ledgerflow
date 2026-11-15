import React, { useCallback, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  ColumnDef,
  flexRender,
  SortingState,
} from '@tanstack/react-table';
import {
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { downloadCsv, type CsvValue } from '../../lib/csvExport';
import { useCompactViewport } from '../../lib/useCompactViewport';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';
import ListColumnChooser from './ListColumnChooser';
import SavedViewsBar from './SavedViewsBar';

export interface DataGridExportConfig<TData> {
  filename: string;
  headers: string[];
  mapRow: (row: TData) => CsvValue[];
  label?: string;
}

export interface DataGridRowProps {
  id?: string;
  className?: string;
  'data-record-id'?: string;
}

export interface TanStackDataGridProps<TData extends object> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  pageSize?: number;
  pageSizeOptions?: number[];
  searchPlaceholder?: string;
  searchLabel?: string;
  enableGlobalFilter?: boolean;
  /** Controlled search string (used with external multi-field filtering). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Skip TanStack's built-in text filter when the parent already filtered `data`. */
  manualFilter?: boolean;
  /** Underlying total row count before filters; 0 triggers U-3 empty state (hides headers & tools). */
  totalCount?: number;
  /** Text direction inherited or overridden explicitly for RTL locales. */
  dir?: 'ltr' | 'rtl' | 'auto';
  /** Read out by screen readers as the table's name (E-05). */
  caption?: string;
  loading?: boolean;
  loadingWhat?: string;
  loadingState?: React.ReactNode;
  emptyState?: React.ReactNode;
  filteredEmptyState?: React.ReactNode;
  toolbarExtra?: React.ReactNode;
  showSavedViews?: boolean;
  columnScope?: string;
  columnLabel?: string;
  columnNames?: string[];
  exportConfig?: DataGridExportConfig<TData>;
  selectable?: boolean;
  getRowId?: (row: TData, index: number) => string;
  selectedIds?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
  selectAllLabel?: string;
  selectRowLabel?: (row: TData) => string;
  bulkActions?: React.ReactNode;
  selectionSummary?: (selectedRows: TData[]) => React.ReactNode;
  footerContent?: React.ReactNode;
  cardFooterContent?: React.ReactNode;
  afterTable?: React.ReactNode;
  getRowProps?: (row: TData) => DataGridRowProps;
  mobileLayout?: 'cards' | 'table';
  renderCard?: (row: TData) => React.ReactNode;
  hidePaginationOnSinglePage?: boolean;
}

const useGridTable = useReactTable;

export function TanStackDataGrid<TData extends object>({
  data,
  columns,
  pageSize = 15,
  pageSizeOptions = [10, 15, 25, 50, 100],
  searchPlaceholder = 'Search records...',
  searchLabel,
  enableGlobalFilter = true,
  searchValue,
  onSearchChange,
  manualFilter = false,
  totalCount,
  dir,
  caption = 'Data table',
  loading = false,
  loadingWhat = 'records',
  loadingState,
  emptyState,
  filteredEmptyState,
  toolbarExtra,
  showSavedViews = false,
  columnScope,
  columnLabel,
  columnNames,
  exportConfig,
  selectable = false,
  getRowId,
  selectedIds,
  onSelectionChange,
  selectAllLabel = 'Select all rows shown',
  selectRowLabel = () => 'Select row',
  bulkActions,
  selectionSummary,
  footerContent,
  cardFooterContent,
  afterTable,
  getRowProps,
  mobileLayout = 'cards',
  renderCard,
  hidePaginationOnSinglePage = false,
}: TanStackDataGridProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalFilter, setInternalFilter] = useState('');
  const [internalSelection, setInternalSelection] = useState<Set<string>>(() => new Set());
  const isCompact = useCompactViewport();

  const isControlledSearch = searchValue !== undefined;
  const activeSearch = isControlledSearch ? searchValue : internalFilter;
  const handleSearchUpdate = (next: string) => {
    if (onSearchChange) onSearchChange(next);
    if (!isControlledSearch) setInternalFilter(next);
  };

  const activeSelection = selectedIds ?? internalSelection;
  const updateSelection = useCallback((next: Set<string>) => {
    if (onSelectionChange) onSelectionChange(next);
    if (selectedIds === undefined) setInternalSelection(next);
  }, [onSelectionChange, selectedIds]);

  const resolveRowId = useMemo(
    () => getRowId ?? ((row: TData, idx: number) => ('id' in row && typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : String(idx))),
    [getRowId],
  );

  const effectiveTotalCount = totalCount ?? data.length;
  const showCards = mobileLayout === 'cards' && isCompact;

  const pageRowsIds = useMemo(() => data.map((row, idx) => resolveRowId(row, idx)), [data, resolveRowId]);
  const selectedRows = useMemo(
    () => data.filter((row, idx) => activeSelection.has(resolveRowId(row, idx))),
    [data, activeSelection, resolveRowId],
  );

  const allColumns = useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!selectable) return columns;
    const allVisibleSelected = pageRowsIds.length > 0 && pageRowsIds.every(id => activeSelection.has(id));
    const selectionCol: ColumnDef<TData, unknown> = {
      id: '__select__',
      enableSorting: false,
      enableGlobalFilter: false,
      header: () => (
        <input
          type="checkbox"
          aria-label={selectAllLabel}
          checked={allVisibleSelected}
          onChange={e => {
            if (e.target.checked) updateSelection(new Set(pageRowsIds));
            else updateSelection(new Set());
          }}
        />
      ),
      cell: ({ row }) => {
        const id = resolveRowId(row.original, row.index);
        return (
          <input
            type="checkbox"
            aria-label={selectRowLabel(row.original)}
            checked={activeSelection.has(id)}
            onChange={e => {
              const next = new Set(activeSelection);
              if (e.target.checked) next.add(id);
              else next.delete(id);
              updateSelection(next);
            }}
          />
        );
      },
    };
    return [selectionCol, ...columns];
  }, [selectable, columns, pageRowsIds, activeSelection, selectAllLabel, selectRowLabel, resolveRowId, updateSelection]);

  const table = useGridTable({
    data,
    columns: allColumns,
    state: {
      sorting,
      globalFilter: manualFilter ? '' : activeSearch,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: handleSearchUpdate,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  const filteredRows = table.getFilteredRowModel().rows;
  const visibleRows = table.getRowModel().rows;
  const pageCount = table.getPageCount() || 1;
  const showPagination = !hidePaginationOnSinglePage || pageCount > 1 || data.length > pageSize;

  const wrapWithColumnScope = (node: React.ReactNode) =>
    columnScope ? (
      <div data-list-columns={columnScope} dir={dir} className="w-full max-w-full overflow-x-auto">
        {node}
      </div>
    ) : (
      <div dir={dir} className="w-full max-w-full">
        {node}
      </div>
    );

  // U-3: When loading with zero records yet, show skeleton loading without empty headers/tools.
  if (loading && effectiveTotalCount === 0) {
    return wrapWithColumnScope(loadingState ?? <LoadingState what={loadingWhat} />);
  }

  // U-3: Truly empty list hides search, filters, column chooser, export, totals, and column headers.
  if (effectiveTotalCount === 0) {
    return wrapWithColumnScope(
      emptyState ?? (
        <EmptyState
          title="Nothing here yet"
          description="Records you add will appear in this list."
        />
      ),
    );
  }

  const hasToolbar = enableGlobalFilter || Boolean(toolbarExtra) || showSavedViews || Boolean(columnScope && columnNames?.length) || Boolean(exportConfig);

  return wrapWithColumnScope(
    <div className="space-y-4">
      {hasToolbar && (
        <div data-print-hide className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            {enableGlobalFilter && (
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={15} />
                <input
                  aria-label={searchLabel || searchPlaceholder || 'Search table'}
                  type="text"
                  value={activeSearch}
                  onChange={e => handleSearchUpdate(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full min-h-11 md:min-h-9 pl-9 pr-3 py-1.5 bg-[var(--surface)] border border-[var(--line)] rounded-xl text-xs font-medium text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                />
              </div>
            )}
            {toolbarExtra}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showSavedViews && <SavedViewsBar currentSearchTerm={activeSearch} compact />}
            {columnScope && columnLabel && columnNames && columnNames.length > 0 && (
              <ListColumnChooser scope={columnScope} label={columnLabel} columns={columnNames} />
            )}
            {exportConfig && (
              <button
                type="button"
                onClick={() => downloadCsv(exportConfig.filename, exportConfig.headers, filteredRows.map(r => exportConfig.mapRow(r.original)))}
                className="inline-flex min-h-11 md:min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-semibold text-[var(--text)] hover:bg-[var(--elevated)] transition-colors"
              >
                <Download aria-hidden="true" size={14} />
                <span>{exportConfig.label || 'Export CSV'}</span>
              </button>
            )}
            <span className="text-xs text-[var(--muted)] font-medium tabular-nums">
              Showing {visibleRows.length} of {filteredRows.length} entries
            </span>
          </div>
        </div>
      )}

      {selectable && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {selectionSummary && (
            <div className="text-xs font-semibold text-[var(--text)]">{selectionSummary(selectedRows)}</div>
          )}
          {bulkActions}
        </div>
      )}

      {showCards ? (
        <div className="space-y-3">
          {visibleRows.length === 0 ? (
            filteredEmptyState ?? (
              <div className="px-4 py-8 text-center text-xs text-[var(--muted)] font-medium rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
                No records found matching query
              </div>
            )
          ) : (
            <div role="list" aria-label={caption} className="space-y-3">
              {visibleRows.map(row => {
                const extra = getRowProps ? getRowProps(row.original) : {};
                return (
                  <div
                    key={row.id}
                    id={extra.id}
                    data-record-id={extra['data-record-id']}
                    data-grid-row
                    role="listitem"
                    className={cn(
                      'p-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xs space-y-2',
                      extra.className,
                    )}
                  >
                    {renderCard ? (
                      renderCard(row.original)
                    ) : (
                      <div className="space-y-2">
                        {row.getVisibleCells().map(cell => {
                          if (cell.column.id === '__select__') {
                            return (
                              <div key={cell.id} className="flex items-center justify-between">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            );
                          }
                          const header = cell.column.columnDef.header;
                          const label = typeof header === 'string' ? header : cell.column.id;
                          return (
                            <div key={cell.id} className="flex items-start justify-between gap-3 text-xs">
                              <span className="text-[var(--muted)] font-semibold shrink-0">{label}</span>
                              <div className="text-right text-[var(--text)] min-w-0">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {filteredRows.length > 0 && cardFooterContent}
        </div>
      ) : (
        <div role="region" aria-label={caption} tabIndex={0} className="overflow-auto max-h-[70vh] print:max-h-none print:overflow-visible border border-[var(--line)] rounded-2xl bg-[var(--surface)] shadow-2xs">
          <table className="w-full text-start border-collapse">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id} className="bg-[var(--ink)] border-b border-[var(--line)]">
                  {headerGroup.headers.map(header => {
                    const canSort = header.column.getCanSort();
                    const sortState = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        aria-sort={
                          canSort
                            ? sortState
                              ? sortState === 'desc'
                                ? 'descending'
                                : 'ascending'
                              : 'none'
                            : undefined
                        }
                        className="px-4 py-3 text-xs font-bold text-[var(--muted)] uppercase tracking-wider select-none hover:bg-[var(--elevated)] transition-colors"
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex items-center gap-1.5 uppercase font-bold tracking-wider cursor-pointer text-[var(--text)]"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {{
                              asc: <ChevronUp aria-hidden="true" size={13} className="text-indigo-600" />,
                              desc: <ChevronDown aria-hidden="true" size={13} className="text-indigo-600" />,
                            }[sortState as string] ?? null}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={allColumns.length} className="px-4 py-8 text-center text-xs text-[var(--muted)] font-medium">
                    {filteredEmptyState ?? 'No records found matching query'}
                  </td>
                </tr>
              ) : (
                visibleRows.map(row => {
                  const extra = getRowProps ? getRowProps(row.original) : {};
                  return (
                    <tr
                      key={row.id}
                      id={extra.id}
                      data-record-id={extra['data-record-id']}
                      data-grid-row
                      className={cn(
                        'hover:bg-[var(--elevated)]/60 transition-colors',
                        extra.className,
                      )}
                    >
                      {row.getVisibleCells().map(cell => (
                        <td key={cell.id} className="px-4 py-3 text-xs text-[var(--text)] font-medium">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredRows.length > 0 && footerContent}
          </table>
        </div>
      )}

      {showPagination && (
        <div data-print-hide className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="First page"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="p-2 min-h-11 min-w-11 md:min-h-8 md:min-w-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 rounded-lg hover:bg-[var(--elevated)] cursor-pointer"
            >
              <ChevronsLeft aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-2 min-h-11 min-w-11 md:min-h-8 md:min-w-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 rounded-lg hover:bg-[var(--elevated)] cursor-pointer"
            >
              <ChevronLeft aria-hidden="true" size={16} />
            </button>
            <span className="px-3 text-xs font-bold text-[var(--text)] tabular-nums">
              Page {table.getState().pagination.pageIndex + 1} of {pageCount}
            </span>
            <button
              type="button"
              aria-label="Next page"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-2 min-h-11 min-w-11 md:min-h-8 md:min-w-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 rounded-lg hover:bg-[var(--elevated)] cursor-pointer"
            >
              <ChevronRight aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              aria-label="Last page"
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
              className="p-2 min-h-11 min-w-11 md:min-h-8 md:min-w-8 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 rounded-lg hover:bg-[var(--elevated)] cursor-pointer"
            >
              <ChevronsRight aria-hidden="true" size={16} />
            </button>
          </div>

          <select
            aria-label="Rows per page"
            value={table.getState().pagination.pageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
            className="px-2.5 py-1.5 bg-[var(--surface)] border border-[var(--line)] rounded-lg text-xs font-semibold text-[var(--text)] focus:outline-none"
          >
            {pageSizeOptions.map(size => (
              <option key={size} value={size}>
                Show {size} rows
              </option>
            ))}
          </select>
        </div>
      )}
      {afterTable}
    </div>,
  );
}
