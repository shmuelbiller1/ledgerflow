/**
 * CA-29 (party link): a customer and a vendor that are the same business. The link is stored on the
 * customer (`linkedVendorId`); a vendor is linked to at most one customer. Both detail pages show what
 * the business owes us, what we owe it and the net, in the books' currency (the same rule as the
 * "still owed" cards, src/lib/aging.ts). Display only: nothing is posted or offset.
 */
import { outstandingBaseCents } from './aging';
import type { Bill, Customer, Invoice } from '../types';

export interface PartyLinkPair { customerId: string; vendorId: string }
export interface PartyNetPosition { receivableCents: number; payableCents: number; netCents: number }

/** The linked pair for a customer or a vendor, if any (a link to a vendor that no longer exists is ignored). */
export function linkedPair(
  side: 'customer' | 'vendor',
  partyId: string,
  customers: Array<Pick<Customer, 'id' | 'linkedVendorId'>>,
  vendorIds: ReadonlySet<string>,
): PartyLinkPair | null {
  if (side === 'customer') {
    const vendorId = customers.find(c => c.id === partyId)?.linkedVendorId;
    return vendorId && vendorIds.has(vendorId) ? { customerId: partyId, vendorId } : null;
  }
  if (!vendorIds.has(partyId)) return null;
  const customer = customers.find(c => c.linkedVendorId === partyId);
  return customer ? { customerId: customer.id, vendorId: partyId } : null;
}

/** Vendors a customer may link to: not already linked to another customer. */
export function linkableVendorIds(
  customerId: string,
  customers: Array<Pick<Customer, 'id' | 'linkedVendorId'>>,
  vendorIds: readonly string[],
): string[] {
  const taken = new Set(customers.filter(c => c.id !== customerId && c.linkedVendorId).map(c => c.linkedVendorId as string));
  return vendorIds.filter(id => !taken.has(id));
}

/** Open invoices to the customer, open bills from the vendor, and the net (positive: they owe us on balance). */
export function partyNetPosition(pair: PartyLinkPair, invoices: Invoice[], bills: Bill[], baseCurrency: string = 'USD'): PartyNetPosition {
  const receivableCents = invoices
    .filter(i => i.customerId === pair.customerId)
    .reduce((sum, i) => sum + outstandingBaseCents(i, 'customer', baseCurrency), 0);
  const payableCents = bills
    .filter(b => b.vendorId === pair.vendorId)
    .reduce((sum, b) => sum + outstandingBaseCents(b, 'vendor', baseCurrency), 0);
  return { receivableCents, payableCents, netCents: receivableCents - payableCents };
}
