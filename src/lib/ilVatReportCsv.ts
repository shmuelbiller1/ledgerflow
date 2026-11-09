import type { IlVatReturn } from './tax/ilVatReturn';

export const IL_VAT_REPORT_CSV_HEADERS = [
  'Code',
  'Field (English)',
  'Field (Hebrew)',
  'Amount (NIS)',
];

export function ilVatReportCsvRows(report: IlVatReturn): Array<Array<string | number>> {
  const roundShekels = (cents: number) => (cents / 100).toFixed(2);
  return [
    ['Header', 'VAT Registration', 'מספר עוסק מורשה', report.registration.split(':').pop() || report.registration],
    ['Header', 'Start Date', 'מתאריך', report.startDate],
    ['Header', 'End Date', 'עד תאריך', report.endDate],
    ['Header', 'Document Count', 'מספר מסמכים', report.documentCount],
    ['Box 1', 'Taxable sales (excluding VAT)', 'עסקאות חייבות במס (ללא מע״מ)', roundShekels(report.taxableSalesCents)],
    ['Box 2', 'Output VAT', 'מע״מ עסקאות', roundShekels(report.outputVatCents)],
    ['Box 3', 'Zero-rated sales', 'עסקאות בשיעור אפס', roundShekels(report.zeroRatedSalesCents)],
    ['Box 4', 'Exempt sales', 'עסקאות פטורות', roundShekels(report.exemptSalesCents)],
    ['Box 5', 'Input VAT on fixed assets (equipment)', 'מס תשומות על ציוד', roundShekels(report.fixedAssetInputVatCents)],
    ['Box 6', 'Input VAT on other purchases', 'מס תשומות אחרות', roundShekels(report.otherInputVatCents)],
    ['Box 7', report.toPayCents >= 0 ? 'VAT to pay' : 'VAT to reclaim', report.toPayCents >= 0 ? 'סכום לתשלום' : 'סכום להחזר', roundShekels(Math.abs(report.toPayCents))],
  ];
}
