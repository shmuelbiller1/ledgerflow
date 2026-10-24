/**
 * A-169: Manufacturing light — work order screen (build N kits; posting stays AI #1's).
 *
 * Uses `kitAssembly.ts` (`kitBuildPlan`) to plan, schedule, track (`planned` → `in_progress` →
 * `completed` / `cancelled`), and export numbered kit assembly work orders (`WO-<year>-<nnn>`),
 * persisted durably inside `InventoryItem.metadata.workOrders` on the bundle item.
 *
 * Explicit boundary per A-169 spec: work orders track build quantities, required part pick lists,
 * and shop-floor completion status only — `quantityAtHand` and GL inventory entries remain 100%
 * server-only under AI #1's stock adjustment / invoice bundle lines.
 */
import type { InventoryItem } from '../types';
import { isBundle, type BundleHost } from './itemBundles';
import { kitBuildPlan, type KitBuildPlan } from './kitAssembly';

export type WorkOrderStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface WorkOrderRecord {
  id: string;
  woNumber: string;
  kitItemId: string;
  kitName: string;
  quantityToBuild: number;
  status: WorkOrderStatus;
  dueDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkOrderWithPlan extends WorkOrderRecord {
  plan: KitBuildPlan | null;
}

export function workOrdersFromItem(item: InventoryItem): WorkOrderRecord[] {
  const raw = item.metadata?.workOrders;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((w): w is Record<string, unknown> => Boolean(w && typeof w === 'object'))
    .map(w => ({
      id: String(w.id || ''),
      woNumber: String(w.woNumber || '').trim(),
      kitItemId: item.id,
      kitName: item.name,
      quantityToBuild: Math.max(1, Math.floor(Number(w.quantityToBuild) || 0)),
      status: (['planned', 'in_progress', 'completed', 'cancelled'].includes(String(w.status))
        ? String(w.status)
        : 'planned') as WorkOrderStatus,
      ...(typeof w.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.dueDate) ? { dueDate: w.dueDate } : {}),
      ...(typeof w.notes === 'string' && w.notes.trim() ? { notes: w.notes.trim().slice(0, 240) } : {}),
      createdAt: String(w.createdAt || ''),
      ...(typeof w.updatedAt === 'string' ? { updatedAt: w.updatedAt } : {}),
    }))
    .filter(w => w.id && w.woNumber && w.quantityToBuild >= 1);
}

export function nextWorkOrderNumber(existing: Pick<WorkOrderRecord, 'woNumber'>[], year: string): string {
  const prefix = `WO-${year}-`;
  const highest = existing.reduce((max, wo) => {
    const n = wo.woNumber?.startsWith(prefix) ? Number(wo.woNumber.slice(prefix.length)) : 0;
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

export function allWorkOrdersWithPlans(items: InventoryItem[]): WorkOrderWithPlan[] {
  const out: WorkOrderWithPlan[] = [];
  for (const item of items || []) {
    if (!isBundle(item as BundleHost)) continue;
    for (const wo of workOrdersFromItem(item)) {
      out.push({
        ...wo,
        plan: kitBuildPlan(item as BundleHost & { name: string }, items, wo.quantityToBuild),
      });
    }
  }
  return out.sort((a, b) => b.woNumber.localeCompare(a.woNumber, undefined, { numeric: true }));
}

export const WORK_ORDERS_CSV_HEADERS = [
  'Work order', 'Kit', 'Quantity to build', 'Status', 'Due date', 'Buildable from stock now', 'Component status', 'Notes',
];

export function workOrdersCsvRows(rows: WorkOrderWithPlan[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.woNumber,
    r.kitName,
    r.quantityToBuild,
    r.status,
    r.dueDate || '',
    r.plan ? r.plan.buildableKits : '',
    r.plan?.problem || 'Parts available',
    r.notes || '',
  ]);
}
