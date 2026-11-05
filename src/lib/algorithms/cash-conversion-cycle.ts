import { AlgorithmDefinition, AlgoResult } from './types';
import { openingDebitCents } from '../accountUtils';
import { isPostable, lineAmount } from '../../lib/txFilters';

export const CASH_CONVERSION_CYCLE_ALGO: AlgorithmDefinition = {
  id: 'ops_1',
  name: 'Cash Conversion Cycle (CCC)',
  domain: 'operations',
  tags: ['Working Capital', 'Efficiency', 'Inventory', 'Receivables', 'Payables'],
  description: 'Calculates the days it takes to convert resource inputs into cash flows (DIO + DSO - DPO). Lower is better.',
  inputs: [
    { key: 'annualizationDays', label: 'Annualization Factor (Days)', min: 30, max: 365, step: 1, defaultValue: 365 }
  ],
  compute: (ctx, inputs: { "annualizationDays": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts, accounting } = ctx;
    const periodDays = inputs.annualizationDays ?? 365;

    const accountBalances: Record<string, number> = {};
    const hasTransactions = transactions.some(tx => isPostable(tx));
    accounts.forEach(acc => {
      // N-13: the opening balance is in the account's own direction; the sums below are debit-positive
      accountBalances[acc.id] = hasTransactions ? openingDebitCents(acc) : (acc.balanceCents ?? acc.openingBalanceCents ?? 0);
    });

    const sourceTransactionIds = new Set<string>();

    // Cost of Goods Sold and Revenue
    let cogs = 0;
    let revenue = 0;

    transactions.forEach(tx => {
       if (!isPostable(tx)) return;
       let hasRelevantLine = false;
       tx.lines.forEach(l => {
          const amt = lineAmount(l, tx);
          accountBalances[l.accountId] = (accountBalances[l.accountId] || 0) + amt;
          
          if (accounting.isCOGS(l.accountId)) {
            cogs += Math.abs(amt);
            hasRelevantLine = true;
          }
          if (accounting.isRevenue(l.accountId)) {
            revenue += Math.abs(amt);
            hasRelevantLine = true;
          }
          const acc = accounts.find(a => a.id === l.accountId);
          const isInventory = acc && accounting.isAsset(acc.id) && ((acc.category || '').toLowerCase().includes('inventory') || (acc.name || '').toLowerCase().includes('inventory'));
          if (isInventory || accounting.isAR(l.accountId) || accounting.isAP(l.accountId)) {
            hasRelevantLine = true;
          }
       });
       if (hasRelevantLine) sourceTransactionIds.add(tx.id);
    });

    // Derive ending balances
    let inventory = 0;
    let ar = 0;
    let ap = 0;

    accounts.forEach(acc => {
      const bal = accountBalances[acc.id] || 0;
      const isInventory = accounting.isAsset(acc.id) && ((acc.category || '').toLowerCase().includes('inventory') || (acc.name || '').toLowerCase().includes('inventory'));

      if (isInventory) inventory += bal;
      else if (accounting.isAR(acc.id)) ar += bal;
      else if (accounting.isAP(acc.id)) ap += -bal; // Liability balance is credit-normal
    });

    if (cogs === 0 || revenue === 0) {
      return {
        metrics: [{ label: 'Status', value: 'Missing P&L Data' }],
        charts: [],
        insights: ['CCC calculation requires non-zero Revenue and Cost of Goods Sold to determine turnover ratios.']
      };
    }

    const avgInventory = inventory; // Assuming ending = average for this point-in-time calculation
    const avgAR = ar;
    const avgAP = ap;

    // Days Inventory Outstanding (DIO) = (Avg Inventory / COGS) * 365
    const dio = cogs > 0 ? (avgInventory / cogs) * periodDays : 0;
    
    // Days Sales Outstanding (DSO) = (Avg AR / Revenue) * 365
    const dso = revenue > 0 ? (avgAR / revenue) * periodDays : 0;
    
    // Days Payable Outstanding (DPO) = (Avg AP / COGS) * 365
    const dpo = cogs > 0 ? (avgAP / cogs) * periodDays : 0;

    const ccc = dio + dso - dpo;

    const chartData = [
       { Metric: 'Days Inventory (DIO)', Days: Number.parseFloat(dio.toFixed(1)) },
       { Metric: 'Days Sales (DSO)', Days: Number.parseFloat(dso.toFixed(1)) },
       { Metric: 'Days Payable (DPO)', Days: -Number.parseFloat(dpo.toFixed(1)) } // Negative as it offsets
    ];

    let cccColor = 'green';
    let cccTrend = 'positive';
    if (ccc > 90) { cccColor = 'red'; cccTrend = 'negative'; }
    else if (ccc > 45) { cccColor = 'orange'; cccTrend = 'neutral'; }

    return {
      metrics: [
        { label: 'Cash Conversion Cycle', value: `${Math.round(ccc)} Days`, color: cccColor, trend: cccTrend },
        { label: 'DIO (Inventory)', value: `${Math.round(dio)} Days` },
        { label: 'DSO (Receivables)', value: `${Math.round(dso)} Days` },
        { label: 'DPO (Payables)', value: `${Math.round(dpo)} Days` }
      ],
      charts: [
        {
          config: {
            xKey: 'Metric',
            yKeys: [{ key: 'Days', name: 'Days Impact', color: '#3b82f6', type: 'bar' }]
          },
          data: chartData
        }
      ],
      insights: [
        `The entity takes approximately ${Math.round(ccc)} days to convert its inventory investments and other resources into cash flows from sales.`,
        `Capital is tied up in inventory for ~${Math.round(dio)} days, and customers take ~${Math.round(dso)} days to pay.`,
        `The entity defers its own payments to suppliers by ~${Math.round(dpo)} days, providing working capital relief.`,
        ccc < 0 ? 'Excellent: A negative CCC means suppliers are funding operations before the entity pays for inventory.' : 'Monitor receivables collection and inventory turnover to lower the cash cycle.'
      ],
      sourceTransactionIds: Array.from(sourceTransactionIds)
    };
  }
};
