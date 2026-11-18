/**
 * The Ledger Health Check figures ("are my books right?"): one place that reads the loaded
 * transactions and bank lines and says, check by check, whether they pass. The modal runs the
 * same function for its first scan and for "Run Again", so the two can never drift apart.
 */
import type { BankStatementLine, Transaction } from '../types';
import { isPostable, lineAmount } from './txFilters';

export type HealthCheckStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheckResult {
  id: string;
  title: string;
  status: HealthCheckStatus;
  message: string;
}

export interface HealthCheckReport {
  results: HealthCheckResult[];
  score: number;
  pending: number;
}

export function buildHealthCheckReport(
  transactions: Transaction[],
  bankLines: BankStatementLine[],
): HealthCheckReport {
  let trialBalanceNet = 0;
  transactions.filter(isPostable).forEach(t => {
    t.lines?.forEach(l => { trialBalanceNet += lineAmount(l, t); });
  });

  const uncategorized = transactions.filter(t =>
    t.lines.some(l => !l.accountId || l.accountId === 'uncategorized')
  ).length;

  const pending = transactions.filter(t => t.status === 'draft' || t.status === 'pending').length;
  const anomalies = transactions.filter(t => t.isFlagged).length;
  const unreconciled = bankLines.filter(l => !l.matchedTransactionId).length;
  const balanced = Math.abs(trialBalanceNet) === 0;

  const results: HealthCheckResult[] = [
    {
      id: 'trial-balance',
      title: 'Trial Balance',
      status: balanced ? 'pass' : 'fail',
      message: balanced
        ? 'Your books are perfectly balanced. Debits equal credits.'
        : 'Your books are out of balance! A journal entry is missing a matching side.'
    },
    {
      id: 'uncategorized',
      title: 'Categorization',
      status: uncategorized === 0 ? 'pass' : (uncategorized > 10 ? 'fail' : 'warn'),
      message: uncategorized === 0
        ? 'All transactions have been categorized.'
        : `You have ${uncategorized} uncategorized transactions waiting in your inbox.`
    },
    {
      id: 'reconciliation',
      title: 'Bank Reconciliation',
      status: unreconciled === 0 ? 'pass' : 'warn',
      message: unreconciled === 0
        ? 'All bank lines are matched to ledger entries.'
        : `${unreconciled} bank lines are still waiting to be matched.`
    },
    {
      id: 'anomalies',
      title: 'Anomaly Detection',
      status: anomalies === 0 ? 'pass' : 'fail',
      message: anomalies === 0
        ? 'No suspicious patterns detected.'
        : `${anomalies} transactions were flagged for review due to unusual patterns.`
    }
  ];

  const score = Math.round((results.filter(r => r.status === 'pass').length / results.length) * 100);
  return { results, score, pending };
}
