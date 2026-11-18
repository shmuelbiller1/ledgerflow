/**
 * A-151 (P2-2): the month-end close journey — one ordered, read-only path through the work a month
 * needs: reconcile each bank, give every entry an account, look at the open receivables and
 * payables, review accruals, clear the drafts, check the trial balance, lock the month and take the
 * report pack. Each step says whether the recorded data shows it done and opens the screen that
 * does the work.
 *
 * Nothing here is a second set of books. The blocker and attention checks are exactly the ones
 * `buildCloseChecklist` (Month-End Close) makes; this file adds the per-bank detail the task asks
 * for, the open-document counts, the accrual reminder and the lock/pack steps. It never posts,
 * signs off or closes anything: the sign-offs, the close and the close package stay on Month-End
 * Close, and a step here that needs attention is a prompt to look, not a conclusion.
 */
import { resolveAccountRole } from './accountUtils';
import { calculateAmountDue } from './documentMath';
import { closeBankLines, needsBankMatch, type CloseItem } from './closeChecklist';
import { isOpenInvoice } from './txFilters';
import { monthEnd, type MonthCloseState } from './periodLock';
import type { BankStatementLine, ChartAccount } from '../model/ledger';

export type CloseJourneyStatus = 'done' | 'attention' | 'blocker' | 'review' | 'not-applicable';
export type CloseJourneyStepId = 'banks' | 'categorize' | 'receivables' | 'payables' | 'accruals' | 'drafts' | 'trial-balance' | 'lock' | 'report-pack';

export interface CloseJourneyFigure {
  label: string;
  /** whole cents of the workspace currency */
  cents?: number;
  count?: number;
  note?: string;
}

export interface CloseJourneyBankRow {
  accountId: string;
  accountName: string;
  lines: number;
  unmatched: number;
  /** lines with no account: listed apart, never assigned to a bank by guess */
  unassigned?: boolean;
}

export interface CloseJourneyStep {
  id: CloseJourneyStepId;
  title: string;
  /** plain words: the work itself */
  what: string;
  /** done / needs attention / blocks the close / review only / does not apply */
  status: CloseJourneyStatus;
  /** what the recorded data shows, in words */
  detail: string;
  figures: CloseJourneyFigure[];
  screen: string;
  tab: string;
  screenLabel: string;
  /** the per-account bank detail (the banks step) */
  banks: CloseJourneyBankRow[];
}

export interface CloseJourney {
  month: string;
  endDate: string;
  state: MonthCloseState;
  steps: CloseJourneyStep[];
  done: number;
  attention: number;
  blockers: number;
  /** no step needs attention and nothing blocks the close; the lock is part of the path */
  readyToClose: boolean;
  nextStep?: CloseJourneyStepId;
  problems: string[];
}

type OpenDocument = {
  id: string;
  number?: string;
  status?: string;
  date?: string;
  dueDate?: string;
  amountCents?: number;
  amountPaidCents?: number;
  depositCents?: number;
  currency?: string;
  partyName?: string;
};

export interface CloseJourneyInput {
  month: string;
  /** the month's close state, from `monthCloseState(month, workspace)` */
  state: MonthCloseState;
  /** the checklist `buildCloseChecklist` returned for the same month */
  items: Array<Pick<CloseItem, 'id' | 'title' | 'status' | 'detail' | 'count'>>;
  accounts?: ChartAccount[];
  bankLines?: Array<Pick<BankStatementLine, 'accountId' | 'date' | 'status' | 'matchedTransactionId'>>;
  invoices?: OpenDocument[];
  bills?: OpenDocument[];
  journalEntries?: Array<{ id?: string; date?: string; deletedAt?: unknown }>;
  currency?: string;
}

const MONTH_TEXT = /^\d{4}-(0[1-9]|1[0-2])$/;
const inMonth = (date: string | undefined, month: string) => String(date || '').slice(0, 7) === month;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const itemOf = (items: CloseJourneyInput['items'], id: string) => items.find(i => i.id === id);

/** Current unpaid balances of documents dated through the month, not reconstructed month-end balances. */
function openDocuments(docs: OpenDocument[] | undefined, endDate: string, currency: string) {
  let count = 0, cents = 0, otherCurrency = 0;
  for (const doc of docs || []) {
    if (!isOpenInvoice(doc)) continue;
    const date = String(doc.date || '').slice(0, 10);
    if (date && date > endDate) continue;
    const due = calculateAmountDue(doc);
    if (due <= 0) continue;
    count++;
    const docCurrency = doc.currency || currency;
    if (docCurrency !== currency) { otherCurrency++; continue; }
    cents += due;
  }
  return { count, cents, otherCurrency };
}

export function closeJourney(input: CloseJourneyInput): CloseJourney {
  const currency = input.currency || 'USD';
  const problems: string[] = [];
  if (!MONTH_TEXT.test(String(input.month || ''))) problems.push('A month is written as 2026-09.');
  const month = String(input.month || '');
  const endDate = MONTH_TEXT.test(month) ? monthEnd(month) : '';
  const items = input.items || [];

  // 1. each bank, apart: a line is unmatched when it is pending or has no matched transaction
  const bankAccounts = (input.accounts || []).filter(a => resolveAccountRole(a) === 'cash');
  const lines = closeBankLines(input.bankLines || [], month);
  const banks: CloseJourneyBankRow[] = bankAccounts.map(account => {
    const mine = lines.filter(l => l.accountId === account.id);
    return {
      accountId: account.id,
      accountName: account.name || account.code || account.id,
      lines: mine.length,
      unmatched: mine.filter(needsBankMatch).length,
    };
  });
  const unassigned = lines.filter(l => !l.accountId || !bankAccounts.some(a => a.id === l.accountId));
  if (unassigned.length) banks.push({
    accountId: '', accountName: 'Lines with no bank account', lines: unassigned.length,
    unmatched: unassigned.filter(needsBankMatch).length, unassigned: true,
  });
  const unmatched = banks.reduce((sum, b) => sum + b.unmatched, 0);
  const lineCount = banks.reduce((sum, b) => sum + b.lines, 0);

  // 2. today’s balances, limited to documents dated through the month (no payment replay)
  const receivables = openDocuments(input.invoices, endDate, currency);
  const payables = openDocuments(input.bills, endDate, currency);

  // 3. journal entries dated in the month: the accrual reminder, never a conclusion
  const journals = (input.journalEntries || []).filter(j => !j.deletedAt && inMonth(j.date, month)).length;

  const drafts = itemOf(items, 'drafts');
  const categorize = itemOf(items, 'categorize');
  const trialBalance = itemOf(items, 'trial-balance');
  const closed = input.state === 'soft' || input.state === 'hard' || input.state === 'partly-open';
  const stateText = input.state === 'hard' ? 'closed' : input.state === 'soft'
    ? 'soft-closed (owners and accountants can still post)' : input.state === 'partly-open'
      ? 'closed, with a date range unlocked' : 'open';

  const steps: CloseJourneyStep[] = [
    {
      id: 'banks',
      title: 'Reconcile each bank',
      what: 'Match every bank line of the month to its entry, one account at a time. A line left pending is money the books do not explain yet.',
      status: !banks.length ? 'not-applicable' : unmatched ? 'attention' : 'done',
      detail: !banks.length
        ? 'No bank or cash account is in the chart of accounts, so there is nothing to reconcile from this data.'
        : unmatched
          ? `${plural(unmatched, 'bank line')} of ${lineCount} in ${month} not matched: ${banks.filter(b => b.unmatched).map(b => `${b.accountName} (${b.unmatched})`).join(', ')}.`
          : lineCount
            ? `All ${plural(lineCount, 'bank line')} to reconcile in ${month} are matched, across ${plural(banks.length, 'account')}.`
            : `No bank lines to reconcile in ${month}. Ignored lines are not counted.`,
      figures: [
        { label: 'Bank lines to reconcile in the month', count: lineCount },
        { label: 'Not matched', count: unmatched },
      ],
      screen: 'reconciliation', tab: 'reconciliation', screenLabel: 'Reconcile', banks,
    },
    {
      id: 'categorize',
      title: 'Give every entry an account',
      ...checklistStep(categorize, 'categorize'),
      screen: 'ledger', tab: 'ledger', screenLabel: 'Ledger & Journal',
      banks: [],
    },
    {
      id: 'receivables',
      title: 'Review receivables aging',
      what: `These are today’s unpaid amounts for invoices dated through ${endDate}. Payments and credits after that date are not reversed.`,
      status: 'review',
      detail: receivables.count
        ? `${plural(receivables.count, 'invoice')} currently unpaid${receivables.otherCurrency ? `, including ${plural(receivables.otherCurrency, 'invoice')} in another currency (not converted)` : ''}.`
        : 'No currently unpaid invoices in the checked dates.',
      figures: [
        { label: 'Invoices open', count: receivables.count },
        { label: 'Due in the workspace currency', cents: receivables.cents },
      ],
      screen: 'ar-aging', tab: 'reports', screenLabel: 'Current A/R Aging', banks: [],
    },
    {
      id: 'payables',
      title: 'Review payables aging',
      what: `These are today’s unpaid amounts for bills dated through ${endDate}. Payments and credits after that date are not reversed.`,
      status: 'review',
      detail: payables.count
        ? `${plural(payables.count, 'bill')} currently unpaid${payables.otherCurrency ? `, including ${plural(payables.otherCurrency, 'bill')} in another currency (not converted)` : ''}.`
        : 'No currently unpaid bills in the checked dates.',
      figures: [
        { label: 'Bills open', count: payables.count },
        { label: 'Due in the workspace currency', cents: payables.cents },
      ],
      screen: 'ap-aging', tab: 'reports', screenLabel: 'Current A/P Aging', banks: [],
    },
    {
      id: 'accruals',
      title: 'Review accruals and prepayments',
      what: 'Check the costs that belong to this month but are not in it yet — an accrual, a prepayment share, depreciation — and the ones already posted that belong to a later month.',
      status: 'review',
      detail: `${plural(journals, 'journal entry', 'journal entries')} dated in ${month}. This screen cannot decide which costs belong to the month; review them on the journal and the asset register, then sign off the depreciation item on Month-End Close when it is posted.`,
      figures: [{ label: 'Journal entries in the month', count: journals }],
      screen: 'ledger', tab: 'ledger', screenLabel: 'Ledger & Journal', banks: [],
    },
    {
      id: 'drafts',
      title: 'Clear the drafts dated in the month',
      ...checklistStep(drafts, 'drafts'),
      screen: 'ledger', tab: 'ledger', screenLabel: 'Ledger & Journal',
      banks: [],
    },
    {
      id: 'trial-balance',
      title: 'Check the trial balance',
      ...checklistStep(trialBalance, 'trial-balance'),
      screen: 'trial-balance', tab: 'reports', screenLabel: 'Trial Balance',
      banks: [],
    },
    {
      id: 'lock',
      title: 'Lock the month',
      what: 'Close the month after the work above, so no new entry can be posted into it.',
      status: closed ? 'done' : 'attention',
      detail: closed
        ? `${month} is ${stateText}.`
        : `${month} is ${stateText}. Sign off the items that need it, then close it on Month-End Close; closing a month also closes every month before it.`,
      figures: [{ label: 'Months still open', count: closed ? 0 : 1 }],
      screen: 'month-end-close', tab: 'month-end-close', screenLabel: 'Month-End Close',
      banks: [],
    },
    {
      id: 'report-pack',
      title: 'Take the report pack',
      what: 'Download the close package for the file: the close status with every sign-off, the trial balance, the month’s general ledger and the questions about its entries.',
      status: 'review',
      detail: 'The Close package (.xlsx) button on Month-End Close builds the workbook from the same checklist and sign-offs this page shows. Downloading it records nothing and closes nothing.',
      figures: [],
      screen: 'month-end-close', tab: 'month-end-close', screenLabel: 'Month-End Close',
      banks: [],
    },
  ];

  const attention = steps.filter(s => s.status === 'attention').length;
  const blockers = steps.filter(s => s.status === 'blocker').length;
  const next = steps.find(s => s.status === 'blocker' || s.status === 'attention');
  return {
    month,
    endDate,
    state: input.state,
    steps,
    done: steps.filter(s => s.status === 'done').length,
    attention,
    blockers,
    readyToClose: attention === 0 && blockers === 0 && problems.length === 0,
    ...(next ? { nextStep: next.id } : {}),
    problems,
  };
}

/** Carry a checklist item's own status and words, so the journey cannot invent a softer answer. */
function checklistStep(item: CloseJourneyInput['items'][number] | undefined, id: string): Pick<CloseJourneyStep, 'what' | 'status' | 'detail' | 'figures'> {
  if (!item) return {
    what: 'This check is not reported from this screen.',
    status: 'review',
    detail: 'The checklist did not return this item, so nothing is concluded here.',
    figures: [],
  };
  return {
    what: id === 'drafts'
      ? 'Post, re-date or delete the drafts dated in this month: once it closes they cannot be changed.'
      : id === 'categorize'
        ? 'Every posted entry needs an account, so the reports can count it.'
        : 'Debits must equal credits through the end of the month before it can close.',
    status: item.status === 'blocker' ? 'blocker' : item.status === 'attention' ? 'attention' : 'done',
    detail: item.detail,
    figures: [{ label: 'Found by the check', count: item.count }],
  };
}
