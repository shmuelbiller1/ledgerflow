/**
 * Sales reps and commission (P-13, A-123): a rep has a default commission percentage, optional
 * per-item-group percentages (`groupRates`, keyed by `InventoryItem.category`), and the customers
 * they look after (a customer has one rep at most). Commission is earned when the customer pays:
 * for a period, each payment applied to an invoice of the rep's customers, less the invoice's tax
 * share of it, times the applicable commission rate (per item category when `groupRates` matches
 * the line's item category, else `rep.commissionPercent`), in whole cents, in the workspace's
 * currency (at the payment's rate). Owners and accountants keep the reps (saved by the server on
 * the workspace, `salesReps`).
 */
import type { Invoice } from '../types';

export interface SalesRep {
  id: string;
  name: string;
  /** above 0 and at most 100, two decimals at most */
  commissionPercent: number;
  customerIds?: string[];
  /** A-123: optional commission rate overrides (0..100, at most 2 decimals) by item group / category */
  groupRates?: Record<string, number>;
}

export interface CommissionCatalogueItem {
  id: string;
  category?: string;
}

export const MAX_SALES_REPS = 100;
export const SALES_REP_ID = /^sr_[a-z0-9]{6,20}$/;

const norm = (s: string) => s.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function salesRepsProblem(reps: unknown): string | null {
  if (!Array.isArray(reps)) return 'The sales reps must be a list';
  if (reps.length > MAX_SALES_REPS) return `${MAX_SALES_REPS} sales reps at most`;
  const names = new Set<string>();
  const taken = new Map<string, string>();
  for (const raw of reps) {
    const rep = (raw || {}) as Partial<SalesRep>;
    const name = typeof rep.name === 'string' ? rep.name.trim() : '';
    if (name.length < 2 || name.length > 80) return 'Each sales rep needs a name of 2 to 80 characters';
    if (names.has(norm(name))) return `"${name}" is in the list twice`;
    names.add(norm(name));
    if (rep.id !== undefined && (typeof rep.id !== 'string' || !SALES_REP_ID.test(rep.id))) return `"${name}": its id is not one of this workspace's sales reps`;
    const p = rep.commissionPercent;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 100 || Math.round(p * 100) / 100 !== p) return `"${name}": the commission is a percentage above 0, at most 100, two decimals at most`;
    if (rep.groupRates !== undefined) {
      if (!rep.groupRates || typeof rep.groupRates !== 'object' || Array.isArray(rep.groupRates)) {
        return `"${name}": item-group rates must be an object of group → percentage`;
      }
      const entries = Object.entries(rep.groupRates);
      if (entries.length > 50) return `"${name}": 50 item-group overrides at most`;
      for (const [group, gp] of entries) {
        if (!group.trim() || group.length > 80) return `"${name}": each item group name must be 1 to 80 characters`;
        if (typeof gp !== 'number' || !Number.isFinite(gp) || gp < 0 || gp > 100 || Math.round(gp * 100) / 100 !== gp) {
          return `"${name}": the rate for "${group}" must be between 0 and 100, two decimals at most`;
        }
      }
    }
    if (rep.customerIds !== undefined) {
      if (!Array.isArray(rep.customerIds) || rep.customerIds.length > 5000 || rep.customerIds.some(c => typeof c !== 'string' || !c || c.length > 200)) return `"${name}": choose their customers`;
      for (const c of rep.customerIds) {
        const other = taken.get(c);
        if (other) return `A customer is looked after by both "${other}" and "${name}": one rep each`;
        taken.set(c, name);
      }
    }
  }
  return null;
}

export const repForCustomer = (reps: SalesRep[] | undefined, customerId: string | undefined) =>
  customerId ? (reps || []).find(r => (r.customerIds || []).includes(customerId)) : undefined;

export interface CommissionPayment {
  id: string;
  status?: string;
  paymentDate?: string;
  date?: string;
  exchangeRate?: number;
  allocations?: Array<{ documentId: string; documentType: string; amountCents: number }>;
}

export interface CommissionLine {
  repId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  paymentId: string;
  date: string;
  paidCents: number;
  netCents: number;
  commissionCents: number;
}

function rateForGroup(rep: SalesRep, category: string | undefined): number {
  if (!category || !rep.groupRates) return rep.commissionPercent;
  const target = norm(category);
  for (const [group, rate] of Object.entries(rep.groupRates)) {
    if (norm(group) === target) return rate;
  }
  return rep.commissionPercent;
}

/** Compute exact whole-cent commission for netCents, using line category shares when `rep.groupRates` is set. */
function computeLineCommissionCents(
  rep: SalesRep,
  inv: Invoice,
  netCents: number,
  categoryByItemId: Map<string, string>,
): number {
  const invItems = inv.items || [];
  if (!rep.groupRates || Object.keys(rep.groupRates).length === 0 || invItems.length === 0) {
    return Math.round(netCents * rep.commissionPercent / 100);
  }
  const lineBaseTotal = invItems.reduce((s, li) => s + Math.max(0, Number(li.amountCents) || 0), 0);
  if (lineBaseTotal <= 0) {
    return Math.round(netCents * rep.commissionPercent / 100);
  }
  let allocatedNet = 0;
  let totalCommission = 0;
  invItems.forEach((li, idx) => {
    const lineAmt = Math.max(0, Number(li.amountCents) || 0);
    const shareNet = idx === invItems.length - 1
      ? netCents - allocatedNet
      : Math.round(netCents * lineAmt / lineBaseTotal);
    allocatedNet += shareNet;
    const cat = li.itemId ? categoryByItemId.get(li.itemId) : undefined;
    totalCommission += Math.round(shareNet * rateForGroup(rep, cat) / 100);
  });
  return totalCommission;
}

/** Each payment applied in the period to an invoice of a rep's customer, with its commission. */
export function commissionLines(
  reps: SalesRep[],
  invoices: Invoice[],
  payments: CommissionPayment[],
  from: string,
  to: string,
  items?: CommissionCatalogueItem[],
): CommissionLine[] {
  const byId = new Map(invoices.map(i => [i.id, i]));
  const categoryByItemId = new Map<string, string>();
  for (const item of items || []) {
    if (item.id && item.category?.trim()) categoryByItemId.set(item.id, item.category.trim());
  }
  const lines: CommissionLine[] = [];
  for (const p of payments) {
    if (p.status === 'void') continue;
    const date = String(p.paymentDate || p.date || '').slice(0, 10);
    if (!date || date < from || date > to) continue;
    const rate = typeof p.exchangeRate === 'number' && p.exchangeRate > 0 ? p.exchangeRate : 1;
    for (const a of p.allocations || []) {
      if (a.documentType !== 'invoice' || !(a.amountCents > 0)) continue;
      const inv = byId.get(a.documentId);
      const rep = inv ? repForCustomer(reps, inv.customerId) : undefined;
      if (!inv || !rep) continue;
      const total = Number(inv.amountCents) || 0;
      const tax = Math.max(0, Number(inv.taxAmountCents) || 0);
      const paidCents = Math.round(a.amountCents * rate);
      // the tax in what was paid is the invoice's share of tax
      const netCents = total > 0 ? Math.round(paidCents * (total - Math.min(tax, total)) / total) : paidCents;
      const commissionCents = computeLineCommissionCents(rep, inv, netCents, categoryByItemId);
      lines.push({
        repId: rep.id,
        invoiceId: inv.id,
        invoiceNumber: String(inv.number || inv.id),
        customerName: String(inv.customerName || ''),
        paymentId: p.id,
        date,
        paidCents,
        netCents,
        commissionCents,
      });
    }
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true }));
}
