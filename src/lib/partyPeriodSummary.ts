import type { Customer, Vendor, Invoice, Bill, Payment, CreditNote, VendorCredit } from '../types';
import { computeCustomerBalanceSummary, computeVendorBalanceSummary } from '../server/reports/partyReports';
import { validCustomReportPeriod, type CustomReportPeriod } from './reportCustomPeriod';
export interface PartyPeriodInput { customers: Customer[]; vendors: Vendor[]; invoices: Invoice[]; bills: Bill[]; payments: Payment[]; creditNotes: CreditNote[]; vendorCredits: VendorCredit[]; baseCurrency?: string }
export interface PartyPeriodRow { id: string; name: string; openingCents: number; invoicedCents: number; paidCents: number; creditedCents: number; closingCents: number }

/** Period movements are differences of the existing authoritative summary formulas.
 * No alternative document status, FX, allocation or credit/refund calculation is introduced.
 */
export function partyPeriodSummary(kind: 'customer' | 'vendor', input: PartyPeriodInput, period: CustomReportPeriod): PartyPeriodRow[] {
  if (!validCustomReportPeriod(period)) throw new Error('Choose a valid report period.');
  const previousDay = new Date(new Date(`${period.startDate}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0,10);
  const summarize = (date: string) => kind === 'customer'
    ? computeCustomerBalanceSummary(input.customers,input.invoices,input.payments,input.creditNotes,date,undefined,undefined,input.baseCurrency).map(row => ({id:row.customerId,name:row.name,invoiced:row.totalInvoicedCents,paid:row.totalPaidCents,credited:row.totalCreditNotesCents,balance:row.balanceCents}))
    : computeVendorBalanceSummary(input.vendors,input.bills,input.payments,input.vendorCredits,date,undefined,undefined,input.baseCurrency).map(row => ({id:row.vendorId,name:row.name,invoiced:row.totalBilledCents,paid:row.totalPaidCents,credited:row.totalVendorCreditsCents,balance:row.balanceCents}));
  const opening = new Map(summarize(previousDay).map(row => [row.id,row]));
  return summarize(period.endDate).map(row => {
    const before = opening.get(row.id);
    return {id:row.id,name:row.name,openingCents:before?.balance ?? 0,invoicedCents:row.invoiced-(before?.invoiced ?? 0),paidCents:row.paid-(before?.paid ?? 0),creditedCents:row.credited-(before?.credited ?? 0),closingCents:row.balance};
  });
}
