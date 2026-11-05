import { usePageSyncedState } from '../../hooks/usePageSyncedState';
import type { ExplainRequest } from '../layout/DrillDownModal';
import { useLedgerStore } from '../../stores/useLedgerStore';
import { useId, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChartAccount, Transaction } from '../../types';
import { getLocalDateISO, addToDateISO } from '../../lib/utils';
import { currentReportExportContext, exportToExcel, reportTitleRows } from '../../lib/excelExport';
import { isPostable, isTransactionInDateRange, lineAmount, calculateNetIncome } from '../../lib/txFilters';
import { useAuthStore } from '../../stores/useAuthStore';
import { useFinancialReporting, ServerBalanceSheetData } from '../../hooks/useFinancialReporting';
import { toast } from 'sonner';
import { BalanceSheetReport } from './BalanceSheetReport';
import type { ReportColumnMode } from '../../lib/reportColumns';
import { getFiscalYearBounds } from '../../lib/fiscalCalendar';
import { STATEMENT_COLLECTIONS, useBrowserProvenance } from '../../hooks/useBrowserProvenance';
import { provenanceFromResponse } from '../../lib/reportProvenance';
import { balanceEntries, opensFromServer, SERVER_OPENING_ENTRY_ID } from '../../lib/serverBalances';
import { useScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';

interface BalanceSheetViewProps {
  accounts: ChartAccount[];
  formatCurrency: (val: number) => string;
  /** As-of date and comparison chosen on the Reports page; the view follows them when given. */
  asOfDate?: string;
  compareEndDate?: string;
  startDate?: string;
  compareStartDate?: string;
}

function useBalanceSheetModel({ accounts = [], formatCurrency, asOfDate: pageAsOfDate, compareEndDate, startDate: pageStartDate, compareStartDate }: BalanceSheetViewProps) {
  const formId = useId();
  const [columnMode, setColumnMode] = useState<ReportColumnMode>('total');
  const [showPercent, setShowPercent] = useState(false);
  const transactions = useLedgerStore(state => state.transactions || []);
  
  const [asOfDate, setAsOfDate] = usePageSyncedState(pageAsOfDate || '', pageAsOfDate || undefined, getLocalDateISO);
  const [isComparative, setIsComparative] = usePageSyncedState(JSON.stringify([pageAsOfDate, compareEndDate]), pageAsOfDate ? Boolean(compareEndDate) : undefined, false);
  const [priorDate, setPriorDate] = usePageSyncedState(
    JSON.stringify([pageAsOfDate, compareEndDate]), pageAsOfDate && compareEndDate ? compareEndDate : undefined,
    () => addToDateISO(getLocalDateISO(), { years: -1 })
  );
  const [sortBy, setSortBy] = useState<'code' | 'name' | 'balance'>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [drillDownTarget, setDrillDownTarget] = useState<{ accountName: string; transactions: Transaction[]; explain?: ExplainRequest } | null>(null);

  const { fetchBalanceSheet, loadingStates } = useFinancialReporting();
  const [serverData, setServerData] = useState<ServerBalanceSheetData | null>(null);
  const [serverPrevData, setServerPrevData] = useState<ServerBalanceSheetData | null>(null);
  const [isServerAuthoritative, setIsServerAuthoritative] = useState(false);
  const [serverFailed, setServerFailed] = useState(false);
  const browserFigures = useBrowserProvenance(STATEMENT_COLLECTIONS, serverFailed);
  const reportGen = useRef(0);

  // N-08: accrual (as posted) or cash (without trade receivables and payables; from the server only)
  const [basis, setBasis] = useState<'accrual' | 'cash'>('accrual');
  const loadServerReport = useCallback(async () => {
    try {
      const gen = ++reportGen.current;
      const res = await fetchBalanceSheet(asOfDate, basis === 'cash' ? 'cash' : undefined);
      // BUG-02: a failed or late answer never leaves another period's figures on screen
      if (gen !== reportGen.current) return;
      setServerData(res || null);
      setIsServerAuthoritative(Boolean(res));
      setServerFailed(!res);
      if (isComparative) {
        const prevRes = await fetchBalanceSheet(priorDate, basis === 'cash' ? 'cash' : undefined);
        if (gen !== reportGen.current) return;
        setServerPrevData(prevRes || null);
      }
    } catch {
      setIsServerAuthoritative(false);
      setServerFailed(true);
    }
  }, [fetchBalanceSheet, asOfDate, priorDate, isComparative, basis]);

  useEffect(() => {
    void Promise.resolve().then(loadServerReport);
  }, [loadServerReport]);

  const toggleSort = (field: 'code' | 'name' | 'balance') => {
    if (sortBy === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const workspaces = useAuthStore(s => s.workspaces);
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const businessType = currentWorkspace?.businessType || 'generic';
  const fiscalStart = currentWorkspace?.fiscalYearStartMonth || 1;
  const columnStartDate = pageStartDate && pageStartDate <= asOfDate ? pageStartDate : getFiscalYearBounds(asOfDate, fiscalStart).startDate;
  const columnCompareStartDate = compareStartDate && compareStartDate <= priorDate ? compareStartDate : getFiscalYearBounds(priorDate, fiscalStart).startDate;


  const labels = useMemo(() => {
    if (businessType === 'personal') {
      return {
        assetsLabel: "Personal Wealth & Assets",
        assetsSub: "Gross Liquid & Invested Portfolio",
        liabilitiesLabel: "Personal Debts & Liabilities",
        liabilitiesSub: "Aggregated Household Credit & Debt",
        equityLabel: "Personal Net Worth",
        equitySub: "Owner Cumulative Financial Capital",
        retainedEarningsLabel: "Household YTD Net Savings",
        retainedEarningsSub: "Calculated Periodic Savings Delta",
        totalClaimsLabel: "Total Liabilities & Net Worth",
        totalClaimsSub: "Combined Claims Dynamic Sum",
        isBalancedSuccess: "Equilibrium Confirmed",
        isBalancedDrift: "Discrepancy Detected"
      };
    } else if (businessType === 'nonprofit') {
      return {
        assetsLabel: "Charitable Trust & Fund Assets",
        assetsSub: "Restricted & Unrestricted Resources",
        liabilitiesLabel: "Institutional & Deferred Liabilities",
        liabilitiesSub: "Operational Commitments & Grants Payable",
        equityLabel: "Charitable Net Assets",
        equitySub: "Donor Reserves & Accumulated Funds",
        retainedEarningsLabel: "YTD Operating Surplus / Deficit",
        retainedEarningsSub: "Periodic Performance Change",
        totalClaimsLabel: "Total Liabilities & Net Assets",
        totalClaimsSub: "Aggregate Claims & Account Balance",
        isBalancedSuccess: "Fund Balanced",
        isBalancedDrift: "Balance Drift Detected"
      };
    } else {
      return {
        assetsLabel: "Assets",
        assetsSub: "What the business owns",
        liabilitiesLabel: "Liabilities",
        liabilitiesSub: "What the business owes",
        equityLabel: "Owner Equity & Capital",
        equitySub: "Capital and retained earnings",
        retainedEarningsLabel: "Retained Earnings (YTD Net)",
        retainedEarningsSub: "Profit to date",
        totalClaimsLabel: "Total Equity & Liabilities",
        totalClaimsSub: "Must equal total assets",
        isBalancedSuccess: "Balanced",
        isBalancedDrift: "Balance Drift Detected"
      };
    }
  }, [businessType]);

  // L-123 step 3c: balances as of a day on or after the oldest loaded day read the server's sums through that day
  const serverOpening = useLedgerStore(state => state.serverOpening);
  const getPeriodBalances = useCallback((dateCutoff: string) => {
    const entries = balanceEntries(transactions, serverOpening, dateCutoff);
    const assets: { [id: string]: number } = {};
    const liabilities: { [id: string]: number } = {};
    const equity: { [id: string]: number } = {};
    const income: { [id: string]: number } = {};
    const expense: { [id: string]: number } = {};

    const accountMap = new Map<string, ChartAccount>();
    accounts.forEach(acc => {
      accountMap.set(acc.id, acc);
      accountMap.set(acc.name, acc);
    });
    
    // Initialize with account opening balances
    accounts.forEach(acc => {
      const initVal = acc.openingBalanceCents || 0;
      if (acc.type === 'asset') assets[acc.id] = initVal;
      else if (acc.type === 'liability') liabilities[acc.id] = initVal;
      else if (acc.type === 'equity') equity[acc.id] = initVal;
      else if (acc.type === 'income' || acc.type === 'revenue') income[acc.id] = initVal;
      else if (acc.type === 'expense' || acc.type === 'cost_of_goods') expense[acc.id] = initVal;
    });

    const orphanedLines: Array<{ accountId: string; transactionId?: string; date?: string; amountCents: number }> = [];

    // Sum transactions before or on cutoff date
    entries.forEach(tx => {
      if (!isPostable(tx) || !isTransactionInDateRange(tx, undefined, dateCutoff)) return;
      tx.lines?.forEach(line => {
        const id = line.accountId;
        const acc = accountMap.get(id) || (line.accountName ? accountMap.get(line.accountName) : undefined);
        if (!acc) {
          // the server's sum for an account not in the loaded chart is no entry to open
          if (tx.id === SERVER_OPENING_ENTRY_ID) return;
          orphanedLines.push({
            accountId: id || line.accountName || 'unknown',
            transactionId: tx.id,
            date: tx.date,
            amountCents: lineAmount(line, tx)
          });
          return;
        }
        const accId = acc.id;
        
        const amt = lineAmount(line, tx);
        const isDebitNature = acc.type === 'asset' || acc.type === 'expense' || acc.type === 'cost_of_goods';
        const delta = isDebitNature ? amt : -amt;

        if (acc.type === 'asset') assets[accId] = (assets[accId] || 0) + delta;
        else if (acc.type === 'liability') liabilities[accId] = (liabilities[accId] || 0) + delta;
        else if (acc.type === 'equity') equity[accId] = (equity[accId] || 0) + delta;
        else if (acc.type === 'income' || acc.type === 'revenue') income[accId] = (income[accId] || 0) + delta;
        else if (acc.type === 'expense' || acc.type === 'cost_of_goods') expense[accId] = (expense[accId] || 0) + delta;
      });
    });

    const totalAssets = Object.values(assets).reduce((sum, v) => sum + v, 0);
    const totalLiabilities = Object.values(liabilities).reduce((sum, v) => sum + v, 0);
    const totalEquity = Object.values(equity).reduce((sum, v) => sum + v, 0);
    const { netIncome } = calculateNetIncome(entries, accounts, "1970-01-01", dateCutoff);

    const totalClaims = totalLiabilities + totalEquity + netIncome;

    return {
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      netIncome,
      totalClaims,
      isBalanced: totalAssets === totalClaims,
      orphanedLines
    };
  }, [transactions, accounts, serverOpening]);

  const localCalculation = useMemo(() => {
    const current = getPeriodBalances(asOfDate);
    const prev = isComparative ? getPeriodBalances(priorDate) : current;
    return { currentData: current, prevData: prev };
  }, [getPeriodBalances, asOfDate, priorDate, isComparative]);

  // on cash basis only the server's figures are shown (never the accrual figures computed here)
  const cashReady = basis === 'cash' && isServerAuthoritative && serverData?.basis === 'cash';
  const emptyBs: ServerBalanceSheetData = { assets: {}, liabilities: {}, equity: {}, totalAssets: 0, totalLiabilities: 0, totalEquity: 0, netIncome: 0, totalClaims: 0, isBalanced: true };
  const currentData: ServerBalanceSheetData = basis === 'cash' ? (cashReady ? serverData! : emptyBs) : isServerAuthoritative && serverData ? serverData : localCalculation.currentData;
  const prevData: ServerBalanceSheetData = basis === 'cash' ? currentData : isServerAuthoritative && serverPrevData ? serverPrevData : localCalculation.prevData;
  // AUD-10: the server's answer, or the figures worked out here; cash basis shows only the server's
  const provenance = basis === 'cash' ? (cashReady ? provenanceFromResponse(serverData) : null)
    : isServerAuthoritative && serverData ? provenanceFromResponse(serverData)
    : serverFailed || browserFigures.completeness !== 'complete' ? browserFigures : null;
  const chooseBasis = (next: 'accrual' | 'cash') => {
    setBasis(next);
    setServerData(null);
    setServerPrevData(null);
    setIsServerAuthoritative(false);
    setServerFailed(false);
    if (next === 'cash') { setColumnMode('total'); setShowPercent(false); setIsComparative(false); }
  };
  /** the entries behind a figure are those as posted, so on cash basis they are not listed */
  const openDrill = (target: { accountName: string; transactions: Transaction[]; explain?: ExplainRequest } | null) => {
    if (target && basis === 'cash') { toast.info('On cash basis the entries behind a figure are not listed yet: switch to accrual to see them'); return; }
    setDrillDownTarget(target);
  };

  const exportBalanceSheet = async () => {
    const columns = [
      { header: 'Account Name', key: 'name', width: 30 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Current Balance', key: 'balance', width: 20 },
      { header: isComparative ? 'Prior Balance' : '', key: 'prior', width: 20 },
      { header: isComparative ? 'Variance' : '', key: 'variance', width: 20 },
      { header: isComparative ? 'Variance %' : '', key: 'variancePct', width: 15 },
    ];

    const titleRows = reportTitleRows(currentReportExportContext(
      'Balance Sheet Statement',
      `As of ${asOfDate}${isComparative ? ` · prior reference ${priorDate}` : ''}`,
      basis === 'cash' ? 'Cash' : 'Accrual',
    ));

    const rows: (Record<string, string | number | null> | string[])[] = [];

    rows.push([labels.assetsLabel.toUpperCase()]);
    accounts.filter(a => a.type === 'asset').forEach(acc => {
      const curBal = currentData.assets[acc.id] || 0;
      const prvBal = isComparative ? prevData.assets[acc.id] || 0 : 0;
      const variance = curBal - prvBal;
      const variancePct = prvBal !== 0 ? (variance / Math.abs(prvBal)) * 100 : 0;
      rows.push({
        name: acc.name,
        code: acc.code,
        balance: curBal / 100,
        prior: isComparative ? prvBal / 100 : null,
        variance: isComparative ? variance / 100 : null,
        variancePct: isComparative && prvBal !== 0 ? variancePct.toFixed(1) + '%' : null
      });
    });
    rows.push({
      name: `Total ${labels.assetsLabel}`,
      balance: currentData.totalAssets / 100,
      prior: isComparative ? prevData.totalAssets / 100 : null
    });
    rows.push([]);

    rows.push([labels.liabilitiesLabel.toUpperCase()]);
    accounts.filter(a => a.type === 'liability').forEach(acc => {
      const curBal = currentData.liabilities[acc.id] || 0;
      const prvBal = isComparative ? prevData.liabilities[acc.id] || 0 : 0;
      const variance = curBal - prvBal;
      const variancePct = prvBal !== 0 ? (variance / Math.abs(prvBal)) * 100 : 0;
      rows.push({
        name: acc.name,
        code: acc.code,
        balance: curBal / 100,
        prior: isComparative ? prvBal / 100 : null,
        variance: isComparative ? variance / 100 : null,
        variancePct: isComparative && prvBal !== 0 ? variancePct.toFixed(1) + '%' : null
      });
    });
    rows.push({
      name: `Total ${labels.liabilitiesLabel}`,
      balance: currentData.totalLiabilities / 100,
      prior: isComparative ? prevData.totalLiabilities / 100 : null
    });
    rows.push([]);

    rows.push([labels.equityLabel.toUpperCase()]);
    accounts.filter(a => a.type === 'equity').forEach(acc => {
      const curBal = currentData.equity[acc.id] || 0;
      const prvBal = isComparative ? prevData.equity[acc.id] || 0 : 0;
      const variance = curBal - prvBal;
      const variancePct = prvBal !== 0 ? (variance / Math.abs(prvBal)) * 100 : 0;
      rows.push({
        name: acc.name,
        code: acc.code,
        balance: curBal / 100,
        prior: isComparative ? prvBal / 100 : null,
        variance: isComparative ? variance / 100 : null,
        variancePct: isComparative && prvBal !== 0 ? variancePct.toFixed(1) + '%' : null
      });
    });

    const curRetEarn = currentData.netIncome;
    const prvRetEarn = isComparative ? prevData.netIncome : 0;
    const reVariance = curRetEarn - prvRetEarn;
    const reVariancePct = prvRetEarn !== 0 ? (reVariance / Math.abs(prvRetEarn)) * 100 : 0;
    rows.push({
      name: labels.retainedEarningsLabel,
      code: 'INC',
      balance: curRetEarn / 100,
      prior: isComparative ? prvRetEarn / 100 : null,
      variance: isComparative ? reVariance / 100 : null,
      variancePct: isComparative && prvRetEarn !== 0 ? reVariancePct.toFixed(1) + '%' : null
    });

    rows.push({
      name: `Total ${labels.equityLabel}`,
      balance: (currentData.totalEquity + currentData.netIncome) / 100,
      prior: isComparative ? (prevData.totalEquity + prevData.netIncome) / 100 : null
    });
    rows.push([]);
    rows.push({
      name: labels.totalClaimsLabel,
      balance: currentData.totalClaims / 100,
      prior: isComparative ? prevData.totalClaims / 100 : null
    });

    await exportToExcel(columns, rows, {
      sheetName: 'Balance Sheet',
      fileName: `Balance_Sheet_As_Of_${asOfDate}.xlsx`,
      titleRows
    });
  };

  const getVarianceAndPct = (curVal: number, prVal: number) => {
    const diff = curVal - prVal;
    const pct = prVal !== 0 ? (diff / Math.abs(prVal)) * 100 : null;
    return { diff, pct };
  };

  const folds = useMemo(() => opensFromServer(transactions, serverOpening, asOfDate), [transactions, serverOpening, asOfDate]);
  const serverAsOf = folds && basis === 'accrual' && !(isServerAuthoritative && serverData) ? serverOpening?.asOf || '' : '';
  return { serverAsOf, columnMode, setColumnMode, showPercent, setShowPercent, columnStartDate, columnCompareStartDate, accounts, formatCurrency, formId, transactions, asOfDate, setAsOfDate, isComparative, setIsComparative, priorDate, setPriorDate, sortBy, sortDir, drillDownTarget, setDrillDownTarget: openDrill, basis, chooseBasis, cashReady, provenance, loadingStates, isServerAuthoritative, loadServerReport, toggleSort, labels, currentData, prevData, exportBalanceSheet, getVarianceAndPct };
}

export type BalanceSheetModel = ReturnType<typeof useBalanceSheetModel>;

export default function BalanceSheetView(props: BalanceSheetViewProps) {
  const model = useBalanceSheetModel(props);
  // A-235: the balance sheet reads the entries and the chart of accounts
  const dataHealth = useScreenDataHealth(['transactions', 'accounts']);
  return (
    <>
      <ScreenDataNotice failedKeys={dataHealth.failedKeys} message={dataHealth.message} onRetry={dataHealth.retry} what="this report" />
      <BalanceSheetReport {...model} />
    </>
  );
}
