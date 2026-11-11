import { AlgorithmDefinition, AlgoResult } from './types';
import { Transaction } from '../../types';
import { parseLocalDate } from '../calendarDate';

export const DUPLICATE_DETECTION_ALGO: AlgorithmDefinition = {
  id: 'forensics_duplicates',
  name: 'Duplicate Payment Detector',
  domain: 'forensics',
  tags: ['Audit', 'Reconciliation', 'AP', 'Risk'],
  description: 'Scans the ledger for exact and near-exact duplicate payments by analyzing temporal proximity, exact amount matching, and fuzzy vendor name matching.',
  inputs: [
    {
      key: 'timeWindowDays',
      label: 'Proximity Window (Days)',
      min: 0,
      max: 30,
      step: 1,
      defaultValue: 3
    }
  ],
  compute: (ctx, inputs: { "timeWindowDays": number; [key: string]: unknown }): AlgoResult => {
    const { transactions } = ctx;
    const timeWindowDays = inputs['timeWindowDays'] ?? 3;
    const windowMs = timeWindowDays * 24 * 60 * 60 * 1000;
    
    // 1. Group by exact amount to limit search space
    const amountGroups: Record<number, Transaction[]> = {};
    
    transactions.forEach(tx => {
      // Ignore very small transactions which are prone to false positives (e.g., $1.00 fees)
      if (Math.abs(tx.totalAmountCents) < 500) return; 
      
      const amt = tx.totalAmountCents;
      if (!amountGroups[amt]) amountGroups[amt] = [];
      amountGroups[amt].push(tx);
    });
    
    // 2. Scan within groups for proximity and description similarity
    const exactDuplicates: Array<[Transaction, Transaction]> = [];
    const suspectedDuplicates: Array<[Transaction, Transaction]> = [];
    let totalRiskAmount = 0;
    
    Object.values(amountGroups).forEach(group => {
      if (group.length < 2) return;
      
      // Sort by date to make temporal proximity check easier
      // (each date parsed once: parsing in the comparator and the pair loop made a year of entries take seconds)
      const times = new Map(group.map(t => [t, parseLocalDate(t.date).getTime()]));
      const timeOf = (t: Transaction) => times.get(t) ?? 0;
      group.sort((a, b) => timeOf(a) - timeOf(b));
      
      for (let i = 0; i < group.length - 1; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const t1 = group[i];
          const t2 = group[j];
          
          const t1Date = timeOf(t1);
          const t2Date = timeOf(t2);
          
          // Since it's sorted, if time difference is > window, break inner loop
          if (t2Date - t1Date > windowMs) break;
          
          const desc1 = (t1.description || '').toLowerCase();
          const desc2 = (t2.description || '').toLowerCase();
          
          if (desc1 === desc2) {
            exactDuplicates.push([t1, t2]);
            totalRiskAmount += Math.abs(t1.totalAmountCents);
          } else {
            // Very basic fuzzy check: One contains the other, or high word overlap
            const words1 = new Set(desc1.split(/[\s-]+/));
            const words2 = new Set(desc2.split(/[\s-]+/));
            
            const intersection = new Set([...words1].filter(x => words2.has(x)));
            if (intersection.size >= Math.min(words1.size, words2.size) * 0.5) {
              suspectedDuplicates.push([t1, t2]);
              totalRiskAmount += Math.abs(t1.totalAmountCents);
            }
          }
        }
      }
    });
    
    const insights = [];
    if (exactDuplicates.length === 0 && suspectedDuplicates.length === 0) {
      insights.push('No suspicious duplicate transactions detected within the specified parameters.');
    } else {
      if (exactDuplicates.length > 0) {
        insights.push(`Found ${exactDuplicates.length} EXACT duplicates (same amount, identical description, within ${timeWindowDays} days).`);
      }
      if (suspectedDuplicates.length > 0) {
        insights.push(`Found ${suspectedDuplicates.length} SUSPECTED duplicates (same amount, similar description, within ${timeWindowDays} days).`);
      }
      
      insights.push(`Total potential capital at risk from double-payments: $${(totalRiskAmount / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    }

    // Prepare chart data (Distribution of duplicate sizes)
    const riskRanges = {
      'Micro (<$50)': 0,
      'Small ($50-$500)': 0,
      'Medium ($500-$5k)': 0,
      'Large (>$5k)': 0
    };
    
    [...exactDuplicates, ...suspectedDuplicates].forEach(([t1]) => {
      const amt = Math.abs(t1.totalAmountCents) / 100;
      if (amt < 50) riskRanges['Micro (<$50)']++;
      else if (amt < 500) riskRanges['Small ($50-$500)']++;
      else if (amt < 5000) riskRanges['Medium ($500-$5k)']++;
      else riskRanges['Large (>$5k)']++;
    });

    const chartData = Object.keys(riskRanges).map(k => ({
      Range: k,
      Count: riskRanges[k as keyof typeof riskRanges]
    }));

    const rows = [
      ...exactDuplicates.map(([t1, t2]) => ({
        id: `${t1.id}_${t2.id}`,
        type: 'Exact',
        date1: t1.date,
        date2: t2.date,
        amount: `$${(Math.abs(t1.totalAmountCents) / 100).toFixed(2)}`,
        description1: t1.description,
        description2: t2.description,
        sourceIds: [t1.id, t2.id]
      })),
      ...suspectedDuplicates.map(([t1, t2]) => ({
        id: `${t1.id}_${t2.id}`,
        type: 'Suspected',
        date1: t1.date,
        date2: t2.date,
        amount: `$${(Math.abs(t1.totalAmountCents) / 100).toFixed(2)}`,
        description1: t1.description,
        description2: t2.description,
        sourceIds: [t1.id, t2.id]
      }))
    ];

    const sourceTransactionIds = Array.from(
      new Set([...exactDuplicates, ...suspectedDuplicates].flatMap(([t1, t2]) => [t1.id, t2.id]))
    );

    return {
      metrics: [
        { label: 'Exact Duplicates', value: exactDuplicates.length, color: exactDuplicates.length > 0 ? 'text-rose-500' : 'text-slate-500' },
        { label: 'Suspected', value: suspectedDuplicates.length, color: suspectedDuplicates.length > 0 ? 'text-amber-500' : 'text-slate-500' },
        { label: 'Capital at Risk', value: `$${(totalRiskAmount / 100).toLocaleString()}`, color: totalRiskAmount > 0 ? 'text-rose-500' : 'text-slate-500' }
      ],
      charts: [
        {
          config: {
            xKey: 'Range',
            yKeys: [
              { key: 'Count', name: 'Duplicate Count', color: '#f43f5e', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights,
      rows,
      sourceTransactionIds
    };
  }
};
