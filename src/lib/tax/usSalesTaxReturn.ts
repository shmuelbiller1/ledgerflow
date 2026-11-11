/**
 * A US state sales tax return for one permit (PLAN US-3), from the period's invoices and credit
 * notes: gross sales, exempt sales (an exempt or zero treatment, or the customer's good exemption
 * certificate, T-05), taxable sales, the tax collected, and the tax by jurisdiction part (state,
 * county, city, district: the invoice's saved tax breakdown). A document belongs to the permit when
 * its seller (its entity label, else the books, PLAN §6) holds that permit on the date and the sale's
 * destination is in the permit's state. Credit notes reduce the period they fall in.
 *
 * AF-004 (#517, #518, #519), the same reading as the nexus watch (usNexusWatch.ts):
 * - the seller's entity label is the one the invoice screen saves: the first line's, else the document's;
 * - the destination is the sale's own saved tax place (the snapshot taken when it was issued), then its
 *   ship-to state, then (a credit note) its invoice's, and only then the customer's place today, so moving
 *   a customer does not move past sales; a US place with no state is passed over for the next one that has
 *   a state; with no place recorded anywhere it is an over-the-counter sale at the seller's own place;
 * - a US sale with no state is in no state's return and is never guessed: it is counted in `unplaced`.
 * Read-only; amounts in the home currency. Pure.
 */
import { taxReturnDocument, type TaxableDocument } from '../taxReturnDocs';
import { COUNTED_SALES } from '../taxCodes';
import { exemptionOn } from '../taxExemption';
import { registrationKey, registrationsOn, resolveSellerProfile, type TaxPlace, type TaxProfiles } from './profile';
import { documentEntityLabels } from './ilVatReturn';

export interface UsSalesDocument extends TaxableDocument {
  customerId?: string;
  dimensions?: Record<string, string>;
  /** the lines as saved: the first line carries the document's entity labels */
  items?: unknown;
  /** a credit note's invoice: it takes that sale's destination and seller when it has none of its own */
  invoiceId?: string;
  metadata?: { taxPlace?: TaxPlace | null } & Record<string, unknown>;
  shippingAddress?: { country?: string; state?: string } | null;
}

export interface UsSalesTaxReturn {
  registration: string;
  state: string;
  startDate: string;
  endDate: string;
  grossSalesCents: number;
  exemptSalesCents: number;
  taxableSalesCents: number;
  taxCollectedCents: number;
  /** the tax by part, as the invoices saved it ("Texas state sales tax", "Austin") */
  byJurisdiction: Array<{ name: string; taxCents: number }>;
  documentCount: number;
  /** the invoices counted in this return (credit notes not included): the certificate check uses the same set */
  invoiceIds: string[];
  /** this seller's US sales in the period with no state recorded: in no state's return until someone adds it */
  unplaced: { documentCount: number; netCents: number; taxCents: number; documents: Array<{ id: string; netCents: number; taxCents: number }> };
}

const toBase = (cents: number, rate?: number) => Math.round(cents * (rate && rate > 0 ? rate : 1));

export function usSalesTaxReturn(input: {
  registration: string;
  profiles: TaxProfiles | null | undefined;
  order: string[];
  invoices: UsSalesDocument[];
  creditNotes?: UsSalesDocument[];
  customers: Array<{ id: string; metadata?: unknown }>;
  startDate: string;
  endDate: string;
}): UsSalesTaxReturn {
  const state = /^sales_tax:US-([A-Z0-9]{1,3})[:-]/.exec(input.registration)?.[1] || '';
  const out: UsSalesTaxReturn = {
    registration: input.registration, state, startDate: input.startDate, endDate: input.endDate,
    grossSalesCents: 0, exemptSalesCents: 0, taxableSalesCents: 0, taxCollectedCents: 0, byJurisdiction: [], documentCount: 0, invoiceIds: [],
    unplaced: { documentCount: 0, netCents: 0, taxCents: 0, documents: [] },
  };
  const parts = new Map<string, number>();
  const customers = new Map(input.customers.map(c => [c.id, c]));
  const invoicesById = new Map(input.invoices.filter(i => i.id).map(i => [i.id, i]));
  const add = (docs: UsSalesDocument[] | undefined, sign: 1 | -1) => {
    for (const doc of docs || []) {
      const date = String(doc.date || doc.issueDate || '').slice(0, 10);
      if (!COUNTED_SALES.has(String(doc.status)) || date < input.startDate || date > input.endDate) continue;
      // a credit note follows its invoice: the same seller and destination when it records none itself
      const invoice = sign === -1 && doc.invoiceId ? invoicesById.get(doc.invoiceId) : undefined;
      const seller = resolveSellerProfile(input.profiles, documentEntityLabels(doc) || (invoice ? documentEntityLabels(invoice) : undefined), input.order);
      if (!registrationsOn(seller, 'sales_tax', date).some(r => registrationKey(r) === input.registration)) continue;
      const customer = doc.customerId ? customers.get(doc.customerId) : undefined;
      const destination = usSaleDestination(doc, invoice, customer, seller.place?.state);
      if (destination.abroad) continue; // a sale abroad is in no state
      const buyerState = destination.state;
      if (!buyerState) {
        const unplacedFigures = taxReturnDocument(doc);
        const netCents = sign * toBase(unplacedFigures.netCents, doc.exchangeRate);
        const taxCents = sign * toBase(unplacedFigures.taxCents, doc.exchangeRate);
        out.unplaced.documentCount++;
        out.unplaced.netCents += netCents;
        out.unplaced.taxCents += taxCents;
        out.unplaced.documents.push({ id: `${sign === 1 ? 'invoice' : 'credit'}:${doc.id}`, netCents, taxCents });
        continue;
      }
      if (buyerState !== state) continue;
      const figures = taxReturnDocument(doc);
      const net = sign * toBase(figures.netCents, doc.exchangeRate);
      const tax = sign * toBase(figures.taxCents, doc.exchangeRate);
      const certified = exemptionOn(customer, date)?.state === 'exempt';
      const exempt = certified || doc.taxTreatment === 'exempt' || doc.taxTreatment === 'zero_rated' || (figures.taxCents === 0 && doc.taxTreatment !== 'standard');
      out.grossSalesCents += net;
      if (exempt) out.exemptSalesCents += net; else out.taxableSalesCents += net;
      out.taxCollectedCents += tax;
      for (const part of doc.taxBreakdown || []) parts.set(part.name, (parts.get(part.name) || 0) + sign * toBase(part.taxCents, doc.exchangeRate));
      out.documentCount++;
      if (sign === 1) out.invoiceIds.push(String(doc.id));
    }
  };
  add(input.invoices, 1);
  add(input.creditNotes, -1);
  out.byJurisdiction = [...parts].map(([name, taxCents]) => ({ name, taxCents })).sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
/**
 * Where a US sale was delivered: the one rule shared by the state return and the quarter journey (#627).
 * Every place recorded for the sale, most specific first: its own saved tax place, its ship-to, then (a credit
 * note) its invoice's, and only then the customer's place today. One that names a state (or a country abroad)
 * decides; a US place with no state is incomplete and passed over. With no place recorded anywhere it is an
 * over-the-counter sale at the seller's own state. `state` is '' when the sale cannot be placed.
 */
export function usSaleDestination(
  doc: UsSalesDocument, invoice: UsSalesDocument | undefined,
  customer: { metadata?: unknown } | undefined, sellerState: string | undefined,
): { abroad: boolean; state: string } {
  const shipTo = (d: UsSalesDocument | undefined): TaxPlace | undefined => (d?.shippingAddress?.state ? { country: d.shippingAddress.country || 'US', state: d.shippingAddress.state } : undefined);
  const recorded = [doc.metadata?.taxPlace, shipTo(doc), invoice?.metadata?.taxPlace, shipTo(invoice), (customer?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace]
    .filter((p): p is TaxPlace => Boolean(p));
  const isAbroad = (p: TaxPlace) => String(p.country || '').toUpperCase() !== 'US';
  const place = recorded.find(p => isAbroad(p) || p.state);
  if (place && isAbroad(place)) return { abroad: true, state: '' };
  return { abroad: false, state: String((place ? place.state : recorded.length ? '' : sellerState) || '').toUpperCase() };
}

