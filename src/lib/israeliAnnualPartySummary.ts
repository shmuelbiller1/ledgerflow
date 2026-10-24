/**
 * A-189: Israeli annual summary per customer & vendor (for the accountant).
 *
 * Read-only year-end working paper ('calculation' status): never files with the Israel Tax
 * Authority, masks all tax/VAT IDs (`••••1234`), checks `needsAllocationNumber`, and posts nothing.
 */
import type { Bill, CreditNote, Customer, Invoice, Payment, Vendor, VendorCredit } from '../types';
import { INVOICE_IS_ISSUED, BILL_IS_ISSUED } from '../server/reports/computeReports';
import { toBaseCents } from '../server/reports/partyReports';
import { calculateAmountDue } from './documentMath';
import { needsAllocationNumber } from './tax/ilAllocation';
import { withholdingOf } from './tax/withholding';

export function maskPartyTaxId(raw?: string | null): string {
  const digits = String(raw ?? '').trim();
  if (!digits) return '';
  if (digits.length <= 4) return `••••${digits}`;
  return `••••${digits.slice(-4)}`;
}

export interface IsraeliAnnualCustomerRow {
  customerId: string;
  customerName: string;
  maskedTaxId: string;
  hasTaxId: boolean;
  documentCount: number;
  netSalesCents: number;
  vatChargedCents: number;
  grossBilledCents: number;
  collectionsInYearCents: number;
  closingOpenCents: number;
  allocationRequiredCount: number;
  allocationRecordedCount: number;
  allocationMissingCount: number;
  foreignDocCount: number;
}

export interface IsraeliAnnualVendorRow {
  vendorId: string;
  vendorName: string;
  maskedTaxId: string;
  hasTaxId: boolean;
  documentCount: number;
  grossBilledCents: number;
  inputVatCents: number;
  paymentsInYearCents: number;
  taxWithheldCents: number;
  withholdingCertificate: string;
  closingOpenCents: number;
  foreignDocCount: number;
}

function partyTin(party?: { metadata?: Record<string, unknown> } | null): string {
  const raw = party as Record<string, unknown> | null | undefined;
  return String(raw?.taxId || raw?.taxNumber || party?.metadata?.vatNumber || party?.metadata?.taxId || '').trim();
}

export function computeIsraeliAnnualSummary(input: {
  year: number;
  baseCurrency?: string;
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  creditNotes: CreditNote[];
  bills: Bill[];
  vendorCredits: VendorCredit[];
  payments: Payment[];
}): {
  customers: IsraeliAnnualCustomerRow[];
  vendors: IsraeliAnnualVendorRow[];
} {
  const {
    year,
    baseCurrency = 'ILS',
    customers,
    vendors,
    invoices,
    creditNotes,
    bills,
    vendorCredits,
    payments,
  } = input;
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const inYear = (d?: string) => Boolean(d && d.slice(0, 10) >= start && d.slice(0, 10) <= end);

  const custById = new Map<string, IsraeliAnnualCustomerRow>();
  const ensureCust = (id: string, fallbackName: string, custObj?: Customer): IsraeliAnnualCustomerRow => {
    let row = custById.get(id);
    if (!row) {
      const rawTin = partyTin(custObj);
      row = {
        customerId: id,
        customerName: custObj?.name || fallbackName || id,
        maskedTaxId: maskPartyTaxId(rawTin),
        hasTaxId: Boolean(rawTin),
        documentCount: 0,
        netSalesCents: 0,
        vatChargedCents: 0,
        grossBilledCents: 0,
        collectionsInYearCents: 0,
        closingOpenCents: 0,
        allocationRequiredCount: 0,
        allocationRecordedCount: 0,
        allocationMissingCount: 0,
        foreignDocCount: 0,
      };
      custById.set(id, row);
    }
    return row;
  };

  const customerLookup = new Map((customers || []).map(c => [c.id, c]));

  for (const inv of invoices || []) {
    if (!INVOICE_IS_ISSUED.has(inv.status)) continue;
    const cid = inv.customerId || `name:${inv.customerName || 'Customer'}`;
    const cObj = inv.customerId ? customerLookup.get(inv.customerId) : undefined;
    const open = calculateAmountDue(inv);
    if (open > 0 && String(inv.date || '').slice(0, 10) <= end) {
      ensureCust(cid, inv.customerName || 'Customer', cObj).closingOpenCents += toBaseCents(open, inv.exchangeRate);
    }
    if (!inYear(inv.date)) continue;
    const row = ensureCust(cid, inv.customerName || 'Customer', cObj);
    row.documentCount += 1;
    const gross = toBaseCents(inv.amountCents || 0, inv.exchangeRate);
    const vat = toBaseCents(Math.max(0, Number(inv.taxAmountCents) || 0), inv.exchangeRate);
    const net = gross - vat;
    row.grossBilledCents += gross;
    row.vatChargedCents += vat;
    row.netSalesCents += net;
    if (inv.currency && inv.currency !== baseCurrency) row.foreignDocCount += 1;

    const buyerVatNumber = partyTin(cObj);
    if (needsAllocationNumber({
      date: String(inv.date || '').slice(0, 10),
      netCents: (inv.amountCents || 0) - Math.max(0, Number(inv.taxAmountCents) || 0),
      currency: inv.currency || baseCurrency,
      exchangeRate: inv.exchangeRate,
      buyerVatNumber,
      taxCents: Math.max(0, Number(inv.taxAmountCents) || 0),
    })) {
      row.allocationRequiredCount += 1;
      const alloc = String((inv as unknown as Record<string, unknown>).allocationNumber || inv.metadata?.allocationNumber || '').trim();
      if (alloc) row.allocationRecordedCount += 1;
      else row.allocationMissingCount += 1;
    }
  }

  for (const cn of creditNotes || []) {
    if (cn.status === 'draft' || cn.status === 'void' || !inYear(cn.date)) continue;
    const cid = cn.customerId || `name:${cn.customerName || 'Customer'}`;
    const row = ensureCust(cid, cn.customerName || 'Customer', cn.customerId ? customerLookup.get(cn.customerId) : undefined);
    row.documentCount += 1;
    const gross = toBaseCents(cn.amountCents || 0, cn.exchangeRate);
    const vat = toBaseCents(Math.max(0, Number(cn.taxAmountCents) || 0), cn.exchangeRate);
    row.grossBilledCents -= gross;
    row.vatChargedCents -= vat;
    row.netSalesCents -= (gross - vat);
  }

  const vendorLookup = new Map((vendors || []).map(v => [v.id, v]));
  const vendById = new Map<string, IsraeliAnnualVendorRow>();
  const ensureVend = (id: string, fallbackName: string, vObj?: Vendor): IsraeliAnnualVendorRow => {
    let row = vendById.get(id);
    if (!row) {
      const rawTin = partyTin(vObj);
      const wht = withholdingOf(vObj);
      row = {
        vendorId: id,
        vendorName: vObj?.name || fallbackName || id,
        maskedTaxId: maskPartyTaxId(rawTin),
        hasTaxId: Boolean(rawTin),
        documentCount: 0,
        grossBilledCents: 0,
        inputVatCents: 0,
        paymentsInYearCents: 0,
        taxWithheldCents: 0,
        withholdingCertificate: wht ? `${wht.ratePercent}%${wht.expires ? ` (to ${wht.expires})` : ''}` : '—',
        closingOpenCents: 0,
        foreignDocCount: 0,
      };
      vendById.set(id, row);
    }
    return row;
  };

  for (const bill of bills || []) {
    if (!BILL_IS_ISSUED.has(bill.status)) continue;
    const vid = bill.vendorId || `name:${bill.vendorName || 'Vendor'}`;
    const vObj = bill.vendorId ? vendorLookup.get(bill.vendorId) : undefined;
    const paid = Number(bill.amountPaidCents) || 0;
    const open = bill.status === 'paid' ? 0 : Math.max(0, (Number(bill.amountCents) || 0) - paid);
    const bDate = String(bill.date || bill.issueDate || '').slice(0, 10);
    if (open > 0 && bDate <= end) {
      ensureVend(vid, bill.vendorName || 'Vendor', vObj).closingOpenCents += toBaseCents(open, bill.exchangeRate);
    }
    if (!inYear(bDate)) continue;
    const row = ensureVend(vid, bill.vendorName || 'Vendor', vObj);
    row.documentCount += 1;
    row.grossBilledCents += toBaseCents(bill.amountCents || 0, bill.exchangeRate);
    row.inputVatCents += toBaseCents(Math.max(0, Number(bill.taxAmountCents) || 0), bill.exchangeRate);
    if (bill.currency && bill.currency !== baseCurrency) row.foreignDocCount += 1;
  }

  for (const vc of vendorCredits || []) {
    if (vc.status === 'draft' || vc.status === 'void' || !inYear(vc.date)) continue;
    const vid = vc.vendorId || `name:${vc.vendorName || 'Vendor'}`;
    const row = ensureVend(vid, vc.vendorName || 'Vendor', vc.vendorId ? vendorLookup.get(vc.vendorId) : undefined);
    row.documentCount += 1;
    row.grossBilledCents -= toBaseCents(vc.amountCents || 0, vc.exchangeRate);
    row.inputVatCents -= toBaseCents(Math.max(0, Number(vc.taxAmountCents) || 0), vc.exchangeRate);
  }

  for (const p of payments || []) {
    if (p.status === 'void' || p.status === 'draft') continue;
    const pRec = p as unknown as Record<string, unknown>;
    const pDay = String(pRec.paymentDate || p.date || '').slice(0, 10);
    if (!inYear(pDay)) continue;
    const baseAmt = toBaseCents(p.amountCents || 0, p.exchangeRate);
    if (p.direction === 'made') {
      const vid = p.contactId || `name:${p.contactName || 'Vendor'}`;
      const row = ensureVend(vid, p.contactName || 'Vendor', p.contactId ? vendorLookup.get(p.contactId) : undefined);
      row.paymentsInYearCents += baseAmt;
      const whtCents = Number(pRec.withholdingTaxCents || (pRec.metadata as Record<string, unknown> | undefined)?.withholdingTaxCents) || 0;
      row.taxWithheldCents += toBaseCents(Math.max(0, whtCents), p.exchangeRate);
    } else if (p.direction === 'received' || (p.allocations || []).some(a => a.documentType === 'invoice')) {
      const cid = p.contactId || `name:${p.contactName || 'Customer'}`;
      const row = ensureCust(cid, p.contactName || 'Customer', p.contactId ? customerLookup.get(p.contactId) : undefined);
      row.collectionsInYearCents += baseAmt;
    }
  }

  return {
    customers: [...custById.values()].sort((a, b) => b.grossBilledCents - a.grossBilledCents || a.customerName.localeCompare(b.customerName)),
    vendors: [...vendById.values()].sort((a, b) => b.grossBilledCents - a.grossBilledCents || a.vendorName.localeCompare(b.vendorName)),
  };
}

export const IL_ANNUAL_CUSTOMER_CSV_HEADERS = [
  'Customer', 'Tax ID (masked)', 'Documents', 'Net pre-VAT (minor units)', 'VAT (minor units)',
  'Gross billed (minor units)', 'Collected in year (minor units)', 'Closing open (minor units)',
  'Allocations required', 'Allocations missing', 'Foreign currency docs',
];

export const IL_ANNUAL_VENDOR_CSV_HEADERS = [
  'Vendor', 'Tax ID (masked)', 'Documents', 'Gross billed (minor units)', 'Input VAT (minor units)',
  'Paid in year (minor units)', 'Tax withheld at source (minor units)', 'Withholding cert',
  'Closing open (minor units)', 'Foreign currency docs',
];
