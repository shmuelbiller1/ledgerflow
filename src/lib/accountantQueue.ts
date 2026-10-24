/**
 * A-155: Accountant queue screen — one unified triage inbox for questions on entries, held
 * approvals (invoices, purchase orders, expense claims), unposted manual adjustments/drafts, and
 * active period-lock exceptions, each with direct navigation metadata to the exact screen & record.
 *
 * Pure read-only aggregation: mutates nothing and posts nothing.
 */
import type { Bill, Invoice, PurchaseOrder, Transaction, Workspace } from '../types';
import type { ClientQuery } from './clientQueries';
import { approvalStatus } from './invoiceApproval';
import { awaitingApproval } from './purchaseOrders';
import { claimOf } from './expenseClaims';
import { formatCurrency } from './utils';

export type AccountantQueueKind = 'question' | 'approval' | 'adjustment' | 'locked-period';

export interface AccountantQueueItem {
  id: string;
  kind: AccountantQueueKind;
  title: string;
  subtitle: string;
  date: string;
  amountFormatted?: string;
  targetTab: string;
  recordRef?: { type: 'transaction' | 'invoice' | 'bill'; id: string };
}

export function buildAccountantQueue(input: {
  queries: ClientQuery[];
  invoices: Invoice[];
  purchaseOrders: PurchaseOrder[];
  bills: Bill[];
  transactions: Transaction[];
  workspace?: Partial<Workspace> | null;
}): AccountantQueueItem[] {
  const { queries, invoices, purchaseOrders, bills, transactions, workspace } = input;
  const home = workspace?.currency || 'USD';
  const items: AccountantQueueItem[] = [];

  // 1. Open entry questions (BD-07)
  for (const q of queries || []) {
    if (q.status === 'closed') continue;
    const latest = q.messages?.[q.messages.length - 1];
    items.push({
      id: `q:${q.id}`,
      kind: 'question',
      title: `Entry question · ${q.entry?.description || q.transactionId}`,
      subtitle: latest?.text ? `${q.status === 'open' ? 'Waiting for answer' : 'Answered — review to close'}: ${latest.text}` : 'Open question thread',
      date: String(q.updatedAt || q.askedAt || '').slice(0, 10),
      targetTab: 'client-queries',
      recordRef: { type: 'transaction', id: q.transactionId },
    });
  }

  // 2. Held invoices awaiting approval (BE-04)
  for (const inv of invoices || []) {
    if (approvalStatus(inv, workspace?.invoiceApproval) !== 'awaiting') continue;
    items.push({
      id: `inv-app:${inv.id}`,
      kind: 'approval',
      title: `Invoice approval · ${inv.number || inv.id} (${inv.customerName || 'Customer'})`,
      subtitle: 'Above workspace invoice approval threshold — held from emailing until approved',
      date: String(inv.date || '').slice(0, 10),
      amountFormatted: formatCurrency(inv.amountCents || 0, inv.currency || home),
      targetTab: 'sales',
      recordRef: { type: 'invoice', id: inv.id },
    });
  }

  // 3. Purchase orders awaiting approval (K-23 / A-120)
  for (const po of purchaseOrders || []) {
    if (!awaitingApproval(po)) continue;
    items.push({
      id: `po-app:${po.id}`,
      kind: 'approval',
      title: `Purchase order approval · ${po.poNumber} (${po.vendorName})`,
      subtitle: 'Awaiting owner or accountant approval before goods receipt or billing',
      date: String(po.issueDate || '').slice(0, 10),
      amountFormatted: formatCurrency(po.totalAmountCents || 0, po.currency || home),
      targetTab: 'purchase-orders',
    });
  }

  // 4. Submitted expense claims awaiting decision (K-22)
  for (const bill of bills || []) {
    const claim = claimOf(bill);
    if (!claim || claim.state !== 'submitted' || bill.status !== 'draft') continue;
    items.push({
      id: `claim:${bill.id}`,
      kind: 'approval',
      title: `Expense claim · ${bill.vendorName || 'Employee'}`,
      subtitle: `${(bill.splits || []).map(s => s.description).filter(Boolean).join(', ') || 'Submitted claim'} — waiting for approval`,
      date: String(bill.date || bill.issueDate || '').slice(0, 10),
      amountFormatted: formatCurrency(bill.amountCents || 0, bill.currency || home),
      targetTab: 'purchases',
      recordRef: { type: 'bill', id: bill.id },
    });
  }

  // 5. Draft / pending manual journal adjustments
  for (const tx of transactions || []) {
    const rawStatus = String(tx.status || '');
    if (rawStatus !== 'draft' && rawStatus !== 'pending_approval') continue;
    items.push({
      id: `adj:${tx.id}`,
      kind: 'adjustment',
      title: `Draft adjustment · ${tx.description || tx.id}`,
      subtitle: rawStatus === 'pending_approval' ? 'Two-person rule: waiting for second signature' : 'Draft journal entry not yet posted to ledger',
      date: String(tx.date || '').slice(0, 10),
      amountFormatted: formatCurrency(Math.abs(tx.totalAmountCents || 0), home),
      targetTab: 'ledger',
      recordRef: { type: 'transaction', id: tx.id },
    });
  }

  // 6. Active period lock exception / reopen window
  const lockEx = (workspace as { lockException?: { until?: string; forUid?: string; reason?: string; throughDate?: string } } | undefined)?.lockException;
  if (lockEx && (lockEx.until || lockEx.reason)) {
    items.push({
      id: 'lock:active-exception',
      kind: 'locked-period',
      title: 'Open period-lock exception window',
      subtitle: `${lockEx.reason ? `Reason: ${lockEx.reason}` : 'Temporary lock exception active'}${lockEx.until ? ` · expires ${lockEx.until}` : ''}`,
      date: String(lockEx.until || workspace?.lockDate || '').slice(0, 10),
      targetTab: 'month-end-close',
    });
  }

  const kindPriority: Record<AccountantQueueKind, number> = {
    'locked-period': 0,
    question: 1,
    approval: 2,
    adjustment: 3,
  };

  return items.sort((a, b) =>
    kindPriority[a.kind] - kindPriority[b.kind]
    || (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99')
    || a.title.localeCompare(b.title));
}
