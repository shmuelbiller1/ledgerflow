import { AlgorithmDefinition, AlgoResult } from './types';
import { currencyChartValue, formatCurrency } from '../../lib/utils';
import { isPostable, lineAmount } from '../../lib/txFilters';

export const BUDGET_VS_ACTUAL_ALGO: AlgorithmDefinition = {
  id: 'budget-vs-actual',
  name: 'Budget vs Actual Variance',
  domain: 'planning',
  tags: ['Reporting', 'Planning', 'Variance'],
  description: 'Compares budgeted amounts against actual posted ledger activity, computing variance and percentage completion.',
  requires: ['transactions', 'budgets', 'accounts'],
  inputs: [
    {
      kind: 'select',
      key: 'period',
      label: 'Budget Period',
      options: [
        { value: '2027', label: '2027 Annual' },
        { value: '2026', label: '2026 Annual' },
        { value: '2025', label: '2025 Annual' },
        { value: '2026-03', label: 'March 2026' }
      ],
      defaultValue: '2026'
    }
  ],
  compute: (ctx, inputs: { "period": string; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts, accounting } = ctx;
    const budgets = ctx.entities?.budgets || [];
    const targetPeriod = inputs['period'] || '2026';
    
    // Filter budgets for the period
    const activeBudgets = budgets.filter((b) => b.period === targetPeriod && b.targetType === 'account');
    
    if (activeBudgets.length === 0) {
      return {
        metrics: [],
        charts: [],
        insights: [`No account-level budgets found for period "${targetPeriod}".`],
        rows: []
      };
    }

    const chartData: { account: string; budget: number; actual: number }[] = [];
    const rows: ({ id: string; account: string; budget: string; actual: string; variance: string; variancePct: string })[] = [];
    const sourceTransactionIds = new Set<string>();
    let totalBudget = 0;
    let totalActual = 0;

    activeBudgets.forEach((budget) => {
      const accountId = budget.targetId;
      const account = accounts.find(a => a.id === accountId);
      
      // Calculate actuals
      let actualCents = 0;
      
      transactions.forEach(tx => {
        if (!isPostable(tx)) return;
        
        // Very rough period check: if budget is YYYY, match year. If YYYY-MM, match month.
        if (!tx.date.startsWith(targetPeriod)) return;

        tx.lines.forEach(e => {
          if (e.accountId === accountId) {
            const isDebitNormal = account ? (accounting.isAsset(account.id) || accounting.isExpense(account.id) || accounting.isCOGS(account.id)) : true;
            const amt = lineAmount(e, tx);
            const debit = amt > 0 ? amt : 0;
            const credit = amt < 0 ? Math.abs(amt) : 0;
            
            actualCents += isDebitNormal ? (debit - credit) : (credit - debit);
            sourceTransactionIds.add(tx.id);
          }
        });
      });

      const budgetAmount = budget.amountCents;
      const variance = budgetAmount - actualCents;
      const variancePct = budgetAmount !== 0 ? (variance / budgetAmount) * 100 : 0;
      
      totalBudget += budgetAmount;
      totalActual += actualCents;

      chartData.push({ account: account ? `${account.code} - ${account.name}` : accountId, budget: currencyChartValue(budgetAmount, ctx.reportingCurrency), actual: currencyChartValue(actualCents, ctx.reportingCurrency) });
      rows.push({
        id: budget.id,
        account: account ? `${account.code} - ${account.name}` : accountId,
        budget: formatCurrency(budgetAmount, ctx.reportingCurrency),
        actual: formatCurrency(actualCents, ctx.reportingCurrency),
        variance: formatCurrency(variance, ctx.reportingCurrency),
        variancePct: `${variancePct > 0 ? '+' : ''}${variancePct.toFixed(1)}%`
      });
    });
    
    const totalVariance = totalBudget - totalActual;

    return {
      metrics: [
        { label: 'Total Budget', value: formatCurrency(totalBudget, ctx.reportingCurrency), color: 'text-indigo-400' },
        { label: 'Total Actuals', value: formatCurrency(totalActual, ctx.reportingCurrency), color: 'text-emerald-400' },
        { label: 'Net Variance', value: formatCurrency(totalVariance, ctx.reportingCurrency), color: totalVariance >= 0 ? 'text-emerald-500' : 'text-rose-500' }
      ],
      charts: [
        {
          config: {
            xKey: 'account',
            yKeys: [
              { key: 'budget', name: 'Budget', color: '#6366f1', type: 'bar' },
              { key: 'actual', name: 'Actual', color: '#10b981', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights: [
        `Overall budget completion is ${totalBudget > 0 ? ((totalActual / totalBudget) * 100).toFixed(1) : 0}%.`,
        totalVariance >= 0 ? 'Currently operating within budget.' : 'Warning: Total actuals exceed budget.'
      ],
      rows,
      sourceTransactionIds: Array.from(sourceTransactionIds)
    };
  }
};
