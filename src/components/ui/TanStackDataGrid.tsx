import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  ColumnDef,
  flexRender,
  SortingState,
  PaginationState,
  Cell,
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
import { flushSync } from 'react-dom';
import { downloadCsv, type CsvValue } from '../../lib/csvExport';
import { useCompactViewport } from '../../lib/useCompactViewport';
import { isRowNavKey, nextRowId, rowAnnouncement } from '../../lib/rowKeyboardNav';
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
  /**
   * The id of the column that names each row. It is drawn as a row header (`<th scope="row">`) and is
   * never hidden by the column chooser, so a screen reader always has a name for the row it is in —
   * the rule `table-a11y-guard` enforces. Off by default: a list whose rows are named by a button or a
   * link keeps plain cells.
   */
  rowHeaderColumn?: string;
  /**
   * A totals row under the body (`<tfoot>`), for lists whose last line is a sum. `colSpan` fills the
   * columns to its left, so the total lines up with the column it totals. Because it is drawn by the
   * grid it survives the column chooser (a hidden column hides the same index in the footer) and it
   * disappears with the empty state, which is what a report wants.
   */
  totals?: { label: string; value: React.ReactNode; columnsBefore?: number };
  /**
   * What the keyboard's live region says when the highlight lands on a row ("Row 3 of 12: Invoice
   * 1042, Acme Corp"). Without it the row is announced by position only.
   */
  announceRow?: (row: TData) => string;
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
  announceRow,
  rowHeaderColumn,
  totals,
  mobileLayout = 'cards',
  renderCard,
  hidePaginationOnSinglePage = false,
}: TanStackDataGridProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  /**
   * Pagination state, with the page size derived rather than copied: a screen that shows more rows ('Show
   * more bills') raises `pageSize`, and the reader must stay on a page that holds the rows just added. Copying
   * the prop into state on mount only (TanStack's `initialState`) left the page at the old size, so the extra
   * rows went to a later page nobody turned to. A size the reader picks in the page-size control still wins,
   * until the screen changes its own page size again.
   */
  const [pageIndex, setPageIndex] = useState(0);
  const [pickedSize, setPickedSize] = useState<{ size: number; forProp: number } | null>(null);
  const pageSizeInForce = pickedSize && pickedSize.forProp === pageSize ? pickedSize.size : pageSize;
  const pagination: PaginationState = { pageIndex, pageSize: pageSizeInForce };
  const setPagination = (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater;
    setPageIndex(next.pageIndex);
    setPickedSize(next.pageSize === pageSize ? null : { size: next.pageSize, forProp: pageSize });
  };
  /**
   * Printing carries every row, not the page on screen. A report's totals line up with the rows above it
   * only if both are whole, and the paging controls are already hidden on paper. `flushSync` because the
   * browser takes the page immediately after `beforeprint`, before a queued render.
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const before = () => flushSync(() => setPrinting(true));
    // also synchronous: the reader is back on their page the moment printing ends, not a render later
    const after = () => flushSync(() => setPrinting(false));
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  const [internalFilter, setInternalFilter] = useState('');
  const [internalSelection, setInternalSelection] = useState<Set<string>>(() => new Set());
  const isCompact = useCompactViewport();

  /**
   * The row the keyboard is on, by record id. The highlight is logical because only the rows on the
   * current page are drawn: the arrow keys move it and the row that holds it scrolls into view. Rows
   * are not tab stops of their own — the list is one focusable region — so a person tabbing through
   * the page meets the list once, and Tab can always leave it.
   */
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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

  /**
   * The totals row lands on the column it totals: `columnsBefore` columns are filled to its left (the
   * label sits in them), the value is the next one, and any columns after it are filled so the row is
   * as wide as the table. Clamped, so a totals row can never widen the table past its columns.
   */

  /**
   * The column chooser's index of the row header, which it must leave visible: hiding the column that
   * names a row leaves every row without its name, and on a report without its only button.
   */
  const rowHeaderLocked = useMemo(() => {
    if (rowHeaderColumn === undefined) return undefined;
    const at = columns.findIndex(column => column.id === rowHeaderColumn);
    return at < 0 ? undefined : [at + (selectable ? 1 : 0)];
  }, [rowHeaderColumn, columns, selectable]);

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

  /**
   * A cell is rendered by calling its function, not by making the function an element type.
   *
   * `flexRender` builds `element(cellFn, context)`, so React compares the *function's identity*: a screen that
   * rebuilds its column list (its handlers come fresh from a hook) hands over a new function each render, React
   * sees a new component type and remounts the cell — and with it the row's buttons. The remount is what lost
   * the opener button's focus when Escape closed the invoice or bill dialog (A-259): the button the dialog
   * remembered was no longer in the document, so focus fell to the body.
   *
   * Calling the function returns its elements directly, so React reconciles the buttons themselves and the DOM
   * node survives. No cell in the app uses hooks, which is what makes this safe; a cell that did would need to
   * become a named component instead.
   */
  const isRowHeader = (cell: Cell<TData, unknown>) => rowHeaderColumn !== undefined && cell.column.id === rowHeaderColumn;

  const renderCellContent = (cell: Cell<TData, unknown>) => {
    const content = cell.column.columnDef.cell;
    return typeof content === 'function'
      ? (content(cell.getContext()) as React.ReactNode)
      : flexRender(content, cell.getContext());
  };

  const table = useGridTable({
    data,
    columns: allColumns,
    state: {
      sorting,
      globalFilter: manualFilter ? '' : activeSearch,
      pagination,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: handleSearchUpdate,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });


  const filteredRows = table.getFilteredRowModel().rows;
  // printing draws the whole list *as the reader sorted it*: the pre-pagination row model carries the
  // sort and the filter, while `filteredRows` (the filter model) would print the rows unsorted
  const visibleRows = printing ? table.getPrePaginationRowModel().rows : table.getRowModel().rows;
  /**
   * The totals row, built from the cells the body actually draws.
   *
   * One cell per drawn column and no colspans, on purpose: the column chooser hides a column with
   * `:nth-child` on each section and deliberately skips rows that contain a `[colspan]` cell, so a
   * spanned footer would keep a hidden column's width and put the total under the wrong heading. A
   * cell-per-column footer is hidden in step with the body it sums.
   */
  const totalsRow = useMemo(() => {
    if (!totals || filteredRows.length === 0) return null;
    const drawnIds = table.getVisibleLeafColumns().map(column => column.id);
    // `columnsBefore` counts the caller's own columns, so the tick column the grid prepends is added on
    const offset = selectable ? 1 : 0;
    const valueAt = Math.min(Math.max(offset + (totals.columnsBefore ?? columns.length - 1), 0), drawnIds.length - 1);
    return (
      <tfoot className="border-t border-[var(--line)]">
        <tr className="font-semibold">
          {drawnIds.map((id, index) => {
            if (index === valueAt) return <td key={id} className="px-4 py-3 text-xs text-[var(--text)] tabular-nums">{totals.value}</td>;
            if (index === 0) return <th key={id} scope="row" className="px-4 py-3 text-xs text-start">{totals.label}</th>;
            return <td key={id} className="px-4 py-3" />;
          })}
        </tr>
      </tfoot>
    );
  }, [totals, filteredRows, table, selectable, columns.length]);

  const pageCount = table.getPageCount() || 1;

  const rowIds = useMemo(() => visibleRows.map(row => resolveRowId(row.original as TData, row.index)), [visibleRows, resolveRowId]);
  const activeRowVisible = activeRowId !== null && rowIds.includes(activeRowId);

  // U-1: while the list holds focus, the arrow keys move the highlight and Home/End jump to the ends;
  // Tab is never taken, so the list can always be left, and keys pressed in a control inside a row (a
  // button, a link, a tick box) belong to that control.
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== node && target.closest('button, input, select, textarea, a, [contenteditable="true"], [role="menu"], [role="listbox"]')) return;
      if (!isRowNavKey(event.key)) return;
      const next = nextRowId(rowIds.map(id => ({ id })), activeRowId, event.key);
      if (next === null) return;
      event.preventDefault();
      setActiveRowId(next);
      node.querySelector(`[data-grid-row-keyboard="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
    // `showCards` is a dependency because the region element itself changes: the cards and the table are
    // two different nodes, so a viewport crossing the breakpoint must re-attach the listener to the new one
  }, [rowIds, activeRowId, showCards]);

  const rowKeyboardProps = (id: string) => ({
    'data-grid-row-keyboard': id,
    'data-grid-active-row': activeRowVisible && activeRowId === id ? 'true' : undefined,
  });

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
              <ListColumnChooser
                scope={columnScope}
                label={columnLabel}
                columns={columnNames}
                lockedColumns={rowHeaderLocked}
              />
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

      {/* One polite live region for the whole list: which row the keyboard is on. It is mounted as soon
          as there are rows and stays mounted, because a live region that appears already holding text is
          not announced — the text has to change while the region is in the page. It carries aria-live
          rather than role="status" so it is not confused with a screen's own status notices. */}
      {rowIds.length > 0 && (
        <p
          data-grid-live-region
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {activeRowVisible && activeRowId !== null
            ? rowAnnouncement(rowIds.map(id => ({ id })), activeRowId, (row, index) => (announceRow ? announceRow(row) : `Row ${index + 1}`), visibleRows.map(row => row.original as TData))
            : ''}
        </p>
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
            <div ref={gridRef} role="region" aria-label={caption} tabIndex={0} className="space-y-3 outline-none rounded-2xl">{/* NOSONAR: S6845 — tabIndex on scrollable region is the intentional axe scrollable-region-focusable pattern */}
            <div role="list" className="space-y-3">
              {visibleRows.map(row => {
                const extra = getRowProps ? getRowProps(row.original) : {};
                const rowId = resolveRowId(row.original as TData, row.index);
                return (
                  <div
                    key={row.id}
                    id={extra.id}
                    {...rowKeyboardProps(rowId)}
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
                                {renderCellContent(cell)}
                              </div>
                            );
                          }
                          const header = cell.column.columnDef.header;
                          const label = typeof header === 'string' ? header : cell.column.id;
                          return (
                            <div key={cell.id} className="flex items-start justify-between gap-3 text-xs">
                              <span className="text-[var(--muted)] font-semibold shrink-0">{label}</span>
                              <div className="text-right text-[var(--text)] min-w-0">
                                {renderCellContent(cell)}
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
            </div>
          )}
          {totals && filteredRows.length > 0 && (
            /* the card layout is the phone layout, and a report's summary belongs there too */
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--elevated)] px-4 py-3 text-xs font-semibold">
              <span className="text-[var(--muted)]">{totals.label}</span>
              <span className="tabular-nums text-[var(--text)]" data-grid-total>{totals.value}</span>
            </div>
          )}
          {filteredRows.length > 0 && cardFooterContent}
        </div>
      ) : (
        <div
          ref={gridRef}
          role="region"
          aria-label={caption}
          tabIndex={0}
          className="lg:overflow-auto lg:max-h-[70vh] print:max-h-none print:overflow-visible border border-[var(--line)] rounded-2xl bg-[var(--surface)] shadow-2xs focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
        >
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
                            data-grid-sort-header
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
                  const rowId = resolveRowId(row.original as TData, row.index);
                  return (
                    <tr
                      key={row.id}
                      id={extra.id}
                      data-record-id={extra['data-record-id']}
                      data-grid-row
                      {...rowKeyboardProps(rowId)}
                      onClick={event => {
                        const target = event.target as HTMLElement;
                        if (target.closest('button, input, select, textarea, a')) return;
                        setActiveRowId(rowId);
                        gridRef.current?.focus({ preventScroll: true });
                      }}
                      className={cn(
                        'hover:bg-[var(--elevated)]/60 transition-colors',
                        activeRowVisible && activeRowId === rowId && 'bg-[var(--elevated)]/70',
                        extra.className,
                      )}
                    >
                      {row.getVisibleCells().map(cell =>
                        isRowHeader(cell) ? (
                          <th
                            key={cell.id}
                            scope="row"
                            className="px-4 py-3 text-xs text-[var(--text)] font-medium text-start"
                          >
                            {renderCellContent(cell)}
                          </th>
                        ) : (
                          <td key={cell.id} className="px-4 py-3 text-xs text-[var(--text)] font-medium">
                            {renderCellContent(cell)}
                          </td>
                        ),
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {totalsRow}
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
