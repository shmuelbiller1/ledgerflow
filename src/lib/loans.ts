/**
 * Loans (A-2, K-30, AI #3): a loan the workspace owes — who lent it, how much, at what rate, over
 * how long, which liability account it sits in, which expense account the interest goes to and
 * which bank pays it.
 *
 * The schedule is `src/lib/loanSchedule.ts` (pure, whole cents). This module is the record, the
 * refusals in plain words and the two balanced entries a loan posts:
 *
 *   money arriving:  debit the bank, credit the liability   (the principal)
 *   a payment:       debit the liability (principal part), debit the interest expense, credit the bank
 *
 * Every entry a loan posts carries the loan's own `reference` (LOAN-…), so the ledger balance
 * behind a loan can be read back and checked against the schedule without guessing from account
 * balances (a liability account may hold more than one loan). Nothing here invents an account: the
 * pickers list the workspace's own chart, and a loan is refused when the right account is missing.
 */
import type { ChartAccount, Transaction, TransactionLine } from '../types';
import { resolveAccountRole } from './accountUtils';
import { isPostable, lineAmount } from './txFilters';
import type { LoanInstallment } from './loanSchedule';

export interface LoanPaymentRecord {
  /** which installment of the schedule this payment settled */
  installment: number;
  /** the date the payment was made */
  date: string;
  /** the entry that was posted for it, when it was posted from the screen */
  transactionId?: string;
}

export interface Loan {
  id: string;
  uid?: string;
  workspaceId: string;
  /** who lent the money */
  lender: string;
  /** the money borrowed, whole cents */
  principalCents: number;
  /** a fraction of a year: 0.065 is 6.5% */
  annualRate: number;
  termMonths: number;
  /** the date the money arrived */
  startDate: string;
  firstPaymentDate: string;
  liabilityAccountId: string;
  interestAccountId: string;
  bankAccountId: string;
  currency?: string;
  /** what every entry this loan posts carries (LOAN-…), so the ledger can be checked back */
  reference: string;
  note?: string;
  payments?: LoanPaymentRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LoanDraft {
  lender: string;
  principalCents: number;
  annualRate: number;
  termMonths: number;
  startDate: string;
  firstPaymentDate: string;
  liabilityAccountId: string;
  interestAccountId: string;
  bankAccountId: string;
}

const accountName = (a: ChartAccount) => (a.code ? `${a.code} · ${a.name}` : a.name);

/** The liability accounts a loan can sit in — the workspace's own chart, never a new account. */
export function loanLiabilityChoices(accounts: ChartAccount[]): ChartAccount[] {
  return accounts
    .filter(a => !a.isArchived && a.isActive !== false && a.type === 'liability')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Expense accounts the interest can go to. */
export function loanInterestChoices(accounts: ChartAccount[]): ChartAccount[] {
  return accounts
    .filter(a => !a.isArchived && a.isActive !== false && a.type === 'expense')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Bank or cash accounts the money arrives in and is paid from. */
export function loanBankChoices(accounts: ChartAccount[]): ChartAccount[] {
  return accounts
    .filter(a => !a.isArchived && a.isActive !== false && resolveAccountRole(a) === 'cash')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What is wrong with the loan as typed, in plain words; null when it can be saved. The account
 * checks are deliberately strict: a loan must point at a liability account, an expense account and
 * a bank account that already exist — the screen offers to open the chart of accounts instead of
 * making one up.
 */
export function loanProblem(draft: LoanDraft, accounts: ChartAccount[]): string | null {
  if (!draft.lender || !draft.lender.trim()) return 'Name the lender.';
  if (!Number.isFinite(draft.principalCents) || draft.principalCents <= 0) return 'The principal must be a positive amount.';
  if (!Number.isFinite(draft.annualRate) || draft.annualRate < 0) return 'The rate cannot be negative.';
  if (draft.annualRate > 1) return 'The rate must be 100% a year or less.';
  if (!Number.isFinite(draft.termMonths) || draft.termMonths < 1 || draft.termMonths > 600) return 'The term must be between 1 and 600 monthly payments.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) return 'Give the date the money arrived.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.firstPaymentDate)) return 'Give the date of the first payment.';
  if (draft.firstPaymentDate <= draft.startDate) return 'The first payment must be after the money arrived.';

  const liability = accounts.find(a => a.id === draft.liabilityAccountId);
  if (!liability) return 'Choose the liability account the loan sits in.';
  if (liability.type !== 'liability') return `${accountName(liability)} is not a liability account.`;
  const interest = accounts.find(a => a.id === draft.interestAccountId);
  if (!interest) return 'Choose the expense account the interest goes to.';
  if (interest.type !== 'expense') return `${accountName(interest)} is not an expense account.`;
  const bank = accounts.find(a => a.id === draft.bankAccountId);
  if (!bank) return 'Choose the bank account the money arrives in and is paid from.';
  if (resolveAccountRole(bank) !== 'cash') return `${accountName(bank)} is not a bank or cash account.`;
  return null;
}

/** A reference for a new loan, unique enough to find its entries again. */
export function newLoanReference(id: string): string {
  return `LOAN-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`;
}

/** "6.5% a year", "0% a year" — how the rate reads, for screens and sentences. */
export function formatLoanRate(annualRate: number): string {
  const percent = annualRate * 100;
  const text = Number.isInteger(percent) ? String(percent) : percent.toFixed(4).replace(/(?<!0)0+$/, '').replace(/\.$/, '');
  return `${text}% a year`;
}

function line(account: ChartAccount, amountCents: number, description?: string): TransactionLine {
  return {
    id: `line-${account.id}`,
    accountId: account.id,
    accountName: account.name,
    amountCents,
    exchangeRate: 1,
    ...(description ? { description } : {}),
  };
}

/** The entry that records the money arriving: the bank is debited, the liability credited. */
export function createLoanDisbursementEntry(input: {
  loan: Pick<Loan, 'lender' | 'principalCents' | 'reference' | 'currency' | 'workspaceId' | 'uid' | 'startDate'>;
  bank: ChartAccount;
  liability: ChartAccount;
}): Partial<Transaction> {
  const amount = Math.abs(Math.round(input.loan.principalCents));
  const description = `Loan from ${input.loan.lender}`;
  return {
    workspaceId: input.loan.workspaceId,
    ...(input.loan.uid ? { uid: input.loan.uid } : {}),
    date: input.loan.startDate,
    description,
    reference: input.loan.reference,
    totalAmountCents: amount,
    currency: input.loan.currency || 'USD',
    exchangeRate: 1,
    type: 'actual',
    status: 'completed',
    lines: [
      line(input.bank, amount),
      // the description goes on the liability line, never on the bank line (the categoriser learns
      // "money from this lender → the loan account", not "→ the bank")
      line(input.liability, -amount, description),
    ],
  };
}

/** One balanced entry for one installment: principal, interest and the money leaving the bank. */
export function createLoanPaymentEntry(input: {
  loan: Pick<Loan, 'lender' | 'reference' | 'currency' | 'workspaceId' | 'uid' | 'termMonths' | 'liabilityAccountId'>;
  installment: LoanInstallment;
  date: string;
  bank: ChartAccount;
  liability: ChartAccount;
  interest: ChartAccount;
}): Partial<Transaction> {
  const { installment } = input;
  const total = installment.interestCents + installment.principalCents;
  const description = `Loan payment ${installment.number}/${input.loan.termMonths} — ${input.loan.lender}`;
  const lines: TransactionLine[] = [];
  if (installment.principalCents) lines.push(line(input.liability, installment.principalCents, description));
  if (installment.interestCents) lines.push(line(input.interest, installment.interestCents, description));
  lines.push(line(input.bank, -total));
  return {
    workspaceId: input.loan.workspaceId,
    ...(input.loan.uid ? { uid: input.loan.uid } : {}),
    date: input.date,
    description,
    reference: input.loan.reference,
    totalAmountCents: total,
    currency: input.loan.currency || 'USD',
    exchangeRate: 1,
    type: 'actual',
    status: 'completed',
    lines,
    // which installment this entry pays, so a payment posted but not yet noted on the loan still counts
    metadata: { [LOAN_INSTALLMENT_KEY]: installment.number },
  };
}

export const LOAN_INSTALLMENT_KEY = 'loanInstallment';

/**
 * The installments already paid: those noted on the loan, and any whose entry is in the ledger.
 * Posting the entry and noting it on the loan are two saves; when the second fails, the ledger
 * still shows the payment, so the screen never offers (and posts) that installment again.
 */
export function recordedInstallments(loan: Pick<Loan, 'reference' | 'payments'>, transactions: Transaction[]): Array<{ installment: number }> {
  const recorded = (loan.payments || []).map(p => ({ installment: p.installment }));
  const seen = new Set(recorded.map(p => p.installment));
  for (const tx of transactions || []) {
    const n = tx.metadata?.[LOAN_INSTALLMENT_KEY];
    if (tx.reference !== loan.reference || !isPostable(tx) || typeof n !== 'number' || seen.has(n)) continue;
    seen.add(n);
    recorded.push({ installment: n });
  }
  return recorded;
}

/**
 * What the ledger says is still owed on this loan: the loan's own posted entries, read back from
 * the liability account they touched (a credit balance is money owed, so the sign is flipped).
 * Entries made by hand without the loan's reference are visible in the account, not here — which
 * is exactly why the screen shows both numbers side by side.
 */
export function loanLedgerCents(loan: Pick<Loan, 'reference' | 'liabilityAccountId'>, transactions: Transaction[]): number {
  let sum = 0;
  for (const tx of transactions || []) {
    if (!isPostable(tx) || tx.reference !== loan.reference) continue;
    for (const transactionLine of tx.lines || []) {
      if (transactionLine.accountId === loan.liabilityAccountId) sum += lineAmount(transactionLine, tx);
    }
  }
  // a settled loan owes exactly nothing, not "minus zero"
  return sum === 0 ? 0 : -sum;
}

/** The sentence under a loan: its size, its rate and what is left, in the workspace's money. */
export function loanSentence(loan: Loan, outstandingCents: number, money: (cents: number) => string): string {
  const term = `${loan.termMonths} monthly payment${loan.termMonths === 1 ? '' : 's'}`;
  return `${money(loan.principalCents)} from ${loan.lender} at ${formatLoanRate(loan.annualRate)}, ${term}. ${money(outstandingCents)} still owed.`;
}
