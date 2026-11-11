/**
 * Israel's periodic VAT report (PLAN IL-3; the online report / form 836 fields), for one VAT
 * registration: the period's sales and purchases from the same document figures as every return
 * (taxReturnDocs.ts → computeTaxReturn), split the way the Tax Authority asks:
 *  - taxable sales (excluding VAT) and the VAT on them;
 *  - zero-rated and exempt sales;
 *  - input VAT on fixed assets (ציוד) and on everything else (תשומות אחרות), reported separately;
 *  - the amount to pay, or to get back when negative.
 * Documents belong to the registration whose seller profile carries it (their first line's entity
 * label, else the books: PLAN §6). Read-only; amounts in the home currency, whole shekels on the form
 * are the screen's rounding. Pure.
 */
import { buildTaxReturn, type TaxableDocument } from '../taxReturnDocs';
import { registrationKey, registrationsOn, resolveSellerProfile, type TaxProfiles } from './profile';

export interface IlVatDocument extends TaxableDocument {
  /** labels kept on the document itself (older records); the screens keep them on the first line */
  dimensions?: Record<string, string>;
  /** a bill whose lines are fixed assets (its input VAT is reported apart) */
  fixedAsset?: boolean;
}

export interface IlVatReturn {
  registration: string;
  startDate: string;
  endDate: string;
  taxableSalesCents: number;
  outputVatCents: number;
  zeroRatedSalesCents: number;
  exemptSalesCents: number;
  fixedAssetInputVatCents: number;
  otherInputVatCents: number;
  /** output − inputs; negative: a refund */
  toPayCents: number;
  documentCount: number;
}

/**
 * CON-4b review: the entity labels of a document as the invoice and bill screens save them — the first line's
 * (items[0] on invoices, splits[0] on bills); labels on the document itself only when its first line has none.
 */
export function documentEntityLabels(doc: { dimensions?: Record<string, string>; items?: unknown; splits?: unknown }): Record<string, string> | undefined {
  const firstLine = (lines: unknown) => {
    const line: unknown = Array.isArray(lines) ? lines[0] : undefined;
    const labels = line && typeof line === 'object' ? (line as { dimensions?: unknown }).dimensions : undefined;
    // an empty label set is no label: the document's own labels then apply
    return labels && typeof labels === 'object' && Object.keys(labels).length > 0 ? labels as Record<string, string> : undefined;
  };
  return firstLine(doc.items) || firstLine(doc.splits) || doc.dimensions;
}

/** Whether a document belongs to this VAT registration (by its entity label, else the books). */
export function belongsTo(doc: IlVatDocument, profiles: TaxProfiles | null | undefined, order: string[], registration: string): boolean {
  const date = String(doc.date || doc.issueDate || '').slice(0, 10);
  const seller = resolveSellerProfile(profiles, documentEntityLabels(doc as IlVatDocument & { items?: unknown; splits?: unknown }), order);
  return registrationsOn(seller, 'vat', date || '9999-12-31').some(r => registrationKey(r) === registration);
}

export function israelVatReturn(input: {
  registration: string;
  profiles: TaxProfiles | null | undefined;
  order: string[];
  invoices: IlVatDocument[];
  bills: IlVatDocument[];
  creditNotes?: IlVatDocument[];
  vendorCredits?: IlVatDocument[];
  startDate: string;
  endDate: string;
}): IlVatReturn {
  const mine = (docs: IlVatDocument[] | undefined) => (docs || []).filter(d => belongsTo(d, input.profiles, input.order, input.registration));
  const period = { startDate: input.startDate, endDate: input.endDate };
  const all = buildTaxReturn({ ...period, invoices: mine(input.invoices), bills: mine(input.bills), creditNotes: mine(input.creditNotes), vendorCredits: mine(input.vendorCredits) });
  const assets = buildTaxReturn({ ...period, invoices: [], bills: mine(input.bills).filter(b => b.fixedAsset), vendorCredits: mine(input.vendorCredits).filter(b => b.fixedAsset) });
  const box = (r: typeof all, key: string) => r.boxes.find(b => b.key === key)?.cents ?? 0;
  const fixedAssetInputVatCents = box(assets, '4');
  const outputVatCents = box(all, '3');
  const inputVatCents = box(all, '4');
  return {
    registration: input.registration,
    ...period,
    taxableSalesCents: all.sales.standard.netCents,
    outputVatCents,
    zeroRatedSalesCents: all.sales.zero_rated.netCents,
    exemptSalesCents: all.sales.exempt.netCents,
    fixedAssetInputVatCents,
    otherInputVatCents: inputVatCents - fixedAssetInputVatCents,
    toPayCents: outputVatCents - inputVatCents,
    documentCount: all.documentCount,
  };
}
