/**
 * A-142: issued-invoice line sales by the invoice item's Location dimension. This follows the
 * existing Sales by Item inclusion rules and uses the existing stored-rate conversion; it does not
 * change invoice values or compare currencies without converting them to the workspace base.
 */
import type { DimensionNode, Invoice } from '../types';
import { INVOICE_IS_ISSUED } from '../server/reports/computeReports';
import { toBaseCents } from '../server/reports/partyReports';
import { isOpeningBalanceDocument } from './partyOpeningBalance';
import { resolveDimensionLabel } from './dimensionUtils';
import { normalizeSearchText } from './textNormalization';
import { validCustomReportPeriod } from './reportCustomPeriod';

export const NO_LOCATION_KEY = '__unassigned_location__';
export const NO_LOCATION_LABEL = 'Unassigned';

export interface SalesByTerritoryInput {
  invoices: readonly Invoice[];
  locationDimensionId?: string;
  dimensionNodes?: readonly DimensionNode[];
  startDate?: string;
  endDate?: string;
  homeCurrency?: string;
}

export interface SalesByTerritoryRow {
  key: string;
  locationValue?: string;
  locationName: string;
  invoiceCount: number;
  lineCount: number;
  salesCents: number;
}

export interface SalesByTerritoryReport {
  rows: SalesByTerritoryRow[];
  totalSalesCents: number;
  invoiceCount: number;
  startDate?: string;
  endDate?: string;
  locationDimensionId: string;
}

function inPeriod(date: string, start?: string, end?: string): boolean {
  if (!date) return false;
  if (!start && !end) return true;
  if (!validCustomReportPeriod({ startDate: start || end || '', endDate: end || start || '' })) return false;
  return (!start || date >= start) && (!end || date <= end);
}

function canonicalLocationValue(value: string, dimensionId: string, nodes: readonly DimensionNode[]): string {
  const normalized = normalizeSearchText(value.trim());
  const matches = (candidate: string | undefined) => typeof candidate === 'string' && normalizeSearchText(candidate.trim()) === normalized;
  const node = nodes.find(candidate => candidate.dimensionId === dimensionId &&
    (matches(candidate.id) || matches(candidate.description) || candidate.aliases?.some(matches)));
  if (node) return node.id;

  // For a hierarchical value such as "L1/aisle-2", canonicalize its known root but retain the path.
  const [root, ...rest] = value.split('/');
  if (rest.length) {
    const rootNormalized = normalizeSearchText(root.trim());
    const rootNode = nodes.find(candidate => candidate.dimensionId === dimensionId && (
      normalizeSearchText(candidate.id) === rootNormalized ||
      normalizeSearchText(candidate.description) === rootNormalized ||
      candidate.aliases?.some(alias => normalizeSearchText(alias) === rootNormalized)
    ));
    if (rootNode) return [rootNode.id, ...rest].join('/');
  }
  return value.trim();
}

/** One row per stored Location value, plus a visible Unassigned bucket for lines without one. */
export function salesByTerritory(input: SalesByTerritoryInput): SalesByTerritoryReport {
  const dimensionId = input.locationDimensionId || 'location';
  const nodes = input.dimensionNodes || [];
  const buckets = new Map<string, { locationValue?: string; locationName: string; salesCents: number; invoices: Set<string>; lineCount: number }>();
  const includedInvoices = new Set<string>();

  for (const invoice of input.invoices) {
    if (!INVOICE_IS_ISSUED.has(invoice.status) || isOpeningBalanceDocument(invoice) ||
        Boolean((invoice as Invoice & { deletedAt?: string }).deletedAt)) continue;
    const date = String(invoice.date || '').slice(0, 10);
    if (!inPeriod(date, input.startDate, input.endDate)) continue;

    for (const line of invoice.items || []) {
      const raw = typeof line.dimensions?.[dimensionId] === 'string' ? line.dimensions[dimensionId].trim() : '';
      const canonical = raw && raw.toLowerCase() !== 'unassigned' ? canonicalLocationValue(raw, dimensionId, nodes) : '';
      const key = canonical || NO_LOCATION_KEY;
      const locationName = canonical ? resolveDimensionLabel(nodes as DimensionNode[], dimensionId, raw) : NO_LOCATION_LABEL;
      const bucket = buckets.get(key) || { locationValue: canonical || undefined, locationName, salesCents: 0, invoices: new Set<string>(), lineCount: 0 };
      const amountCents = Number.isFinite(line.amountCents) ? line.amountCents : 0;
      bucket.salesCents += toBaseCents(amountCents, invoice.exchangeRate, invoice.currency, input.homeCurrency || 'USD');
      bucket.invoices.add(invoice.id);
      bucket.lineCount++;
      buckets.set(key, bucket);
      includedInvoices.add(invoice.id);
    }
  }

  const rows = [...buckets.entries()].map(([key, bucket]): SalesByTerritoryRow => ({
    key,
    ...(bucket.locationValue ? { locationValue: bucket.locationValue } : {}),
    locationName: bucket.locationName,
    invoiceCount: bucket.invoices.size,
    lineCount: bucket.lineCount,
    salesCents: bucket.salesCents,
  })).sort((a, b) => {
    if (a.key === NO_LOCATION_KEY) return 1;
    if (b.key === NO_LOCATION_KEY) return -1;
    return b.salesCents - a.salesCents || a.locationName.localeCompare(b.locationName) || a.key.localeCompare(b.key);
  });

  return {
    rows,
    totalSalesCents: rows.reduce((sum, row) => sum + row.salesCents, 0),
    invoiceCount: includedInvoices.size,
    startDate: input.startDate,
    endDate: input.endDate,
    locationDimensionId: dimensionId,
  };
}

export const SALES_BY_TERRITORY_CSV_HEADERS = [
  'Location', 'Stored Location value', 'Issued invoices', 'Invoice lines', 'Sales (workspace base minor units)',
];

export function salesByTerritoryCsvRows(rows: readonly SalesByTerritoryRow[]): Array<Array<string | number>> {
  return rows.map(row => [row.locationName, row.locationValue || '', row.invoiceCount, row.lineCount, row.salesCents]);
}
