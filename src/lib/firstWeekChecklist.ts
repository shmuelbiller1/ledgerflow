import { resolveAccountRole } from './accountUtils';
import type { ChartAccount, Customer, Invoice, Payment } from '../types';

export type FirstWeekStepId = 'bank' | 'customer' | 'invoice' | 'payment' | 'profit-and-loss';

export interface FirstWeekSignals {
  workspaceId: string;
  accounts: readonly ChartAccount[];
  customers: readonly Customer[];
  invoices: readonly Invoice[];
  payments: readonly Payment[];
  profitAndLossVisited: boolean;
}

export interface FirstWeekStep {
  id: FirstWeekStepId;
  title: string;
  description: string;
  action: string;
  page: { tab: string; sub?: string };
  done: boolean;
}

/**
 * Progress for the Overview's first-week checklist. Records must belong to the current workspace;
 * draft/void invoices and draft/void payments are not evidence that the corresponding workflow
 * completed. The report step is an explicit navigation action rather than a ledger record.
 */
export function evaluateFirstWeekChecklist(input: FirstWeekSignals): FirstWeekStep[] {
  const inWorkspace = <T extends { workspaceId?: string }>(rows: readonly T[]) =>
    rows.filter(row => row.workspaceId === input.workspaceId);
  const bankAdded = inWorkspace(input.accounts).some(account => {
    if (account.isArchived || account.archived || account.isActive === false || resolveAccountRole(account) !== 'cash') return false;
    const subtype = String(account.subtype || '').toLowerCase();
    const category = String(account.category || '').toLowerCase();
    const name = String(account.name || '').toLowerCase();
    return Boolean(account.bankId)
      || ['bank', 'checking', 'savings', 'money market', 'moneymrkt'].includes(subtype)
      || category.includes('bank')
      || name.includes('bank')
      || name.includes('checking')
      || name.includes('savings');
  });
  const customerAdded = inWorkspace(input.customers).some(customer => customer.status !== 'inactive' && customer.status !== 'blocked');
  const invoiceIssued = inWorkspace(input.invoices).some(invoice =>
    ['pending', 'approved', 'sent', 'paid', 'partially_paid', 'overdue', 'invoiced'].includes(invoice.status),
  );
  const paymentRecorded = inWorkspace(input.payments).some(payment =>
    payment.direction === 'received' && payment.status === 'posted',
  );

  return [
    {
      id: 'bank',
      title: 'Add a bank account',
      description: 'Set up a bank account in your chart of accounts. This does not connect a live bank feed.',
      action: 'Open Banking',
      page: { tab: 'banking' },
      done: bankAdded,
    },
    {
      id: 'customer',
      title: 'Add a customer',
      description: 'Save a customer record in this workspace.',
      action: 'Open Customers',
      page: { tab: 'sales' },
      done: customerAdded,
    },
    {
      id: 'invoice',
      title: 'Send your first invoice',
      description: 'A sent or posted invoice counts; a draft does not.',
      action: 'Open Sales',
      page: { tab: 'sales' },
      done: invoiceIssued,
    },
    {
      id: 'payment',
      title: 'Record a customer payment',
      description: 'A posted payment received from a customer counts; a draft does not.',
      action: 'Open Payments',
      page: { tab: 'payments' },
      done: paymentRecorded,
    },
    {
      id: 'profit-and-loss',
      title: 'See the profit and loss report',
      description: 'Open the report to review the activity in your books.',
      action: 'Open profit and loss',
      page: { tab: 'reports', sub: 'pnl' },
      done: input.profitAndLossVisited,
    },
  ];
}

export function firstWeekStorageKey(userId: string | null | undefined, workspaceId: string | null | undefined): string {
  return `lf_first_week_v1:${userId || 'guest'}:${workspaceId || 'default'}`;
}

export function loadFirstWeekDismissed(userId: string | null | undefined, workspaceId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(firstWeekStorageKey(userId, workspaceId)) === 'dismissed';
  } catch {
    return false;
  }
}

export function saveFirstWeekDismissed(userId: string | null | undefined, workspaceId: string | null | undefined): void {
  try {
    localStorage.setItem(firstWeekStorageKey(userId, workspaceId), 'dismissed');
  } catch {
    // The checklist remains dismissible for this render even if browser storage is unavailable.
  }
}

export function loadProfitAndLossVisited(userId: string | null | undefined, workspaceId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(`${firstWeekStorageKey(userId, workspaceId)}:pnl`) === 'visited';
  } catch {
    return false;
  }
}

export function saveProfitAndLossVisited(userId: string | null | undefined, workspaceId: string | null | undefined): void {
  try {
    localStorage.setItem(`${firstWeekStorageKey(userId, workspaceId)}:pnl`, 'visited');
  } catch {
    // The click still marks the step for the current component instance.
  }
}
