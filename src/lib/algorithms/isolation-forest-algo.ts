import type { AlgoResultRow } from './types';
import { AlgorithmDefinition } from './types';
import { IsolationForest } from '../algorithms';
import { formatCurrency } from '../utils';

function hashCategory(cat: string): number {
  let hash = 0;
  for (let i = 0; i < cat.length; i++) {
    hash = (hash << 5) - hash + cat.charCodeAt(i);
    hash |= 0; // NOSONAR: S7767 — intentional 32-bit wrap for hash/PRNG state; Math.trunc would break modular arithmetic
  }
  return Math.abs(hash % 1000) / 1000;
}

export const ISOLATION_FOREST_ALGO: AlgorithmDefinition = {
  id: 'forensics_isolation_forest',
  name: 'Isolation Forest Anomaly Isolation',
  domain: 'forensics',
  tags: ['isolation-forest', 'anomaly', 'unsupervised', 'fraud', 'outliers'],
  description: 'Unsupervised multi-dimensional Isolation Forest algorithm. Projects amountCents and line item dimension coordinates into random decision trees to isolate anomalous transactions.',
  inputs: [
    { key: 'trees', label: 'Number of Decision Trees', min: 10, max: 200, step: 10, defaultValue: 100 },
    { key: 'threshold', label: 'Anomaly Contamination Threshold', min: 0.5, max: 0.95, step: 0.05, defaultValue: 0.65 }
  ],
  compute: (ctx, inputs: { "trees": number; "threshold": number; [key: string]: unknown }) => {
    const { transactions, accounts } = ctx;
    const numTrees = inputs['trees'] ?? 100;
    const threshold = inputs['threshold'] ?? 0.65;

    if (!transactions || transactions.length === 0) {
      return {
        metrics: [
          { label: 'Anomalies Identified', value: 0, color: 'text-emerald-500' },
          { label: 'Isolation Score Avg', value: '0.00', color: 'text-slate-500' }
        ],
        charts: [],
        insights: ['No transactions present in current period to analyze.'],
        rows: []
      };
    }

    // Convert transactions to feature vectors: [amountCents, categoryHash, lineCount]
    const points: number[][] = transactions.map(tx => {
      const amount = Math.abs(tx.totalAmountCents || 0);
      const firstLineAccId = tx.lines?.[0]?.accountId || '';
      const acc = accounts.find(a => a.id === firstLineAccId);
      const catHash = hashCategory(acc?.category || acc?.type || 'Uncategorized');
      const lineCount = tx.lines?.length || 1;
      return [amount, catHash * 100000, lineCount * 10000];
    });

    const scores = IsolationForest.score(points, numTrees);

    const flagged: AlgoResultRow[] = [];
    const sourceTransactionIds: string[] = [];
    let totalScore = 0;

    transactions.forEach((tx, i) => {
      const score = scores[i] ?? 0;
      totalScore += score;
      if (score >= threshold) {
        sourceTransactionIds.push(tx.id);
        const firstLineAccId = tx.lines?.[0]?.accountId || '';
        const acc = accounts.find(a => a.id === firstLineAccId);
        flagged.push({
          id: tx.id,
          date: tx.date,
          description: tx.description || 'Transaction',
          account: acc?.name || 'General Ledger',
          amount: formatCurrency(tx.totalAmountCents),
          isolationScore: score.toFixed(3),
          reason: score >= 0.8 ? 'Severe Structural Anomaly' : 'Moderate Dimension Deviation'
        });
      }
    });

    const avgScore = points.length > 0 ? (totalScore / points.length) : 0;

    // Distribution chart
    const scoreBins: Record<string, number> = {
      '0.0 - 0.4': 0,
      '0.4 - 0.6': 0,
      '0.6 - 0.8': 0,
      '0.8 - 1.0': 0
    };

    scores.forEach(s => {
      if (s < 0.4) scoreBins['0.0 - 0.4']++;
      else if (s < 0.6) scoreBins['0.4 - 0.6']++;
      else if (s < 0.8) scoreBins['0.6 - 0.8']++;
      else scoreBins['0.8 - 1.0']++;
    });

    const chartData = Object.entries(scoreBins).map(([range, count]) => ({ range, count }));

    return {
      metrics: [
        { label: 'Anomalies Identified', value: flagged.length, color: flagged.length > 0 ? 'text-amber-500' : 'text-emerald-500' },
        { label: 'Avg Isolation Path Score', value: Number(avgScore.toFixed(3)), color: 'text-indigo-500' }
      ],
      charts: [
        {
          data: chartData,
          config: {
            xKey: 'range',
            yKeys: [{ key: 'count', color: '#6366f1', name: 'Transactions Count', type: 'bar' }]
          }
        }
      ],
      insights: [
        flagged.length > 0
          ? `Isolation Forest flagged ${flagged.length} transaction(s) exceeding contamination threshold ${threshold}.`
          : `No structural anomalies detected across ${transactions.length} transactions in current scope.`
      ],
      rows: flagged,
      sourceTransactionIds
    };
  }
};
