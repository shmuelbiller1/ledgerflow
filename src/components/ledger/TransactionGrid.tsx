import { TransactionGridView } from './TransactionGridView';
import { currentIdentity, useAuthStore } from '../../stores/useAuthStore';
import { identityScope } from '../../lib/serverAction';

import React, { useId, useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Transaction, FilterCriteria } from '../../types';

import { toast } from 'sonner';

import { gridTemplate, gridTracks, orderedGridTracks } from '../../lib/transactionColumns';
import { gridFields, reconcileGridFocus, type GridFocus } from '../../lib/ledgerGridNav';
import { listStateFromParams, listStateToParams, replaceSearchParams } from '../../lib/listPermalink';
import { useTransactionColumnLayout } from '../../hooks/useTransactionColumnLayout';
import { resolveAccountName, formatCurrency, formatDate, getLocalDateISO } from '../../lib/utils';
import { csvMoney, downloadCsv } from '../../lib/csvExport';
import { isCashAccount, isInflow, isPostable, lineAmount } from '../../lib/txFilters';

import { useAuditTelemetry } from '../../hooks/useAuditTelemetry';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLedgerComputation } from '../../hooks/useLedgerComputation';
import { useTransactionActions } from '../../hooks/useTransactionActions';
import { useCommandDispatcher } from '../../hooks/useSystemContext';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import { MatchingEngine } from '../../lib/MatchingEngine';

import { useSavedViewsStore } from '../../stores/useSavedViewsStore';

import { useAutoRules } from '../../hooks/useAutoRules';
import { useRecordFocus } from '../../hooks/useRecordFocus';
import { VirtualRowProps } from './TransactionGridShared';
function useTransactionGridModel() {
  const formId = useId();
  const transactions = useLedgerStore(s => s.transactions);
  // search and date range can come from a shared link (?search=&from=&to=) and stay in the address (I-17)
  const [linkedList] = useState(() => listStateFromParams(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)));
  const filterCriteria = useUIStore(s => s.filterCriteria);
  useEffect(() => {
    if (linkedList.from || linkedList.to) {
      const current = useUIStore.getState().filterCriteria || {};
      useUIStore.getState().setFilterCriteria({ ...current, startDate: linkedList.from, endDate: linkedList.to });
    }
  }, [linkedList]);
  const onFilterApplied = useCallback((c: FilterCriteria) => useUIStore.getState().setFilterCriteria(c), []);
  const { handleAction: onAction } = useCommandDispatcher();
  const txActions = useTransactionActions();
  const { updateEntity, deleteEntity } = useEntityOperations();
  const onUpdate = useCallback((id: string, updates: Partial<Transaction>) => txActions?.handleUpdateTransaction ? txActions.handleUpdateTransaction(id, updates) : updateEntity('transactions', id, updates), [txActions, updateEntity]);
  const onVoid = useCallback((id: string) => deleteEntity('transactions', id), [deleteEntity]);
  const onNewEntry = () => { txActions.handleQuickAdd?.({}); onAction("quick-entry"); };
  const isProMode = useUIStore(s => s.isProMode);
  const isCompactMode = useUIStore(s => s.isCompactMode);
  const setProMode = useUIStore(s => s.setProMode);
  const setCompactMode = useUIStore(s => s.setCompactMode);

  const { saveRule } = useAutoRules();
  // "Create rule" from a row: future transactions with this description go to this row's account
  const onCreateRule = useCallback(async (tx: Transaction) => {
    if (!tx || !tx.description) return;
    const accountId = tx.lines?.[0]?.accountId;
    const accountName = tx.lines?.[0]?.accountName || 'Unassigned';
    if (!accountId) {
      toast.error('Pick an account for this transaction first; the rule sends matching ones there.');
      return;
    }
    const pattern = tx.description.trim();
    const saved = await saveRule({
      id: `rule_${Date.now()}_${tx.id.slice(-6)}`,
      uid: '',
      name: `Auto-categorize: ${pattern.slice(0, 30)}`,
      groupName: 'General',
      priority: 10,
      isActive: true,
      confidence: 1,
      isHardened: true,
      createdAt: new Date().toISOString(),
      condition: { descriptionContains: pattern },
      action: { targetNodeId: accountId },
    });
    if (saved) toast.success(`Rule saved: "${pattern.slice(0, 25)}" → ${accountName}`);
  }, [saveRule]);
  const dateFormat = 'MMM dd, yyyy';
  // Defensive array checks
  const safeTransactions = useMemo(() => Array.isArray(transactions) ? transactions : [], [transactions]);

  const [searchTerm, setSearchTerm] = useState(linkedList.search);
  useEffect(() => {
    replaceSearchParams(listStateToParams({ search: searchTerm, from: filterCriteria?.startDate, to: filterCriteria?.endDate }, new URLSearchParams(window.location.search)));
  }, [searchTerm, filterCriteria?.startDate, filterCriteria?.endDate]);
  // leaving the list: its filters leave the address too
  useEffect(() => () => replaceSearchParams(listStateToParams({}, new URLSearchParams(window.location.search))), []);
  const [viewMode, setViewMode] = useState<'grid' | 'pivot'>('grid');
  const [focusedCell, setFocusedCell] = useState<{ id: string, field: string, index: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string, field: string } | null>(null);
  const [editingDetailsTx, setEditingDetailsTx] = useState<Transaction | null>(null);
  const [isReverseModeModal, setIsReverseModeModal] = useState(false);
  // A record link (#transactions/transaction/<id>, e.g. from Data Health) opens that entry once it has loaded
  const focusedTxId = useRecordFocus('transaction', { ready: false });
  const [openedFocusId, setOpenedFocusId] = useState<string | null>(null);
  if (focusedTxId && openedFocusId !== focusedTxId) {
    const tx = safeTransactions.find(t => t.id === focusedTxId);
    if (tx) {
      // Open a loaded record link once, without an extra effect-driven render.
      setOpenedFocusId(focusedTxId);
      setEditingDetailsTx(tx);
    }
  }
  const lockDate = useLedgerStore(state => state.lockDate);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelectAll = () => {
    const rows = transactionsWithBalance;
    if (selectedIds.size === rows.length && rows.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.id)));
  };
  useRef<HTMLInputElement>(null);

  const parsingQueue = useUIStore(s => s.parsingQueue);
  const setParsingQueue = useUIStore(s => s.setParsingQueue);
  const splittingTxId = useUIStore(s => s.splittingTxId);
  const setSplittingTxId = useUIStore(s => s.setSplittingTxId);
  const accounts = useLedgerStore(state => state.accounts);
  const projects = useLedgerStore(state => state.projects);
  const { handleParseReceipt, handleToggleFlag, handleDuplicateTransaction } = useTransactionActions();
  const [dragActive, setDragActive] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        if (current.direction === 'asc') return { key, direction: 'desc' };
        return null;
      }
      return { key, direction: 'asc' };
    });
  };

  const splittingTransaction = useMemo(() =>
    splittingTxId ? safeTransactions.find(t => t.id === splittingTxId) : null
  , [splittingTxId, safeTransactions]);

  const activeViewId = useSavedViewsStore(s => s.activeViewId);
  const views = useSavedViewsStore(s => s.views);
  const activeView = views.find(v => v.id === activeViewId);

  // High-performance computation offloading
  const { smartFilteredTransactions, transactionsWithBalance, stats, conflicts: deterministicConflicts } = useLedgerComputation(safeTransactions, filterCriteria, searchTerm, accounts, sortConfig);

  const telemetry = useAuditTelemetry(
    safeTransactions,
    accounts,
    30
  );
  const anomaliesValues = telemetry.anomalies;

  const anomalyMap = useMemo(() => new Map(anomaliesValues.map((a) => [a.transactionId, a])), [anomaliesValues]);

  // High volume pre-computations
  // Debits minus credits over the listed entries: 0 when every entry balances. (It used to add up
  // the entries' totals, which are always positive, so it always said "imbalance".)
  const totalBalancedSum = useMemo(() => {
    let sum = 0;
    for (const t of transactionsWithBalance) {
      if (!isPostable(t)) continue;
      for (const l of t.lines || []) sum += lineAmount(l, t);
    }
    return sum;
  }, [transactionsWithBalance]);

  const selectedMetricsResult = useMemo(() => {
    if (selectedIds.size === 0) return { sum: 0, mean: 0 };
    let sum = 0;
    let count = 0;
    const filtered = transactionsWithBalance.filter(isPostable);
    const len = filtered.length;
    for (let i = 0; i < len; i++) {
      const t = filtered[i];
      if (selectedIds.has(t.id)) {
        sum += (t.totalAmountCents || 0);
        count++;
      }
    }
    return { sum, mean: count > 0 ? sum / count : 0 };
  }, [selectedIds, transactionsWithBalance]);

  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
  const [columnSearchTerms, setColumnSearchTerms] = useState<Record<string, string>>({});
  const { layout: columnLayout, hiddenColumns, toggleColumnVisibility, setColumnWidth, moveColumn, resetColumnLayout } = useTransactionColumnLayout();
  const show = (column: string) => !hiddenColumns.has(column);

  const columnFilterValues = useMemo(() => {
    const categoriesSet = new Set<string>();
    const projectsSet = new Set<string>();
    const statusesSet = new Set<string>();

    const filtered = safeTransactions.filter(isPostable);
    const len = filtered.length;
    for (let i = 0; i < len; i++) {
      const t = filtered[i];
      categoriesSet.add(resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName));
      projectsSet.add(t.project || 'Global');
      statusesSet.add(t.status || 'Active');
    }

    return {
      category: Array.from(categoriesSet).sort(),
      project: Array.from(projectsSet).sort(),
      status: Array.from(statusesSet).sort()
    };
  }, [safeTransactions, accounts]);

  const toggleColumnFilter = (column: string, value: string) => {
    const keyMap: Record<string, 'selectedCategories' | 'selectedProjects' | 'selectedClasses' | 'selectedLocations' | 'selectedStatuses'> = {
      category: 'selectedCategories',
      project: 'selectedProjects',
      class: 'selectedClasses',
      location: 'selectedLocations',
      status: 'selectedStatuses'
    };
    const key = keyMap[column];
    if (!key) return;
    const current = filterCriteria?.[key] || [];
    const next = current.includes(value)
      ? current.filter((v: string) => v !== value)
      : [...current, value];

    onFilterApplied({ ...filterCriteria, [key]: next });
  };

  const _searchInterpretation = useMemo(() => {
    if (!searchTerm.trim()) return null;
    const lowerSearch = searchTerm.toLowerCase().trim();
    const interpretation = [];

    if (lowerSearch.match(/(greater than|more than|over|above|less than|under|below|at least|at most|around|about|approx|approximately)\s*(\d+(\.\d+)?)/) || lowerSearch.match(/([><=])\s*(\d+(\.\d+)?)/)) {
       interpretation.push('Quantities');
    }
    if (lowerSearch.match(/between\s*(\d+(\.\d+)?)\s*and\s*(\d+(\.\d+)?)/)) {
       interpretation.push('Range Scan');
    }
    if (lowerSearch.match(/\b(top|bottom)\s*(10|25|50)\s*%?\b/)) {
       interpretation.push('Statistical Slice');
    }
    if (lowerSearch.match(/\b(above|below)\s+average\b/)) {
       interpretation.push('Anomaly Detection');
    }
    if (lowerSearch.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)) {
       interpretation.push('Months');
    }
    if (lowerSearch.match(/\b(20\d{2})\b/)) interpretation.push('Year Filter');
    if (lowerSearch.match(/\b(last month|this month|last week|this week|yesterday|today|last year|this year|last 7 days|last 30 days|ytd)\b/)) interpretation.push('Relative Time');
    if (lowerSearch.match(/\b(q[1-4])\b/)) interpretation.push('Quarterly Review');
    if (lowerSearch.match(/(category|type|account):\s*([a-zA-Z\s]+)/)) interpretation.push('Classification Scoping');
    if (lowerSearch.match(/starts\s+with\s+|ends\s+with\s+|contains\s+/)) interpretation.push('Text Pattern');
    if (lowerSearch.match(/\b(error|mismatch|conflict|audit|review|unbalanced)\b/)) interpretation.push('Integrity Mapping');

    return interpretation.length > 0 ? interpretation.join(' • ') : 'Keyword Search';
  }, [searchTerm]);

  const [isMobileGrid, setIsMobileGrid] = useState(false);
  const [isTabletGrid, setIsTabletGrid] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileGrid(window.innerWidth < 768);
      setIsTabletGrid(window.innerWidth >= 768 && window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const rowHeight = isCompactMode ? (isMobileGrid ? 44 : 32) : isProMode ? 44 : 72;
  // one width per cell the rows draw (desktop rows also have a running balance and actions)
  const gridCols = gridTemplate({ mobile: isMobileGrid, tablet: isTabletGrid, compact: isProMode || isCompactMode }, hiddenColumns, columnLayout);

  const trackLayout = { mobile: isMobileGrid, tablet: isTabletGrid, compact: isProMode || isCompactMode };
  const naturalColumnOrder = gridTracks(trackLayout, hiddenColumns).map(([id]) => id);
  const columnOrder = orderedGridTracks(trackLayout, hiddenColumns, columnLayout).map(([id]) => id);
  const navigationKey = columnOrder.filter(id => ['date', 'description', 'category', 'project', 'amount', 'status'].includes(id)).join(',');

  // Keyboard navigation (#104). The keys are handled by the focusable grid region in
  // TransactionGridKeyboardRegion; this model owns the highlight and keeps it honest when the
  // visible rows change. The old window listener prevented Tab everywhere and pointed the highlight
  // at rows the virtualized list had not drawn.
  const navigationFields = useMemo(() => gridFields(navigationKey), [navigationKey]);
  // A filter, a sort or a deletion changes the visible rows: keep the highlight on its record (its
  // index follows a sort) or drop it, never leave it pointing at a row that is no longer there.
  const [lastRows, setLastRows] = useState(transactionsWithBalance);
  if (lastRows !== transactionsWithBalance) {
    setLastRows(transactionsWithBalance);
    setFocusedCell(current => reconcileGridFocus(current, transactionsWithBalance));
  }
  const onGridFocusChange = useCallback((next: GridFocus | null) => setFocusedCell(next), []);
  const onGridEdit = useCallback((target: GridFocus) => setEditingCell({ id: target.id, field: target.field }), []);
  const gridAnnouncement = useMemo(() => {
    if (!focusedCell) return '';
    const index = transactionsWithBalance.findIndex(t => t.id === focusedCell.id);
    if (index === -1) return '';
    const tx = transactionsWithBalance[index];
    return `Row ${index + 1} of ${transactionsWithBalance.length}: ${formatDate(tx.date)}, ${tx.description}, ${focusedCell.field}, ${formatCurrency(tx.totalAmountCents)}`;
  }, [focusedCell, transactionsWithBalance]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onProjectClick = useCallback((projectName: string) => onFilterApplied({ ...filterCriteria, project: projectName }), [filterCriteria, onFilterApplied]);

  const pivotData = useMemo(() => {
    const groups: Record<string, { total: number, count: number }> = {};
    smartFilteredTransactions.filter(isPostable).forEach(t => {
      const key = resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName);
      if (!groups[key]) groups[key] = { total: 0, count: 0 };
      groups[key].total += t.totalAmountCents;
      groups[key].count += 1;
    });
    return Object.entries(groups).map(([name, data]) => ({ name, value: data.total, count: data.count })).sort((a, b) => b.value - a.value);
  }, [smartFilteredTransactions, accounts]);

  const selectedTransactions = useMemo(() =>
    transactions.filter(t => selectedIds.has(t.id)),
    [transactions, selectedIds]
  );

  // amounts signed like the list: money in positive, money out negative (E-26)
  const signedCents = (t: Transaction) => (isInflow(t, accounts) ? 1 : -1) * (t.totalAmountCents || 0);

  const handleExportCSV = () => {
    downloadCsv(`ledger_export_${getLocalDateISO()}.csv`,
      ['Date', 'Description', 'Category', 'Project', 'Amount', 'Currency', 'Status'],
      transactionsWithBalance.map(t => [t.date, t.description, resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName), t.project || 'General', csvMoney(signedCents(t)), t.currency || '', t.status]));
    toast.success('Ledger Export Matrix Generated');
  };

  const handleBulkUpdate = useCallback(async (updates: Partial<Transaction>) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (txActions?.handleBulkUpdate) {
      await txActions.handleBulkUpdate(ids, updates);
    } else {
      const results = await Promise.all(ids.map(id => Promise.resolve(onUpdate?.(id, updates)).then(r => r !== false, () => false)));
      const saved = results.filter(Boolean).length;
      if (saved === ids.length) toast.success(`Updated ${saved} ${saved === 1 ? 'entry' : 'entries'}`);
      else toast.error(`${saved} of ${ids.length} entries were updated; ${ids.length - saved} were not saved.`);
    }
    setSelectedIds(new Set());
  }, [selectedIds, txActions, onUpdate]);

  const handleBulkSweep = useCallback(async () => {
    const loaderId = toast.loading('Initializing rule telemetry bulk resolution...');

    // Defer the heavy engine boot sequence to a task so UI repaints the toast first
    await new Promise(r => setTimeout(r, 50));

    const state = useLedgerStore.getState();
    const rules = state.autoRules;
    const accounts = state.accounts;
    const engine = new MatchingEngine(rules, state.analyticalPatternCache, undefined, state.matchingThreshold, transactionsWithBalance, state.dimensionNodes, accounts);

    // #108: the books may change while suggestions are computed; only confirmed saves are counted
    const scope = identityScope(currentIdentity, () => useAuthStore.getState().currentWorkspaceId);
    const suggestions = await engine.suggestCategoriesAsync(transactionsWithBalance, Math.round);
    if (!scope.isCurrent()) { toast.dismiss(loaderId); return; }

    const planned: Array<{ id: string; lines: Transaction['lines'] }> = [];

    // O(1) Pre-computing Maps to avoid O(N * M) performance drop during Bulk Sweep
    const txMap = new Map(transactionsWithBalance.map(t => [t.id, t]));
    const accountNameMap = new Map(accounts.map(a => [a.name, a]));

    suggestions.forEach((suggestion, id) => {
      const tx = txMap.get(id);
      const targetAcc = accountNameMap.get(suggestion.accountName);

      if (tx && targetAcc && (!tx.lines || tx.lines.length === 0 || tx.lines[0].accountName === 'Uncategorized' || tx.lines[0].accountName === 'Unassigned')) {
        const bankAcc = accounts.find(a => isCashAccount(a)) || accounts[0];
        const updatedLines = tx.lines && tx.lines.length >= 2 ? [
          { ...tx.lines[0], accountId: targetAcc.id, accountName: targetAcc.name, dimensions: suggestion.dimensions || tx.lines[0].dimensions },
          ...tx.lines.slice(1)
        ] : [
          { accountId: targetAcc.id, accountName: targetAcc.name, amountCents: Math.abs(tx.totalAmountCents), dimensions: suggestion.dimensions || undefined },
          { accountId: bankAcc?.id || accounts[0]?.id || '', accountName: bankAcc?.name || 'Main Checking', amountCents: -Math.abs(tx.totalAmountCents) }
        ];
        planned.push({ id, lines: updatedLines as Transaction['lines'] });
      }
    });

    const results = await Promise.all(planned.map(p => Promise.resolve(onUpdate?.(p.id, { lines: p.lines })).then(r => r !== false, () => false)));
    const count = results.filter(Boolean).length;
    const failed = planned.length - count;
    if (failed > 0) {
      toast.error(`${count} of ${planned.length} entries were categorized; ${failed} were not saved (see the messages above).`, { id: loaderId });
    } else if (count > 0) {
      toast.success(`Categorized ${count} ${count === 1 ? 'entry' : 'entries'}.`, { id: loaderId });
    } else {
      toast.info('No auto-resolvable patterns found. Try adjusting Rule Matching thresholds.', { id: loaderId });
    }
  }, [transactionsWithBalance, onUpdate]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const files = Array.from(e.dataTransfer.files);
      // Processing queue will show up via UI store updates
      files.forEach(file => {
        handleParseReceipt(file);
      });
      toast.info(`Processing ${files.length} receipts...`);
    }
  };

  const itemData = useMemo(() => ({
    transactions: transactionsWithBalance,
    selectedIds,
    focusedCell,
    editingCell,
    anomalyMap,
    deterministicConflicts,
    onToggleSelection: toggleSelection,
    onVoid,
    onUpdate,
    onCreateRule,
    onProjectClick,
    setSplittingTxId,
    setFocusedCell,
    setEditingCell,
    isProMode,
    isCompactMode,
    isMobileGrid,
    isTabletGrid,
    onToggleFlag: handleToggleFlag,
    onEditDetails: (tx: Transaction) => {
      setEditingDetailsTx(tx);
      setIsReverseModeModal(false);
    },
    onReverseAndCorrect: (tx: Transaction) => {
      setEditingDetailsTx(tx);
      setIsReverseModeModal(true);
    },
    dateFormat,
    formatCurrency,
    gridCols,
    hiddenColumns,
    columnLayout,
    searchTerm,
    onDuplicate: handleDuplicateTransaction
  }), [
    transactionsWithBalance,
    selectedIds,
    focusedCell,
    editingCell,
    anomalyMap,
    deterministicConflicts,
    searchTerm,
    toggleSelection,
    onVoid,
    onUpdate,
    onCreateRule,
    onProjectClick,
    setSplittingTxId,
    setFocusedCell,
    setEditingCell,
    isProMode,
    isCompactMode,
    isMobileGrid,
    isTabletGrid,
    handleToggleFlag,
    dateFormat,
    gridCols,
    hiddenColumns,
    columnLayout,
    handleDuplicateTransaction
  ]);

  const itemKey = useCallback((index: number, data: VirtualRowProps['data']) => {
    return data.transactions[index]?.id || `idx-${index}`;
  }, []);

  return { columnLayout, naturalColumnOrder, columnOrder, setColumnWidth, moveColumn, resetColumnLayout, formId, filterCriteria, onFilterApplied, onAction, txActions, onUpdate, onNewEntry, isProMode, isCompactMode, setProMode, setCompactMode, searchTerm, setSearchTerm, viewMode, setViewMode, editingDetailsTx, setEditingDetailsTx, isReverseModeModal, setIsReverseModeModal, lockDate, selectedIds, setSelectedIds, toggleSelectAll, parsingQueue, setParsingQueue, splittingTxId, setSplittingTxId, accounts, projects, dragActive, sortConfig, handleSort, splittingTransaction, activeView, transactionsWithBalance, stats, totalBalancedSum, selectedMetricsResult, activeFilterColumn, setActiveFilterColumn, columnSearchTerms, setColumnSearchTerms, hiddenColumns, show, toggleColumnVisibility, columnFilterValues, toggleColumnFilter, pivotData, isMobileGrid, isTabletGrid, rowHeight, gridCols, selectedTransactions, signedCents, handleExportCSV, handleBulkUpdate, handleBulkSweep, handleDrag, handleDrop, itemData, itemKey, navigationFields, gridAnnouncement, onGridFocusChange, onGridEdit, focusedCell, editingCell };
}

export type TransactionGridModel = ReturnType<typeof useTransactionGridModel>;

export default function TransactionGrid() {
 return <TransactionGridView {...useTransactionGridModel()} />;
}
