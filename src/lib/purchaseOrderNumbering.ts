/**
 * Purchase order numbering, in its own module so the server can number a drop-ship order (W-08) without
 * reaching the screen's purchase-order rules (src/lib/purchaseOrders.ts imports the browser's utils).
 */
import type { PurchaseOrder } from '../types';

/** PO-<year>-<nnn>, one more than the highest number used this year. */
export function nextPoNumber(existing: Pick<PurchaseOrder, 'poNumber'>[], year: string): string {
  const prefix = `PO-${year}-`;
  const highest = existing.reduce((max, po) => {
    const n = po.poNumber?.startsWith(prefix) ? Number(po.poNumber.slice(prefix.length)) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}
