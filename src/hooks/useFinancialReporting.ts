import { useState, useCallback } from 'react';
import { runCommand } from '../lib/runCommand';
import { useAuthStore } from '../stores/useAuthStore';

export interface ServerPLData {
  income: { total: number; accounts: Record<string, { name: string; code?: string; balance: number; parentId?: string }> };
  cogs: { total: number; accounts: Record<string, { name: string; code?: string; balance: number; parentId?: string }> };
  expense: { total: number; accounts: Record<string, { name: string; code?: string; balance: number; parentId?: string }> };
  grossProfit: number;
  netIncome: number;
}

export interface ServerBalanceSheetData {
  assets: Record<string, number>;
  liabilities: Record<string, number>;
  equity: Record<string, number>;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
  totalClaims: number;
  isBalanced: boolean;
  orphanedLines?: Array<{ accountId: string; transactionId?: string; date?: string; amountCents: number }>;
  /** N-08: on the cash-basis answer, entries left out and payments not yet applied (with the liabilities) */
  basis?: 'cash';
  leftOut?: number;
  notApplied?: number;
}

export interface ServerTrialBalanceData {
  accounts: Array<{ id: string; name: string; code?: string; type: string; debit: number; credit: number; netSigned: number }>;
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
}

export interface ServerCashFlowData {
  operating: { total: number; inflow: number; outflow: number; items: Array<{ name: string; amount: number }> };
  investing: { total: number; inflow: number; outflow: number; items: Array<{ name: string; amount: number }> };
  financing: { total: number; inflow: number; outflow: number; items: Array<{ name: string; amount: number }> };
  netChange: number;
}

export interface ReportLoadingStates {
  pl: boolean;
  bs: boolean;
  tb: boolean;
  cf: boolean;
  profitAndLoss: boolean;
  balanceSheet: boolean;
  trialBalance: boolean;
  cashFlow: boolean;
}


type ReportKind = 'pl' | 'bs' | 'tb' | 'cf';
const LONG_NAME = { pl: 'profitAndLoss', bs: 'balanceSheet', tb: 'trialBalance', cf: 'cashFlow' } as const;
const PATH = { pl: 'profit-and-loss', bs: 'balance-sheet', tb: 'trial-balance', cf: 'cash-flow' } as const;

/**
 * The four statements from the server (/api/v1/reports/*). Each fetch returns the report, or null
 * when it fails (the screens then keep what they computed locally). It used to also keep a P&L of
 * the whole ledger, recomputed on every change and read by no screen.
 */
export function useFinancialReporting() {
  const currentWorkspaceId = useAuthStore(s => s.currentWorkspaceId);
  const [loadingStates, setLoadingStates] = useState<ReportLoadingStates>({
    pl: false,
    bs: false,
    tb: false,
    cf: false,
    profitAndLoss: false,
    balanceSheet: false,
    trialBalance: false,
    cashFlow: false,
  });

  const fetchReport = useCallback(async <T,>(kind: ReportKind, params: Record<string, string | undefined>): Promise<T | null> => {
    if (!currentWorkspaceId) return null;
    const setBusy = (busy: boolean) => setLoadingStates(prev => ({ ...prev, [kind]: busy, [LONG_NAME[kind]]: busy }));
    setBusy(true);
    try {
      const query = new URLSearchParams({ workspaceId: currentWorkspaceId });
      for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
      const data = await runCommand<{ data?: T } & T>({ path: `/api/v1/reports/${PATH[kind]}?${query}` });
      return (data.data || data) as T;
    } catch (e) {
      console.warn(`${PATH[kind]} server fetch fallback:`, e);
      return null;
    } finally {
      setBusy(false);
    }
  }, [currentWorkspaceId]);

  // N-08: basis 'cash' counts invoices and bills when paid (the server's cashBasis.ts)
  const fetchPL = useCallback((startDate?: string, endDate?: string, basis?: 'cash') =>
    fetchReport<ServerPLData>('pl', { startDate, endDate, basis }), [fetchReport]);
  const fetchBalanceSheet = useCallback((endDate?: string, basis?: 'cash') =>
    fetchReport<ServerBalanceSheetData>('bs', { endDate, basis }), [fetchReport]);
  const fetchTrialBalance = useCallback((asOfDate?: string) =>
    fetchReport<ServerTrialBalanceData>('tb', { asOfDate }), [fetchReport]);
  const fetchCashFlow = useCallback((startDate?: string, endDate?: string) =>
    fetchReport<ServerCashFlowData>('cf', { startDate, endDate }), [fetchReport]);

  return { loadingStates, fetchPL, fetchBalanceSheet, fetchTrialBalance, fetchCashFlow };
}
