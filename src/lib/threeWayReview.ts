/**
 * A-118: the three-way match review. A read-only report over the check the Purchase orders screen
 * already runs — order against goods received against the supplier's bill — with the figures an
 * accountant needs to review a period instead of one order at a time:
 *
 * - the match itself is NOT recalculated here: `performThreeWayMatch` is called once and its result
 *   is presented (so the report and the screen can never disagree about an order);
 * - every amount is the order's own numbers in the order's own currency; currencies are never added
 *   together, so the totals are per currency;
 * - the bill variance is the bill against the order, which is what "price variance" means in the
 *   engine; a positive figure means the bill is higher than the order;
 * - draft and cancelled orders are left to the engine (it already skips cancelled ones); the period
 *   filters on the order's issue date and says which window it used;
 * - the engine's own sentences are shown as its wording, without rewriting them.
 *
 * Nothing here posts, edits an order, a receipt or a bill, or changes the tolerance the check uses.
 */
import type { Bill, PurchaseOrder, ThreeWayMatchResult, Vendor } from '../types';
import { performThreeWayMatch } from './threeWayMatchEngine';
import { byCodeUnit } from './codeUnitOrder';

export type ThreeWayStatus = ThreeWayMatchResult['status'];

export interface ThreeWayReviewRow {
  poId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  issueDate: string;
  currency: string;
  status: ThreeWayStatus;
  orderedCents: number;
  receivedCents: number;
  billedCents: number;
  /** billed against ordered; 0 when no bill is recorded */
  varianceCents: number;
  /**
   * variance against the order in percent to two decimals; undefined when the order is zero or no
   * bill is recorded
   */
  variancePercent?: number;
  billId?: string;
  receiptId?: string;
  /** the engine's own sentences */
  findings: string[];
}

export interface ThreeWayReviewStatusTotal {
  status: ThreeWayStatus;
  orders: number;
  varianceCents: number;
}

export interface ThreeWayReviewReport {
  rows: ThreeWayReviewRow[];
  summary: {
    orders: number;
    matched: number;
    priceVariance: number;
    quantityVariance: number;
    unreceived: number;
    missingBill: number;
    varianceCents: number;
    byStatus: ThreeWayReviewStatusTotal[];
  };
  byCurrency: Array<{ currency: string; orders: number; varianceCents: number }>;
  window: { from: string; to: string };
  toleranceCents: number;
}

export interface ThreeWayReviewInput {
  orders: Array<Pick<PurchaseOrder, 'id' | 'poNumber' | 'vendorId' | 'issueDate' | 'status' | 'items' | 'totalAmountCents' | 'currency' | 'receipts' | 'billId'>>;
  bills: Bill[];
  vendors: Array<Pick<Vendor, 'id' | 'name'>>;
  /** inclusive window on the order's issue date (YYYY-MM-DD); omitted sides are open */
  from?: string;
  to?: string;
  /** one status only; 'all' (default) keeps every order the engine looked at */
  status?: ThreeWayStatus | 'all';
  /** the tolerance the engine uses, in the order's own minor units; 0 by default, as on the screen */
  toleranceCents?: number;
}

const ORDER = ['matched', 'quantity_variance', 'price_variance', 'unreceived', 'missing_bill'] as const;

export function threeWayReview(input: ThreeWayReviewInput): ThreeWayReviewReport {
  const window = { from: input.from || '', to: input.to || '' };
  const inWindow = (date: string) => !!date && (!window.from || date >= window.from) && (!window.to || date <= window.to);
  const orders = input.orders.filter(order => inWindow((order.issueDate || '').slice(0, 10)));
  const receipts = orders.flatMap(order => order.receipts || []);
  const toleranceCents = Math.max(0, Math.round(input.toleranceCents || 0));
  const engine = performThreeWayMatch(orders as PurchaseOrder[], receipts, input.bills, toleranceCents);
  const names = new Map(input.vendors.map(vendor => [vendor.id, vendor.name]));
  const byId = new Map(orders.map(order => [order.id, order]));

  const rows: ThreeWayReviewRow[] = engine.results.flatMap(result => {
    const order = byId.get(result.poId);
    if (!order) return [];
    const orderedCents = result.poAmountCents;
    const billedCents = result.billAmountCents;
    const hasBill = !!result.billId;
    const varianceCents = hasBill ? billedCents - orderedCents : 0;
    return [{
      poId: result.poId,
      poNumber: result.poNumber,
      vendorId: order.vendorId,
      vendorName: names.get(order.vendorId) || 'Unknown vendor',
      issueDate: (order.issueDate || '').slice(0, 10),
      currency: order.currency || '',
      status: result.status,
      orderedCents,
      receivedCents: result.receiptAmountCents,
      billedCents,
      varianceCents,
      ...(hasBill && orderedCents !== 0 ? { variancePercent: Math.round((varianceCents / orderedCents) * 10000) / 100 } : {}),
      billId: result.billId,
      receiptId: result.receiptId,
      findings: result.discrepancies,
    }];
  });

  const filtered = input.status && input.status !== 'all' ? rows.filter(row => row.status === input.status) : rows;
  filtered.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.issueDate.localeCompare(b.issueDate) || a.poNumber.localeCompare(b.poNumber));

  const byStatus: ThreeWayReviewStatusTotal[] = ORDER.map(status => {
    const own = filtered.filter(row => row.status === status);
    return { status, orders: own.length, varianceCents: own.reduce((sum, row) => sum + Math.abs(row.varianceCents), 0) };
  });
  const currencies = [...new Set(filtered.map(row => row.currency))].sort(byCodeUnit);
  const byCurrency = currencies.map(currency => {
    const own = filtered.filter(row => row.currency === currency);
    return { currency, orders: own.length, varianceCents: own.reduce((sum, row) => sum + Math.abs(row.varianceCents), 0) };
  });

  return {
    rows: filtered,
    summary: {
      orders: filtered.length,
      matched: filtered.filter(row => row.status === 'matched').length,
      priceVariance: filtered.filter(row => row.status === 'price_variance').length,
      quantityVariance: filtered.filter(row => row.status === 'quantity_variance').length,
      unreceived: filtered.filter(row => row.status === 'unreceived').length,
      missingBill: filtered.filter(row => row.status === 'missing_bill').length,
      varianceCents: filtered.reduce((sum, row) => sum + Math.abs(row.varianceCents), 0),
      byStatus,
    },
    byCurrency,
    window,
    toleranceCents,
  };
}

export const THREE_WAY_REVIEW_CSV_HEADERS = [
  'Order', 'Vendor', 'Issue date', 'Currency', 'Result', 'Ordered (minor units)', 'Received (minor units)',
  'Billed (minor units)', 'Variance (minor units)', 'Variance (%)', 'Bill', 'Receipt', 'Findings',
];

export function threeWayReviewCsvRows(report: ThreeWayReviewReport): Array<Array<string | number>> {
  return report.rows.map(row => [
    row.poNumber, row.vendorName, row.issueDate, row.currency, row.status, row.orderedCents, row.receivedCents,
    row.billedCents, row.varianceCents, row.variancePercent ?? '', row.billId || '', row.receiptId || '', row.findings.join(' '),
  ]);
}
