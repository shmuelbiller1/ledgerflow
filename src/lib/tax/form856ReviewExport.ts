/**
 * E-17: a review worksheet for annual Israeli vendor withholding (Form 856).
 * NOT the Tax Authority's electronic 856 file. The published 2017-2025
 * interface has fixed-width 60/70/80 records, 218 bytes each, not CSV.
 * Reference: https://www.gov.il/he/service/report126
 *
 * No posting, filing, conversion, deduction or invented taxpayer metadata.
 */
import { csvMoney } from '../csvExport';
import {
  form856Rows, form856Year, isForm856Payment,
  type Form856Payment, type Form856Row,
} from './form856';

export interface Form856ReviewPayment extends Form856Payment {
  /** Stored document currency; missing on legacy records means the book currency. */
  currency?: string;
  status?: 'draft' | 'posted' | 'void';
}

export const FORM_856_REVIEW_HEADERS = [
  'Tax year', 'Vendor reference', 'Vendor', 'Tax ID (sensitive)', 'Payments',
  'Paid', 'Withholding base', 'Withheld', 'Effective rate %',
  'Recorded certificates', 'Months', 'Payments missing certificate',
] as const;

export interface Form856ReviewExport {
  /** CSV is a human-review worksheet and NEVER an authority upload file. */
  readyForFiling: false;
  canDownloadForReview: boolean;
  blockers: string[];
  notices: string[];
  headers: readonly string[];
  rows: string[][];
}

function safeCents(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const candidate = new Date(date + 'T00:00:00Z');
  return Number.isFinite(candidate.getTime()) && candidate.toISOString().slice(0, 10) === date;
}

function worksheetRow(row: Form856Row, year: string): string[] {
  return [
    year, row.contactId, row.name, row.taxId, String(row.payments),
    csvMoney(row.paidCents), csvMoney(row.baseCents), csvMoney(row.withheldCents),
    String(row.effectiveRatePercent), row.certificates.join(' '),
    row.months.join(' '), String(row.missingCertificates),
  ];
}

/**
 * Validate the source BEFORE handing the existing report totals to a CSV.
 * A posted foreign-currency payment mixes document amount with the saved
 * home-currency withholding; refuse that comparison rather than invent FX.
 * Callers must also verify that their workspace-scoped payment read is complete.
 */
export function form856ReviewExport(
  payments: readonly Form856ReviewPayment[],
  year: string,
  homeCurrency: string,
): Form856ReviewExport {
  const blockers: string[] = [];
  const notices = [
    'Review worksheet only; NOT an Israeli Tax Authority Form 856 upload or filing.',
    'Verify complete posted payment history, withholding classifications, payer details and amounts with an accountant.',
    'Contains taxpayer identifiers: store and share the downloaded file securely.',
  ];
  const bookCurrency = homeCurrency.trim().toUpperCase();
  if (!/^\d{4}$/.test(year) || year === '0000') blockers.push('Select a valid four-digit tax year.');
  if (!/^[A-Z]{3}$/.test(bookCurrency)) blockers.push('A valid home currency is required.');

  const selected = payments.filter(payment =>
    isForm856Payment(payment) && form856Year(payment.date) === year
  );
  for (const payment of selected) {
    if (payment.status !== 'posted') {
      blockers.push('A draft, void or unverified-status payment has withholding in this year.');
    }
    if (!validDate(payment.date)) blockers.push('A withholding payment has an invalid date.');
    const currency = (payment.currency || bookCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency !== bookCurrency) {
      blockers.push('Foreign/unknown-currency payments require verified conversion before this worksheet can be exported.');
    }
    if (!safeCents(payment.amountCents) || !safeCents(payment.vatCents) ||
        !safeCents(payment.withheldCents) || (payment.vatCents ?? 0) > payment.amountCents ||
        (payment.withheldCents ?? 0) > payment.amountCents) {
      blockers.push('A payment has invalid minor-unit amounts or inconsistent VAT/withholding.');
    }
  }
  const reportRows = form856Rows([...selected], year);
  if (reportRows.some(row =>
    !safeCents(row.paidCents) || !safeCents(row.baseCents) ||
    !safeCents(row.withheldCents) || !Number.isSafeInteger(row.payments) ||
    !Number.isFinite(row.effectiveRatePercent)
  )) blockers.push('The aggregated report contains invalid or unsafe totals.');
  if (reportRows.some(row => !row.taxId.trim())) {
    notices.push('Some vendors have no recorded tax ID; identify and verify them before filing.');
  }
  if (reportRows.some(row => row.missingCertificates > 0)) {
    notices.push('Some payments lack a recorded withholding certificate; check the underlying payments.');
  }
  return {
    readyForFiling: false,
    canDownloadForReview: blockers.length === 0 && reportRows.length > 0,
    blockers: [...new Set(blockers)],
    notices,
    headers: FORM_856_REVIEW_HEADERS,
    rows: blockers.length ? [] : reportRows.map(row => worksheetRow(row, year)),
  };
}
