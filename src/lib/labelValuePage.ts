/**
 * EU-E6: one page per label value ("Maui house"): its open invoices and bills and its last entries. A document or
 * entry belongs to the value when it, or any of its lines, carries it. The profit figure on the page is the server's
 * Profit by Label column for the value, so the page and the report always agree. Read-only.
 */
import type { Bill, Invoice, Transaction } from '../types';
import { isPostable } from './txFilters';

type Dims = { dimensions?: Record<string, string> } | undefined;
const has = (d: Dims, label: string, value: string) => d?.dimensions?.[label] === value;

export function labelValueView(input: { label: string; value: string; transactions: readonly Transaction[]; invoices: readonly Invoice[]; bills: readonly Bill[]; lastCount?: number }) {
  const { label, value, transactions, invoices, bills, lastCount = 10 } = input;
  const openInvoices = invoices.filter(inv => !['paid', 'void', 'draft'].includes(String(inv.status))
    && (has(inv as Dims, label, value) || (inv.items || []).some(i => has(i as Dims, label, value))));
  const openBills = bills.filter(b => !['paid', 'void', 'draft'].includes(String(b.status))
    && (has(b as Dims, label, value) || ((b as { splits?: Dims[] }).splits || []).some(s => has(s, label, value))));
  const entries = transactions
    .filter(t => isPostable(t) && (has(t as Dims, label, value) || (t.lines || []).some(l => has(l as Dims, label, value))))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, lastCount);
  return { openInvoices, openBills, entries };
}
