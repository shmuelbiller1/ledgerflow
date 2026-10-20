/**
 * E-9: historical PCN874 individual-dealer, fixed-width fixture writer.
 * Source: Israel Tax Authority's English PCN874 Appendix A, archived by gov.il:
 * https://www.gov.il/BlobFolder/generalpage/tax-vat-online-invoice-reporting/ar/IncomeTax_IncomeTaxSoftwareHousesInfo_874-eng.pdf
 *
 * Layout dates to 2010. DO NOT USE FOR LIVE FILING: current validation, document classification,
 * allocation numbers and tax-authority acceptance must be verified independently.
 * Nothing here calculates VAT rates or reads/posts accounting entries.
 */
import { validCustomReportPeriod } from '../reportCustomPeriod';

export const PCN874_DRAFT_HEADER_WIDTH = 131;
export const PCN874_DRAFT_TRANSACTION_WIDTH = 60;
export const PCN874_DRAFT_CLOSING_WIDTH = 10;

export type Pcn874Class = 'taxable-sale' | 'zero-sale' | 'input-other' | 'input-equipment';
export type Pcn874Sign = '+' | '-';
export interface Pcn874FixtureDocument {
  entryType: 'S' | 'L' | 'M' | 'Y' | 'I' | 'T' | 'K' | 'R' | 'P' | 'H' | 'C';
  category: Pcn874Class;
  counterpartyId: string;
  invoiceDate: string; // YYYY-MM-DD
  referenceGroup: string; // max 4 ASCII
  referenceNumber: string; // 1–9 numeric characters
  vatNis: number; // whole NIS, pre-rounded by the source of record
  baseNis: number; // whole NIS, excluding VAT
  sign: Pcn874Sign;
  allocationNumber?: string; // historical future-field 9 digits, only if verified
}
export interface Pcn874DraftRequest {
  dealerId: string;
  month: string; // YYYY-MM
  /**
   * CON-4: the last month of a bimonthly report (the month after `month`); omitted for a monthly one.
   * The header keeps `month`, the period's first month — not verified against the current layout.
   */
  endMonth?: string;
  generatedOn: string; // YYYY-MM-DD
  documents: readonly Pcn874FixtureDocument[];
}
export interface Pcn874DraftOutput {
  text: string;
  header: string;
  transactions: string[];
  closing: string;
  /** Explicit refusal to certify this historical format for 2026 filings. */
  filingReady: false;
}
const sales = new Set(['S','L','M','Y','I']);
const signed = (value: number, width: number): string => {
  if (!Number.isSafeInteger(value)) throw new Error('A PCN874 total is not a safe whole number.');
  return (value < 0 ? '-' : '+') + numeric(String(Math.abs(value)), width);
};
const numeric = (value: string, width: number, label = 'numeric field') => {
  if (!/^\d+$/.test(value) || value.length > width) throw new Error(`Invalid PCN874 ${label} (maximum ${width} digits).`);
  return value.padStart(width, '0');
};
const date8 = (date: string) => {
  if (!validCustomReportPeriod({ startDate: date, endDate: date })) throw new Error('Invalid PCN874 document date.');
  return date.replace(/-/g, '');
};
const signedAmount = (doc: Pcn874FixtureDocument, name: 'baseNis' | 'vatNis') => {
  const amount = doc[name];
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`Invalid PCN874 ${name}: must be nonnegative whole NIS.`);
  return doc.sign === '-' ? -amount : amount;
};
export function buildPcn874FixtureDraft(request: Pcn874DraftRequest): Pcn874DraftOutput {
  const dealerId = numeric(request.dealerId, 9, 'dealer ID');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(request.month)) throw new Error('Invalid PCN874 month.');
  const month = request.month.replace('-', '');
  const endMonth = (request.endMonth || request.month).replace('-', '');
  const [y, m] = request.month.split('-').map(Number);
  const nextMonth = m === 12 ? null : `${y}${String(m + 1).padStart(2, '0')}`;
  if (endMonth !== month && (!/^\d{6}$/.test(endMonth) || endMonth !== nextMonth)) throw new Error('Invalid PCN874 period: a report is one month or two months of one year.');
  const generatedOn = date8(request.generatedOn);
  let taxableSales = 0, taxableVat = 0, zeroSales = 0, inputOther = 0, inputEquipment = 0;
  let saleCount = 0, inputCount = 0;
  const transactions = request.documents.map((doc) => {
    if (![...sales, 'T', 'K', 'R', 'P', 'H', 'C'].includes(doc.entryType)) throw new Error('Unknown PCN874 entry type.');
    const isSale = sales.has(doc.entryType);
    if (isSale !== (doc.category === 'taxable-sale' || doc.category === 'zero-sale'))
      throw new Error('PCN874 type/category classification mismatch.');
    if (doc.sign !== '+' && doc.sign !== '-') throw new Error('Invalid PCN874 sign.');
    const date = date8(doc.invoiceDate);
    if (date.slice(0, 6) < month || date.slice(0, 6) > endMonth) throw new Error('PCN874 document date is outside report month.');
    if (!/^[\x20-\x7e]{0,4}$/.test(doc.referenceGroup)) throw new Error('Invalid PCN874 reference group.');
    if (doc.category === 'zero-sale' && doc.vatNis !== 0) throw new Error('Zero-rate entry has VAT.');
    signedAmount(doc, 'vatNis'); signedAmount(doc, 'baseNis');
    const vat = signedAmount(doc, 'vatNis'), base = signedAmount(doc, 'baseNis');
    if (isSale) {
      saleCount++;
      if (doc.category === 'zero-sale') zeroSales += base;
      else { taxableSales += base; taxableVat += vat; }
    } else {
      inputCount++;
      if (doc.category === 'input-equipment') inputEquipment += vat;
      else inputOther += vat;
    }
    const row = doc.entryType
      + numeric(doc.counterpartyId, 9, 'counterparty')
      + date
      + doc.referenceGroup.padEnd(4, ' ')
      + numeric(doc.referenceNumber, 9, 'reference number')
      + numeric(String(doc.vatNis), 9, 'VAT amount')
      + doc.sign
      + numeric(String(doc.baseNis), 10, 'base amount')
      + numeric(doc.allocationNumber || '0', 9, 'future/allocation field');
    if (row.length !== PCN874_DRAFT_TRANSACTION_WIDTH) throw new Error('PCN874 transaction width mismatch.');
    return row;
  });
  const header = 'O' + dealerId + month + '1' + generatedOn
    + signed(taxableSales, 11) + signed(taxableVat, 9)
    + signed(0, 11) + signed(0, 9)
    + numeric(String(saleCount), 9, 'sales count')
    + signed(zeroSales, 11)
    + signed(inputOther, 9) + signed(inputEquipment, 9)
    + numeric(String(inputCount), 9, 'input count')
    + signed(taxableVat - inputOther - inputEquipment, 11);
  if (header.length !== PCN874_DRAFT_HEADER_WIDTH) throw new Error('PCN874 header width mismatch.');
  const closing = 'X' + dealerId;
  if (closing.length !== PCN874_DRAFT_CLOSING_WIDTH) throw new Error('PCN874 closing width mismatch.');
  return { text: [header, ...transactions, closing].join('\r\n') + '\r\n', header, transactions, closing, filingReady: false };
}
