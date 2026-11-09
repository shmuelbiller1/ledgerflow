/**
 * AU-4: accepting an import by reconciliation, not by a record count. The source system's own trial balance
 * (QuickBooks Reports → Trial Balance → Export to CSV, or any "Account, Debit, Credit" file) is set against
 * LedgerFlow's trial balance on the same date, account by account, and the totals that matter after a move —
 * the trial balance itself, A/R, A/P, cash and tax payable — are compared. Every difference is named: an account
 * whose balance differs, a source line with no account here, an account here with a balance the source does not
 * have. Nothing is matched by guess: a source line is an account here when its code or its name is the same.
 */
import { parseCsv } from './csv';
import { resolveAccountRole } from './accountUtils';
import { DEFAULT_ACCOUNT_SLOTS, accountInUse } from './accountDefaults';
import type { ChartAccount } from '../types';

/** One line of the source trial balance: its balance as a debit (a credit balance is negative). */
export interface SourceLine { row: number; account: string; code?: string; debitCents: number }

export interface SourceTrialBalance { lines: SourceLine[]; totalDebitCents: number; totalCreditCents: number; problems: string[] }

/** A trial balance row as LedgerFlow's report gives it (GET /reports/trial-balance). */
export interface LedgerRow { id: string; debit: number; credit: number }

export type CheckKey = 'trial-balance' | 'ar' | 'ap' | 'cash' | 'tax';

export interface AcceptanceLine {
  accountId?: string;
  label: string;
  /** the balance as a debit (credit balances negative); null when that side has no such line */
  sourceCents: number | null;
  ledgerCents: number | null;
  differenceCents: number;
  why?: 'balance differs' | 'not in LedgerFlow' | 'not in the source';
}

export interface Acceptance {
  checks: Array<{ key: CheckKey; label: string; sourceCents: number; ledgerCents: number; differenceCents: number }>;
  /** every account or source line with a difference (accounts that agree are counted, not listed) */
  differences: AcceptanceLine[];
  agreeing: number;
  /** true when every check and every line agrees */
  accepted: boolean;
  problems: string[];
}

/** "1,234.56", "$1,234.56", "-12.00", "(12.00)", "" → cents; null when it is not an amount. */
export function amountCents(text: string): number | null {
  const raw = text.trim().replace(/[\s$€£₪]/g, '').replace(/,/g, '');
  if (raw === '' || raw === '-') return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith('-');
  const digits = raw.replace(/^\(|\)$/g, '').replace(/^-/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const [whole, part = ''] = digits.split('.');
  const cents = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return negative ? -cents : cents;
}

const money = (cents: number) => (cents / 100).toFixed(2);
const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** The source file read: the header row with Debit and Credit, then one line per account; the total row is checked, not counted. */
export function readSourceTrialBalance(csv: string): SourceTrialBalance {
  const rows = parseCsv(csv);
  const problems: string[] = [];
  const headerAt = rows.findIndex(r => r.some(c => /^debit$/i.test(c.trim())) && r.some(c => /^credit$/i.test(c.trim())));
  if (headerAt < 0) return { lines: [], totalDebitCents: 0, totalCreditCents: 0, problems: ['No header row with "Debit" and "Credit" columns was found'] };
  const header = rows[headerAt].map(c => c.trim().toLowerCase());
  const debitCol = header.indexOf('debit');
  const creditCol = header.indexOf('credit');
  const codeCol = header.findIndex(h => ['code', 'account #', 'account no', 'account number', 'num'].includes(h));
  const accountCol = Math.max(0, header.findIndex(h => h === 'account' || h === 'account name' || h === 'name'));
  const lines: SourceLine[] = [];
  let fileTotal: { debit: number; credit: number } | null = null;
  rows.slice(headerAt + 1).forEach((r, i) => {
    const row = headerAt + i + 2;
    const name = (r[accountCol] || '').trim();
    if (!name && !r.some(c => c.trim())) return;
    const debit = amountCents(r[debitCol] || '');
    const credit = amountCents(r[creditCol] || '');
    if (debit === null || credit === null) { problems.push(`Row ${row}: "${r[debitCol] || ''}" / "${r[creditCol] || ''}" is not an amount`); return; }
    if (/^total\b/i.test(name)) { fileTotal = { debit, credit }; return; }
    if (!name) { problems.push(`Row ${row}: an amount with no account`); return; }
    // QuickBooks writes "1200 Accounts Receivable (A/R)": a leading number is the account's code
    const lead = name.match(/^(\d[\w.-]*)\s+(.+)$/);
    const code = codeCol >= 0 ? (r[codeCol] || '').trim() || undefined : lead?.[1];
    lines.push({ row, account: codeCol < 0 && lead ? lead[2] : name, ...(code ? { code } : {}), debitCents: debit - credit });
  });
  const totalDebitCents = lines.reduce((s, l) => s + Math.max(0, l.debitCents), 0);
  const totalCreditCents = lines.reduce((s, l) => s + Math.max(0, -l.debitCents), 0);
  const total = fileTotal as { debit: number; credit: number } | null;
  if (total && (total.debit !== totalDebitCents || total.credit !== totalCreditCents)) {
    problems.push(`The file's own total row (${money(total.debit)} / ${money(total.credit)}) is not the sum of its lines (${money(totalDebitCents)} / ${money(totalCreditCents)})`);
  }
  return { lines, totalDebitCents, totalCreditCents, problems };
}

/** The source set against LedgerFlow: every account, and the five totals that say whether the move is complete. */
export function compareImport(source: SourceTrialBalance, accounts: ChartAccount[], ledger: LedgerRow[], mappings?: Record<string, string | undefined>): Acceptance {
  const byCode = new Map(accounts.filter(a => a.code).map(a => [norm(String(a.code)), a]));
  const byName = new Map(accounts.map(a => [norm(a.name), a]));
  const ledgerOf = new Map(ledger.map(r => [r.id, r.debit - r.credit]));
  const sourceOf = new Map<string, number>();
  const differences: AcceptanceLine[] = [];
  const unmatched: SourceLine[] = [];
  for (const line of source.lines) {
    const account = (line.code && byCode.get(norm(line.code))) || byName.get(norm(line.account));
    if (!account) { unmatched.push(line); continue; }
    sourceOf.set(account.id, (sourceOf.get(account.id) || 0) + line.debitCents);
  }
  let agreeing = 0;
  const ordered = [...accounts].sort((a, b) => String(a.code || '￿').localeCompare(String(b.code || '￿'), 'en', { numeric: true }) || a.name.localeCompare(b.name, 'en'));
  for (const a of ordered) {
    const src = sourceOf.has(a.id) ? sourceOf.get(a.id)! : null;
    const own = ledgerOf.get(a.id) || 0;
    if (src === null && own === 0) continue;
    const label = `${a.code ? `${a.code} ` : ''}${a.name}`;
    if (src === null) { differences.push({ accountId: a.id, label, sourceCents: null, ledgerCents: own, differenceCents: own, why: 'not in the source' }); continue; }
    if (src === own) { agreeing++; continue; }
    differences.push({ accountId: a.id, label, sourceCents: src, ledgerCents: own, differenceCents: own - src, why: 'balance differs' });
  }
  for (const l of unmatched) {
    differences.push({ label: `${l.code ? `${l.code} ` : ''}${l.account} (row ${l.row})`, sourceCents: l.debitCents, ledgerCents: null, differenceCents: -l.debitCents, why: 'not in LedgerFlow' });
  }

  const tax = accountInUse(DEFAULT_ACCOUNT_SLOTS.find(s => s.key === 'tax payable')!, accounts, mappings).account;
  const sum = (pick: (a: ChartAccount) => boolean, side: Map<string, number>) => accounts.filter(pick).reduce((s, a) => s + (side.get(a.id) || 0), 0);
  // A/P and tax payable are credit balances: shown as what is owed (positive)
  const roll = (key: CheckKey, label: string, pick: (a: ChartAccount) => boolean, sign: 1 | -1) => {
    const sourceCents = sign * sum(pick, sourceOf);
    const ledgerCents = sign * sum(pick, ledgerOf);
    return { key, label, sourceCents, ledgerCents, differenceCents: ledgerCents - sourceCents };
  };
  const ledgerDebits = ledger.reduce((s, r) => s + Math.max(0, r.debit - r.credit), 0);
  const checks: Acceptance['checks'] = [
    { key: 'trial-balance', label: 'Trial balance (debits)', sourceCents: source.totalDebitCents, ledgerCents: ledgerDebits, differenceCents: ledgerDebits - source.totalDebitCents },
    roll('ar', 'Accounts receivable', a => resolveAccountRole(a) === 'ar', 1),
    // tax payable is its own line, not a trade payable (resolveAccountRole reads "payable" in its name as A/P)
    roll('ap', 'Accounts payable', a => resolveAccountRole(a) === 'ap' && a.id !== tax?.id, -1),
    roll('cash', 'Cash and bank', a => resolveAccountRole(a) === 'cash', 1),
    roll('tax', tax ? `Tax payable (${tax.name})` : 'Tax payable (no account set)', a => a.id === tax?.id, -1),
  ];
  const problems = [...source.problems, ...(source.totalDebitCents !== source.totalCreditCents ? [`The source file does not balance: debits ${money(source.totalDebitCents)}, credits ${money(source.totalCreditCents)}`] : [])];
  return { checks, differences, agreeing, accepted: differences.length === 0 && checks.every(c => c.differenceCents === 0) && problems.length === 0, problems };
}
