import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, lineAmount } from '../../lib/txFilters';

export const DUPONT_ANALYSIS_ALGO: AlgorithmDefinition = {
  id: 'valuation_3',
  name: 'DuPont ROE Decomposition',
  domain: 'valuation',
  tags: ['DuPont', 'ROE', 'Profitability', 'Efficiency', 'Leverage'],
  description: 'Deconstructs Return on Equity (ROE) into Profit Margin, Asset Turnover, and Financial Leverage to identify the core drivers of shareholder return.',
  inputs: [],
  compute: (ctx, _inputs): AlgoResult => {
    const { transactions, accounts, accounting } = ctx;
    let revenue = 0;
    let netIncome = 0;
    let totalAssets = 0;
    let equity = 0;

    // Use accounts for assets and equity
    accounts.forEach(acc => {
      const bal = acc.balanceCents || 0;

      if (accounting.isAsset(acc.id)) {
        totalAssets += bal;
      } else if (accounting.isEquity(acc.id)) {
        equity -= bal;
      }
    });

    // Approximate revenue and net income from transactions
    transactions.forEach(tx => {
       if (!isPostable(tx)) return;
       tx.lines.forEach(l => {
          const amt = lineAmount(l, tx);
          if (accounting.isRevenue(l.accountId)) {
             const absAmt = Math.abs(amt);
             revenue += absAmt;
             netIncome += absAmt;
          } else if (accounting.isExpense(l.accountId) || accounting.isCOGS(l.accountId)) {
             netIncome -= Math.abs(amt);
          }
       });
    });

    if (equity === 0 || totalAssets === 0) {
      return {
        metrics: [{ label: 'Status', value: 'Insufficient Balance Sheet' }],
        charts: [],
        insights: ['DuPont analysis requires non-zero Total Assets and Equity balances to compute leverage and turnover.']
      };
    }

    // DuPont Factors
    const profitMargin = revenue > 0 ? (netIncome / revenue) : 0;
    const assetTurnover = totalAssets > 0 ? (revenue / totalAssets) : 0;
    const equityMultiplier = equity > 0 ? (totalAssets / equity) : 0;
    
    // ROE = Profit Margin * Asset Turnover * Equity Multiplier
    const roe = profitMargin * assetTurnover * equityMultiplier;

    const chartData = [
       { Component: 'Profit Margin', Value: Number.parseFloat((profitMargin * 100).toFixed(2)) },
       { Component: 'Asset Turnover', Value: Number.parseFloat((assetTurnover * 100).toFixed(2)) },
       { Component: 'Equity Multiplier', Value: Number.parseFloat((equityMultiplier * 100).toFixed(2)) }
    ];

    let roeColor: string;
    let roeTrend = 'neutral';
    if (roe > 0.15) { roeColor = 'text-green-500'; roeTrend = 'positive'; }
    else if (roe < 0.05) { roeColor = 'text-red-500'; roeTrend = 'negative'; }
    else { roeColor = 'text-blue-500'; }

    return {
      metrics: [
        { label: 'Return on Equity (ROE)', value: `${(roe * 100).toFixed(2)}%`, color: roeColor, trend: roeTrend },
        { label: 'Net Profit Margin', value: `${(profitMargin * 100).toFixed(2)}%` },
        { label: 'Asset Turnover', value: `${assetTurnover.toFixed(2)}x` },
        { label: 'Equity Multiplier (Leverage)', value: `${equityMultiplier.toFixed(2)}x` }
      ],
      charts: [
        {
          config: {
            xKey: 'Component',
            yKeys: [{ key: 'Value', name: 'Driver Magnitude', color: '#10b981', type: 'bar' }]
          },
          data: chartData
        }
      ],
      insights: [
        `Return on Equity (ROE) stands at ${(roe * 100).toFixed(2)}%.`,
        `Decomposition shows a Profit Margin of ${(profitMargin * 100).toFixed(2)}%, Asset Turnover of ${assetTurnover.toFixed(2)}x, and Financial Leverage of ${equityMultiplier.toFixed(2)}x.`,
        equityMultiplier > 2 ? 'Note: High Equity Multiplier (>2.0x) indicates significant reliance on debt financing to drive ROE.' : 'Leverage is conservative, suggesting ROE is driven primarily by operational efficiency rather than debt.'
      ]
    };
  }
};
