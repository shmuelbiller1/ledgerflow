import type { Invoice, Bill, Payment, CreditNote, VendorCredit, Customer, Vendor } from "../../types";
import { INVOICE_IS_ISSUED, BILL_IS_ISSUED } from "./computeReports";
import { getDateInTimezoneISO, getLocalDateISO } from "../../lib/calendarDate";

export function toBaseCents(amountCents: number = 0, exchangeRate?: number): number {
  const rate = typeof exchangeRate === 'number' && exchangeRate > 0 ? exchangeRate : 1;
  return Math.round(amountCents * rate);
}

export interface CustomerBalanceSummaryRow {
  customerId: string;
  name: string;
  email?: string;
  phone?: string;
  openInvoicesCount: number;
  totalInvoicedCents: number;
  totalCreditNotesCents: number;
  totalPaidCents: number;
  balanceCents: number;
}

export function computeCustomerBalanceSummary(
  customers: Customer[] = [],
  invoices: Invoice[] = [],
  payments: Payment[] = [],
  creditNotes: CreditNote[] = [],
  asOfDateOrStartDate?: string,
  endDate?: string,
  timezone?: string
): CustomerBalanceSummaryRow[] {
  const end = endDate || asOfDateOrStartDate || (timezone ? getDateInTimezoneISO(new Date(), timezone) : getLocalDateISO());

  return customers.map(cust => {
    const custId = cust.id;
    const custInvoices = invoices.filter(inv => {
      if (inv.customerId !== custId) return false;
      if (!INVOICE_IS_ISSUED.has(inv.status)) return false;
      const docDate = inv.date || '';
      if (docDate && docDate > end) return false;
      return true;
    });

    const totalInvoicedCents = custInvoices.reduce((sum, inv) => {
      return sum + toBaseCents(inv.amountCents || 0, inv.exchangeRate);
    }, 0);

    const custCreditNotes = creditNotes.filter(cn => {
      if (cn.customerId !== custId) return false;
      if (cn.status === 'void' || cn.status === 'draft') return false;
      const docDate = cn.date || '';
      if (docDate && docDate > end) return false;
      return true;
    });

    // a credit counts less what was paid back in cash (L-160)
    const totalCreditNotesCents = custCreditNotes.reduce((sum, cn) => {
      return sum + toBaseCents((cn.amountCents || 0) - (cn.refundedCents || 0), cn.exchangeRate);
    }, 0);

    const custPayments = payments.filter(p => {
      const matchesContact = p.contactId === custId || p.allocations?.some((a: { documentId: string }) => custInvoices.some(inv => inv.id === a.documentId));
      if (!matchesContact) return false;
      if (p.direction === 'made') return false;
      if (p.status === 'void' || p.status === 'draft') return false;
      const docDate = p.date || '';
      if (docDate && docDate > end) return false;
      return true;
    });

    const totalPaidCents = custPayments.reduce((sum, p) => {
      return sum + toBaseCents(p.amountCents || 0, p.exchangeRate);
    }, 0);

    const openInvoicesCount = custInvoices.filter(inv => inv.status !== 'paid').length;
    // Allow negative balance (credit balances for customers)
    const balanceCents = totalInvoicedCents - totalCreditNotesCents - totalPaidCents;

    return {
      customerId: custId,
      name: cust.name || 'Unnamed Customer',
      email: cust.email,
      phone: cust.phone,
      openInvoicesCount,
      totalInvoicedCents,
      totalCreditNotesCents,
      totalPaidCents,
      balanceCents
    };
  }).sort((a, b) => b.balanceCents - a.balanceCents);
}

export interface VendorBalanceSummaryRow {
  vendorId: string;
  name: string;
  email?: string;
  phone?: string;
  openBillsCount: number;
  totalBilledCents: number;
  totalVendorCreditsCents: number;
  totalPaidCents: number;
  balanceCents: number;
}

export function computeVendorBalanceSummary(
  vendors: Vendor[] = [],
  bills: Bill[] = [],
  payments: Payment[] = [],
  vendorCredits: VendorCredit[] = [],
  asOfDateOrStartDate?: string,
  endDate?: string,
  timezone?: string
): VendorBalanceSummaryRow[] {
  const end = endDate || asOfDateOrStartDate || (timezone ? getDateInTimezoneISO(new Date(), timezone) : getLocalDateISO());

  return vendors.map(vendor => {
    const vendorId = vendor.id;
    const vendorBills = bills.filter(b => {
      if (b.vendorId !== vendorId) return false;
      if (!BILL_IS_ISSUED.has(b.status)) return false;
      const docDate = b.date || '';
      if (docDate && docDate > end) return false;
      return true;
    });

    const totalBilledCents = vendorBills.reduce((sum, b) => {
      return sum + toBaseCents(b.amountCents || 0, b.exchangeRate);
    }, 0);

    const custVendorCredits = vendorCredits.filter(vc => {
      if (vc.vendorId !== vendorId) return false;
      if (vc.status === 'void' || vc.status === 'draft') return false;
      const docDate = vc.date || '';
      if (docDate && docDate > end) return false;
      return true;
    });

    const totalVendorCreditsCents = custVendorCredits.reduce((sum, vc) => {
      return sum + toBaseCents((vc.amountCents || 0) - (vc.refundedCents || 0), vc.exchangeRate);
    }, 0);

    const vendorPayments = payments.filter(p => {
      if (p.contactId !== vendorId) return false;
      if (p.direction === 'received') return false;
      if (p.status === 'void' || p.status === 'draft') return false;
      const docDate = p.date || '';
      if (docDate && docDate > end) return false;
      return true;
    });

    const totalPaidCents = vendorPayments.reduce((sum, p) => {
      return sum + toBaseCents(p.amountCents || 0, p.exchangeRate);
    }, 0);

    const openBillsCount = vendorBills.filter(b => b.status !== 'paid').length;
    const balanceCents = totalBilledCents - totalVendorCreditsCents - totalPaidCents;

    return {
      vendorId,
      name: vendor.name || 'Unnamed Vendor',
      email: vendor.email,
      phone: vendor.phone,
      openBillsCount,
      totalBilledCents,
      totalVendorCreditsCents,
      totalPaidCents,
      balanceCents
    };
  }).sort((a, b) => b.balanceCents - a.balanceCents);
}

export interface PartyTransactionRow {
  id: string;
  date: string;
  partyName: string;
  type: string;
  reference: string;
  status: string;
  amountCents: number;
}

export function computeTransactionsByCustomer(
  customers: Customer[] = [],
  invoices: Invoice[] = [],
  payments: Payment[] = [],
  creditNotes: CreditNote[] = [],
  startDate?: string,
  endDate?: string
): PartyTransactionRow[] {
  const start = startDate || "1970-01-01";
  const end = endDate || "2099-12-31";
  const customerMap = new Map(customers.map(c => [c.id, c.name]));
  const list: PartyTransactionRow[] = [];

  // 1. Invoices (issued only, non-draft, non-void)
  for (const inv of invoices) {
    if (!INVOICE_IS_ISSUED.has(inv.status)) continue;
    const docDate = inv.date || '';
    if (docDate && (docDate < start || docDate > end)) continue;
    const customerName = inv.customerName || customerMap.get(inv.customerId) || 'Unknown Customer';
    list.push({
      id: inv.id,
      date: docDate,
      partyName: customerName,
      type: 'Invoice',
      reference: inv.number || inv.id,
      status: inv.status || 'pending',
      amountCents: toBaseCents(inv.amountCents || 0, inv.exchangeRate)
    });
  }

  // 2. Credit Notes
  for (const cn of creditNotes) {
    if (cn.status === 'void' || cn.status === 'draft') continue;
    const docDate = cn.date || '';
    if (docDate && (docDate < start || docDate > end)) continue;
    const customerName = cn.customerName || customerMap.get(cn.customerId) || 'Unknown Customer';
    list.push({
      id: cn.id,
      date: docDate,
      partyName: customerName,
      type: 'Credit Note',
      reference: cn.number || cn.id,
      status: cn.status || 'applied',
      amountCents: -toBaseCents(cn.amountCents || 0, cn.exchangeRate)
    });
  }

  // 3. Payments (received)
  for (const pay of payments) {
    if (pay.status === 'void' || pay.status === 'draft' || pay.direction === 'made') continue;
    const docDate = pay.date || '';
    if (docDate && (docDate < start || docDate > end)) continue;
    const customerName = pay.contactName || customerMap.get(pay.contactId) || 'Customer Payment';
    list.push({
      id: pay.id,
      date: docDate,
      partyName: customerName,
      type: 'Payment',
      reference: pay.reference || pay.number || pay.id,
      status: pay.status || 'posted',
      amountCents: -toBaseCents(pay.amountCents || 0, pay.exchangeRate)
    });
  }

  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export function computeTransactionsByVendor(
  vendors: Vendor[] = [],
  bills: Bill[] = [],
  payments: Payment[] = [],
  vendorCredits: VendorCredit[] = [],
  startDate?: string,
  endDate?: string
): PartyTransactionRow[] {
  const start = startDate || "1970-01-01";
  const end = endDate || "2099-12-31";
  const vendorMap = new Map(vendors.map(v => [v.id, v.name]));
  const list: PartyTransactionRow[] = [];

  // 1. Bills (issued only, non-draft, non-void)
  for (const bill of bills) {
    if (!BILL_IS_ISSUED.has(bill.status)) continue;
    const docDate = bill.date || '';
    if (docDate && (docDate < start || docDate > end)) continue;
    const vendorName = bill.vendorName || vendorMap.get(bill.vendorId) || 'Unknown Vendor';
    list.push({
      id: bill.id,
      date: docDate,
      partyName: vendorName,
      type: 'Bill',
      reference: bill.number || bill.id,
      status: bill.status || 'pending',
      amountCents: toBaseCents(bill.amountCents || 0, bill.exchangeRate)
    });
  }

  // 2. Vendor Credits
  for (const vc of vendorCredits) {
    if (vc.status === 'void' || vc.status === 'draft') continue;
    const docDate = vc.date || '';
    if (docDate && (docDate < start || docDate > end)) continue;
    const vendorName = vc.vendorName || vendorMap.get(vc.vendorId) || 'Unknown Vendor';
    list.push({
      id: vc.id,
      date: docDate,
      partyName: vendorName,
      type: 'Vendor Credit',
      reference: vc.number || vc.id,
      status: vc.status || 'applied',
      amountCents: -toBaseCents(vc.amountCents || 0, vc.exchangeRate)
    });
  }

  // 3. Payments made
  for (const pay of payments) {
    if (pay.status === 'void' || pay.status === 'draft' || pay.direction === 'received') continue;
    const docDate = pay.date || '';
    if (docDate && (docDate < start || docDate > end)) continue;
    const vendorName = pay.contactName || vendorMap.get(pay.contactId) || 'Supplier Payment';
    list.push({
      id: pay.id,
      date: docDate,
      partyName: vendorName,
      type: 'Vendor Payment',
      reference: pay.reference || pay.number || pay.id,
      status: pay.status || 'posted',
      amountCents: -toBaseCents(pay.amountCents || 0, pay.exchangeRate)
    });
  }

  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export interface ContactBalanceSummaryRow {
  key: string;
  name: string;
  email?: string;
  customerId?: string;
  vendorId?: string;
  /** What the contact owes us (customer balance), base currency. */
  receivableCents: number;
  /** What we owe the contact (vendor balance), base currency. */
  payableCents: number;
  /** receivable − payable: positive, they owe us on balance; negative, we owe them. */
  netCents: number;
}

const emailKey = (email?: string) => (email || '').trim().toLowerCase();
const nameKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Contact Balance Summary (J-03): customers and vendors in one list. A business that is both is one
 * row with both balances and the net: matched by email, or by name (case and spacing ignored, any
 * script) when one of the two has no email. Built from the two balance summaries, so it follows
 * their rules (issued documents, credits, payments, as-of date, base currency).
 */
export function computeContactBalanceSummary(
  customerRows: CustomerBalanceSummaryRow[],
  vendorRows: VendorBalanceSummaryRow[]
): ContactBalanceSummaryRow[] {
  const rows: ContactBalanceSummaryRow[] = customerRows.map(c => ({
    key: `customer:${c.customerId}`, name: c.name, email: c.email, customerId: c.customerId,
    receivableCents: c.balanceCents, payableCents: 0, netCents: 0,
  }));
  for (const v of vendorRows) {
    const open = rows.filter(r => r.customerId && !r.vendorId);
    const match = (emailKey(v.email) && open.find(r => emailKey(r.email) === emailKey(v.email)))
      || open.find(r => nameKey(r.name) === nameKey(v.name) && (!emailKey(r.email) || !emailKey(v.email)));
    if (match) {
      match.vendorId = v.vendorId;
      match.payableCents = v.balanceCents;
      match.email = match.email || v.email;
    } else {
      rows.push({ key: `vendor:${v.vendorId}`, name: v.name, email: v.email, vendorId: v.vendorId, receivableCents: 0, payableCents: v.balanceCents, netCents: 0 });
    }
  }
  return rows
    .map(r => ({ ...r, netCents: r.receivableCents - r.payableCents }))
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents) || a.name.localeCompare(b.name));
}
