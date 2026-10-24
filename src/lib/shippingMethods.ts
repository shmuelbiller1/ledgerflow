/**
 * A-124: Shipping methods and rates table.
 *
 * Each shipping method is saved as a service item (`itemType: 'service'`) in `inventory` with
 * structured metadata under `metadata.shippingMethod` (`carrier`, `zone`, `freeAboveCents`,
 * `minDays`, `maxDays`, `currency`). Because it lives in `inventory`, every shipping method is
 * immediately selectable on sales invoices, estimates/quotes, and purchase orders with zero changes
 * to document posting or database schema rules.
 *
 * Rate calculation (`quoteShippingCharge`) runs strictly in whole minor units and refuses mismatched
 * currencies rather than inventing an exchange rate.
 */
import type { InventoryItem } from '../types';

export interface ShippingMethodMeta {
  carrier: string;
  zone: string;
  currency: string;
  /** Order subtotal (minor units, same currency) at or above which shipping becomes 0; null = never free */
  freeAboveCents?: number | null;
  minDays?: number;
  maxDays?: number;
}

export interface ShippingMethodRow {
  id: string;
  name: string;
  sku: string;
  carrier: string;
  zone: string;
  currency: string;
  rateCents: number;
  freeAboveCents: number | null;
  minDays?: number;
  maxDays?: number;
}

export function shippingMethodsFromInventory(
  items: InventoryItem[],
  defaultCurrency = 'USD',
): ShippingMethodRow[] {
  const out: ShippingMethodRow[] = [];
  for (const item of items || []) {
    const raw = item.metadata?.shippingMethod;
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const freeRaw = m.freeAboveCents;
    const freeAboveCents = typeof freeRaw === 'number' && Number.isFinite(freeRaw) && freeRaw > 0
      ? Math.round(freeRaw)
      : null;
    out.push({
      id: item.id,
      name: item.name,
      sku: item.sku || '',
      carrier: String(m.carrier || '').trim() || 'Standard carrier',
      zone: String(m.zone || '').trim() || 'Domestic',
      currency: String(m.currency || defaultCurrency || 'USD').trim().toUpperCase(),
      rateCents: Math.max(0, Math.round(Number(item.unitPriceCents) || 0)),
      freeAboveCents,
      ...(Number.isFinite(Number(m.minDays)) && Number(m.minDays) >= 0 ? { minDays: Math.round(Number(m.minDays)) } : {}),
      ...(Number.isFinite(Number(m.maxDays)) && Number(m.maxDays) >= 0 ? { maxDays: Math.round(Number(m.maxDays)) } : {}),
    });
  }
  return out.sort((a, b) => a.zone.localeCompare(b.zone) || a.rateCents - b.rateCents || a.name.localeCompare(b.name));
}

export function shippingMethodProblem(input: {
  name?: string;
  rateCents?: number;
  freeAboveCents?: number | null;
  minDays?: number;
  maxDays?: number;
}): string | null {
  if (!input.name?.trim()) return 'Enter a shipping method name.';
  const rate = Math.round(Number(input.rateCents) || 0);
  if (rate < 0) return 'Shipping rate cannot be negative.';
  if (input.freeAboveCents != null && input.freeAboveCents < 0) return 'Free-shipping threshold cannot be negative.';
  if (input.minDays !== undefined && input.maxDays !== undefined && input.maxDays < input.minDays) {
    return 'Maximum delivery days cannot be less than minimum days.';
  }
  return null;
}

export function quoteShippingCharge(
  method: Pick<ShippingMethodRow, 'rateCents' | 'freeAboveCents' | 'currency'>,
  orderSubtotalCents: number,
  orderCurrency: string,
): { chargeCents: number | null; freeApplied: boolean; problem?: string } {
  const mCcy = method.currency.trim().toUpperCase();
  const oCcy = orderCurrency.trim().toUpperCase();
  if (mCcy !== oCcy) {
    return {
      chargeCents: null,
      freeApplied: false,
      problem: `Shipping method is priced in ${mCcy}, not ${oCcy} (no exchange rate is guessed).`,
    };
  }
  const sub = Math.max(0, Math.round(Number(orderSubtotalCents) || 0));
  if (method.freeAboveCents !== null && sub >= method.freeAboveCents) {
    return { chargeCents: 0, freeApplied: true };
  }
  return { chargeCents: method.rateCents, freeApplied: false };
}

export const SHIPPING_METHODS_CSV_HEADERS = [
  'Method', 'SKU', 'Carrier', 'Zone', 'Currency', 'Rate (minor units)', 'Free from (minor units)', 'Transit days',
];

export function shippingMethodsCsvRows(rows: ShippingMethodRow[]): Array<Array<string | number>> {
  return rows.map(r => [
    r.name,
    r.sku,
    r.carrier,
    r.zone,
    r.currency,
    r.rateCents,
    r.freeAboveCents ?? '',
    r.minDays !== undefined && r.maxDays !== undefined ? `${r.minDays}-${r.maxDays}` : r.minDays !== undefined ? String(r.minDays) : '',
  ]);
}
