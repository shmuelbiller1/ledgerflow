/**
 * Data-quality checks for books hygiene before close and tax filings:
 * - A-194: posted entries missing labels required by `requiredLabels` rules.
 * - A-196: customers and vendors missing tax IDs or postal addresses needed for filings.
 * - A-197: active items missing unit cost or selling price (respecting service items and bundles).
 *
 * Pure and read-only: nothing here alters records, validates an ID with an external authority,
 * or shows an unmasked tax identifier.
 */
import type { Bill, ChartAccount, Customer, DimensionDefinition, InventoryItem, Invoice, Payment, Transaction, Vendor } from '../types';
import type { RecordRef } from './recordLinks';
import { isBundle } from './itemBundles';
import { missingLabels, requiredLabelRules, type MissingLabel } from './requiredLabels';
import { allocationThresholdCents } from './tax/ilAllocation';
import { threshold1099Cents } from './tax/us1099Preview';
import { isPostable, lineAmount } from './txFilters';
import { maskRecordedTaxId } from './vendorTaxRecords';
import { convertMinorUnits } from './currencyMinorUnits';

export interface MissingLabelEntryRow {
  transactionId: string;
  date: string;
  description: string;
  currency: string;
  totalAmountCents: number;
  severity: 'medium' | 'low';
  missing: MissingLabel[];
  summary: string;
  record: RecordRef;
}

export type FilingPartyKind = 'vendor' | 'customer';
export type MissingFilingField = 'taxId' | 'address';

export interface MissingFilingPartyRow {
  id: string;
  kind: FilingPartyKind;
  contactId: string;
  name: string;
  country: string;
  maskedTaxId: string;
  hasTaxId: boolean;
  hasAddress: boolean;
  missingFields: MissingFilingField[];
  filingReasons: string[];
  activityAmountCents: number;
  currency: string;
  documentCount: number;
  record?: RecordRef;
}

export type MissingItemField = 'cost' | 'price';

export interface MissingItemPricingRow {
  itemId: string;
  sku: string;
  name: string;
  itemType: 'stock' | 'service';
  unitCostCents: number;
  unitPriceCents: number;
  quantityAtHand: number;
  missingFields: MissingItemField[];
  reason: string;
  record: RecordRef;
}

export interface DataQualityReport {
  taxYear: number;
  homeCurrency: string;
  activeLabelRules: ReturnType<typeof requiredLabelRules>;
  missingLabelEntries: MissingLabelEntryRow[];
  missingFilingParties: MissingFilingPartyRow[];
  missingItemPricing: MissingItemPricingRow[];
}

export interface DataQualityInput {
  transactions: Transaction[];
  accounts: ChartAccount[];
  dimensions?: DimensionDefinition[];
  customers?: Array<Partial<Customer> & { id: string; name?: string; metadata?: Record<string, unknown> }>;
  vendors?: Array<Partial<Vendor> & { id: string; name?: string; is1099?: boolean; isForeign?: boolean; country?: string; metadata?: Record<string, unknown> }>;
  invoices?: Invoice[];
  bills?: Bill[];
  payments?: Payment[];
  inventory?: Array<Partial<InventoryItem> & { id: string; name?: string }>;
  taxYear?: number;
  homeCurrency?: string;
  workspaceCountry?: string;
}

const ACTIVE_DOC_SKIP = new Set(['draft', 'void', 'cancelled', 'canceled']);

function extractRawTaxId(entity: { taxId?: unknown; vatNumber?: unknown; metadata?: Record<string, unknown> }): unknown {
  const meta = entity.metadata || {};
  return (
    entity.taxId ??
    entity.vatNumber ??
    meta.taxId ??
    meta.vatNumber ??
    meta.taxNumber ??
    meta.ein ??
    meta.ssn ??
    meta.businessNumber ??
    meta.dealerNumber
  );
}

function extractCountry(entity: { country?: unknown; metadata?: Record<string, unknown> }): string {
  const meta = entity.metadata || {};
  const place = meta.taxPlace as { country?: unknown } | undefined;
  const candidate = typeof entity.country === 'string' && entity.country.trim()
    ? entity.country.trim().toUpperCase()
    : typeof place?.country === 'string' && place.country.trim()
      ? place.country.trim().toUpperCase()
      : typeof meta.country === 'string' && meta.country.trim()
        ? meta.country.trim().toUpperCase()
        : '';
  return /^[A-Z]{2}$/.test(candidate) ? candidate : 'Not recorded';
}

function hasPostalAddress(entity: { address?: unknown; billingAddress?: unknown; metadata?: Record<string, unknown> }): boolean {
  if (typeof entity.address === 'string' && entity.address.trim().length > 0) return true;
  const meta = entity.metadata || {};
  if (typeof meta.address === 'string' && meta.address.trim().length > 0) return true;
  const structured = (entity.billingAddress ?? meta.billingAddress ?? meta.taxAddress) as Record<string, unknown> | undefined;
  if (structured && typeof structured === 'object') {
    return ['line1', 'street', 'city', 'postalCode', 'country'].some(k => typeof structured[k] === 'string' && String(structured[k]).trim().length > 0);
  }
  return false;
}

function isMarked1099(vendor: { is1099?: unknown; is1099Vendor?: unknown; metadata?: Record<string, unknown> }): boolean {
  const meta = vendor.metadata || {};
  return Boolean(vendor.is1099 || vendor.is1099Vendor || meta.is1099 || meta.is1099Vendor || meta.form1099);
}

function isMarkedTaxExempt(customer: { taxExempt?: unknown; metadata?: Record<string, unknown> }): boolean {
  const meta = customer.metadata || {};
  return Boolean(customer.taxExempt || meta.taxExempt || meta.exemptionCertificate);
}

/** A-194: posted entries missing labels required on their accounts (`requiredLabels`). */
export function missingRequiredLabelEntries(input: {
  transactions: Transaction[];
  accounts: ChartAccount[];
  dimensions?: DimensionDefinition[];
}): MissingLabelEntryRow[] {
  const rules = requiredLabelRules(input.dimensions);
  if (!rules.length) return [];
  const refusingDimIds = new Set(rules.filter(r => r.refuse).map(r => r.dimensionId));
  const reversed = new Set(
    input.transactions
      .map(t => t.metadata?.reversesTxId || t.metadata?.reversedTransactionId)
      .filter(Boolean),
  );
  const rows: MissingLabelEntryRow[] = [];
  for (const tx of input.transactions) {
    if (!isPostable(tx)) continue;
    if (tx.reversalEventId || tx.metadata?.isReversal || tx.metadata?.reversesTxId || reversed.has(tx.id)) continue;
    const misses = missingLabels(tx, input.dimensions, input.accounts);
    if (!misses.length) continue;
    const debitSum = (tx.lines || []).reduce((sum, line) => {
      const amt = lineAmount(line);
      return amt > 0 ? sum + amt : sum;
    }, 0);
    rows.push({
      transactionId: tx.id,
      date: tx.date || '',
      description: tx.description || 'Entry',
      currency: tx.currency || 'USD',
      totalAmountCents: tx.totalAmountCents ?? debitSum,
      severity: misses.some(m => refusingDimIds.has(m.dimensionId)) ? 'medium' : 'low',
      missing: misses,
      summary: misses.map(m => `no ${m.dimensionName} on ${m.accountName}`).join('; '),
      record: { type: 'transaction', id: tx.id },
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.transactionId.localeCompare(b.transactionId));
}

/** A-196: customers and vendors missing tax IDs or addresses required by active tax/information filings. */
export function contactsMissingFilingDetails(input: {
  customers?: DataQualityInput['customers'];
  vendors?: DataQualityInput['vendors'];
  invoices?: Invoice[];
  bills?: Bill[];
  payments?: Payment[];
  taxYear?: number;
  homeCurrency?: string;
  workspaceCountry?: string;
}): MissingFilingPartyRow[] {
  const year = input.taxYear ?? 2026;
  const yearPrefix = `${year}-`;
  const homeCurrency = (input.homeCurrency || 'USD').toUpperCase();
  const wsCountry = (input.workspaceCountry || '').toUpperCase();
  const clampedYear = Math.max(2020, Math.min(2099, Number.isInteger(year) ? year : 2026));
  const threshold1099 = threshold1099Cents(clampedYear, '1099-NEC', '1a');

  const paymentsByVendor = new Map<string, { paidHomeCents: number; count: number; withheldCents: number }>();
  for (const p of input.payments || []) {
    if (ACTIVE_DOC_SKIP.has(String(p.status || '').toLowerCase())) continue;
    const dir = String(p.direction || '').toLowerCase();
    if (dir && dir !== 'made' && dir !== 'outgoing' && dir !== 'out') continue;
    if (!p.date || !p.date.startsWith(yearPrefix)) continue;
    const vid = p.contactId || (p as unknown as { vendorId?: string }).vendorId;
    if (!vid) continue;
    const cur = paymentsByVendor.get(vid) || { paidHomeCents: 0, count: 0, withheldCents: 0 };
    cur.paidHomeCents += convertMinorUnits(p.amountCents || 0, p.exchangeRate && p.exchangeRate > 0 ? p.exchangeRate : 1, p.currency || homeCurrency, homeCurrency);
    cur.count += 1;
    const wh = (p as unknown as { withholdingAmountCents?: number; withholdingCents?: number }).withholdingAmountCents
      ?? (p as unknown as { withholdingCents?: number }).withholdingCents ?? 0;
    cur.withheldCents += wh;
    paymentsByVendor.set(vid, cur);
  }

  const billsByVendor = new Map<string, { count: number; totalCents: number; taxCents: number; withheldCents: number; firstBillId: string; currency: string }>();
  for (const b of input.bills || []) {
    if (ACTIVE_DOC_SKIP.has(String(b.status || '').toLowerCase())) continue;
    if (b.date && !b.date.startsWith(yearPrefix)) continue;
    const vid = b.vendorId;
    if (!vid) continue;
    const cur = billsByVendor.get(vid) || { count: 0, totalCents: 0, taxCents: 0, withheldCents: 0, firstBillId: b.id, currency: homeCurrency };
    cur.count += 1;
    cur.totalCents += convertMinorUnits(b.amountCents || 0, b.exchangeRate && b.exchangeRate > 0 ? b.exchangeRate : 1, b.currency || homeCurrency, homeCurrency);
    cur.taxCents += convertMinorUnits(b.taxAmountCents || 0, b.exchangeRate && b.exchangeRate > 0 ? b.exchangeRate : 1, b.currency || homeCurrency, homeCurrency);
    cur.withheldCents += (b as unknown as { withholdingAmountCents?: number }).withholdingAmountCents || 0;
    billsByVendor.set(vid, cur);
  }

  const invoicesByCustomer = new Map<string, {
    count: number;
    totalCents: number;
    taxedCount: number;
    exemptOrZeroCount: number;
    overIlAllocationCount: number;
    firstInvoiceId: string;
    currency: string;
  }>();
  for (const inv of input.invoices || []) {
    if (ACTIVE_DOC_SKIP.has(String(inv.status || '').toLowerCase())) continue;
    if (inv.date && !inv.date.startsWith(yearPrefix)) continue;
    const cid = inv.customerId;
    if (!cid) continue;
    const cur = invoicesByCustomer.get(cid) || {
      count: 0, totalCents: 0, taxedCount: 0, exemptOrZeroCount: 0, overIlAllocationCount: 0,
      firstInvoiceId: inv.id, currency: homeCurrency,
    };
    cur.count += 1;
    const invRate = inv.exchangeRate && inv.exchangeRate > 0 ? inv.exchangeRate : 1;
    cur.totalCents += convertMinorUnits(inv.amountCents || 0, invRate, inv.currency || homeCurrency, homeCurrency);
    const taxCents = convertMinorUnits(inv.taxAmountCents || 0, invRate, inv.currency || homeCurrency, homeCurrency);
    const netCents = Math.max(0, convertMinorUnits((inv.amountCents || 0) - (inv.taxAmountCents || 0), invRate, inv.currency || homeCurrency, homeCurrency));
    if (taxCents > 0) cur.taxedCount += 1;
    const treatment = (inv as unknown as { taxTreatment?: string }).taxTreatment;
    if (treatment === 'exempt' || treatment === 'zero_rated') cur.exemptOrZeroCount += 1;
    const ilThreshold = inv.date ? allocationThresholdCents(inv.date) : undefined;
    if (ilThreshold !== undefined && taxCents > 0) {
      const netIlsCents = homeCurrency === 'ILS'
        ? netCents
        : 0;
      if (netIlsCents > ilThreshold) cur.overIlAllocationCount += 1;
    }
    invoicesByCustomer.set(cid, cur);
  }

  const rows: MissingFilingPartyRow[] = [];

  for (const vendor of input.vendors || []) {
    const maskedTaxId = maskRecordedTaxId(extractRawTaxId(vendor as { taxId?: unknown; vatNumber?: unknown; metadata?: Record<string, unknown> }));
    const hasTaxId = Boolean(maskedTaxId);
    const hasAddress = hasPostalAddress(vendor as { address?: unknown; metadata?: Record<string, unknown> });
    if (hasTaxId && hasAddress) continue;

    const country = extractCountry(vendor as { country?: unknown; metadata?: Record<string, unknown> });
    const pay = paymentsByVendor.get(vendor.id);
    const bill = billsByVendor.get(vendor.id);
    const marked1099 = isMarked1099(vendor as { is1099?: unknown; is1099Vendor?: unknown; metadata?: Record<string, unknown> });
    const isForeign = Boolean(vendor.isForeign || (country !== 'Not recorded' && country !== 'US' && homeCurrency === 'USD'));

    const reasons: string[] = [];
    if (marked1099 && ((pay?.paidHomeCents || 0) > 0 || (bill?.count || 0) > 0)) {
      reasons.push(`Marked 1099 vendor with ${year} activity`);
    } else if (!isForeign && (wsCountry === 'US' || homeCurrency === 'USD' || country === 'US') && (pay?.paidHomeCents || 0) >= threshold1099) {
      reasons.push(`Paid at or above the ${year} US 1099 threshold`);
    }
    if ((pay?.withheldCents || 0) > 0 || (bill?.withheldCents || 0) > 0) {
      reasons.push(`Tax withheld on ${year} supplier payments or bills (Form 856 / withholding return)`);
    }
    if ((bill?.taxCents || 0) > 0 && (country === 'IL' || wsCountry === 'IL' || homeCurrency === 'ILS')) {
      reasons.push(`Input VAT claimed on ${year} bills (VAT / PCN874 schedule)`);
    }
    if (!reasons.length) continue;

    const missingFields: MissingFilingField[] = [];
    if (!hasTaxId) missingFields.push('taxId');
    if (!hasAddress) missingFields.push('address');

    rows.push({
      id: `vendor-${vendor.id}`,
      kind: 'vendor',
      contactId: vendor.id,
      name: vendor.name || vendor.id,
      country,
      maskedTaxId: maskedTaxId || 'Not recorded',
      hasTaxId,
      hasAddress,
      missingFields,
      filingReasons: reasons,
      activityAmountCents: (pay?.paidHomeCents || 0) || (bill?.totalCents || 0),
      currency: homeCurrency,
      documentCount: (pay?.count || 0) + (bill?.count || 0),
      record: bill?.firstBillId ? { type: 'bill', id: bill.firstBillId } : undefined,
    });
  }

  for (const customer of input.customers || []) {
    const maskedTaxId = maskRecordedTaxId(extractRawTaxId(customer as { taxId?: unknown; vatNumber?: unknown; metadata?: Record<string, unknown> }));
    const hasTaxId = Boolean(maskedTaxId);
    const hasAddress = hasPostalAddress(customer as { address?: unknown; billingAddress?: unknown; metadata?: Record<string, unknown> });
    if (hasTaxId && hasAddress) continue;

    const country = extractCountry(customer as { metadata?: Record<string, unknown> });
    const inv = invoicesByCustomer.get(customer.id);
    if (!inv || inv.count === 0) continue;

    const reasons: string[] = [];
    if (inv.overIlAllocationCount > 0) {
      reasons.push(`Tax invoice above the Israel allocation-number threshold in ${year}`);
    }
    if (inv.exemptOrZeroCount > 0 || isMarkedTaxExempt(customer as { taxExempt?: unknown; metadata?: Record<string, unknown> })) {
      reasons.push(`Exempt or zero-rated sales recorded in ${year}`);
    }
    if (inv.taxedCount > 0 && (country === 'IL' || wsCountry === 'IL' || homeCurrency === 'ILS') && inv.overIlAllocationCount === 0) {
      reasons.push(`Taxed VAT sales in ${year} missing buyer details`);
    }
    if (!reasons.length) continue;

    const missingFields: MissingFilingField[] = [];
    if (!hasTaxId) missingFields.push('taxId');
    if (!hasAddress) missingFields.push('address');

    rows.push({
      id: `customer-${customer.id}`,
      kind: 'customer',
      contactId: customer.id,
      name: customer.name || customer.id,
      country,
      maskedTaxId: maskedTaxId || 'Not recorded',
      hasTaxId,
      hasAddress,
      missingFields,
      filingReasons: reasons,
      activityAmountCents: inv.totalCents,
      currency: inv.currency,
      documentCount: inv.count,
      record: inv.firstInvoiceId ? { type: 'invoice', id: inv.firstInvoiceId } : undefined,
    });
  }

  return rows.sort((a, b) =>
    b.activityAmountCents - a.activityAmountCents ||
    a.kind.localeCompare(b.kind) ||
    a.name.localeCompare(b.name) ||
    a.contactId.localeCompare(b.contactId),
  );
}

/** A-197: catalogue items missing cost or selling price (bundles get both from their parts; services have no stock cost). */
export function itemsMissingPricing(
  inventory: Array<Partial<InventoryItem> & { id: string; name?: string }> = [],
): MissingItemPricingRow[] {
  const rows: MissingItemPricingRow[] = [];
  for (const item of inventory) {
    if (isBundle({ id: item.id, name: item.name || item.id, bundleParts: item.bundleParts })) continue;
    const status = (item as { status?: string }).status;
    if (status === 'archived' || status === 'inactive') continue;

    const itemType: 'stock' | 'service' = item.itemType === 'service' ? 'service' : 'stock';
    const isConsignmentFromSupplier = item.consignment === 'from-supplier';
    const costCents = typeof item.unitCostCents === 'number' && Number.isFinite(item.unitCostCents) ? item.unitCostCents : 0;
    const priceCents = typeof item.unitPriceCents === 'number' && Number.isFinite(item.unitPriceCents) ? item.unitPriceCents : 0;

    const missingFields: MissingItemField[] = [];
    if (itemType === 'stock' && !isConsignmentFromSupplier && costCents <= 0) missingFields.push('cost');
    if (priceCents <= 0) missingFields.push('price');
    if (!missingFields.length) continue;

    const reason = missingFields.length === 2
      ? 'Unit cost and selling price are both missing or zero — sales default to zero and book zero COGS.'
      : missingFields[0] === 'cost'
        ? 'Unit cost is missing or zero — selling this stock item books zero cost of goods sold.'
        : 'Selling price is missing or zero — picking this item on an invoice or quote fills a zero rate.';

    rows.push({
      itemId: item.id,
      sku: item.sku || '',
      name: item.name || item.id,
      itemType,
      unitCostCents: costCents,
      unitPriceCents: priceCents,
      quantityAtHand: typeof item.quantityAtHand === 'number' ? item.quantityAtHand : 0,
      missingFields,
      reason,
      record: { type: 'item', id: item.id },
    });
  }
  return rows.sort((a, b) =>
    b.missingFields.length - a.missingFields.length ||
    a.name.localeCompare(b.name) ||
    a.itemId.localeCompare(b.itemId),
  );
}

export function evaluateDataQuality(input: DataQualityInput): DataQualityReport {
  const taxYear = input.taxYear ?? 2026;
  const homeCurrency = (input.homeCurrency || 'USD').toUpperCase();
  return {
    taxYear,
    homeCurrency,
    activeLabelRules: requiredLabelRules(input.dimensions),
    missingLabelEntries: missingRequiredLabelEntries({
      transactions: input.transactions,
      accounts: input.accounts,
      dimensions: input.dimensions,
    }),
    missingFilingParties: contactsMissingFilingDetails({
      customers: input.customers,
      vendors: input.vendors,
      invoices: input.invoices,
      bills: input.bills,
      payments: input.payments,
      taxYear,
      homeCurrency,
      workspaceCountry: input.workspaceCountry,
    }),
    missingItemPricing: itemsMissingPricing(input.inventory || []),
  };
}

export const DATA_QUALITY_CSV_HEADERS = [
  'Check',
  'Record type',
  'Record ID',
  'Name or description',
  'Date or country',
  'Masked tax ID',
  'Missing',
  'Detail',
];

export function dataQualityCsvRows(report: DataQualityReport): string[][] {
  const out: string[][] = [];
  for (const row of report.missingLabelEntries) {
    out.push([
      'Missing required label',
      'transaction',
      row.transactionId,
      row.description,
      row.date,
      '',
      row.missing.map(m => m.dimensionName).join('; '),
      row.summary,
    ]);
  }
  for (const row of report.missingFilingParties) {
    out.push([
      'Missing filing tax ID or address',
      row.kind,
      row.contactId,
      row.name,
      row.country,
      row.maskedTaxId,
      row.missingFields.map(f => (f === 'taxId' ? 'Tax ID' : 'Address')).join('; '),
      row.filingReasons.join('; '),
    ]);
  }
  for (const row of report.missingItemPricing) {
    out.push([
      'Item missing cost or price',
      'item',
      row.itemId,
      row.sku ? `${row.sku} — ${row.name}` : row.name,
      row.itemType,
      '',
      row.missingFields.map(f => (f === 'cost' ? 'Unit cost' : 'Selling price')).join('; '),
      row.reason,
    ]);
  }
  return out;
}
