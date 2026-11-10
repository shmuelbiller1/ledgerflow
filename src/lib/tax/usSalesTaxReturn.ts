/**
 * A US state sales tax return for one permit (PLAN US-3), from the period's invoices and credit
 * notes: gross sales, exempt sales (an exempt or zero treatment, or the customer's good exemption
 * certificate, T-05), taxable sales, the tax collected, and the tax by jurisdiction part (state,
 * county, city, district: the invoice's saved tax breakdown). A document belongs to the permit when
 * its seller (its entity label — the first line's, as the invoice screen saves it — else the books, PLAN §6) holds that permit on the date and the
 * customer's tax place is in the permit's state. Credit notes reduce the period they fall in.
 * Read-only; amounts in the home currency. Pure.
 */
import { taxReturnDocument, type TaxableDocument } from '../taxReturnDocs';
import { COUNTED_SALES } from '../taxCodes';
import { exemptionOn } from '../taxExemption';
import { documentEntityLabels } from './ilVatReturn';
import { registrationKey, registrationsOn, resolveSellerProfile, type TaxPlace, type TaxProfiles } from './profile';

export interface UsSalesDocument extends TaxableDocument {
  customerId?: string;
  dimensions?: Record<string, string>;
  /** the invoice screen saves the entity label on the first line (#517) */
  items?: unknown;
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
    grossSalesCents: 0, exemptSalesCents: 0, taxableSalesCents: 0, taxCollectedCents: 0, byJurisdiction: [], documentCount: 0,
  };
  const parts = new Map<string, number>();
  const customers = new Map(input.customers.map(c => [c.id, c]));
  const add = (docs: UsSalesDocument[] | undefined, sign: 1 | -1) => {
    for (const doc of docs || []) {
      const date = String(doc.date || doc.issueDate || '').slice(0, 10);
      if (!COUNTED_SALES.has(String(doc.status)) || date < input.startDate || date > input.endDate) continue;
      const seller = resolveSellerProfile(input.profiles, documentEntityLabels(doc), input.order);
      if (!registrationsOn(seller, 'sales_tax', date).some(r => registrationKey(r) === input.registration)) continue;
      const customer = doc.customerId ? customers.get(doc.customerId) : undefined;
      const place = (customer?.metadata as { taxPlace?: TaxPlace } | undefined)?.taxPlace;
      // the buyer's state decides; without one, the seller's own place (an over-the-counter sale)
      const buyerState = place?.country === 'US' ? place.state : place ? undefined : seller.place?.state;
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
    }
  };
  add(input.invoices, 1);
  add(input.creditNotes, -1);
  out.byJurisdiction = [...parts].map(([name, taxCents]) => ({ name, taxCents })).sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
