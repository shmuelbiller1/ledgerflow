/**
 * EU-C1: why the review list suggests an account, in words, instead of a made-up percentage.
 * - "rule": one of the workspace's bank rules matches (the same `suggestFromRules` the import and the server run);
 * - "history": every earlier entry of this payee (at least two) went to the same account, unchanged;
 * - "guess": an account is already on the line, but neither a rule nor history backs it;
 * - "none": nothing to suggest — the person decides.
 * Only "rule" and "history" are accepted by "Accept all with a rule or history".
 */
import type { AutoRule, ChartAccount, Transaction } from '../types';
import type { CalibratedAutoPostDecision } from './practiceAutomation';
import { suggestFromRules } from './bankRules';

export type ReviewReasonKind = 'rule' | 'history' | 'guess' | 'none';

export interface ReviewReason {
  kind: ReviewReasonKind;
  accountId?: string;
  accountName?: string;
  /** what the screen says, e.g. "rule: Shell → Fuel", "same as the last 4 times" */
  text: string;
}

const UNSET = new Set(['', 'uncategorized', 'unassigned']);

/** The account on the entry's category line (the first line that is not money in or out of the bank), if set. */
function lineAccount(tx: Pick<Transaction, 'lines'>, accounts: readonly ChartAccount[]): ChartAccount | undefined {
  for (const line of tx.lines || []) {
    if (!line.accountId || UNSET.has(line.accountId)) continue;
    const account = accounts.find(a => a.id === line.accountId);
    if (account && account.type !== 'asset' && account.type !== 'liability') return account;
  }
  return undefined;
}

export function reviewReason(input: {
  tx: Pick<Transaction, 'description' | 'payee' | 'date' | 'totalAmountCents' | 'lines'>;
  rules: readonly AutoRule[];
  accounts: readonly ChartAccount[];
  calibration?: Pick<CalibratedAutoPostDecision, 'sampleSize' | 'unchangedCount' | 'suggestedAccountId'>;
}): ReviewReason {
  const { tx, rules, accounts, calibration } = input;
  const live = (id?: string | null) => (id ? accounts.find(a => a.id === id && !a.isArchived && !a.archived) : undefined);

  const ruled = rules.length
    ? suggestFromRules([...rules], { description: tx.description || '', payee: tx.payee, amountCents: tx.totalAmountCents || 0, date: tx.date }, { accounts: [...accounts] })
    : null;
  const ruleAccount = live(ruled?.accountId);
  if (ruled && ruleAccount) {
    const rule = rules.find(r => r.id === ruled.ruleIds[0]);
    const name = rule?.name || rule?.condition.vendor || rule?.condition.descriptionContains || 'a rule';
    // a rule named after its decision ("Shell → Fuel", EU-C3) already says where it goes
    return { kind: 'rule', accountId: ruleAccount.id, accountName: ruleAccount.name, text: name.includes('→') ? `rule: ${name}` : `rule: ${name} → ${ruleAccount.name}` };
  }

  const historyAccount = live(calibration?.suggestedAccountId);
  if (calibration && historyAccount && calibration.sampleSize >= 2 && calibration.unchangedCount === calibration.sampleSize) {
    return { kind: 'history', accountId: historyAccount.id, accountName: historyAccount.name, text: `same as the last ${calibration.sampleSize} times → ${historyAccount.name}` };
  }

  const onLine = lineAccount(tx, accounts);
  if (onLine && !onLine.isArchived && !onLine.archived) {
    return { kind: 'guess', accountId: onLine.id, accountName: onLine.name, text: `guess → ${onLine.name}` };
  }
  return { kind: 'none', text: 'no rule or history yet' };
}
