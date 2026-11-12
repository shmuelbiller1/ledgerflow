/**
 * Month-end currency revaluation (R-07), as a pure plan.
 *
 * A foreign invoice or bill is stored in its own currency with the rate it was booked at
 * (`exchangeRate`), and the ledger holds its value in the workspace's currency. When the rate moves,
 * what the customer owes or the vendor is owed is worth a different amount in the books than it was
 * the day the document was made. At a period end an accountant may want the balance sheet to say the
 * value at *today's* rate: that is this entry — the open receivables and payables move by the
 * difference, and an unrealized FX gain/loss account takes the other side.
 *
 * It is a snapshot, not a restatement of the documents: the entry reverses the next day (the caller
 * posts both together), so the invoices and bills keep their own rates, a later payment matches
 * them, and the ledger after that day reads exactly what the documents say.
 *
 * What is deliberately not here:
 * - no rate is ever invented. A currency whose rate cannot be had stops the run (the old run used a
 *   made-up rate and revalued home-currency accounts too, which is why it was switched off, L-187);
 * - no new account is created. The gain/loss account and the receivable/payable accounts must exist;
 *   the plan only names the documents it could not use and why;
 * - no money is added up twice: the open amount of a document is `calculateAmountDue` and its booked
 *   value is `toBaseCents`, the same two rules the aging and the customer balances use, so this
 *   entry and the A/R report cannot disagree.
 */
import { convertMinorUnits } from './currencyMinorUnits';
import { addDaysYMD } from './fiscalCalendar';
import { monthEnd } from './periodLock';
import { calculateAmountDue } from './documentMath';
import { isOpenBill, isOpenInvoice } from './txFilters';
import { byCodeUnit } from './codeUnitOrder';

/** A receivable (a customer's invoice) or a payable (a vendor's bill). */
export type RevaluationSide = 'customer' | 'vendor';

export const REVALUATION_SIDES: Record<RevaluationSide, { label: string; accountLabel: string; open: (doc: { status?: string }) => boolean }> = {
  customer: { label: 'invoice', accountLabel: 'Accounts Receivable', open: isOpenInvoice },
  vendor: { label: 'bill', accountLabel: 'Accounts Payable', open: isOpenBill },
};

/** One open document, with the account its balance sits in. */
export interface RevaluableDocument {
  id: string;
  side: RevaluationSide;
  number?: string;
  partyName?: string;
  currency?: string;
  /** the rate the document was booked at: its currency → the workspace's currency */
  exchangeRate?: number;
  amountCents?: number;
  amountPaidCents?: number;
  depositCents?: number;
  status?: string;
  accountId?: string;
  accountName?: string;
  /** the account's own currency, when it has one (see `planFxRevaluation`) */
  accountCurrency?: string;
}

export interface RevaluedAccount { id: string; name: string }

/** A currency's rate for today, or undefined when it cannot be had — never a guessed number. */
export type RateFor = (currency: string) => number | undefined;

export interface RevaluationDetail {
  id: string;
  side: RevaluationSide;
  number: string;
  partyName: string;
  currency: string;
  /** what is still owed, in the document's own currency */
  openCents: number;
  bookedRate: number;
  todayRate: number;
  /** the same amount in the workspace's currency, as the books have it and as today's rate gives it */
  bookedBaseCents: number;
  todayBaseCents: number;
  /** the move, in the workspace's currency; positive means the customer owes more (or the bill costs more) */
  deltaCents: number;
}

export interface RevaluationSkip {
  id: string;
  side: RevaluationSide;
  number: string;
  reason: string;
}

export interface RevaluationLine {
  accountId: string;
  accountName: string;
  /** signed cents in the workspace's currency: positive is a debit, as everywhere in the ledger */
  amountCents: number;
  description: string;
}

export interface RevaluationPlan {
  /** the lines of the entry, the offset account included; they add up to zero exactly */
  lines: RevaluationLine[];
  details: RevaluationDetail[];
  skipped: RevaluationSkip[];
  /** currencies an open document needs and that had no rate; a run with any of these posts nothing */
  unpriced: string[];
  /** positive is a gain for the workspace: the receivables grew more than the payables did */
  netGainCents: number;
  /** the size of the entry (the debit side), the figure `totalAmountCents` is checked against */
  debitTotalCents: number;
  currencies: string[];
  documentCount: number;
}

const upper = (value: unknown): string => String(value ?? '').trim().toUpperCase();
const usableRate = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
const label = (doc: { number?: string; id: string }): string => String(doc.number || doc.id);

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const lastDay = Number(monthEnd(`${year}-${String(month).padStart(2, '0')}`).slice(-2));
  return day <= lastDay;
}

/** A past valuation must be an actual month-end and must use rates entered for that date. */
export function revaluationDateProblem(date: string, today: string): string | null {
  if (!isCalendarDate(date)) return 'Date must be a real calendar date in YYYY-MM-DD format';
  if (date > today) return `A revaluation date cannot be after ${today}.`;
  if (date < today && date !== monthEnd(date.slice(0, 7))) {
    return 'For a past revaluation, choose the last day of a month and enter that day’s rates.';
  }
  return null;
}

/** The date the entry reverses on: the day after the one it is valued at. */
export const revaluationReversalDate = (date: string): string => addDaysYMD(date, 1);

/**
 * The entry for one date, from the workspace's open documents and the rate for that date. The
 * optional date keeps the original "today" wording for current-rate previews; historical plans name
 * the date whose typed rates they use.
 *
 * A document is left out (with the reason, so the accountant can see what was not valued) when it is
 * closed or fully paid, when it is not in a foreign currency, when it carries no rate to compare
 * against, when its account is itself in that currency (then the account is already in that money and
 * there is nothing to convert), or when the chosen date's rate gives the same value as the booked one.
 */
export function planFxRevaluation(
  docs: RevaluableDocument[],
  rateFor: RateFor,
  gainLossAccount: RevaluedAccount,
  baseCurrency: string,
  rateDate?: string,
): RevaluationPlan {
  const base = upper(baseCurrency) || 'USD';
  const rateLabel = (currency: string) => rateDate ? `${rateDate} ${currency} rate` : `today's ${currency} rate`;
  const details: RevaluationDetail[] = [];
  const skipped: RevaluationSkip[] = [];
  const unpriced = new Set<string>();
  const perAccount = new Map<string, { account: RevaluedAccount; cents: number; docs: RevaluationDetail[] }>();
  const currencies = new Set<string>();

  for (const doc of docs) {
    const side: RevaluationSide = doc.side === 'vendor' ? 'vendor' : 'customer';
    const sideInfo = REVALUATION_SIDES[side];
    const short = { id: doc.id, side, number: label(doc) };
    if (!sideInfo.open({ status: doc.status })) {
      skipped.push({ ...short, reason: `the ${sideInfo.label} is ${doc.status || 'closed'}, so nothing is owed on it` });
      continue;
    }
    const currency = upper(doc.currency);
    if (!currency || currency === base) continue; // not foreign: the books already hold its value
    const openCents = calculateAmountDue(doc);
    if (openCents <= 0) {
      skipped.push({ ...short, reason: `nothing is left open on the ${sideInfo.label}` });
      continue;
    }
    const bookedRate = usableRate(doc.exchangeRate);
    if (bookedRate === undefined) {
      skipped.push({ ...short, reason: `the ${sideInfo.label} carries no exchange rate, so what was booked cannot be reproduced` });
      continue;
    }
    if (!doc.accountId) {
      skipped.push({ ...short, reason: `no ${sideInfo.accountLabel} account is set on this workspace` });
      continue;
    }
    const accountCurrency = upper(doc.accountCurrency);
    if (accountCurrency && accountCurrency !== base) {
      skipped.push({ ...short, reason: `${doc.accountName || 'its account'} is kept in ${accountCurrency} itself, so there is nothing to convert` });
      continue;
    }
    const todayRate = usableRate(rateFor(currency));
    if (todayRate === undefined) {
      unpriced.add(currency);
      continue;
    }

    const bookedBaseCents = convertMinorUnits(openCents, bookedRate, currency, base);
    const todayBaseCents = convertMinorUnits(openCents, todayRate, currency, base);
    const deltaCents = todayBaseCents - bookedBaseCents;
    if (deltaCents === 0) {
      skipped.push({ ...short, reason: `already at ${rateLabel(currency)}` });
      continue;
    }

    const detail: RevaluationDetail = {
      id: doc.id, side, number: label(doc), partyName: String(doc.partyName || ''), currency,
      openCents, bookedRate, todayRate, bookedBaseCents, todayBaseCents, deltaCents,
    };
    details.push(detail);
    currencies.add(currency);
    const key = doc.accountId;
    const entry = perAccount.get(key) || { account: { id: doc.accountId, name: doc.accountName || sideInfo.accountLabel }, cents: 0, docs: [] };
    // A receivable that is worth more is a debit to it; a payable that is worth more is a credit.
    entry.cents += side === 'customer' ? deltaCents : -deltaCents;
    entry.docs.push(detail);
    perAccount.set(key, entry);
  }

  const lines: RevaluationLine[] = [];
  let netGainCents = 0;
  for (const { account, cents, docs: moved } of [...perAccount.values()].sort((a, b) => a.account.name.localeCompare(b.account.name))) {
    if (cents === 0) continue; // one account's gains and losses cancelling each other out need no line
    netGainCents += cents;
    lines.push({
      accountId: account.id,
      accountName: account.name,
      amountCents: cents,
      description: revaluationLineDescription(account.name, moved, rateDate),
    });
  }

  // The other side of the entry, so it closes to zero exactly: the unrealized gain or loss of the
  // period. Left out when there is none — then the accounts already balance each other, and a line
  // of nothings in the ledger would only be noise for whoever reads it later.
  if (lines.length > 0 && netGainCents !== 0) {
    lines.push({
      accountId: gainLossAccount.id,
      accountName: gainLossAccount.name,
      amountCents: -netGainCents,
      description: `Unrealized FX ${netGainCents > 0 ? 'gain' : 'loss'} at ${rateDate ? `${rateDate} rates` : "today's rates"}`,
    });
  }

  const debitTotalCents = lines.reduce((sum, l) => sum + Math.max(0, l.amountCents), 0);
  return {
    lines, details, skipped, unpriced: [...unpriced].sort(byCodeUnit), netGainCents, debitTotalCents,
    currencies: [...currencies].sort(byCodeUnit), documentCount: details.length,
  };
}

function revaluationLineDescription(accountName: string, docs: RevaluationDetail[], rateDate?: string): string {
  const kinds = new Map<RevaluationSide, number>();
  for (const d of docs) kinds.set(d.side, (kinds.get(d.side) || 0) + 1);
  const what = (['customer', 'vendor'] as RevaluationSide[])
    .filter(side => kinds.get(side))
    .map(side => `${kinds.get(side)} ${REVALUATION_SIDES[side].label}${kinds.get(side) === 1 ? '' : 's'}`)
    .join(' and ');
  const where = docs.length === 1 ? ` (${docs[0].number}${docs[0].partyName ? `, ${docs[0].partyName}` : ''})` : '';
  return `${accountName} at ${rateDate ? `the ${rateDate} rate` : "today's rate"}: ${what}${where}`;
}

/** The same lines the other way round — the entry that undoes the revaluation. */
export function reversalLines(lines: RevaluationLine[]): RevaluationLine[] {
  return lines.map(line => ({ ...line, amountCents: -line.amountCents }));
}

/**
 * What a person is told about a plan, before and after they press the button: what moved, and when
 * nothing moved, why not. `money` is the workspace's currency formatter, so the amounts read like
 * they do everywhere else in the app.
 */
export function revaluationSummary(plan: RevaluationPlan, money: (cents: number) => string, rateDate?: string): string {
  const datedRateLabel = rateDate ? `the ${rateDate} rate` : "today's rate";
  if (plan.unpriced.length > 0) {
    if (rateDate) {
      return `Type the ${plan.unpriced.join(' and ')} rate${plan.unpriced.length === 1 ? '' : 's'} for ${rateDate} to complete the preview. Nothing was posted.`;
    }
    return `Nothing was posted: the ${plan.unpriced.join(' and ')} rate${plan.unpriced.length === 1 ? ' is' : 's are'} not available from the exchange service right now, and a revaluation cannot leave a currency out.`;
  }
  if (plan.lines.length === 0) {
    return plan.skipped.length > 0
      ? `Nothing to post: ${plan.skipped.length} ${plan.skipped.length === 1 ? 'document' : 'documents'} looked at, and every open foreign one already stands at ${datedRateLabel}.`
      : 'Nothing to post: this workspace has no open invoice or bill in another currency.';
  }
  const gain = plan.netGainCents === 0
    ? 'the receivables and payables move by the same amount, so there is no gain or loss'
    : `${plan.netGainCents > 0 ? 'an unrealized gain' : 'an unrealized loss'} of ${money(Math.abs(plan.netGainCents))}`;
  const reversal = rateDate ? `It reverses on ${revaluationReversalDate(rateDate)}` : 'It reverses the next day';
  const asOf = rateDate ? `at ${rateDate}` : 'at today’s rates';
  return `${plan.documentCount} ${plan.documentCount === 1 ? 'document' : 'documents'} in ${plan.currencies.join(', ')}: ${money(plan.debitTotalCents)} of movement in the accounts ${asOf}, ${gain}. ${reversal}, so the documents keep their own rates.`;
}
