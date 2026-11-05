import { Transaction, ChartAccount, Invoice, Bill, Vendor, Employee, Budget, Customer } from '../../types';
import { isPostable, isTransactionInDateRange } from '../txFilters';
import { resolveAccountRole } from '../accountUtils';

declare const postable: unique symbol;
export type PostableTransaction = Transaction & { readonly [postable]: true };

export type AlgoInput =
  | { kind?: 'number'; key: string; label: string; min: number; max: number; step: number; defaultValue: number }
  | { kind: 'dateRange'; key: string; label: string; defaultValue: { start: string; end: string } }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[]; defaultValue: string }
  | { kind: 'boolean'; key: string; label: string; defaultValue: boolean }
  | { kind: 'account'; key: string; label: string; defaultValue?: string; multiple?: boolean }
  /** AUD-14: text the person pastes (a receipt's lines) */
  | { kind: 'text'; key: string; label: string; defaultValue: string; placeholder?: string };

export interface AlgoResultRow {
  [key: string]: unknown;
}

export interface AlgoResult {
  metrics: { label: string; value: string | number; trend?: string; color?: string }[];
  charts: { data: (AlgoResultRow | string)[]; config: { xKey: string; yKeys: { key: string; color: string; name: string; type?: 'bar' | 'line' | string }[] } }[];
  insights: string[];
  rows?: AlgoResultRow[];
  sourceTransactionIds?: string[];
}

// SOURCE OF INTEGRITY:
// All algorithms receive the raw `Transaction[]` and `ChartAccount[]` within AlgorithmContext as the absolute source of integrity.
// Do NOT fetch data directly inside the algorithm. Only compute based on the provided context.

export type AlgorithmInvoice = Partial<Invoice> & Pick<Invoice, 'id' | 'status' | 'amountCents'> & {
  deletedAt?: string;
  paidDate?: string;
  paymentDate?: string;
  originState?: string;
  shippingAddress?: { state?: string };
  billingAddress?: { state?: string };
  taxJurisdiction?: string;
  transactionId?: string;
  paymentTransactionIds?: string[];
};
export type AlgorithmCustomer = Customer & {
  shippingAddress?: { state?: string };
  billingAddress?: { state?: string };
  state?: string;
};

export interface AlgorithmContext {
  readonly transactions: readonly PostableTransaction[];
  readonly accounts: readonly ChartAccount[];
  readonly period: { start: string; end: string; days: number };
  readonly asOfDate: string;
  readonly reportingCurrency: string;
  readonly entities?: {
    invoices?: AlgorithmInvoice[];
    bills?: (Bill & { paidDate?: string })[];
    vendors?: Vendor[];
    employees?: Employee[];
    budgets?: Budget[];
    customers?: AlgorithmCustomer[];
  };
  readonly accounting: {
    isCash: (accountId: string) => boolean;
    isRevenue: (accountId: string) => boolean;
    isCOGS: (accountId: string) => boolean;
    isExpense: (accountId: string) => boolean;
    isAR: (accountId: string) => boolean;
    isAP: (accountId: string) => boolean;
    isEquity: (accountId: string) => boolean;
    isLiability: (accountId: string) => boolean;
    isAsset: (accountId: string) => boolean;
  };
}

export type AlgoFn = (ctx: AlgorithmContext, inputs: Record<string, unknown>) => AlgoResult;

export function buildAlgorithmContext(
  transactions: Transaction[],
  accounts: ChartAccount[],
  asOfDate: string,
  period: { start: string; end: string; days?: number },
  reportingCurrency: string = 'USD',
  entities?: AlgorithmContext['entities']
): AlgorithmContext {
  const startDate = period.start;
  const endDate = period.end || asOfDate;
  const postableTxs = (transactions || []).filter(isPostable).filter(t => {
    if (!startDate || !endDate) return true;
    return isTransactionInDateRange(t, startDate, endDate);
  }) as PostableTransaction[];
  let days = period.days;
  if (!days) {
    const sTime = new Date(startDate).getTime();
    const eTime = new Date(endDate).getTime();
    const diff = Math.max(1, Math.round((eTime - sTime) / (1000 * 60 * 60 * 24)));
    days = Number.isNaN(diff) ? 365 : diff;
  }

  const getRole = (accId: string) => resolveAccountRole(accounts.find(a => a.id === accId));
  const getType = (accId: string) => accounts.find(a => a.id === accId)?.type;

  const accounting = {
    isCash: (id: string) => getRole(id) === 'cash',
    isRevenue: (id: string) => getRole(id) === 'revenue' || getType(id) === 'income',
    isCOGS: (id: string) => getRole(id) === 'cogs' || getType(id) === 'cost_of_goods',
    isExpense: (id: string) => getRole(id) === 'expense' || getType(id) === 'expense',
    isAR: (id: string) => getRole(id) === 'ar',
    isAP: (id: string) => getRole(id) === 'ap',
    isEquity: (id: string) => getRole(id) === 'equity' || getType(id) === 'equity',
    isLiability: (id: string) => getRole(id) === 'liability' || getRole(id) === 'ap' || getType(id) === 'liability',
    isAsset: (id: string) => getRole(id) === 'asset' || getRole(id) === 'cash' || getRole(id) === 'ar' || getType(id) === 'asset'
  };

  return {
    transactions: postableTxs,
    accounts: accounts || [],
    asOfDate,
    period: {
      start: startDate,
      end: endDate,
      days
    },
    reportingCurrency,
    entities: entities || {},
    accounting
  };
}

export interface AlgorithmDefinition {
  help?: { scope: string; method: string; example: string; limits: string };
  domain?: 'finance' | 'operations' | 'forensics' | 'planning' | 'treasury' | 'system' | 'valuation';
  requires?: ('transactions' | 'invoices' | 'bills' | 'accounts' | 'budgets')[];
  tags?: string[];
  id: string;
  name: string;
  description: string;
  inputs: AlgoInput[];
  compute(ctx: AlgorithmContext, inputs: Record<string, unknown>): AlgoResult;
}
