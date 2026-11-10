/**
 * AF-004 / issue #519 probe (Agent #7, 2026-11-10). Review-only; exits 0.
 * Reproduces: an issued invoice's destination snapshot (#255) is ignored by the
 * US state sales-tax return; the customer's CURRENT tax place decides.
 */
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn';
import { saleDestinationSnapshot } from '../../../src/lib/tax/usInvoiceTax';

const TX = { kind: 'sales_tax' as const, number: 'TX-1234', place: { country: 'US', state: 'TX' }, filing: 'quarterly' as const, validFrom: '2020-01-01' };
const profiles = { books: { name: 'Acme Texas LLC', place: { country: 'US', state: 'TX' }, registrations: [TX] } };
const key = 'sales_tax:US-TX:TX-1234';

// Invoice issued 2026-07-10 to a TX customer; the issued doc carries the #255 snapshot.
const customerBefore = { id: 'c1', metadata: { taxPlace: { country: 'US', state: 'TX' } } };
const snap = saleDestinationSnapshot({ status: 'sent', customerId: 'c1', initial: undefined, customers: [customerBefore] });
console.log('snapshot written on issue:', JSON.stringify(snap));
const invoice = {
  id: 'inv-519-1', date: '2026-07-10', status: 'paid', customerId: 'c1',
  amountCents: 10825, taxAmountCents: 825, taxVersion: 2, taxTreatment: 'standard' as const,
  metadata: { taxPlace: snap.taxPlace },
  taxBreakdown: [{ name: 'Texas state sales tax', rate: 0.0625, taxCents: 678 }, { name: 'Austin', rate: 0.02, taxCents: 147 }],
};

// Customer moves to CA on 2026-08-15.
const customerAfter = { id: 'c1', metadata: { taxPlace: { country: 'US', state: 'CA' } } };

for (const [label, customers] of [['customer still in TX', [customerBefore]], ['customer moved to CA', [customerAfter]]] as const) {
  const r = usSalesTaxReturn({ registration: key, profiles, order: ['world'], invoices: [invoice as never], customers: [...customers], startDate: '2026-07-01', endDate: '2026-09-30' });
  console.log(`${label}: documentCount=${r.documentCount} grossSalesCents=${r.grossSalesCents} taxCollectedCents=${r.taxCollectedCents}`);
}
console.log('EXPECTED per the #255 contract (usNexusWatch reads the invoice snapshot): the July sale stays in the TX return either way.');
