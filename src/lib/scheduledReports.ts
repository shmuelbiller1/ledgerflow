/**
 * Scheduled reports (K-28 / M-08): a report emailed by itself after each finished week or month,
 * for example the profit and loss every Monday for the week before. Owners and accountants keep the
 * schedules on the workspace (`scheduledReports`); the daily job sends each finished period once
 * (`scheduledReportsSent`, written by the server only). Figures come from the existing report code.
 */
import { addToDateISO } from './calendarDate';
import { csvMoney, toCsv } from './csvExport';

export const SCHEDULED_REPORTS = {
  'profit-and-loss': 'Profit and loss',
  'balance-sheet': 'Balance sheet',
  'receivables-aging': 'Receivables aging',
} as const;
export type ScheduledReportKind = keyof typeof SCHEDULED_REPORTS;
export type ReportFrequency = 'weekly' | 'monthly';

export interface ScheduledReport {
  id: string;
  report: ScheduledReportKind;
  frequency: ReportFrequency;
  /** who gets it: up to 10 addresses */
  recipients: string[];
}

export const MAX_SCHEDULES = 10;
export const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** What is wrong with a schedule, or null. */
export function scheduleProblem(s: Partial<ScheduledReport>): string | null {
  if (!s.report || !(s.report in SCHEDULED_REPORTS)) return 'Choose a report';
  if (s.frequency !== 'weekly' && s.frequency !== 'monthly') return 'Choose weekly or monthly';
  const recipients = s.recipients || [];
  if (!recipients.length) return 'Add at least one email address';
  if (recipients.length > MAX_RECIPIENTS) return `At most ${MAX_RECIPIENTS} addresses`;
  const bad = recipients.find(r => !EMAIL.test(r) || r.length > 254);
  if (bad) return `"${bad}" is not an email address`;
  return null;
}

/** Addresses typed with commas, semicolons, spaces or new lines; duplicates (any case) once. */
export function parseRecipients(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean)) {
    if (!out.some(o => o.toLowerCase() === part.toLowerCase())) out.push(part);
  }
  return out;
}

export interface ReportPeriod { key: string; startDate: string; endDate: string; label: string }

/**
 * The last finished period on `today` (YYYY-MM-DD, the workspace's date): weekly is Monday to Sunday
 * (the week before the current one), monthly the month before. The key names it, so it is sent once.
 */
export function lastFinishedPeriod(frequency: ReportFrequency, today: string): ReportPeriod {
  if (frequency === 'monthly') {
    const firstOfThis = `${today.slice(0, 7)}-01`;
    const endDate = addToDateISO(firstOfThis, { days: -1 });
    const startDate = `${endDate.slice(0, 7)}-01`;
    return { key: `M:${endDate.slice(0, 7)}`, startDate, endDate, label: endDate.slice(0, 7) };
  }
  // weekday from the civil date, without time zones: 2024-01-01 was a Monday
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse('2024-01-01T00:00:00Z')) / 86_400_000);
  const weekday = ((days % 7) + 7) % 7; // 0 = Monday
  const thisMonday = addToDateISO(today, { days: -weekday });
  const startDate = addToDateISO(thisMonday, { days: -7 });
  const endDate = addToDateISO(thisMonday, { days: -1 });
  return { key: `W:${startDate}`, startDate, endDate, label: `${startDate} – ${endDate}` };
}

/** The table a report is sent as: rows of text and cents; `strong` rows are totals. */
export interface ReportTable {
  title: string;
  headers: string[];
  rows: Array<{ cells: Array<string | number>; strong?: boolean }>;
}

type AccountLines = Record<string, { name: string; code?: string; balance: number }>;
const byCode = (a: { code?: string; name: string }, b: { code?: string; name: string }) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }) || a.name.localeCompare(b.name);
const lines = (accounts: AccountLines) => Object.values(accounts).filter(a => a.balance !== 0).sort(byCode).map(a => ({ cells: [[a.code, a.name].filter(Boolean).join(' '), a.balance] }));

export function profitAndLossTable(pl: { income: { total: number; accounts: AccountLines }; expense: { total: number; accounts: AccountLines }; netIncome: number }, period: ReportPeriod): ReportTable {
  return {
    title: `Profit and loss, ${period.label}`,
    headers: ['Account', 'Amount'],
    rows: [
      { cells: ['Income', ''], strong: true }, ...lines(pl.income.accounts), { cells: ['Total income', pl.income.total], strong: true },
      { cells: ['Expenses', ''], strong: true }, ...lines(pl.expense.accounts), { cells: ['Total expenses', pl.expense.total], strong: true },
      { cells: ['Net profit', pl.netIncome], strong: true },
    ],
  };
}

export function balanceSheetTable(bs: { assets: Record<string, number>; liabilities: Record<string, number>; equity: Record<string, number>; totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number; totalClaims: number }, accounts: Array<{ id: string; name: string; code?: string }>, period: ReportPeriod): ReportTable {
  const named = (values: Record<string, number>) => Object.entries(values).filter(([, v]) => v !== 0)
    .map(([id, v]) => { const a = accounts.find(x => x.id === id); return { code: a?.code, name: a?.name || id, v }; })
    .sort(byCode).map(a => ({ cells: [[a.code, a.name].filter(Boolean).join(' '), a.v] }));
  return {
    title: `Balance sheet on ${period.endDate}`,
    headers: ['Account', 'Amount'],
    rows: [
      { cells: ['Assets', ''], strong: true }, ...named(bs.assets), { cells: ['Total assets', bs.totalAssets], strong: true },
      { cells: ['Liabilities', ''], strong: true }, ...named(bs.liabilities), { cells: ['Total liabilities', bs.totalLiabilities], strong: true },
      { cells: ['Equity', ''], strong: true }, ...named(bs.equity), { cells: ['Profit to date', bs.netIncome] }, { cells: ['Total equity', bs.totalEquity + bs.netIncome], strong: true },
      { cells: ['Total liabilities and equity', bs.totalClaims], strong: true },
    ],
  };
}

export function agingTable(rows: Array<{ partyName: string; buckets: Record<string, number>; total: number }>, bucketLabels: Array<{ key: string; label: string }>, period: ReportPeriod): ReportTable {
  const totals = bucketLabels.map(b => rows.reduce((s, r) => s + (r.buckets[b.key] || 0), 0));
  return {
    title: `Receivables aging on ${period.endDate}`,
    headers: ['Customer', ...bucketLabels.map(b => b.label), 'Total'],
    rows: [
      ...rows.map(r => ({ cells: [r.partyName, ...bucketLabels.map(b => r.buckets[b.key] || 0), r.total] })),
      { cells: ['Total', ...totals, rows.reduce((s, r) => s + r.total, 0)], strong: true },
    ],
  };
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email: a plain table (amounts in the workspace currency) and where it came from. */
export function reportEmailHtml(table: ReportTable, meta: { workspaceName: string; currency: string; format: (cents: number) => string }): string {
  const cell = (v: string | number, i: number) => `<td style="padding:4px 10px;${i > 0 ? 'text-align:right;' : ''}">${typeof v === 'number' ? escape(meta.format(v)) : escape(v)}</td>`;
  const body = table.rows.map(r => `<tr${r.strong ? ' style="font-weight:bold;border-top:1px solid #ddd"' : ''}>${r.cells.map(cell).join('')}</tr>`).join('');
  return `<h2 style="font-family:sans-serif">${escape(table.title)}</h2>`
    + `<p style="font-family:sans-serif;color:#555">${escape(meta.workspaceName)} · amounts in ${escape(meta.currency)}</p>`
    + `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px"><thead><tr>${table.headers.map((h, i) => `<th style="padding:4px 10px;${i > 0 ? 'text-align:right;' : 'text-align:left;'}">${escape(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
    + '<p style="font-family:sans-serif;color:#888;font-size:12px">Sent by LedgerFlow on a schedule set in Settings → Scheduled reports. The same figures are attached as a spreadsheet (CSV).</p>';
}

export function reportCsv(table: ReportTable): string {
  return toCsv(table.headers, table.rows.map(r => r.cells.map(v => (typeof v === 'number' ? csvMoney(v) : v))));
}
