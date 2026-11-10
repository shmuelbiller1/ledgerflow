import PDFDocument from 'pdfkit';
import { drawLine } from './pdfText';
import { fonts } from './pdfService';
import { yearToDate, type PayRunEmployeeLine } from '../../lib/payRunPosting';

import { BRAND_NAME } from '../../config/brand';
/**
 * Payslips (U-01): one employee's pay for one posted pay run, as a PDF: gross pay, pre-tax
 * deductions, each kind of tax withheld, garnishments and after-tax deductions (U-05, U-06, each by
 * name), net pay, and the year to date up to and including this run.
 * Laid out first (`layoutPayslip`, tested), then drawn. Only what the run kept is shown; nothing is
 * worked out again, so a later change to the employee's salary does not change an old payslip.
 */
export interface PayslipLayout {
  company: string;
  employee: string;
  payDate: string;
  rows: Array<{ label: string; amount: string; strong?: boolean }>;
  ytd: Array<{ label: string; amount: string }>;
  note: string;
}

const money = (cents: number, currency: string) => `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const clean = (value: unknown, max = 120) => [...String(value ?? '')].map(ch => { const code = ch.charCodeAt(0); return code < 32 || code === 127 ? ' ' : ch; }).join('').trim().slice(0, max);

export function layoutPayslip(
  run: { date: string },
  line: PayRunEmployeeLine,
  runsOfYear: Array<{ date: string; status: string; employees?: PayRunEmployeeLine[] }>,
  workspace: { name?: string; currency?: string },
): PayslipLayout {
  const currency = clean(workspace.currency || 'USD', 3).toUpperCase();
  const m = (cents: number) => money(cents, currency);
  const rows: PayslipLayout['rows'] = [{ label: 'Gross pay', amount: m(line.grossCents), strong: true }];
  const named = line.deductions || [];
  const deduct = (kind: string) => { for (const d of named.filter(x => x.kind === kind)) rows.push({ label: kind === 'garnishment' ? `${clean(d.name, 60)} (garnishment)` : clean(d.name, 60), amount: `−${m(d.cents)}` }); };
  if (named.length) deduct('pre_tax');
  else if (line.deductionsCents) rows.push({ label: 'Pre-tax deductions (retirement, health)', amount: `−${m(line.deductionsCents)}` });
  const t = line.taxes;
  if (t) {
    for (const [label, cents] of [['Federal income tax', t.federalCents], ['State income tax', t.stateCents], ['Local income tax', t.localCents], ['Social Security', t.socialSecurityCents], ['Medicare', t.medicareCents]] as const) {
      if (cents) rows.push({ label, amount: `−${m(cents)}` });
    }
  } else if (line.withheldCents) {
    rows.push({ label: 'Taxes withheld', amount: `−${m(line.withheldCents)}` });
  }
  deduct('garnishment');
  deduct('post_tax');
  rows.push({ label: 'Net pay', amount: m(line.netCents), strong: true });
  const year = run.date.slice(0, 4);
  const upTo = runsOfYear.filter(r => r.date <= run.date);
  const total = yearToDate(upTo, year).get(line.employeeId);
  return {
    company: clean(workspace.name || ''),
    employee: clean(line.name),
    payDate: clean(run.date, 10),
    rows,
    ytd: total ? [
      { label: `Gross pay in ${year}`, amount: m(total.grossCents) },
      { label: 'Taxes withheld', amount: m(total.withheldCents) },
      { label: 'Deductions', amount: m(total.deductionsCents) },
      { label: 'Net pay', amount: m(total.netCents) },
    ] : [],
    note: `Tax amounts are estimates worked out by ${BRAND_NAME}; check them against the tax tables before filing.`,
  };
}

export async function generatePayslipPdf(layout: PayslipLayout): Promise<Buffer> {
  const files = fonts();
  const pdf = new PDFDocument({ size: 'LETTER', margin: 54, font: files?.body || 'Helvetica', info: { Title: `Payslip ${layout.employee} ${layout.payDate}`, Author: layout.company } });
  if (files) { pdf.registerFont('body', files.body); pdf.registerFont('bold', files.bold); }
  const body = files ? 'body' : 'Helvetica';
  const bold = files ? 'bold' : 'Helvetica-Bold';
  const latin = (s: string) => (files ? s : s.replace(/[^\x20-\xFF]/g, '?'));
  const text = (s: string, x: number, y: number, width: number, align: 'left' | 'right' = 'left') => drawLine(pdf, latin(s), x, y, width, align);
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  const left = 54;
  const right = 612 - 54;
  let y = 54;
  pdf.font(bold).fontSize(16).fillColor('#111827');
  text(layout.company, left, y, 340);
  pdf.font(body).fontSize(11);
  text('Payslip', 400, y + 2, right - 400, 'right');
  y += 34;
  pdf.fontSize(10).fillColor('#374151');
  text(`Employee: ${layout.employee}`, left, y, 340);
  text(`Pay date: ${layout.payDate}`, 360, y, right - 360, 'right');
  y += 28;
  pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor('#D1D5DB').stroke();
  y += 12;
  for (const row of layout.rows) {
    pdf.font(row.strong ? bold : body).fontSize(10).fillColor('#111827');
    text(row.label, left, y, 340);
    text(row.amount, 360, y, right - 360, 'right');
    y += row.strong ? 22 : 16;
  }
  if (layout.ytd.length) {
    y += 10;
    pdf.font(bold).fontSize(10);
    text('Year to date', left, y, 340);
    y += 18;
    pdf.font(body).fontSize(10).fillColor('#374151');
    for (const row of layout.ytd) {
      text(row.label, left, y, 340);
      text(row.amount, 360, y, right - 360, 'right');
      y += 16;
    }
  }
  y += 18;
  pdf.fontSize(8).fillColor('#6B7280');
  text(layout.note, left, y, right - left);
  pdf.end();
  return done;
}
