import { csvMoney } from './csvExport';
import type { IlVatReturn } from './tax/ilVatReturn';

/**
 * The CSV amount column names the currency the figures are actually in. The Israel VAT screen
 * passes the workspace's base currency: `israelVatReturn` returns home-currency cents, so labeling
 * a USD workspace's figures "NIS" would be false. The ILS default keeps standalone panel callers
 * and older exported files consistent.
 */
export function ilVatReportCsvHeaders(currency = 'ILS'): string[] {
  return [
    'Code',
    'Field (English)',
    'Field (Hebrew)',
    `Amount (${currency})`,
  ];
}

/** The default headers for an ILS workspace; kept as a constant for existing callers and tests. */
export const IL_VAT_REPORT_CSV_HEADERS: string[] = ilVatReportCsvHeaders('ILS');

/**
 * Bilingual Form 836 CSV rows for one return. Amounts are plain decimals from integer cents via
 * the shared `csvMoney` writer (no division by 100, which can lose a cent at large magnitudes).
 * Box 7 is a positive reclaim amount when the return is negative. Pure; nothing is filed.
 */
export function ilVatReportCsvRows(report: IlVatReturn): Array<Array<string | number>> {
  return [
    ['Header', 'VAT Registration', 'מספר עוסק מורשה', report.registration.split(':').pop() || report.registration],
    ['Header', 'Start Date', 'מתאריך', report.startDate],
    ['Header', 'End Date', 'עד תאריך', report.endDate],
    ['Header', 'Document Count', 'מספר מסמכים', report.documentCount],
    ['Box 1', 'Taxable sales (excluding VAT)', 'עסקאות חייבות במס (ללא מע״מ)', csvMoney(report.taxableSalesCents)],
    ['Box 2', 'Output VAT', 'מע״מ עסקאות', csvMoney(report.outputVatCents)],
    ['Box 3', 'Zero-rated sales', 'עסקאות בשיעור אפס', csvMoney(report.zeroRatedSalesCents)],
    ['Box 4', 'Exempt sales', 'עסקאות פטורות', csvMoney(report.exemptSalesCents)],
    ['Box 5', 'Input VAT on fixed assets (equipment)', 'מס תשומות על ציוד', csvMoney(report.fixedAssetInputVatCents)],
    ['Box 6', 'Input VAT on other purchases', 'מס תשומות אחרות', csvMoney(report.otherInputVatCents)],
    ['Box 7', report.toPayCents >= 0 ? 'VAT to pay' : 'VAT to reclaim', report.toPayCents >= 0 ? 'סכום לתשלום' : 'סכום להחזר', csvMoney(Math.abs(report.toPayCents))],
  ];
}
