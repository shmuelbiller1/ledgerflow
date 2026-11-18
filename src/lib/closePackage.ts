/**
 * The close package (R-11): what an accountant files for a closed month, as sheets of a workbook.
 * - Close status: the month, whether it is open or closed and through when, every checklist item and
 *   the client's own steps with their status, who signed them off, when, and the note;
 * - Trial balance on the last day of the month (debits, credits, balance; a total row);
 * - The month's general ledger, line by line;
 * - Questions about the month's entries (BD-07) with the latest answer.
 * Pure: the screen writes these into the spreadsheet. Money is in major units (workspace currency for the ledger, entry currency for questions), as
 * numbers (not text), so the sheet adds up.
 */
import type { ChartAccount, Transaction } from '../types';
import { getCurrencyDivisor } from './moneyFormat';
import { openingDebitCents } from './accountUtils';
import type { ClientQuery } from './clientQueries';
import { STATUS_LABEL } from './clientQueries';
import { isPostable, lineAmount } from './txFilters';

export interface SheetSpec {
  name: string;
  columns: Array<{ header: string; key: string; width: number; money?: boolean }>;
  rows: Array<Record<string, string | number>>;
}

interface ChecklistRow { id: string; title: string; status: 'done' | 'attention' | 'blocker'; detail: string }
interface SignOff { by: string; at: string; note?: string }

export interface ClosePackageInput {
  month: string;
  monthEnd: string;
  currency?: string;
  state: string;
  closedThrough: string;
  items: ChecklistRow[];
  signOffs: Record<string, SignOff | undefined>;
  accounts: ChartAccount[];
  transactions: Transaction[];
  queries: ClientQuery[];
}

function statusText(item: ChecklistRow, signed?: SignOff): string {
  if (signed) return `Signed off by ${signed.by} on ${signed.at.slice(0, 10)}${signed.note ? `: ${signed.note}` : ''}`;
  if (item.status === 'done') return 'Done';
  return item.status === 'blocker' ? 'Blocks the close' : 'Needs a sign-off';
}

export function closePackageSheets(input: ClosePackageInput): SheetSpec[] {
  const divisor = getCurrencyDivisor(input.currency || 'USD');
  const units = (minor: number) => Math.round(minor) / divisor;
  const posted = input.transactions.filter(t => isPostable(t) && String(t.date || '').slice(0, 10) <= input.monthEnd);
  const inMonth = posted.filter(t => String(t.date || '').slice(0, 7) === input.month);

  const status: SheetSpec = {
    name: 'Close status',
    columns: [{ header: 'Item', key: 'item', width: 40 }, { header: 'Status', key: 'status', width: 48 }, { header: 'Details', key: 'detail', width: 70 }],
    rows: [
      { item: 'Month', status: input.month, detail: '' },
      { item: 'State', status: input.state, detail: input.closedThrough ? `Closed through ${input.closedThrough}` : 'Nothing is closed' },
      ...input.items.map(i => ({ item: i.title, status: statusText(i, input.signOffs[i.id]), detail: i.detail })),
    ],
  };

  const totals = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
  for (const a of input.accounts) totals.set(a.id, { code: a.code || '', name: a.name, type: a.type, debit: 0, credit: 0 });
  for (const a of input.accounts) if (a.openingBalanceCents) {
    const row = totals.get(a.id)!;
    // N-13: the opening balance is in the account's own direction
    const asDebit = openingDebitCents(a);
    if (asDebit > 0) row.debit += asDebit; else row.credit -= asDebit;
  }
  for (const t of posted) for (const l of t.lines || []) {
    const row = totals.get(l.accountId) || { code: '', name: l.accountName || l.accountId || 'Unassigned', type: '', debit: 0, credit: 0 };
    const amount = lineAmount(l, t);
    if (amount > 0) row.debit += amount; else row.credit -= amount;
    totals.set(l.accountId, row);
  }
  const tbRows = [...totals.values()].filter(r => r.debit || r.credit).sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  const sumDebit = tbRows.reduce((s, r) => s + r.debit, 0);
  const sumCredit = tbRows.reduce((s, r) => s + r.credit, 0);
  const trialBalance: SheetSpec = {
    name: 'Trial Balance',
    columns: [
      { header: 'Code', key: 'code', width: 12 }, { header: 'Account', key: 'name', width: 32 }, { header: 'Type', key: 'type', width: 14 },
      { header: 'Debits', key: 'debit', width: 16, money: true }, { header: 'Credits', key: 'credit', width: 16, money: true }, { header: 'Balance', key: 'net', width: 16, money: true },
    ],
    rows: [
      ...tbRows.map(r => ({ code: r.code, name: r.name, type: r.type, debit: units(r.debit), credit: units(r.credit), net: units(r.debit - r.credit) })),
      { code: '', name: `Total on ${input.monthEnd}`, type: '', debit: units(sumDebit), credit: units(sumCredit), net: units(sumDebit - sumCredit) },
    ],
  };

  const ledger: SheetSpec = {
    name: 'General Ledger',
    columns: [
      { header: 'Date', key: 'date', width: 12 }, { header: 'Entry', key: 'id', width: 22 }, { header: 'Reference', key: 'ref', width: 14 },
      { header: 'Description', key: 'desc', width: 32 }, { header: 'Account', key: 'account', width: 28 }, { header: 'Amount', key: 'amount', width: 14, money: true },
    ],
    rows: [...inMonth].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id)).flatMap(t => (t.lines || []).map(l => ({
      date: String(t.date || '').slice(0, 10), id: t.id, ref: t.reference || '', desc: t.description || '', account: l.accountName || l.accountId, amount: units(lineAmount(l, t)),
    }))),
  };

  const questions: SheetSpec = {
    name: 'Questions',
    columns: [
      { header: 'Entry date', key: 'date', width: 12 }, { header: 'Entry', key: 'entry', width: 30 }, { header: 'Amount', key: 'amount', width: 14, money: true },
      { header: 'Currency', key: 'currency', width: 12 }, { header: 'Status', key: 'status', width: 22 },
      { header: 'Question', key: 'question', width: 50 }, { header: 'Latest answer', key: 'answer', width: 50 },
    ],
    rows: input.queries.filter(q => String(q.entry?.date || '').slice(0, 7) === input.month).map(q => {
      const messages = q.messages || [];
      const answer = [...messages].reverse().find(m => m.uid !== q.askedBy);
      const currency = q.entry?.currency || input.currency || 'USD';
      return {
        date: String(q.entry?.date || ''), entry: q.entry?.description || q.transactionId, amount: Math.round(q.entry?.amountCents || 0) / getCurrencyDivisor(currency), currency,
        status: STATUS_LABEL[q.status] || q.status, question: messages[0]?.text || '', answer: answer?.text || '',
      };
    }),
  };

  return [status, trialBalance, ledger, questions];
}
