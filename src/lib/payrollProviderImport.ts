/**
 * PAY-1: recording an outside payroll provider's results. The provider runs payroll; the books record what it did.
 * A CSV export (one row per person per pay date) becomes one balanced entry per pay date:
 *   DR wages expense                 gross pay                         (split by label when a label is chosen)
 *   DR employer tax expense          the employer's taxes              (split by label)
 *   DR employer benefits expense     the employer's contributions      (split by label)
 *   CR withholdings owed             taxes withheld from employees
 *   CR deductions owed               employees' deductions (401k, health, garnishments)
 *   CR employer taxes owed           the employer's taxes
 *   CR employer benefits owed        the employer's contributions
 *   CR payroll clearing              net pay; the bank payment to the provider or the employees clears it
 * Each row must add up (gross − withholdings − deductions = net), so the entry balances by construction:
 *   gross + employer taxes + benefits = net + withholdings + deductions + employer taxes + benefits.
 * Nothing is guessed: a column that is not in the provider's column set stops the import with its name, an amount
 * role without a chosen account stops it, and a label value that is not one of the workspace's labels stops it.
 * The column sets are the ones this importer accepts (below), not a claim about every export a provider offers.
 * Posting, the open-period check and refusing the same file twice are on the server (payrollImportService.ts).
 */
import { parseCsv } from './csv';
import { normalizeSearchText } from './textNormalization';

export type PayrollProvider = 'adp' | 'gusto' | 'paychex';

export type PayrollColumnRole = 'payDate' | 'employee' | 'label' | 'gross' | 'employeeTax' | 'deduction' | 'employerTax' | 'employerBenefit' | 'net' | 'ignore';

type AmountRole = 'gross' | 'employeeTax' | 'deduction' | 'employerTax' | 'employerBenefit' | 'net';

export const PAYROLL_COLUMN_SETS: Record<PayrollProvider, { name: string; columns: Record<string, PayrollColumnRole> }> = {
  gusto: {
    name: 'Gusto (payroll journal)',
    columns: {
      'pay date': 'payDate', 'check date': 'payDate', employee: 'employee', 'employee name': 'employee', 'employee id': 'ignore', department: 'label',
      'gross earnings': 'gross', 'employee taxes': 'employeeTax', 'employee deductions': 'deduction', 'employer taxes': 'employerTax',
      'employer contributions': 'employerBenefit', 'net pay': 'net', hours: 'ignore', 'payment method': 'ignore',
    },
  },
  adp: {
    name: 'ADP (payroll register)',
    columns: {
      'pay date': 'payDate', 'check date': 'payDate', 'employee name': 'employee', 'file number': 'ignore', 'home department': 'label', 'location': 'label',
      'gross pay': 'gross', 'federal income tax': 'employeeTax', 'social security': 'employeeTax', medicare: 'employeeTax', 'state income tax': 'employeeTax', 'local tax': 'employeeTax',
      'retirement 401k': 'deduction', medical: 'deduction', dental: 'deduction', garnishment: 'deduction',
      'employer social security': 'employerTax', 'employer medicare': 'employerTax', futa: 'employerTax', suta: 'employerTax',
      'employer 401k match': 'employerBenefit', 'employer medical': 'employerBenefit', 'net pay': 'net', hours: 'ignore',
    },
  },
  paychex: {
    name: 'Paychex (payroll journal)',
    columns: {
      'check date': 'payDate', employee: 'employee', 'employee id': 'ignore', location: 'label', department: 'label',
      'total gross': 'gross', 'federal withholding': 'employeeTax', 'social security ee': 'employeeTax', 'medicare ee': 'employeeTax', 'state withholding': 'employeeTax', 'local withholding': 'employeeTax',
      deductions: 'deduction', 'social security er': 'employerTax', 'medicare er': 'employerTax', futa: 'employerTax', sui: 'employerTax',
      'employer benefits': 'employerBenefit', 'net pay': 'net', hours: 'ignore',
    },
  },
};

export type PayrollAccountRole = 'wages' | 'employerTaxExpense' | 'employerBenefitExpense' | 'withholdings' | 'deductions' | 'employerTaxLiability' | 'employerBenefitLiability' | 'clearing';
export type PayrollAccounts = Partial<Record<PayrollAccountRole, string>>;

export const PAYROLL_ACCOUNT_ROLES: Array<{ role: PayrollAccountRole; label: string; side: 'expense' | 'liability'; from: AmountRole }> = [
  { role: 'wages', label: 'Wages expense', side: 'expense', from: 'gross' },
  { role: 'employerTaxExpense', label: 'Employer tax expense', side: 'expense', from: 'employerTax' },
  { role: 'employerBenefitExpense', label: 'Employer benefits expense', side: 'expense', from: 'employerBenefit' },
  { role: 'withholdings', label: 'Withholdings owed', side: 'liability', from: 'employeeTax' },
  { role: 'deductions', label: 'Employee deductions owed', side: 'liability', from: 'deduction' },
  { role: 'employerTaxLiability', label: 'Employer taxes owed', side: 'liability', from: 'employerTax' },
  { role: 'employerBenefitLiability', label: 'Employer benefits owed', side: 'liability', from: 'employerBenefit' },
  { role: 'clearing', label: 'Payroll clearing (net pay)', side: 'liability', from: 'net' },
];

export interface PayrollRow {
  /** the file's row number (the header is row 1) */
  row: number;
  payDate: string;
  employee: string;
  label: string;
  grossCents: number;
  employeeTaxCents: number;
  deductionCents: number;
  employerTaxCents: number;
  employerBenefitCents: number;
  netCents: number;
}

export interface PayrollTotals { people: number; grossCents: number; employeeTaxCents: number; deductionCents: number; employerTaxCents: number; employerBenefitCents: number; netCents: number; costCents: number }

export interface PayrollEntryLine { role: PayrollAccountRole; accountId: string; amountCents: number; label?: string; description: string }

export interface PayrollPayDate { payDate: string; rows: PayrollRow[]; totals: PayrollTotals; lines: PayrollEntryLine[] }

export interface PayrollLabelChoice {
  dimensionId: string;
  /** the workspace's values of that label: matched by code, name or alias, ignoring case */
  nodes: Array<{ id: string; description?: string; aliases?: string[]; status?: string }>;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const money = (cents: number) => `${cents < 0 ? '−' : ''}${(Math.abs(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** "1,234.56", "$1,234.56", "-12.00" or "(12.00)" → cents; blank → 0; anything else → null. */
export function payrollCents(value: string): number | null {
  let s = value.trim();
  if (s === '') return 0;
  let negative = false;
  const bracket = s.match(/^\((.*)\)$/);
  if (bracket) { negative = true; s = bracket[1].trim(); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  s = s.replace(/^\$/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.replace(/,/g, '').split('.');
  if (whole.length > 13) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD, or null. */
export function payrollDate(value: string): string | null {
  const s = value.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const [y, m, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : us ? [Number(us[3]), Number(us[1]), Number(us[2])] : [0, 0, 0];
  if (!y || m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > days) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Reads a provider's CSV. Problems stop the import; rows are returned only when there are none. */
export function readPayrollCsv(content: string, provider: PayrollProvider): { rows: PayrollRow[]; problems: string[] } {
  const set = PAYROLL_COLUMN_SETS[provider];
  if (!set) return { rows: [], problems: ['Choose the payroll provider.'] };
  if (content.length > 5_000_000) return { rows: [], problems: ['The file is larger than 5 MB.'] };
  const table = parseCsv(content).filter(r => r.some(c => c.trim() !== ''));
  if (table.length < 2) return { rows: [], problems: ['The file has no rows under its header.'] };
  const header = table[0].map(normalize);
  const roles = header.map(h => set.columns[h]);
  const problems: string[] = [];
  const unknown = table[0].filter((_, i) => !roles[i]);
  if (unknown.length) {
    problems.push(`${unknown.length === 1 ? 'This column is' : 'These columns are'} not in the ${set.name} column set, so nothing is imported: ${unknown.map(c => `"${c.trim()}"`).join(', ')}. Remove ${unknown.length === 1 ? 'it' : 'them'} from the file, or check the provider.`);
  }
  const once = (role: PayrollColumnRole) => roles.filter(r => r === role).length;
  for (const [role, what] of [['payDate', 'pay date'], ['employee', 'employee'], ['gross', 'gross pay'], ['net', 'net pay']] as const) {
    if (once(role) === 0) problems.push(`The file has no ${what} column.`);
  }
  for (const role of ['payDate', 'employee', 'label', 'gross', 'net'] as const) {
    if (once(role) > 1) problems.push(`The file has more than one ${role === 'payDate' ? 'pay date' : role} column.`);
  }
  if (problems.length) return { rows: [], problems };

  const rows: PayrollRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const n = i + 1;
    if (cells.length !== header.length) { problems.push(`Row ${n}: ${cells.length} columns, the header has ${header.length}.`); continue; }
    const row: PayrollRow = { row: n, payDate: '', employee: '', label: '', grossCents: 0, employeeTaxCents: 0, deductionCents: 0, employerTaxCents: 0, employerBenefitCents: 0, netCents: 0 };
    let bad = false;
    cells.forEach((cell, c) => {
      const role = roles[c];
      if (role === 'ignore') return;
      if (role === 'payDate') {
        const date = payrollDate(cell);
        if (!date) { problems.push(`Row ${n}: "${cell}" is not a date (MM/DD/YYYY or YYYY-MM-DD).`); bad = true; }
        row.payDate = date || '';
      } else if (role === 'employee') row.employee = cell.trim();
      else if (role === 'label') row.label = cell.trim();
      else {
        const cents = payrollCents(cell);
        if (cents === null) { problems.push(`Row ${n}: "${cell}" in "${table[0][c].trim()}" is not an amount.`); bad = true; return; }
        const key = `${role}Cents` as `${AmountRole}Cents`;
        row[key] += cents;
      }
    });
    if (bad) continue;
    if (!row.employee) { problems.push(`Row ${n}: no employee.`); continue; }
    // #261 review: a row with nothing paid (all amounts zero) changes nothing in the books and is left out
    if (!row.grossCents && !row.employeeTaxCents && !row.deductionCents && !row.employerTaxCents && !row.employerBenefitCents && !row.netCents) continue;
    const expectedNet = row.grossCents - row.employeeTaxCents - row.deductionCents;
    if (expectedNet !== row.netCents) {
      problems.push(`Row ${n} (${row.employee}): gross ${money(row.grossCents)} less withholdings ${money(row.employeeTaxCents)} and deductions ${money(row.deductionCents)} is ${money(expectedNet)}, but net pay is ${money(row.netCents)}.`);
      continue;
    }
    rows.push(row);
  }
  if (!problems.length && !rows.length) problems.push('Every row in the file is zero: there is no payroll to record.');
  return problems.length ? { rows: [], problems } : { rows, problems };
}

export function payrollTotals(rows: PayrollRow[]): PayrollTotals {
  const sum = (k: keyof PayrollRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const t = {
    people: rows.length, grossCents: sum('grossCents'), employeeTaxCents: sum('employeeTaxCents'), deductionCents: sum('deductionCents'),
    employerTaxCents: sum('employerTaxCents'), employerBenefitCents: sum('employerBenefitCents'), netCents: sum('netCents'),
  };
  return { ...t, costCents: t.grossCents + t.employerTaxCents + t.employerBenefitCents };
}

/**
 * The label value a file's text names: its code exactly, else its name or alias compared as text (case, Unicode form,
 * Hebrew points and direction marks folded, #261 review); never a near match. Two values sharing that name or alias
 * are ambiguous: none is chosen.
 */
function labelOf(text: string, choice: PayrollLabelChoice): { id?: string; ambiguous?: string[] } {
  const live = choice.nodes.filter(n => n.status !== 'archived');
  const exact = live.find(n => n.id === text.trim());
  if (exact) return { id: exact.id };
  const s = normalizeSearchText(text.trim().replace(/\s+/g, ' '));
  const fold = (v: string) => normalizeSearchText(v.trim().replace(/\s+/g, ' '));
  for (const matches of [live.filter(n => fold(n.id) === s), live.filter(n => fold(n.description || '') === s), live.filter(n => (n.aliases || []).some(a => fold(a) === s))]) {
    if (matches.length === 1) return { id: matches[0].id };
    if (matches.length > 1) return { ambiguous: matches.map(n => n.id) };
  }
  return {};
}

/** A journal entry holds at most 100 lines (TransactionSchema). */
export const PAYROLL_MAX_LINES = 100;

/**
 * One entry per pay date, oldest first. Expense lines are split by the chosen label (one line per label value, in
 * the order the file names them); what is owed and the clearing line are not split. Problems stop the import.
 */
export function payrollEntries(rows: PayrollRow[], accounts: PayrollAccounts, labels?: PayrollLabelChoice): { payDates: PayrollPayDate[]; problems: string[] } {
  const problems: string[] = [];
  const all = payrollTotals(rows);
  const amountOf: Record<AmountRole, number> = {
    gross: all.grossCents, employeeTax: all.employeeTaxCents, deduction: all.deductionCents, employerTax: all.employerTaxCents, employerBenefit: all.employerBenefitCents, net: all.netCents,
  };
  for (const r of PAYROLL_ACCOUNT_ROLES) {
    if (amountOf[r.from] !== 0 && !accounts[r.role]) problems.push(`Choose the account for "${r.label}".`);
  }
  const labelIds = new Map<string, string>();
  if (labels) {
    for (const row of rows) {
      if (!row.label) { problems.push(`Row ${row.row} (${row.employee}): no ${labels.dimensionId} label; with costs split by label, every row needs one.`); continue; }
      const found = labelOf(row.label, labels);
      if (found.ambiguous) problems.push(`Row ${row.row} (${row.employee}): "${row.label}" names more than one ${labels.dimensionId} label (${found.ambiguous.join(', ')}). Use the label's code in the file.`);
      else if (!found.id) problems.push(`Row ${row.row} (${row.employee}): "${row.label}" is not one of this workspace's ${labels.dimensionId} labels. Add it, or fix the file.`);
      else labelIds.set(row.label, found.id);
    }
  }
  if (problems.length) return { payDates: [], problems: [...new Set(problems)] };

  const dates = [...new Set(rows.map(r => r.payDate))].sort();
  const payDates = dates.map(payDate => {
    const these = rows.filter(r => r.payDate === payDate);
    const totals = payrollTotals(these);
    const lines: PayrollEntryLine[] = [];
    const expense = (role: PayrollAccountRole, key: 'grossCents' | 'employerTaxCents' | 'employerBenefitCents', what: string) => {
      if (!labels) {
        const cents = totals[key];
        if (cents !== 0) lines.push({ role, accountId: accounts[role]!, amountCents: cents, description: `${what}, payroll ${payDate}` });
        return;
      }
      const byLabel = new Map<string, number>();
      for (const r of these) byLabel.set(labelIds.get(r.label)!, (byLabel.get(labelIds.get(r.label)!) || 0) + r[key]);
      for (const [label, cents] of byLabel) if (cents !== 0) lines.push({ role, accountId: accounts[role]!, amountCents: cents, label, description: `${what}, payroll ${payDate}` });
    };
    const owed = (role: PayrollAccountRole, cents: number, what: string) => {
      if (cents !== 0) lines.push({ role, accountId: accounts[role]!, amountCents: -cents, description: `${what}, payroll ${payDate}` });
    };
    expense('wages', 'grossCents', 'Gross wages');
    expense('employerTaxExpense', 'employerTaxCents', 'Employer taxes');
    expense('employerBenefitExpense', 'employerBenefitCents', 'Employer benefits');
    owed('withholdings', totals.employeeTaxCents, 'Taxes withheld');
    owed('deductions', totals.deductionCents, 'Employee deductions');
    owed('employerTaxLiability', totals.employerTaxCents, 'Employer taxes owed');
    owed('employerBenefitLiability', totals.employerBenefitCents, 'Employer benefits owed');
    owed('clearing', totals.netCents, 'Net pay');
    return { payDate, rows: these, totals, lines };
  });
  // #261 review: an entry has at most 100 lines; say so before posting rather than fail on the server
  for (const p of payDates) {
    if (p.lines.length > PAYROLL_MAX_LINES) problems.push(`The payroll of ${p.payDate} needs ${p.lines.length} lines split by label; an entry holds at most ${PAYROLL_MAX_LINES}. Import it without splitting, or in parts.`);
  }
  return problems.length ? { payDates: [], problems } : { payDates, problems };
}
