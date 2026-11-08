import { Transaction } from '../../types';
import { AlgorithmDefinition } from './types';
import { byCodeUnit } from '../codeUnitOrder';

// A Fenwick Tree (Binary Indexed Tree) for O(log n) prefix sums
// Allows instant "Balance as of Date" queries even with out-of-order amendments
export class FenwickTree {
    private tree: number[];
    private size: number;

    constructor(size: number) {
        this.size = size;
        this.tree = new Array(size + 1).fill(0);
    }

    // Add value to index i (1-based index)
    add(i: number, delta: number) {
        const intDelta = Math.round(delta);
        while (i <= this.size) {
            this.tree[i] += intDelta;
            i += i & (-i);
        }
    }

    // Get sum from 1 to i
    query(i: number): number {
        let sum = 0;
        while (i > 0) {
            sum += this.tree[i];
            i -= i & (-i);
        }
        return sum;
    }
}

export function buildTimeTravelLedger(transactions: readonly Transaction[], targetAccountId?: string) {
    // 0. Chronologically sort transactions to prevent out-of-order corruption
    const sortedTxs = [...transactions].sort((a, b) => {
        if (a.date > b.date) return 1;
        if (a.date < b.date) return -1;
        const aTime = a.createdAt || '';
        const bTime = b.createdAt || '';
        if (aTime > bTime) return 1;
        if (aTime < bTime) return -1;
        return 0;
    });

    // 1. Map dates to 1-based indices (compress the timeline)
    const dates = new Set<string>();
    sortedTxs.forEach(t => dates.add(t.date));
    const sortedDates = Array.from(dates).sort(byCodeUnit);
    
    const dateToIndex = new Map<string, number>();
    sortedDates.forEach((d, i) => dateToIndex.set(d, i + 1));

    const tree = new FenwickTree(sortedDates.length);

    // 2. Populate tree
    sortedTxs.forEach(t => {
        const idx = dateToIndex.get(t.date)!;
        let delta = 0;
        
        if (targetAccountId) {
            // Filter to specific account
            t.lines?.forEach(l => {
                if (l.accountId === targetAccountId || l.accountName === targetAccountId) {
                    delta += l.amountCents;
                }
            });
        } else {
            // Net cashflow for the day
            delta += t.totalAmountCents;
        }

        if (delta !== 0) {
            tree.add(idx, delta);
        }
    });

    return { tree, sortedDates, dateToIndex };
}

export const FENWICK_TIME_TRAVEL_ALGO: AlgorithmDefinition = {
  id: 'fenwick_time_travel',
  domain: 'system',
  name: 'O(log n) Time Travel Ledger (Fenwick Tree)',
  description: 'Uses a Binary Indexed Tree to compute "Balance As Of Date" in logarithmic time, enabling instant timeline scrubbing and Git-style branches.',
  inputs: [
    { key: 'targetDayIndex', label: 'Timeline Scrub (Days from Start)', min: 1, max: 365, step: 1, defaultValue: 90 }
  ],
  compute: (ctx, inputs: { "targetDayIndex": number; [key: string]: unknown }) => {
    const { transactions } = ctx;
    const start = performance.now();
    
    // Build tree
    const { tree, sortedDates } = buildTimeTravelLedger(transactions);
    
    // Query
    const maxIdx = sortedDates.length;
    const targetDayIndex = typeof inputs?.targetDayIndex === 'number' ? inputs.targetDayIndex : Math.max(1, Math.floor(maxIdx / 2));
    const queryIdx = maxIdx > 0 ? Math.min(Math.max(1, targetDayIndex), maxIdx) : 0;
    
    const balanceAsOf = maxIdx > 0 ? tree.query(queryIdx) : 0;
    
    const ms = performance.now() - start;

    // Generate chart data: sample every 10th day to show prefix sum curve
    const chartData = [];
    for (let i = 1; i <= maxIdx; i += Math.ceil(maxIdx / 20) || 1) {
        chartData.push({
            day: i,
            date: sortedDates[i-1],
            balance: tree.query(i) / 100
        });
    }

    return {
      metrics: [
        { label: 'Execution Time', value: `${ms.toFixed(2)} ms` },
        { label: 'Timeline Span', value: `${sortedDates.length} days` },
        { label: `Balance on Day ${queryIdx}`, value: `$${(balanceAsOf/100).toFixed(2)}`, color: 'text-indigo-400' }
      ],
      charts: [
         {
             data: chartData,
             config: {
                 xKey: 'date',
                 yKeys: [
                     { key: 'balance', color: '#8b5cf6', name: 'Cumulative Balance', type: 'line' }
                 ]
             }
         }
      ],
      insights: [
        `Constructed Binary Indexed Tree over ${sortedDates.length} distinct days.`,
        'Queries take O(log n) time. A query over 10,000 days touches at most 14 nodes.',
        'Updates (like an out-of-order amendment) also take O(log n) time, avoiding full recalculations.',
        'This provides the mathematical engine for the "Git-for-Books" Time Machine.'
      ]
    };
  }
};
