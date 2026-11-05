import { AlgorithmDefinition, AlgoResult } from './types';
import { parseLocalDate } from '../../lib/utils';
import { isOutflow } from '../txFilters';

export const EXPENSE_POLICY_ALGO: AlgorithmDefinition = {
  id: 'forensics_policy',
  name: 'Policy Violator (Weekend & Round Numbers)',
  domain: 'forensics',
  tags: ['Audit', 'Compliance', 'Risk', 'T&E'],
  description: 'Flags suspicious expenses that occur on weekends or are perfectly round numbers, which often indicate unapproved out-of-policy spending or artificial entries.',
  inputs: [
    {
      key: 'minRoundAmount',
      label: 'Min Round Amount ($)',
      min: 10,
      max: 1000,
      step: 10,
      defaultValue: 100
    }
  ],
  compute: (ctx, inputs: { "minRoundAmount": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts } = ctx;
    const minRoundAmount = (inputs['minRoundAmount'] ?? 100) * 100; // in cents
    
    let weekendCount = 0;
    let roundNumberCount = 0;
    let totalRiskAmount = 0;
    
    const riskByDay: Record<string, number> = {
      'Monday': 0, 'Tuesday': 0, 'Wednesday': 0, 'Thursday': 0, 'Friday': 0, 'Saturday': 0, 'Sunday': 0
    };
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    transactions.forEach(tx => {
      // Look at expense/liability accounts or general spending
      if (!isOutflow(tx, accounts as unknown as import("../../types").ChartAccount[] | Map<string, import("../../types").ChartAccount> | undefined)) return;
      
      const absAmount = Math.abs(tx.totalAmountCents);
      if (absAmount < 500) return; // Skip tiny transactions
      
      let isRisk = false;
      const dateObj = parseLocalDate(tx.date);
      const dayName = daysOfWeek[dateObj.getDay()];
      
      // Check Weekend
      if (dayName === 'Saturday' || dayName === 'Sunday') {
        weekendCount++;
        isRisk = true;
      }
      
      // Check Round Number (e.g., $100.00, $500.00)
      if (absAmount >= minRoundAmount && absAmount % 10000 === 0) { // Divisible by $100.00
        roundNumberCount++;
        isRisk = true;
      }
      
      if (isRisk) {
        totalRiskAmount += absAmount;
        riskByDay[dayName] += (absAmount / 100);
      }
    });
    
    const chartData = Object.keys(riskByDay).map(day => ({
      Day: day.substring(0, 3), // Mon, Tue
      'Risk Volume': Number.parseFloat(riskByDay[day].toFixed(2))
    }));
    
    const insights = [];
    if (weekendCount === 0 && roundNumberCount === 0) {
      insights.push('No significant policy violations detected. Expenses appear natural and within standard operating days.');
    } else {
      insights.push(`Detected ${weekendCount} transactions occurring on weekends.`);
      insights.push(`Detected ${roundNumberCount} round-number transactions (multiples of $100) over the threshold.`);
      insights.push(`Total potential out-of-policy spending at risk: $${(totalRiskAmount / 100).toLocaleString()}`);
    }

    return {
      metrics: [
        { label: 'Weekend Tx', value: weekendCount, color: weekendCount > 0 ? 'text-amber-500' : 'text-slate-500' },
        { label: 'Round Number Tx', value: roundNumberCount, color: roundNumberCount > 0 ? 'text-amber-500' : 'text-slate-500' },
        { label: 'At-Risk Volume', value: `$${(totalRiskAmount / 100).toLocaleString()}`, color: totalRiskAmount > 0 ? 'text-rose-500' : 'text-slate-500' }
      ],
      charts: [
        {
          config: {
            xKey: 'Day',
            yKeys: [
              { key: 'Risk Volume', name: 'Anomalous Volume ($)', color: '#f59e0b', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights
    };
  }
};
