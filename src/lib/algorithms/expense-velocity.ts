import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, lineAmount } from '../txFilters';
import { calendarDateISO, parseLocalDate } from '../utils';

export const EXPENSE_VELOCITY_ALGO: AlgorithmDefinition = {
  id: 'ops_velocity',
  name: 'Expense Velocity (Spike Detector)',
  domain: 'operations',
  tags: ['Cash', 'Spikes', 'Operations', 'Monitoring'],
  description: 'Calculates the trailing moving average of true operational expenses to detect sudden spikes in outflow velocity before the end-of-month reporting cycle.',
  inputs: [
    {
      key: 'spikeThresholdPct',
      label: 'Spike Alert Threshold (%)',
      min: 10,
      max: 300,
      step: 10,
      defaultValue: 50
    },
    {
      key: 'movingAverageDays',
      label: 'Moving Avg (Days)',
      min: 3,
      max: 30,
      step: 1,
      defaultValue: 7
    }
  ],
  compute: (ctx, inputs: { "spikeThresholdPct": number; "movingAverageDays": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts, accounting } = ctx;
    const threshold = (inputs['spikeThresholdPct'] ?? 50) / 100;
    const windowDays = Math.max(1, inputs['movingAverageDays'] ?? 7);
    
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    const dailyExpenses: Record<string, number> = {};
    const dailyTxIds: Record<string, string[]> = {};
    const sourceTransactionIds = new Set<string>();

    transactions.forEach(tx => {
      if (!isPostable(tx)) return;
      if (!tx.date) return;
      
      const dateKey = tx.date.substring(0, 10);
      let txExpenseCents = 0;

      if (Array.isArray(tx.lines) && tx.lines.length > 0) {
        tx.lines.forEach(l => {
          const acc = accountMap.get(l.accountId);
          const isExp = acc ? (accounting.isExpense(acc.id) || accounting.isCOGS(acc.id)) : false;
          if (isExp) {
            const amt = lineAmount(l, tx);
            if (amt > 0) txExpenseCents += amt; // Debits to expense accounts are positive
          }
        });
      }

      // If no dedicated expense accounts identified, fallback to explicit expense transaction types
      if (txExpenseCents === 0 && (tx.type === 'expense' || (tx.type as string) === 'cost_of_goods')) {
        txExpenseCents = Math.abs(tx.totalAmountCents || 0);
      }

      if (txExpenseCents > 0) {
        if (!dailyExpenses[dateKey]) {
          dailyExpenses[dateKey] = 0;
          dailyTxIds[dateKey] = [];
        }
        dailyExpenses[dateKey] += txExpenseCents;
        dailyTxIds[dateKey].push(tx.id);
        sourceTransactionIds.add(tx.id);
      }
    });
    
    // Sort dates
    const rawDates = Object.keys(dailyExpenses).sort();
    if (rawDates.length < 2) {
       return {
          metrics: [
            { label: 'Recent Spikes', value: 0, color: 'text-slate-500' },
            { label: 'Status', value: 'Insufficient Data' }
          ],
          charts: [],
          insights: ['Not enough expense transaction history to establish a baseline moving average.']
       };
    }

    // Build contiguous calendar days from min date to max date
    const startDate = parseLocalDate(rawDates[0]);
    const endDate = parseLocalDate(rawDates[rawDates.length - 1]);
    const contiguousDates: string[] = [];
    
    const curr = new Date(startDate);
    while (curr <= endDate) {
      contiguousDates.push(calendarDateISO(curr));
      curr.setDate(curr.getDate() + 1);
    }
    
    if (contiguousDates.length < windowDays) {
      return {
        metrics: [],
        charts: [],
        insights: ['Date range is shorter than the configured moving average window.']
      };
    }

    // Calculate moving average and spikes
    const chartData = [];
    let recentSpikes = 0;
    let maxVelocity = 0;
    let currentVelocity = 0;
    const spikedTxIds: string[] = [];

    // Start from the window end
    for (let i = windowDays; i < contiguousDates.length; i++) {
      const targetDate = contiguousDates[i];
      const targetVolume = dailyExpenses[targetDate] || 0;
      
      // Calculate average of previous `windowDays` (strictly previous days)
      let sum = 0;
      for (let j = 1; j <= windowDays; j++) {
        sum += dailyExpenses[contiguousDates[i - j]] || 0;
      }
      const movingAvg = sum / windowDays;
      
      const velocityRatio = movingAvg > 0 ? (targetVolume - movingAvg) / movingAvg : (targetVolume > 0 ? 1 : 0);
      
      if (velocityRatio > threshold && targetVolume > 0) {
        recentSpikes++;
        if (dailyTxIds[targetDate]) {
          spikedTxIds.push(...dailyTxIds[targetDate]);
        }
      }
      
      if (targetVolume > maxVelocity) {
        maxVelocity = targetVolume;
      }
      
      currentVelocity = targetVolume;
      
      chartData.push({
        Date: targetDate.substring(5), // MM-DD
        'Daily Volume': Number.parseFloat((targetVolume / 100).toFixed(2)),
        'Avg': Number.parseFloat((movingAvg / 100).toFixed(2))
      });
    }
    
    const insights = [];
    insights.push(`Analyzed daily operational expense velocity across ${contiguousDates.length} calendar days.`);
    if (recentSpikes > 0) {
      insights.push(`Detected ${recentSpikes} day(s) where expense outflow spiked more than ${inputs['spikeThresholdPct'] ?? 50}% above the trailing ${windowDays}-day moving average.`);
    } else {
      insights.push(`Expense velocity is within normal bounds. No anomalous spikes detected above the ${inputs['spikeThresholdPct'] ?? 50}% threshold.`);
    }

    return {
      metrics: [
        { label: 'Recent Spikes', value: recentSpikes, color: recentSpikes > 0 ? 'text-amber-500' : 'text-slate-500' },
        { label: 'Max Daily Velocity', value: `$${(maxVelocity / 100).toLocaleString()}` },
        { label: 'Latest Daily Velocity', value: `$${(currentVelocity / 100).toLocaleString()}` }
      ],
      charts: [
        {
          config: {
            xKey: 'Date',
            yKeys: [
              { key: 'Daily Volume', name: 'Actual Daily Expenses ($)', color: '#94a3b8', type: 'bar' },
              { key: 'Avg', name: `${windowDays}-Day Trailing Avg ($)`, color: '#6366f1', type: 'line' }
            ]
          },
          data: chartData
        }
      ],
      insights,
      sourceTransactionIds: spikedTxIds.length > 0 ? spikedTxIds : Array.from(sourceTransactionIds)
    };
  }
};
