/**
 * SBX-2 Part 6 model test: a small, deterministic sample company whose read tools answer from its own
 * records (not fixed replies), so a model's figures can be checked against the books. Test data only.
 * Amounts are in cents; "today" is fixed so answers never drift.
 */
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

const collections: Record<string, Array<Record<string, unknown>>> = { customers, vendors, accounts, invoices, bills, payments };
const lastMonth = '2026-10', thisMonth = '2026-11';

function safeCalc(expression: string): number | null {
  const e = expression.replace(/,/g, '').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
  if (!/^[\d+\-*/().\s]+$/.test(e)) return null;
  try { const v = Function(`"use strict"; return (${e});`)() as unknown; return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; }
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
      const rows = [...(collections[c] ?? [])];
      const order = args.orderBy as { field?: string; direction?: string } | undefined;
      if (order?.field) rows.sort((a, b) => String(a[order.field!]).localeCompare(String(b[order.field!])) * (order.direction === 'desc' ? -1 : 1));
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
      if (/aging|ageing|receivable|payable/.test(report)) return { report, ...aging(/payable/.test(report) ? 'payables' : 'receivables'), byCustomer: /payable/.test(report) ? undefined : owedByCustomer() };
      if (/balance/.test(report)) return { report, endDate: params.endDate ?? TODAY, assets: { Cash: balances.acc_cash, Bank: balances.acc_bank, 'Accounts receivable': aging('receivables').total }, liabilities: { 'Accounts payable': aging('payables').total } };
      const from = (params.startDate ?? '2026-01-01').slice(0, 7), to = (params.endDate ?? TODAY).slice(0, 7);
      return { report: 'profit-and-loss', ...profitAndLoss(from, to), previousMonth: profitAndLoss(lastMonth, lastMonth), thisMonth: profitAndLoss(thisMonth, thisMonth) };
    }
    case 'ask_books': {
      const q = s(args.question).toLowerCase();
      if (/cash|bank|balance/.test(q)) return { answer: { totalCents: balances.acc_cash + balances.acc_bank, accounts: { Cash: balances.acc_cash, Bank: balances.acc_bank } }, understood: { period: 'to date' } };
      const month = /last month/.test(q) ? lastMonth : /this month/.test(q) ? thisMonth : null;
      const pl = month ? profitAndLoss(month, month) : profitAndLoss('2026-01', thisMonth);
      return { answer: { revenueCents: pl.revenueCents, expensesCents: pl.expensesCents, netProfitCents: pl.netProfitCents }, understood: { period: month ?? 'this year' } };
    }
    case 'explain_number': return { totalCents: profitAndLoss('2026-01', thisMonth).revenueCents, lines: Object.entries(profitAndLoss('2026-01', thisMonth).revenue).map(([label, cents]) => ({ label, cents })) };
    case 'calculate': { const v = safeCalc(s(args.expression)); return v === null ? { error: 'Only numbers and + - * / ( ) % are allowed' } : { expression: args.expression, amount: v, cents: Math.round(v * 100) }; }
    case 'remembered_choices': return { suggestions: [] };
    case 'list_proposals': return { proposals: [] };
    case 'preview_proposal': return { proposal: null };
    default: return { error: 'not available in the test books' };
  }
}
