/**
 * A-43 (PLAN IL-5): Israel's **default** rates of tax withheld at source on a payment to a vendor who
 * has not given a current approval/ exemption (אישור פקיד שומה).
 *
 * What this is for: the suggested rate a payment screen shows when the vendor's own approval is
 * missing or expired — a starting point a person confirms, dated, with the source it was read from.
 * What it is not: a decision. The vendor's own approval always replaces the default
 * (`src/lib/tax/withholding.ts` reads it), an approval the payee holds is evidence a rule cannot
 * invent, and a tax treaty changes the foreign-resident rows. Nothing here posts or changes how much
 * the app withholds: the existing helper still computes the amount from the rate and the payment.
 *
 * Two questions this table deliberately leaves open, and says so:
 *  - **the base** — the regulations' wording takes the payment as the payee receives it; published
 *    practice for rent takes the amount including VAT while ordinary bookkeeping practice for a service
 *    takes the amount before VAT. Every row is therefore `base: 'unspecified'`, and the app's existing
 *    helper (which withholds from the payment less VAT) is unchanged. An accountant must settle it.
 *  - **the payee's kind** — a company and an individual supplier share the 30% services default, but an
 *    individual's *approval* often differs (and the authority's letters name rates up to 47%). The row
 *    names the rate the regulation sets, not the payee's own rate.
 *
 * The rows become rules in `src/lib/rules/packs/ilWithholdingPack.ts`, so the source checker (A-59) and
 * the pack diff (A-60) see them like every other table.
 */
import { withholdingOn, type WithholdingCertificate } from './withholding';

export type IlWithholdingPaymentType = 'services-or-assets' | 'rent-expense' | 'interest' | 'royalty' | 'dividend' | 'wage';
export type IlWithholdingPayeeResidence = 'israel' | 'foreign';
export type IlWithholdingPayeeKind = 'company' | 'individual' | 'substantial-shareholder';

export interface IlWithholdingDefaultRow {
  id: string;
  paymentType: IlWithholdingPaymentType;
  residence: IlWithholdingPayeeResidence;
  /** only where the source distinguishes the payee; otherwise undefined (the rate is the same) */
  payeeKind?: IlWithholdingPayeeKind;
  /** the default percentage from 0 to 100 */
  ratePercent: number;
  /** what the percentage is taken from, where the source settles it */
  base: 'payment-less-vat' | 'payment-including-vat' | 'unspecified';
  /** false for payments a business does not make to a vendor (a shareholder dividend, a wage) */
  vendorPayment: boolean;
  validFrom: string;
  validTo?: string;
  source: { authority: string; url: string; retrieved: string };
  note: string;
}

const ITA = 'https://www.gov.il/he/departments/israel_tax_authority';
const CHECKED = '2026-10-12';
/** The rows are asserted from here — not each regulation's own commencement, which the note names. */
const VALID_FROM = '2026-01-01';

const base = (authority: string) => ({ authority, url: ITA, retrieved: CHECKED });

const BASE_QUESTION = 'the source says the payment as it reaches the payee; published practice takes rent from the amount including VAT while ordinary practice for a service takes the amount before VAT — an accountant confirms the base';
const APPROVAL_WINS = 'the payee’s own approval (אישור) from the assessing officer replaces this rate, including an approval of exemption';

export const IL_WITHHOLDING_DEFAULTS: IlWithholdingDefaultRow[] = [
  {
    id: 'il-withholding-services-or-assets-israel',
    paymentType: 'services-or-assets', residence: 'israel',
    ratePercent: 30, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (payments for a service or an asset as income), תשל"ז-1977'),
    note: `the regulation reaches a payment to a supplier for a service or an asset where the payer keeps double-entry books; ${APPROVAL_WINS}; ${BASE_QUESTION}`,
  },
  {
    id: 'il-withholding-services-or-assets-foreign',
    paymentType: 'services-or-assets', residence: 'foreign',
    ratePercent: 25, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from payments to foreign residents), תשנ"ג-1992'),
    note: `the internal-law default for a payment to a foreign resident; a tax treaty may reduce it or remove it, and the payee’s certificate of residence decides which treaty applies — the accountant confirms before using this rate; ${BASE_QUESTION}`,
  },
  {
    id: 'il-withholding-rent-expense-israel',
    paymentType: 'rent-expense', residence: 'israel',
    ratePercent: 35, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from payment of rent), תשנ"ח-1998'),
    note: `only where the payer claims the rent as an expense; ${APPROVAL_WINS}; ${BASE_QUESTION}`,
  },
  {
    id: 'il-withholding-rent-expense-foreign',
    paymentType: 'rent-expense', residence: 'foreign',
    ratePercent: 25, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from payments to foreign residents), תשנ"ג-1992'),
    note: `rent from Israeli real property paid to a foreign resident; a tax treaty may change it — the accountant confirms; ${BASE_QUESTION}`,
  },
  {
    id: 'il-withholding-interest-israel',
    paymentType: 'interest', residence: 'israel',
    ratePercent: 25, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from interest, dividends and certain profits), תשס"ו-2005'),
    note: 'interest on an asset that is not linked to the index, paid to an individual; interest paid to a company follows the corporate rate instead, and older linked deposits had 15%/20% transitional rates — a person confirms which applies',
  },
  {
    id: 'il-withholding-interest-foreign',
    paymentType: 'interest', residence: 'foreign',
    ratePercent: 25, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from payments to foreign residents), תשנ"ג-1992'),
    note: 'the internal-law default; a tax treaty may reduce it (published treaty rates run between 5% and 17.5% for common treaty partners) — the accountant confirms the treaty and the payee’s certificate of residence',
  },
  {
    id: 'il-withholding-royalty-foreign',
    paymentType: 'royalty', residence: 'foreign',
    ratePercent: 25, base: 'unspecified', vendorPayment: true, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from payments to foreign residents), תשנ"ג-1992'),
    note: 'the internal-law default for a royalty to a foreign resident; a tax treaty often reduces it and the classification (a licence of a right versus a service, for example software) decides which paragraph applies — the accountant confirms',
  },
  {
    id: 'il-withholding-dividend-israel-individual',
    paymentType: 'dividend', residence: 'israel', payeeKind: 'individual',
    ratePercent: 25, base: 'unspecified', vendorPayment: false, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from interest, dividends and certain profits), תשס"ו-2005'),
    note: 'a dividend to an individual who is not a substantial shareholder; a dividend is not a vendor payment and is not paid from the bills path',
  },
  {
    id: 'il-withholding-dividend-israel-substantial-shareholder',
    paymentType: 'dividend', residence: 'israel', payeeKind: 'substantial-shareholder',
    ratePercent: 30, base: 'unspecified', vendorPayment: false, validFrom: VALID_FROM,
    source: base('Israel Tax Authority — Income Tax regulations (deduction from interest, dividends and certain profits), תשס"ו-2005'),
    note: 'a dividend to an individual who was a substantial shareholder (10% or more) in the twelve months before the payment; a dividend is not a vendor payment',
  },
];

/** The rows for a payment type, and for a residence when asked. */
export function ilWithholdingDefaultRows(paymentType?: IlWithholdingPaymentType, residence?: IlWithholdingPayeeResidence): IlWithholdingDefaultRow[] {
  return IL_WITHHOLDING_DEFAULTS.filter(r => (!paymentType || r.paymentType === paymentType) && (!residence || r.residence === residence));
}

/**
 * The default row for a payment type, residence and payee kind. Without a named kind the row that
 * does not name one is used (never one written for a different payee).
 */
export function ilWithholdingDefault(
  paymentType: IlWithholdingPaymentType,
  residence: IlWithholdingPayeeResidence,
  payeeKind?: IlWithholdingPayeeKind,
): IlWithholdingDefaultRow | undefined {
  const rows = ilWithholdingDefaultRows(paymentType, residence);
  if (!payeeKind) return rows.find(r => !r.payeeKind);
  return rows.find(r => r.payeeKind === payeeKind) || rows.find(r => !r.payeeKind);
}

/** What a payment screen shows as the suggested rate, and why. */
export interface IlWithholdingSuggestion {
  ratePercent: number;
  basis: 'certificate' | 'default';
  /** the payee's approval was good on the date; the default was not used */
  certificateState?: 'good' | 'expired';
  row?: IlWithholdingDefaultRow;
  source: { authority: string; url: string; retrieved: string };
  /** one line a screen can show beside the amount */
  reason: string;
  /** what the suggestion does not settle */
  caveats: string[];
}

export interface IlWithholdingSuggestionInput {
  paymentType: IlWithholdingPaymentType;
  residence: IlWithholdingPayeeResidence;
  /** YYYY-MM-DD the payment is made */
  date: string;
  /** the vendor's own approval, as stored (metadata.withholding) */
  certificate?: WithholdingCertificate | null;
  /** true when the store already knows the approval was good/expired on the date */
  certificateState?: 'good' | 'expired';
  payeeKind?: IlWithholdingPayeeKind;
}

/**
 * The suggested rate for a payment: the payee's own approval wins when it is good on the date; an
 * expired approval falls back to the default and says so; a payment type this table does not answer
 * returns undefined (a person sets the rate — e.g. a resident royalty, or any classification doubt).
 */
export function suggestedWithholdingRate(input: IlWithholdingSuggestionInput): IlWithholdingSuggestion | undefined {
  const certificate = input.certificate || undefined;
  if (certificate && input.certificateState !== 'expired') {
    return {
      ratePercent: certificate.ratePercent, basis: 'certificate', certificateState: 'good',
      source: { authority: 'The payee’s own approval (אישור) from the assessing officer', url: ITA, retrieved: CHECKED },
      reason: certificate.ratePercent === 0
        ? 'The vendor’s approval of exemption applies'
        : `The vendor’s approval sets ${certificate.ratePercent}%`,
      caveats: certificate.expires ? [`The approval is good to ${certificate.expires}`] : [],
    };
  }
  const row = ilWithholdingDefault(input.paymentType, input.residence, input.payeeKind);
  if (!row) return undefined;
  return {
    ratePercent: row.ratePercent, basis: 'default',
    ...(certificate ? { certificateState: 'expired' as const } : {}),
    row, source: row.source,
    reason: input.date < row.validFrom
      ? `No default is asserted for this date (the table starts ${row.validFrom})`
      : `${row.ratePercent}% is the default at source${certificate ? ' (the vendor’s approval has expired)' : ' (the vendor has no approval on file)'}`,
    caveats: [
      row.note,
      'A person confirms the classification and the rate before the payment goes out; this is a suggestion, not a decision.',
    ],
  };
}

/**
 * The suggestion for a stored vendor: reads their own approval through the existing helper and, when
 * it is missing or expired, the default row. Payment screens (AI #1’s bills path) call this; nothing
 * here writes or posts.
 */
export function suggestedWithholdingForVendor(
  vendor: { metadata?: unknown } | null | undefined,
  input: { paymentType: IlWithholdingPaymentType; date: string; payeeKind?: IlWithholdingPayeeKind; residence?: IlWithholdingPayeeResidence },
): IlWithholdingSuggestion | undefined {
  const approval = withholdingOn(vendor, input.date);
  return suggestedWithholdingRate({
    ...input,
    residence: input.residence || 'israel',
    ...(approval ? { certificate: approval.certificate, certificateState: approval.state } : {}),
  });
}

/** The rows a business pays a vendor from; a dividend and a wage are not among them. */
export const IL_VENDOR_PAYMENT_TYPES: IlWithholdingPaymentType[] = ['services-or-assets', 'rent-expense', 'interest', 'royalty'];
