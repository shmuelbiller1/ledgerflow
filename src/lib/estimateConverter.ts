import { Estimate, Invoice } from '../types';
import { getLocalDateISO } from './calendarDate';
import { calculateDueDate } from './paymentTerms';

/**
 * Converts an estimate to a formal customer invoice using canonical Invoice & Estimate fields:
 * - Estimate: amountCents, number, lines
 * - Invoice: uid, workspaceId, customerId, amountCents, amountPaidCents, items, number
 */
export function convertEstimateToInvoice(estimate: Estimate): Invoice {
  if (estimate.status === 'declined') {
    throw new Error('Cannot convert a declined estimate to an invoice');
  }

  const issueDate = getLocalDateISO();
  const dueDate = calculateDueDate(issueDate, 'net_30');

  // an estimate saved as one amount becomes one line
  const lines = estimate.lines?.length
    ? estimate.lines
    : [{ description: `Estimate ${estimate.number || ''}`.trim(), quantity: 1, unitPriceCents: estimate.amountCents, amountCents: estimate.amountCents }];
  const invoiceItems = lines.map((line, i) => ({
    id: `${estimate.id}-${i}`,
    // a stock item stays linked, so the invoice lowers stock and books its cost (BF-08)
    ...(line.itemId ? { itemId: line.itemId } : {}),
    description: line.description || '',
    quantity: line.quantity || 1,
    rateCents: line.unitPriceCents || 0,
    amountCents: line.amountCents || (line.quantity || 1) * (line.unitPriceCents || 0),
    // no account picked: posting uses the workspace's income account (never a made-up account id)
    accountId: ''
  }));

  const invoice: Invoice = {
    id: `inv_from_est_${estimate.id}`,
    uid: estimate.uid || 'usr_system',
    workspaceId: estimate.workspaceId,
    number: `INV-EST-${estimate.number || estimate.id.substring(0, 6)}`,
    customerId: estimate.customerId || '',
    customerName: estimate.customerName,
    date: issueDate,
    dueDate: dueDate,
    amountCents: estimate.amountCents,
    amountPaidCents: 0,
    status: 'draft',
    items: invoiceItems
  };

  return invoice;
}
