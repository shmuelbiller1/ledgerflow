/**
 * E-17: an authority-order CSV for the yearly Israeli vendor withholding report (Form 856).
 *
 * The columns follow the Tax Authority's published record-60 ("רשומת המקבלים") field order for the
 * 2017–2025 interface: 20 fields filling content columns 1–216, then CR at 217 and LF at 218 —
 * every record type (60, 70, 80) is exactly 218 bytes. Source: "מבנה קובץ 856 מ שנת המס 2017 עד
 * 2025" (Israel Tax Authority, 14 Jan 2026) published on https://www.gov.il/he/service/report126,
 * whose field table is reproduced field-for-field at
 * https://www.hon.co.il/טופס-856-דו-ח-שנתית-על-ניכויים/ (both checked against each other: rules
 * 1–4, field 11 at 97–107, record-type field at 215–216 and the 218-byte record length agree).
 *
 * What this is NOT: the transmission file. The authority's file is fixed-width 218-byte records;
 * this writer emits CSV (the task's "CSV in the Tax Authority's order"). Numeric cells follow the
 * authority's numeric reporting rules — whole minor units (agorot), no decimal point, zero-padded
 * to the field width, empty numeric fields written as zeros. Text cells keep their full value; an
 * overflow is reported instead of silently truncated. `readyForFiling` is always false and
 * nothing here is filed, posted or paid.
 *
 * Pure: no store, no I/O.
 */
import { form856Year, isForm856Payment, type Form856Payment } from './form856';
import type { TaxProfiles } from './profile';

/** One column of the authority's record-60 layout, in the authority's own order. */
export interface Form856AuthorityField {
  /** the authority's field number (1–20 for record 60) */
  no: number;
  /** first content column (1-based, inclusive) */
  from: number;
  /** last content column (inclusive) */
  to: number;
  width: number;
  /** stable camelCase key used to fill a cell */
  key: string;
  he: string;
  en: string;
  kind: 'num' | 'text';
}

/** Record 60 fields in the authority's order; widths sum to 216, +CR/LF = the 218-byte record. */
export const FORM_856_RECORD_60_FIELDS: readonly Form856AuthorityField[] = [
  { no: 1, from: 1, to: 9, width: 9, key: 'withholdingFileNo', he: 'מספר תיק ניכויים', en: 'Withholding file no.', kind: 'num' },
  { no: 2, from: 10, to: 11, width: 2, key: 'reportCode', he: 'קוד הדיווח', en: 'Report code', kind: 'num' },
  { no: 3, from: 12, to: 15, width: 4, key: 'taxYear', he: 'שנת מס', en: 'Tax year', kind: 'num' },
  { no: 4, from: 16, to: 16, width: 1, key: 'workerFlag', he: 'זיהוי עובד', en: 'Worker identification', kind: 'num' },
  { no: 5, from: 17, to: 17, width: 1, key: 'payeeFileType', he: 'סוג התיק במס הכנסה של המקבל', en: 'Payee Income-Tax file type', kind: 'num' },
  { no: 6, from: 18, to: 26, width: 9, key: 'payeeItFileNo', he: 'מספר תיק במס הכנסה / מספר תעודת זהות', en: 'Payee Income-Tax file no. / ID', kind: 'num' },
  { no: 7, from: 27, to: 40, width: 14, key: 'supplierAccountNo', he: 'מספר ספק / חשבון', en: 'Supplier / account no.', kind: 'num' },
  { no: 8, from: 41, to: 62, width: 22, key: 'name', he: 'שם משפחה ושם פרטי / שם החברה', en: 'Payee name', kind: 'text' },
  { no: 9, from: 63, to: 83, width: 21, key: 'street', he: 'רחוב / שכונה ומספר בית', en: 'Street', kind: 'text' },
  { no: 10, from: 84, to: 96, width: 13, key: 'city', he: 'עיר', en: 'City', kind: 'text' },
  { no: 11, from: 97, to: 107, width: 11, key: 'payments', he: 'סה״כ תשלומים ששולמו ברוטו (כולל מע״מ)', en: 'Gross payments (incl. VAT)', kind: 'num' },
  { no: 12, from: 108, to: 116, width: 9, key: 'taxWithheld', he: 'סה״כ מס הכנסה שנוכה', en: 'Income tax withheld', kind: 'num' },
  { no: 13, from: 117, to: 124, width: 8, key: 'vatTransferred', he: 'סה״כ מע״מ ששולם למס הכנסה', en: 'VAT paid to the Income Tax', kind: 'num' },
  { no: 14, from: 125, to: 132, width: 8, key: 'yearEndBalance', he: 'יתרות לזכות המקבל לסוף שנת המס', en: 'Year-end balance to the payee', kind: 'num' },
  { no: 15, from: 133, to: 134, width: 2, key: 'rate', he: 'שיעור הניכוי', en: 'Withholding rate %', kind: 'num' },
  { no: 16, from: 135, to: 146, width: 12, key: 'approvingOffice', he: 'משרד השומה נותן האישור וסמל פקיד השומה', en: 'Approving office and code', kind: 'text' },
  { no: 17, from: 147, to: 160, width: 14, key: 'occupation', he: 'עיסוק המקבל', en: 'Payee occupation', kind: 'text' },
  { no: 18, from: 161, to: 212, width: 52, key: 'filler', he: 'ריק', en: 'Filler', kind: 'text' },
  { no: 19, from: 213, to: 214, width: 2, key: 'typeCode', he: 'סוג הניכוי', en: 'Withholding type code', kind: 'num' },
  { no: 20, from: 215, to: 216, width: 2, key: 'recordType', he: 'סוג רשומה 60', en: 'Record type (60)', kind: 'num' },
];

/** The payer's own record (part of every record-60 row). */
export interface Form856AuthorityPayer {
  /** מס' תיק ניכויים: nine digits assigned by the Income Tax office (the first digit is 9). */
  withholdingFileNo: string;
  /** the tax year, four digits (field 3) */
  taxYear: string;
}

/** One payee line — the typed input the CSV is written from (a fixture or mapped payments). */
export interface Form856AuthorityPayee {
  name: string;
  /** field 4: 2 = Palestinian Authority resident, 5 = international company (English names) */
  workerFlag?: '2' | '5';
  /** field 5: 1 = self-employed, 2 = company, 3 = licensed dealer */
  payeeFileType?: '1' | '2' | '3';
  /** field 6: Income-Tax file no. / ID / company no., up to 9 digits (zero-padded left) */
  payeeItFileNo?: string;
  /** field 7: the supplier/account number as recorded */
  supplierAccountNo?: string;
  street?: string;
  city?: string;
  /** whole agorot (field 11) */
  paymentsCents: number;
  /** whole agorot (field 12) */
  taxWithheldCents: number;
  /** whole agorot (field 13) */
  vatTransferredCents?: number;
  /** whole agorot (field 14) */
  yearEndBalanceCents?: number;
  /** whole percent 0–99 (field 15); one record per rate, as the authority requires */
  withholdingRatePercent?: number;
  approvingOffice?: string;
  occupation?: string;
  /** two digits (field 19) */
  withholdingTypeCode?: string;
}

export interface Form856AuthorityExport {
  /** The authority's file is fixed-width 218-byte records; a CSV is never filed. */
  readyForFiling: false;
  /** rows can be produced and nothing invalid was seen — the human still reviews the problems */
  canDownload: boolean;
  /** invalid input: no rows are produced */
  blockers: string[];
  /** written anyway, but a person must fix or confirm each one before real use */
  problems: string[];
  notices: string[];
  /** one header per authority field, in the authority's order */
  headers: string[];
  rows: string[][];
}

const REPORT_CODE = '96';
const RECORD_TYPE_60 = '60';

function pushUnique(list: string[], message: string): void {
  if (!list.includes(message)) list.push(message);
}

interface Ctx {
  blockers: string[];
  problems: string[];
}

/**
 * A numeric cell under the authority's rules: whole agorot/codes, no decimal point, zero-padded
 * to the field width (empty → zeros). A value too wide for the field keeps its full digits and
 * is reported — a fixed-width record could not carry it, and silently cutting money is worse.
 */
function numCell(value: number | undefined, field: Form856AuthorityField, ctx: Ctx, who: string): string {
  const zeros = '0'.repeat(field.width);
  if (value === undefined) return zeros;
  if (!Number.isSafeInteger(value) || value < 0) {
    pushUnique(ctx.blockers, `${who}: ${field.en} must be a non-negative whole amount (got ${value}).`);
    return zeros;
  }
  const digits = String(value).length;
  if (digits > field.width) {
    pushUnique(ctx.problems, `${who}: ${field.en} (${value}) has more than the field's ${field.width} digits; the CSV keeps the full number, the fixed-width record could not.`);
    return String(value);
  }
  return String(value).padStart(field.width, '0');
}

/** A text cell: full value kept; an overflow is reported, never truncated in silence. */
function textCell(value: string | undefined, field: Form856AuthorityField, ctx: Ctx, who: string): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const length = [...text].length;
  if (length > field.width) {
    pushUnique(ctx.problems, `${who}: ${field.en} is ${length} characters; the field holds ${field.width}. The CSV keeps the full value.`);
  }
  return text;
}

/**
 * A numeric identifier cell (fields 6 and 7): digits are zero-padded left to the field width,
 * an absent value is the authority's empty form (zeros, reported), and anything the numeric
 * field cannot hold keeps its recorded value with a problem — never a silent rewrite.
 */
function numericIdCell(
  raw: string | undefined,
  field: Form856AuthorityField,
  ctx: Ctx,
  who: string,
  missing: string,
): string {
  const text = String(raw ?? '').trim();
  if (!text) {
    pushUnique(ctx.problems, `${who}: ${missing} is written as zeros.`);
    return '0'.repeat(field.width);
  }
  if (new RegExp(`^\\d{1,${field.width}}$`).test(text)) return text.padStart(field.width, '0');
  pushUnique(ctx.problems, `${who}: "${text}" is not up to ${field.width} digits as the numeric field requires; written as recorded.`);
  return text;
}

function rateCell(rate: number | undefined, taxWithheldCents: number, ctx: Ctx, who: string): string {
  if (rate === undefined) {
    if (taxWithheldCents > 0) {
      pushUnique(ctx.problems, `${who}: tax was withheld but no withholding rate is recorded; field 15 is written as 00.`);
    }
    return '00';
  }
  if (!Number.isInteger(rate) || rate < 0 || rate > 99) {
    pushUnique(ctx.blockers, `${who}: the withholding rate must be a whole percent from 0 to 99 (got ${rate}).`);
    return '00';
  }
  return String(rate).padStart(2, '0');
}

/**
 * The authority-order CSV for one payer and its payee records, in the field order of record 60.
 * Callers that start from payments use `form856AuthorityPayees` first; this function never
 * invents a value — absent fields are the authority's empty form (zeros / blank) and are listed
 * in `notices`/`problems` so a person sees exactly what the books did not record.
 */
export function form856AuthorityCsv(
  payer: Form856AuthorityPayer,
  payees: readonly Form856AuthorityPayee[],
): Form856AuthorityExport {
  const ctx: Ctx = { blockers: [], problems: [] };
  const notices = [
    'Columns follow the Tax Authority record-60 field order for the 2017–2025 Form 856 interface; amounts are whole agorot, zero-padded to each field width.',
    'This CSV is not the fixed-width 218-byte transmission file, and nothing is filed from Ledgerflow.',
    'Fields the books do not record (worker flag, payee file type, supplier account, street, city, VAT transferred, year-end balance, approving office, occupation, withholding type) are written as zeros or blank and must be completed before any real use.',
    'Contains taxpayer identifiers: store and share the downloaded file securely.',
  ];

  const fileNo = String(payer.withholdingFileNo ?? '').trim();
  if (!/^\d{9}$/.test(fileNo)) {
    ctx.blockers.push('The withholding file number (תיק ניכויים) must be exactly nine digits.');
  } else if (fileNo[0] !== '9') {
    pushUnique(ctx.problems, `The withholding file number ${fileNo} does not start with 9, the first digit the Income Tax office assigns.`);
  }
  const taxYear = String(payer.taxYear ?? '').trim();
  if (!/^\d{4}$/.test(taxYear) || taxYear === '0000') {
    ctx.blockers.push('The tax year must be four digits (not 0000).');
  }

  const rows: string[][] = [];
  for (const payee of payees) {
    const who = String(payee.name ?? '').trim() || 'A payee record';
    if (!String(payee.name ?? '').trim()) {
      ctx.blockers.push('A payee record has no name.');
      continue;
    }
    if (payee.withholdingTypeCode !== undefined && !/^\d{2}$/.test(payee.withholdingTypeCode)) {
      ctx.blockers.push(`${who}: the withholding type code must be two digits (got ${payee.withholdingTypeCode}).`);
    }
    const cells: Record<string, string> = {
      withholdingFileNo: /^\d{9}$/.test(fileNo) ? fileNo : '000000000',
      reportCode: REPORT_CODE,
      taxYear: /^\d{4}$/.test(taxYear) ? taxYear : '0000',
      workerFlag: payee.workerFlag ?? '0',
      payeeFileType: payee.payeeFileType ?? '0',
      payeeItFileNo: numericIdCell(payee.payeeItFileNo, fieldByKey('payeeItFileNo')!, ctx, who, 'no tax ID (field 6)'),
      supplierAccountNo: numericIdCell(payee.supplierAccountNo, fieldByKey('supplierAccountNo')!, ctx, who, 'no supplier/account number (field 7)'),
      name: textCell(payee.name, fieldByKey('name')!, ctx, who),
      street: textCell(payee.street, fieldByKey('street')!, ctx, who),
      city: textCell(payee.city, fieldByKey('city')!, ctx, who),
      payments: numCell(payee.paymentsCents, fieldByKey('payments')!, ctx, who),
      taxWithheld: numCell(payee.taxWithheldCents, fieldByKey('taxWithheld')!, ctx, who),
      vatTransferred: numCell(payee.vatTransferredCents, fieldByKey('vatTransferred')!, ctx, who),
      yearEndBalance: numCell(payee.yearEndBalanceCents, fieldByKey('yearEndBalance')!, ctx, who),
      rate: rateCell(payee.withholdingRatePercent, payee.taxWithheldCents, ctx, who),
      approvingOffice: textCell(payee.approvingOffice, fieldByKey('approvingOffice')!, ctx, who),
      occupation: textCell(payee.occupation, fieldByKey('occupation')!, ctx, who),
      filler: '',
      typeCode: payee.withholdingTypeCode ?? '00',
      recordType: RECORD_TYPE_60,
    };
    rows.push(FORM_856_RECORD_60_FIELDS.map(field => cells[field.key]));
  }

  const canDownload = ctx.blockers.length === 0 && rows.length > 0;
  return {
    readyForFiling: false,
    canDownload,
    blockers: [...new Set(ctx.blockers)],
    problems: [...new Set(ctx.problems)],
    notices,
    headers: FORM_856_RECORD_60_FIELDS.map(field => `${field.no}. ${field.he} / ${field.en} (${field.from}-${field.to}, ${field.width})`),
    rows: canDownload ? rows : [],
  };
}

function fieldByKey(key: string): Form856AuthorityField | undefined {
  return FORM_856_RECORD_60_FIELDS.find(field => field.key === key);
}

/**
 * Yearly per-vendor withholding payments → the typed payee records record 60 asks for, split one
 * record per withholding rate (the authority requires a separate record for every rate a payee
 * brought). Payments with no usable recorded rate are grouped separately and reported — a rate
 * is never guessed from the effective percentage.
 */
export function form856AuthorityPayees(
  payments: readonly Form856Payment[],
  year: string,
): { payees: Form856AuthorityPayee[]; problems: string[] } {
  const problems: string[] = [];
  interface Group { name: string; taxId: string; rates: Map<number | 'unrated', { paymentsCents: number; taxWithheldCents: number }> }
  const vendors = new Map<string, Group>();

  for (const payment of payments) {
    if (!isForm856Payment(payment) || form856Year(payment.date) !== year) continue;
    const name = String(payment.contactName || '').trim() || payment.contactId;
    let group = vendors.get(payment.contactId);
    if (!group) {
      group = { name, taxId: String(payment.contactTaxId || '').trim(), rates: new Map() };
      vendors.set(payment.contactId, group);
    } else {
      const taxId = String(payment.contactTaxId || '').trim();
      if (taxId && group.taxId && taxId !== group.taxId) {
        pushUnique(problems, `${group.name}: payments carry different tax IDs (${group.taxId} and ${taxId}); the first one recorded is written.`);
      } else if (taxId && !group.taxId) {
        group.taxId = taxId;
      }
    }
    const rawRate = payment.withholdingRatePercent;
    let rate: number | 'unrated';
    if (rawRate === undefined || rawRate === null) {
      rate = 'unrated';
    } else if (Number.isInteger(rawRate) && rawRate >= 0 && rawRate <= 99) {
      rate = rawRate;
    } else {
      pushUnique(problems, `${name}: the recorded withholding rate ${rawRate} is not a whole percent from 0 to 99; the record is written with rate 00.`);
      rate = 'unrated';
    }
    const bucket = group.rates.get(rate) || { paymentsCents: 0, taxWithheldCents: 0 };
    bucket.paymentsCents += Number(payment.amountCents) || 0;
    bucket.taxWithheldCents += Number(payment.withheldCents) || 0;
    group.rates.set(rate, bucket);
  }

  const payees: Form856AuthorityPayee[] = [];
  for (const group of vendors.values()) {
    for (const [rate, totals] of group.rates) {
      payees.push({
        name: group.name,
        payeeItFileNo: group.taxId || undefined,
        paymentsCents: totals.paymentsCents,
        taxWithheldCents: totals.taxWithheldCents,
        withholdingRatePercent: rate === 'unrated' ? undefined : rate,
      });
    }
  }
  payees.sort((a, b) =>
    a.name.localeCompare(b.name)
    || (a.withholdingRatePercent ?? -1) - (b.withholdingRatePercent ?? -1));
  return { payees, problems };
}

/**
 * The workspace's Israeli withholding file number (תיק ניכויים) when a books-level tax profile
 * records one: an `employer` registration for Israel whose number is the nine digits the
 * authority assigns. Anything else — a US EIN, a partial number — is left for the person to type.
 */
export function ilWithholdingFileNo(profiles: TaxProfiles | null | undefined): string {
  const registrations = profiles?.books?.registrations || [];
  const hit = registrations.find(registration =>
    registration.kind === 'employer'
    && String(registration.place?.country || '').trim().toUpperCase() === 'IL'
    && /^\d{9}$/.test(String(registration.number || '').trim()));
  return hit ? String(hit.number).trim() : '';
}
