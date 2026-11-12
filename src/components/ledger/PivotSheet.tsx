import type { TransactionLine } from '../../types';
import { useState, useMemo, useCallback } from 'react';
import { Transaction } from '../../types';
import { resolveAccountName } from '../../lib/utils';
import { isPostable, isTransactionInDateRange, lineAmount } from '../../lib/txFilters';
import { getLineDimension, DEFAULT_WORKSPACE_DIMENSIONS } from '../../lib/dimensionUtils';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { PivotSheetView } from './PivotSheetView';
import { deleteLayout, readLayouts, saveLayout, type CompareLayout } from '../../lib/compareLayouts';
interface PivotSheetProps {
  transactions: Transaction[];
  isEmbedded?: boolean;
}

type GroupBy = string; // Dynamic dimension ID or 'month' | 'payee'
type PivotMode = 'flat' | 'matrix';
export type PeriodFilter = 'all' | 'this_year' | 'last_year' | 'this_quarter' | 'this_month' | 'custom';

function usePivotSheetModel({ transactions, isEmbedded = false }: PivotSheetProps) {
  const currentWorkspace = useAuthStore(s => s.getCurrentWorkspace());
  const accounts = useLedgerStore(s => s.accounts);
  const dimensionNodes = useLedgerStore(s => s.dimensionNodes);
  const activeDimensions = useMemo(() => {
    const custom = currentWorkspace?.dimensions || DEFAULT_WORKSPACE_DIMENSIONS;
    const baseIds = custom.map(d => ({ id: d.id, name: d.name }));
    return [
      ...baseIds,
      { id: 'month', name: 'Month' },
      { id: 'payee', name: 'Payee' }
    ];
  }, [currentWorkspace]);

  const [pivotMode, setPivotMode] = useState<PivotMode>('flat');
  const [rowDim, setRowDim] = useState<GroupBy>('category');
  const [colDim, setColDim] = useState<GroupBy>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('category');
  const [searchTerm, setSearchTerm] = useState('');
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // EU-E8: layouts a person saved for Compare, per workspace (src/lib/compareLayouts.ts)
  const layoutWorkspace = currentWorkspace?.id || '';
  const [layouts, setLayouts] = useState<CompareLayout[]>(() => (layoutWorkspace ? readLayouts(layoutWorkspace) : []));
  const saveCurrentLayout = (name: string): boolean => {
    if (!layoutWorkspace) return false;
    const next = saveLayout(layoutWorkspace, { name, pivotMode, rowDim, colDim, groupBy, period });
    if (next) setLayouts(next);
    return Boolean(next);
  };
  const applyLayout = (name: string) => {
    const layout = layouts.find(l => l.name === name);
    if (!layout) return;
    setPivotMode(layout.pivotMode); setRowDim(layout.rowDim); setColDim(layout.colDim); setGroupBy(layout.groupBy);
    setPeriod(layout.period as PeriodFilter);
  };
  const removeLayout = (name: string) => { if (!layoutWorkspace) return; const next = deleteLayout(layoutWorkspace, name); if (next) setLayouts(next); };
  const [drillDownTarget, setDrillDownTarget] = useState<{ title: string; transactions: Transaction[] } | null>(null);

  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  // Compute active date boundaries
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    if (period === 'this_year') {
      return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
    }
    if (period === 'last_year') {
      return { startDate: `${y - 1}-01-01`, endDate: `${y - 1}-12-31` };
    }
    if (period === 'this_month') {
      const lastDay = new Date(y, m + 1, 0).getDate();
      return { 
        startDate: `${y}-${String(m + 1).padStart(2, '0')}-01`, 
        endDate: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` 
      };
    }
    if (period === 'this_quarter') {
      const qStartMonth = Math.floor(m / 3) * 3;
      const qEndMonth = qStartMonth + 2;
      const lastDay = new Date(y, qEndMonth + 1, 0).getDate();
      return {
        startDate: `${y}-${String(qStartMonth + 1).padStart(2, '0')}-01`,
        endDate: `${y}-${String(qEndMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      };
    }
    if (period === 'custom') {
      return { startDate: customStartDate, endDate: customEndDate };
    }
    return { startDate: '', endDate: '' };
  }, [period, customStartDate, customEndDate]);

  // Scoped & Postable transactions
  const scopedTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (!isPostable(t)) return false;
      return isTransactionInDateRange(t, startDate || undefined, endDate || undefined);
    });
  }, [transactions, startDate, endDate]);

  // Helper code to map a Transaction/Line to a group key representation
  const getLineDimensionValue = useCallback((t: Transaction, line: TransactionLine, dim: GroupBy): string => {
    if (dim === 'payee') {
      return t.payee || t.description || 'Direct Entry';
    }
    if (dim === 'month') {
      if (!t.date) return 'Unknown Date';
      return t.date.substring(0, 7); // ISO YYYY-MM
    }
    if (dim === 'account' || dim === 'accountId') {
      return resolveAccountName(accounts, line?.accountId, line?.accountName) || 'Unassigned';
    }

    const lineVal = line ? getLineDimension(line, t, dim, dimensionNodes) : 'Unassigned';
    return lineVal || 'Unassigned';
  }, [accounts, dimensionNodes]);

  const formatDimensionDisplay = (dim: GroupBy, key: string): string => {
    if (dim === 'month' && /^\d{4}-\d{2}$/.test(key)) {
      const [year, month] = key.split('-');
      const d = new Date(Number(year), Number(month) - 1, 1);
      return d.toLocaleString('default', { month: 'short', year: 'numeric' });
    }
    return key;
  };

  // 1. FLAT MODE COMPILATION (Line-accurate Aggregation)
  const groupedData = useMemo(() => {
    const groups: Record<string, { total: number, items: Transaction[], lineCount: number }> = {};
    const seenTxInGroup: Record<string, Set<string>> = {};
    
    scopedTransactions.forEach(t => {
      const linesToProcess = (t.lines && t.lines.length > 0) 
        ? t.lines 
        : [{ accountId: '', accountName: '', amountCents: t.totalAmountCents, description: t.description }];

      linesToProcess.forEach(line => {
        const key = getLineDimensionValue(t, line, groupBy);

        if (searchTerm && 
            !key.toLowerCase().includes(searchTerm.toLowerCase()) && 
            !t.description.toLowerCase().includes(searchTerm.toLowerCase()) &&
            !(t.payee || '').toLowerCase().includes(searchTerm.toLowerCase())) {
          return;
        }

        const convertedCents = lineAmount(line, t) || 0; // already in the base currency (L-153)

        if (!groups[key]) {
          groups[key] = { total: 0, items: [], lineCount: 0 };
          seenTxInGroup[key] = new Set();
        }
        groups[key].total += convertedCents;
        groups[key].lineCount += 1;

        if (!seenTxInGroup[key].has(t.id)) {
          seenTxInGroup[key].add(t.id);
          groups[key].items.push(t);
        }
      });
    });

    return Object.entries(groups).sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
  }, [scopedTransactions, groupBy, searchTerm, getLineDimensionValue]);

  // 2. CROSS-TAB MATRIX MODE COMPILATION
  const matrixData = useMemo(() => {
    if (pivotMode !== 'matrix') {
      return { rows: [], cols: [], cells: {}, cellItems: {}, rowTotals: {}, rowItems: {}, colTotals: {}, colItems: {}, allItems: [], grandTotal: 0 };
    }

    const cells: Record<string, Record<string, number>> = {};
    const cellItems: Record<string, Record<string, Transaction[]>> = {};
    const seenCellTxs: Record<string, Record<string, Set<string>>> = {};
    const rowTotals: Record<string, number> = {};
    const rowItems: Record<string, Transaction[]> = {};
    const seenRowTxs: Record<string, Set<string>> = {};
    const colTotals: Record<string, number> = {};
    const colItems: Record<string, Transaction[]> = {};
    const seenColTxs: Record<string, Set<string>> = {};
    const allItems: Transaction[] = [];
    const seenAllTxs = new Set<string>();
    let grandTotal = 0;

    const rowKeys = new Set<string>();
    const colKeys = new Set<string>();

    scopedTransactions.forEach(t => {
      const linesToProcess = (t.lines && t.lines.length > 0) 
        ? t.lines 
        : [{ accountId: '', accountName: '', amountCents: t.totalAmountCents, description: t.description }];

      linesToProcess.forEach(line => {
        const rKey = getLineDimensionValue(t, line, rowDim);
        const cKey = getLineDimensionValue(t, line, colDim);

        if (searchTerm && 
            !rKey.toLowerCase().includes(searchTerm.toLowerCase()) && 
            !cKey.toLowerCase().includes(searchTerm.toLowerCase()) &&
            !t.description.toLowerCase().includes(searchTerm.toLowerCase())) {
          return;
        }

        rowKeys.add(rKey);
        colKeys.add(cKey);

        const convertedCents = lineAmount(line, t) || 0; // already in the base currency (L-153)

        if (!cells[rKey]) cells[rKey] = {};
        if (!cells[rKey][cKey]) cells[rKey][cKey] = 0;
        cells[rKey][cKey] += convertedCents;

        if (!cellItems[rKey]) cellItems[rKey] = {};
        if (!cellItems[rKey][cKey]) cellItems[rKey][cKey] = [];
        if (!seenCellTxs[rKey]) seenCellTxs[rKey] = {};
        if (!seenCellTxs[rKey][cKey]) seenCellTxs[rKey][cKey] = new Set();
        if (!seenCellTxs[rKey][cKey].has(t.id)) {
          seenCellTxs[rKey][cKey].add(t.id);
          cellItems[rKey][cKey].push(t);
        }
        
        rowTotals[rKey] = (rowTotals[rKey] || 0) + convertedCents;
        if (!rowItems[rKey]) rowItems[rKey] = [];
        if (!seenRowTxs[rKey]) seenRowTxs[rKey] = new Set();
        if (!seenRowTxs[rKey].has(t.id)) {
          seenRowTxs[rKey].add(t.id);
          rowItems[rKey].push(t);
        }

        colTotals[cKey] = (colTotals[cKey] || 0) + convertedCents;
        if (!colItems[cKey]) colItems[cKey] = [];
        if (!seenColTxs[cKey]) seenColTxs[cKey] = new Set();
        if (!seenColTxs[cKey].has(t.id)) {
          seenColTxs[cKey].add(t.id);
          colItems[cKey].push(t);
        }

        if (!seenAllTxs.has(t.id)) {
          seenAllTxs.add(t.id);
          allItems.push(t);
        }
        grandTotal += convertedCents;
      });
    });

    const sortedRows = Array.from(rowKeys).sort((a, b) => Math.abs(rowTotals[b] || 0) - Math.abs(rowTotals[a] || 0));
    
    // Alphanumeric ISO sort (e.g. YYYY-MM is chronological in every locale)
    const sortedCols = Array.from(colKeys).sort((a, b) => a.localeCompare(b));

    return {
      rows: sortedRows,
      cols: sortedCols,
      cells,
      cellItems,
      rowTotals,
      rowItems,
      colTotals,
      colItems,
      allItems,
      grandTotal
    };

  }, [scopedTransactions, pivotMode, rowDim, colDim, searchTerm, getLineDimensionValue]);

  return { layouts, saveCurrentLayout, applyLayout, removeLayout, transactions, isEmbedded, accounts, activeDimensions, pivotMode, setPivotMode, rowDim, setRowDim, colDim, setColDim, groupBy, setGroupBy, searchTerm, setSearchTerm, period, setPeriod, customStartDate, setCustomStartDate, customEndDate, setCustomEndDate, expandedGroups, drillDownTarget, setDrillDownTarget, toggleGroup, scopedTransactions, formatDimensionDisplay, groupedData, matrixData };
}

export type PivotSheetModel = NonNullable<ReturnType<typeof usePivotSheetModel>>;

export default function PivotSheet(props: Parameters<typeof usePivotSheetModel>[0]) {
  const model = usePivotSheetModel(props);
  return <PivotSheetView {...model} />;
}
