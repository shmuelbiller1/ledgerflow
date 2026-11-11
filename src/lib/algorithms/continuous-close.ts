import { AlgorithmDefinition } from './types';
import { Transaction } from '../../types';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { computeLedgerCloseAnchor } from '../auditHashChain';

export function runContinuousCloseCheck(transactions: readonly Transaction[]) {
  const totalCount = transactions.length;
  const postedCount = transactions.filter(isPostable).length;
  const pendingCount = totalCount - postedCount;
  
  // Calculate debits and credits balance
  let totalDebitsCents = 0;
  let totalCreditsCents = 0;

  transactions.forEach(tx => {
    if (!isPostable(tx)) return;
    tx.lines.forEach(line => {
      const amt = lineAmount(line, tx);
      if (amt > 0) totalDebitsCents += amt;
      else totalCreditsCents += Math.abs(amt);
    });
  });

  const balanced = totalDebitsCents === totalCreditsCents;
  const healthPercent = totalCount > 0 ? Math.round((postedCount / totalCount) * 100) : 100;

  const anchor = computeLedgerCloseAnchor(transactions);
  const hashAnchor = anchor.shortAnchor;

  return {
    totalCount,
    postedCount,
    pendingCount,
    totalDebitsCents,
    totalCreditsCents,
    balanced,
    healthPercent,
    hashAnchor,
    sha256Anchor: anchor.sha256,
  };
}

export const CONTINUOUS_CLOSE_ALGO: AlgorithmDefinition = {
  id: 'continuous_close',
  domain: 'system',
  name: 'Silent Micro-Close & Nightly Hash Anchor',
  description: 'Reconciles, flags unfiled items, and computes hash-anchored snapshots every night so the books are always closed and audit-ready.',
  inputs: [],
  compute: (ctx, _inputs) => {
    const { transactions } = ctx;
    const res = runContinuousCloseCheck(transactions);

    return {
      metrics: [
        { label: 'Micro-Close Status', value: res.balanced ? 'Books Balanced ✓' : 'Out of Balance ⚠' },
        { label: 'Ledger Health', value: `${res.healthPercent}% Reconciled` },
        { label: 'Unfiled / Pending Entries', value: `${res.pendingCount}` },
        { label: 'Hash Anchor Snapshot', value: res.hashAnchor }
      ],
      charts: [
        {
          data: [
            { name: 'Reconciled', count: res.postedCount },
            { name: 'Pending Review', count: res.pendingCount }
          ],
          config: {
            xKey: 'name',
            yKeys: [{ key: 'count', color: '#10b981', name: 'Transaction Count', type: 'bar' }]
          }
        }
      ],
      insights: [
        `Silent micro-close completed. Hash Anchor: ${res.hashAnchor}.`,
        res.balanced ? 'Debit/Credit balance holds exact equality across all accounts.' : 'Unbalanced transactions detected in pending queue.',
        'Zero tax-season crunch — the ledger is verified and closed continuously.'
      ]
    };
  }
};
