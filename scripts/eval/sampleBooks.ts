/**
 * SBX-2 Part 6 model test: a small, deterministic sample company whose read tools answer from its own
 * records (not fixed replies), so a model's figures can be checked against the books. Test data only.
 * Amounts are in cents; "today" is fixed so answers never drift.
 */
import { answerCents, readQuestion } from '../../src/lib/askBooks';
import type { ChartAccount } from '../../src/types';

export const TODAY = '2026-11-22';
export const CURRENCY = 'USD';

export const customers = [
  { id: 'cus_acme', name: 'Acme Ltd', email: 'ap@acme.example' },
  { id: 'cus_beta', name: 'Beta Corp', email: 'billing@beta.example' },
  { id: 'cus_gamma', name: 'Gamma LLC', email: 'finance@gamma.example' },
];
export const vendors = [
  { id: 'ven_elec', name: 'City Electric Co', category: 'Utilities' },
  { id: 'ven_office', name: 'Office Mart', category: 'Office costs' },
  { id: 'ven_rent', name: 'Harbor Properties', category: 'Rent' },
];
export const accounts = [
  { id: 'acc_cash', name: 'Cash', type: 'asset' }, { id: 'acc_bank', name: 'Bank', type: 'asset' },
  { id: 'acc_ar', name: 'Accounts receivable', type: 'asset' }, { id: 'acc_ap', name: 'Accounts payable', type: 'liability' },
  { id: 'acc_sales', name: 'Sales', type: 'revenue' }, { id: 'acc_consult', name: 'Consulting income', type: 'revenue' },
  { id: 'acc_util', name: 'Utilities', type: 'expense' }, { id: 'acc_office', name: 'Office costs', type: 'expense' },
  { id: 'acc_rent', name: 'Rent', type: 'expense' }, { id: 'acc_wages', name: 'Wages', type: 'expense' },
];

/** Monthly income and costs by account for 2026 (Jan..Nov, Nov to date). */
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const salesByMonth = [3_800_000, 3_900_000, 4_100_000, 4_000_000, 4_300_000, 4_400_000, 4_200_000, 4_500_000, 4_700_000, 4_600_000, 4_200_000];
const consultByMonth = [400_000, 350_000, 500_000, 450_000, 400_000, 600_000, 500_000, 550_000, 500_000, 600_000, 300_000];
const cost = { util: 120_000, office: 180_000, rent: 900_000, wages: 2_000_000 };
const officeByMonth = [150_000, 160_000, 170_000, 180_000, 175_000, 190_000, 185_000, 180_000, 200_000, 180_000, 280_000];

export function monthFigures(month: string) {
  const i = months.indexOf(month);
  if (i < 0) return { Sales: 0, 'Consulting income': 0, Utilities: 0, 'Office costs': 0, Rent: 0, Wages: 0 };
  return { Sales: salesByMonth[i], 'Consulting income': consultByMonth[i], Utilities: cost.util, 'Office costs': officeByMonth[i], Rent: cost.rent, Wages: cost.wages };
}
const REVENUE = ['Sales', 'Consulting income'] as const;
const EXPENSE = ['Utilities', 'Office costs', 'Rent', 'Wages'] as const;

/** Profit and loss for whole months from..to (inclusive, YYYY-MM). */
export function profitAndLoss(from: string, to: string) {
  const ms = months.filter(m => m >= from && m <= to);
  const sum = (name: string) => ms.reduce((s, m) => s + (monthFigures(m) as Record<string, number>)[name], 0);
  const revenue = Object.fromEntries(REVENUE.map(n => [n, sum(n)]));
  const expenses = Object.fromEntries(EXPENSE.map(n => [n, sum(n)]));
  const revenueCents = REVENUE.reduce((s, n) => s + sum(n), 0);
  const expensesCents = EXPENSE.reduce((s, n) => s + sum(n), 0);
  return { from, to, revenue, expenses, revenueCents, expensesCents, netProfitCents: revenueCents - expensesCents };
}

export const invoices = [
  { id: 'inv_1001', number: 'INV-1001', customerId: 'cus_acme', customerName: 'Acme Ltd', date: '2026-09-15', dueDate: '2026-10-15', totalCents: 120_000, paidCents: 0, status: 'overdue' },
  { id: 'inv_1002', number: 'INV-1002', customerId: 'cus_acme', customerName: 'Acme Ltd', date: '2026-10-01', dueDate: '2026-10-31', totalCents: 80_000, paidCents: 80_000, status: 'paid' },
  { id: 'inv_1003', number: 'INV-1003', customerId: 'cus_beta', customerName: 'Beta Corp', date: '2026-08-20', dueDate: '2026-09-19', totalCents: 450_000, paidCents: 0, status: 'overdue' },
  { id: 'inv_1004', number: 'INV-1004', customerId: 'cus_beta', customerName: 'Beta Corp', date: '2026-10-25', dueDate: '2026-11-24', totalCents: 200_000, paidCents: 0, status: 'open' },
  { id: 'inv_1005', number: 'INV-1005', customerId: 'cus_gamma', customerName: 'Gamma LLC', date: '2026-07-10', dueDate: '2026-08-09', totalCents: 4_500, paidCents: 0, status: 'overdue' },
  { id: 'inv_1006', number: 'INV-1006', customerId: 'cus_gamma', customerName: 'Gamma LLC', date: '2026-11-05', dueDate: '2026-12-05', totalCents: 95_000, paidCents: 0, status: 'open' },
  { id: 'inv_1007', number: 'INV-1007', customerId: 'cus_acme', customerName: 'Acme Ltd', date: '2026-06-02', dueDate: '2026-07-02', totalCents: 3_200, paidCents: 0, status: 'overdue' },
];
export const bills = [
  { id: 'bill_201', number: 'B-201', vendorId: 'ven_elec', vendorName: 'City Electric Co', date: '2026-11-01', dueDate: '2026-11-25', totalCents: 31_000, paidCents: 0, status: 'open' },
  { id: 'bill_202', number: 'B-202', vendorId: 'ven_rent', vendorName: 'Harbor Properties', date: '2026-11-01', dueDate: '2026-11-05', totalCents: 900_000, paidCents: 900_000, status: 'paid' },
  { id: 'bill_203', number: 'B-203', vendorId: 'ven_office', vendorName: 'Office Mart', date: '2026-10-28', dueDate: '2026-11-27', totalCents: 64_000, paidCents: 0, status: 'open' },
];
export const payments = [
  { id: 'pay_9', date: '2026-11-20', amountCents: 80_000, reference: 'PAY-0009', customerId: 'cus_acme', documentNumber: 'INV-1002' },
  { id: 'pay_8', date: '2026-11-12', amountCents: 150_000, reference: 'PAY-0008', customerId: 'cus_beta', documentNumber: 'INV-0998' },
  { id: 'pay_7', date: '2026-11-03', amountCents: 60_000, reference: 'PAY-0007', customerId: 'cus_gamma', documentNumber: 'INV-0995' },
];
export const balances = { acc_cash: 1_234_500, acc_bank: 8_450_000 };

const owed = (i: { totalCents: number; paidCents: number }) => i.totalCents - i.paidCents;
const daysPast = (due: string) => Math.floor((Date.parse(TODAY) - Date.parse(due)) / 86_400_000);
export function aging(kind: 'receivables' | 'payables') {
  const docs = kind === 'receivables' ? invoices : bills;
  const b = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 } as Record<string, number>;
  for (const d of docs) {
    const o = owed(d); if (!o) continue;
    const late = daysPast(d.dueDate);
    b[late <= 0 ? 'current' : late <= 30 ? '1-30' : late <= 60 ? '31-60' : late <= 90 ? '61-90' : '90+'] += o;
  }
  return { ...b, total: Object.values(b).reduce((s, v) => s + v, 0) };
}
/** Who owes what, overdue first: Beta has the larger overdue balance. */
export const owedByCustomer = () => customers.map(c => {
  const mine = invoices.filter(i => i.customerId === c.id);
  return { customer: c.name, owedCents: mine.reduce((s, i) => s + owed(i), 0), overdueCents: mine.filter(i => daysPast(i.dueDate) > 0).reduce((s, i) => s + owed(i), 0) };
});

// the collection names the real tools use (sandboxTools.ts): accounts are `chartAccounts`
const collections: Record<string, Array<Record<string, unknown>>> = { customers, vendors, chartAccounts: accounts, invoices, bills, payments };
const lastMonth = '2026-10', thisMonth = '2026-11';

/** Arithmetic only (+ - * / parentheses, n% = n/100), parsed by hand: no code is ever evaluated. */
function safeCalc(expression: string): number | null {
  const src = expression.replace(/,/g, '').replace(/\s+/g, '');
  let i = 0;
  const peek = () => src[i];
  const num = (): number | null => {
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    let v = Number(m[0]);
    if (peek() === '%') { i++; v /= 100; }
    return v;
  };
  const factor = (): number | null => {
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v; }
    if (peek() === '(') { i++; const v = expr(); if (v === null || peek() !== ')') return null; i++; return v; }
    return num();
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) { const op = src[i++]; const r = factor(); if (r === null) return null; v = op === '*' ? v * r : v / r; }
    return v;
  };
  function expr(): number | null {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) { const op = src[i++]; const r = term(); if (r === null) return null; v = op === '+' ? v + r : v - r; }
    return v;
  }
  const v = expr();
  return v !== null && i === src.length && Number.isFinite(v) ? v : null;
}

/** The same predicates as the real list tool (sandboxTools.ts `whereSchema`). */
function matches(v: unknown, op: string, want: unknown): boolean {
  switch (op) {
    case '==': return v === want;
    case '!=': return v !== want;
    case '<': return (v as number) < (want as number);
    case '<=': return (v as number) <= (want as number);
    case '>': return (v as number) > (want as number);
    case '>=': return (v as number) >= (want as number);
    case 'in': return Array.isArray(want) && want.includes(v);
    case 'not-in': return Array.isArray(want) && !want.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(want);
    default: return false;
  }
}

/** The read tools, answered from the books above in the shapes the real tools return. */
export function bookTool(name: string, args: Record<string, unknown>): unknown {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'search_records': {
      const text = s(args.text).toLowerCase();
      const wanted = Array.isArray(args.collections) && args.collections.length ? args.collections as string[] : Object.keys(collections);
      const matches = wanted.flatMap(c => (collections[c] ?? []).filter(r => Object.values(r).some(v => typeof v === 'string' && v.toLowerCase().includes(text)))
        .map(r => ({ collection: c, id: r.id, record: r })));
      return { text: args.text, matches: matches.slice(0, 20), scannedPerCollection: 500 };
    }
    case 'list_records': {
      const c = s(args.collection);
      const filters = Array.isArray(args.where) ? args.where as Array<{ field: string; op: string; value: unknown }> : [];
      const rows = (collections[c] ?? []).filter(r => filters.every(f => matches(r[f.field], f.op, f.value)));
      const order = args.orderBy as { field?: string; direction?: string } | undefined;
      if (order?.field) {
        const f = order.field;
        // numbers numerically, text as text (the real store orders values by type, not as strings)
        const cmp = (x: unknown, y: unknown) => typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
        rows.sort((a, b) => cmp(a[f], b[f]) * (order.direction === 'desc' ? -1 : 1));
      }
      return { collection: c, records: rows.slice(0, typeof args.limit === 'number' ? args.limit : 20), nextCursor: null };
    }
    case 'get_record': {
      const c = s(args.collection);
      const record = (collections[c] ?? []).find(r => r.id === args.id || r.number === args.id) ?? null;
      return record ? { collection: c, record } : { error: 'No such record' };
    }
    case 'run_report': {
      const report = s(args.report).toLowerCase();
      const params = (args.params ?? {}) as Record<string, string>;
      if (/aging|ageing|receivable|payable/.test(report)) {
        // the real report picks the side from `params.type` ('ar' | 'ap'); the report's name only as a fallback
        const ap = params.type ? params.type === 'ap' : /payable/.test(report);
        return { report, type: ap ? 'ap' : 'ar', ...aging(ap ? 'payables' : 'receivables'), byCustomer: ap ? undefined : owedByCustomer() };
      }
      if (/balance/.test(report)) return { report, endDate: params.endDate ?? TODAY, assets: { Cash: balances.acc_cash, Bank: balances.acc_bank, 'Accounts receivable': aging('receivables').total }, liabilities: { 'Accounts payable': aging('payables').total } };
      // only the reports these books implement; any other (cash flow, budget …) is refused, never answered with another report
      if (!/profit|loss|p&l|pnl|income-statement|income statement/.test(report)) return { error: `Report not available in the test books: ${report || '(none)'}` };
      const from = (params.startDate ?? '2026-01-01').slice(0, 7), to = (params.endDate ?? TODAY).slice(0, 7);
      return { report: 'profit-and-loss', ...profitAndLoss(from, to), previousMonth: profitAndLoss(lastMonth, lastMonth), thisMonth: profitAndLoss(thisMonth, thisMonth) };
    }
    case 'ask_books': {
      // the real reader (src/lib/askBooks.ts), so the test is no easier or harder than the site: it reads the
      // accounts and the period; the figure comes from these books for that filter, as explain_number does
      const reading = readQuestion(s(args.question), {
        accounts: accounts.map(a => ({ ...a, type: a.type === 'revenue' ? 'income' : a.type })) as unknown as ChartAccount[],
        today: TODAY, fiscalYearStartMonth: 1,
      });
      if (!reading.filter) return { question: s(args.question), today: TODAY, reading, answer: null };
      const pl = profitAndLoss(reading.filter.startDate.slice(0, 7), reading.filter.endDate.slice(0, 7));
      const figures: Record<string, number> = { ...pl.revenue, ...pl.expenses, Cash: balances.acc_cash, Bank: balances.acc_bank };
      const lines = reading.filter.accountIds.map(id => accounts.find(a => a.id === id)).filter(Boolean)
        .map(a => ({ accountId: a!.id, account: a!.name, cents: (figures[a!.name] ?? 0) * (a!.type === 'revenue' ? -1 : 1) }));
      const totalCents = lines.reduce((t, l) => t + l.cents, 0);
      return { question: s(args.question), today: TODAY, reading, answer: { totalCents, lines, answerCents: answerCents(totalCents, reading.sense), sense: reading.sense } };
    }
    case 'explain_number': {
      // the requested accounts over the requested period (whole months); balance accounts at the end date
      const ids = Array.isArray(args.accountIds) ? args.accountIds as string[] : [];
      const from = (s(args.startDate) || '2026-01-01').slice(0, 7), to = (s(args.endDate) || TODAY).slice(0, 7);
      const pl = profitAndLoss(from, to);
      const figures: Record<string, number> = { ...pl.revenue, ...pl.expenses, Cash: balances.acc_cash, Bank: balances.acc_bank };
      const lines = ids.map(id => accounts.find(a => a.id === id)).filter(Boolean).map(a => ({ accountId: a!.id, label: a!.name, cents: (figures[a!.name] ?? 0) * (a!.type === 'revenue' ? -1 : 1) }));
      if (!lines.length) return { error: 'Name the accounts to explain (accountIds)' };
      return { startDate: from, endDate: to, totalCents: lines.reduce((t, l) => t + l.cents, 0), lines };
    }
    case 'calculate': {
      const one = (e: string) => { const v = safeCalc(e); return v === null ? { expression: e, error: 'Only numbers and + - * / ( ) % are allowed' } : { expression: e, amount: v, cents: Math.round(v * 100) }; };
      if (Array.isArray(args.expressions)) return { results: args.expressions.slice(0, 20).map(e => one(s(e))) };
      const r = one(s(args.expression)); return 'error' in r ? { error: r.error } : r;
    }
    case 'remembered_choices': return { suggestions: [] };
    case 'list_proposals': return { proposals: [] };
    case 'preview_proposal': return { proposal: null };
    default: return { error: 'not available in the test books' };
  }
}
