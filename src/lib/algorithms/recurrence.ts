import { Transaction } from '../../types';
import { AlgorithmDefinition } from './types';
import { parseLocalDate } from '../calendarDate';
import { isPostable } from '../../lib/txFilters';

export function detectRecurrences(transactions: readonly Transaction[], minOccurrences = 2) {
    // 1. Group by entity/vendor (using description or simple hash)
    const groups: Record<string, Transaction[]> = {};
    transactions.forEach(t => {
        if (!isPostable(t)) return;
        // Simple normalization
        const vendor = t.description?.toLowerCase().replace(/[^a-z]/g, '').substring(0, 15) || 'unknown';
        if (!groups[vendor]) groups[vendor] = [];
        groups[vendor].push(t);
    });

    const recurrences = [];

    // 2. Analyze each group
    for (const [vendor, txs] of Object.entries(groups)) {
        if (txs.length < minOccurrences) continue; // Respect minOccurrences parameter
        
        // Sort by date
        txs.sort((a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime());
        
        // Calculate intervals in days
        const intervals = [];
        const amounts = [];
        for (let i = 1; i < txs.length; i++) {
            const diffTime = Math.abs(parseLocalDate(txs[i].date).getTime() - parseLocalDate(txs[i-1].date).getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            intervals.push(diffDays);
            amounts.push(Math.abs(txs[i].totalAmountCents));
        }
        amounts.push(Math.abs(txs[0].totalAmountCents)); // Include first amount too

        // Calculate Median
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        
        amounts.sort((a, b) => a - b);
        const medianAmount = amounts[Math.floor(amounts.length / 2)];

        // Calculate MAD (Median Absolute Deviation) for interval
        const intervalDeviations = intervals.map(i => Math.abs(i - medianInterval));
        intervalDeviations.sort((a, b) => a - b);
        const madInterval = intervalDeviations[Math.floor(intervalDeviations.length / 2)];

        // Calculate MAD for amounts
        const amountDeviations = amounts.map(a => Math.abs(a - medianAmount));
        amountDeviations.sort((a, b) => a - b);
        const madAmount = amountDeviations[Math.floor(amountDeviations.length / 2)];

        // Is it recurring?
        // Robust to 1 late payment: if MAD is very small, it's a tight pattern
        const isRecurringTime = madInterval <= 3; // allow 3 days variance for weekends etc
        const isRecurringAmount = madAmount <= medianAmount * 0.1; // allow 10% variance

        if (isRecurringTime && medianInterval > 0) {
            recurrences.push({
                vendor,
                medianInterval,
                medianAmount,
                confidence: isRecurringAmount ? 'High' : 'Medium',
                lastDate: txs[txs.length - 1].date,
                txCount: txs.length
            });
        }
    }

    return recurrences.sort((a,b) => b.medianAmount - a.medianAmount);
}

export const RECURRENCE_DETECTION: AlgorithmDefinition = {
  id: 'recurrence_detection',
  domain: 'planning',
  name: 'Discrete Event Recurrence Engine',
  description: 'Uses Median Absolute Deviation (MAD) to detect recurring discrete cash flow events without relying on continuous smoothing models.',
  inputs: [
    { key: 'minOccurrences', label: 'Min Occurrences', min: 2, max: 10, step: 1, defaultValue: 3 }
  ],
  compute: (ctx, inputs: { "minOccurrences": number; [key: string]: unknown }) => {
    const { transactions } = ctx;
    // We will use the live transactions
    const start = performance.now();
    const minOcc = inputs['minOccurrences'] ?? 3;
    const recurrences = detectRecurrences(transactions, minOcc);
    const filtered = recurrences.filter(r => r.txCount >= minOcc);
    const ms = performance.now() - start;
    
    // Calculate total monthly impact
    let monthlyImpact = 0;
    filtered.forEach(r => {
        if (r.medianInterval >= 25 && r.medianInterval <= 35) { // roughly monthly
            monthlyImpact += r.medianAmount;
        } else if (r.medianInterval >= 10 && r.medianInterval <= 16) { // biweekly
            monthlyImpact += r.medianAmount * 2;
        } else if (r.medianInterval >= 6 && r.medianInterval <= 8) { // weekly
            monthlyImpact += r.medianAmount * 4.3;
        } else if (r.medianInterval > 350 && r.medianInterval < 380) { // yearly
             monthlyImpact += r.medianAmount / 12;
        }
    });

    return {
      metrics: [
        { label: 'Active Subscriptions', value: filtered.length },
        { label: 'Estimated Mo. Run Rate', value: `$${(monthlyImpact/100).toFixed(2)}` },
        { label: 'Execution Time', value: `${ms.toFixed(2)} ms` }
      ],
      charts: [
         {
             data: filtered.slice(0, 10).map(r => ({
                 name: r.vendor, 
                 amount: r.medianAmount / 100, 
                 interval: r.medianInterval
             })),
             config: {
                 xKey: 'name',
                 yKeys: [
                     { key: 'amount', color: '#6366f1', name: 'Median Amount', type: 'bar' },
                     { key: 'interval', color: '#10b981', name: 'Interval (Days)', type: 'line' }
                 ]
             }
         }
      ],
      insights: [
        `Detected ${filtered.length} distinct recurring patterns using MAD robust statistics.`,
        'Median Absolute Deviation is immune to single outliers (like a late rent payment) unlike mean/variance.',
        'This discrete detection feeds upcoming bill alerts, cash forecasts, and missed-event alarms.'
      ]
    };
  }
};
