/**
 * EU-I3: the free invoice maker at the door (`/make-invoice`). Pure: totals, the hand-off draft,
 * and the one browser slot the draft travels in. Nothing here posts or saves to a server; "Save
 * this and track who paid" opens the sample company with the draft in the invoice form.
 */
import type { Invoice } from '../types';
import { currencyDigits } from './currencyMinorUnits';

export interface FreeInvoiceLine { description: string; quantity: number; rateCents: number }
export interface FreeInvoice {
  from: string;
  to: string;
  number: string;
  date: string;
  dueDate: string;
  currency: string;
  /** Percent, 0–100. */
  taxRate: number;
  lines: FreeInvoiceLine[];
}

export const FREE_INVOICE_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD'] as const;
export const FREE_INVOICE_STORAGE_KEY = 'ledgerflow_free_invoice_draft';

const round = (n: number) => Math.round(n);
/** The tax percent the maker works with: 0–100. */
export const cappedRate = (rate: number) => Math.min(100, Math.max(0, Number(rate) || 0));

/** The capped percent in the one form the invoice form cannot misread (see toInvoiceDraft). */
export const handOverRate = (rate: number) => {
  const pct = cappedRate(rate);
  return pct > 1 ? pct : pct / 100;
};

/** One line's amount in minor units: quantity × rate, rounded to a whole unit. */
export function lineAmount(line: FreeInvoiceLine): number {
  return round((Number(line.quantity) || 0) * (Number(line.rateCents) || 0));
}

export function freeInvoiceTotals(inv: Pick<FreeInvoice, 'lines' | 'taxRate'>) {
  const subtotal = inv.lines.reduce((s, l) => s + lineAmount(l), 0);
  const rate = cappedRate(inv.taxRate);
  const tax = round(subtotal * rate / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Typed text as minor units of `currency`; null when it is not an amount. */
export function parseRate(text: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const t = text.trim().replace(/[\s,](?=\d{3}(\D|$))/g, '');
  if (!t) return 0;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m || (m[2] || '').length > digits) return null;
  return Number(m[1]) * 10 ** digits + Number((m[2] || '').padEnd(digits, '0') || 0);
}

/** Why the invoice is not ready to save or print, or null. */
export function freeInvoiceProblem(inv: FreeInvoice): string | null {
  if (!inv.to.trim()) return 'Add who the invoice is for.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date)) return 'Choose the invoice date.';
  if (inv.dueDate && inv.dueDate < inv.date) return 'The due date is before the invoice date.';
  const used = inv.lines.filter(l => l.description.trim() || l.rateCents);
  if (!used.length) return 'Add at least one line.';
  if (used.some(l => !l.description.trim())) return 'Every line needs a description.';
  if (used.some(l => !(l.quantity > 0))) return 'Every line needs a quantity above zero.';
  return null;
}

/** The invoice form's starting values in the sample company: a draft, never posted by itself. */
export function toInvoiceDraft(inv: FreeInvoice): Partial<Invoice> {
  const used = inv.lines.filter(l => l.description.trim());
  const totals = freeInvoiceTotals({ lines: used, taxRate: inv.taxRate });
  return {
    customerName: inv.to.trim(),
    ...(inv.number.trim() ? { number: inv.number.trim() } : {}),
    date: inv.date,
    dueDate: inv.dueDate || inv.date,
    currency: inv.currency,
    status: 'draft',
    // the invoice form reads above 1 as a percent and 0–1 as a fraction: 17% goes over as 17 (so
    // the form's percent field shows 17), and 1% or less as its fraction (1% → 0.01)
    taxRate: handOverRate(inv.taxRate),
    amountCents: totals.total,
    items: used.map((l, i) => ({
      id: `free-${i + 1}`,
      description: l.description.trim(),
      quantity: l.quantity,
      rateCents: l.rateCents,
      amountCents: lineAmount(l),
      accountId: '',
    })),
    metadata: { source: 'free-invoice-maker', ...(inv.from.trim() ? { from: inv.from.trim() } : {}) },
  };
}

/** Put the draft where the sample company's Sales screen will pick it up once. */
export function stashFreeInvoice(storage: Pick<Storage, 'setItem'>, inv: FreeInvoice): boolean {
  try {
    storage.setItem(FREE_INVOICE_STORAGE_KEY, JSON.stringify(toInvoiceDraft(inv)));
    return true;
  } catch {
    return false; // private mode / blocked storage: the caller says the draft could not be carried
  }
}

/** A waiting draft, or null when there is none or it is unreadable. Reading does not clear it. */
export function readFreeInvoice(storage: Pick<Storage, 'getItem'>): Partial<Invoice> | null {
  try {
    const raw = storage.getItem(FREE_INVOICE_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<Invoice>;
    return draft && typeof draft === 'object' && draft.metadata?.source === 'free-invoice-maker' ? draft : null;
  } catch {
    return null; // unreadable or blocked storage: there is simply no draft to open
  }
}

/** The draft is opened once: clear it after the form has taken it. */
export function clearFreeInvoice(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(FREE_INVOICE_STORAGE_KEY);
  } catch {
    // ignore: blocked storage has nothing to clear (best-effort)
  }
}
