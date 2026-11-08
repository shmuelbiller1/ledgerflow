import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, lineAmount } from '../../lib/txFilters';
import { byCodeUnit } from '../codeUnitOrder';

export const SAAS_UNIT_ECONOMICS_ALGO: AlgorithmDefinition = {
  id: 'planning_6',
  name: 'SaaS Unit Economics (LTV/CAC)',
  domain: 'planning',
  tags: ['SaaS', 'LTV', 'CAC', 'Churn', 'Gross Margin'],
  description: 'Evaluates SaaS business model viability by approximating Customer Acquisition Cost (CAC) vs Lifetime Value (LTV).',
  inputs: [
    { key: 'assumedChurnPct', label: 'Assumed Monthly Churn (%)', min: 1, max: 20, step: 1, defaultValue: 3 },
    { key: 'newCustomers', label: 'New Customers Acquired (Count)', min: 1, max: 1000, step: 10, defaultValue: 50 }
  ],
  compute: (ctx, inputs: { "assumedChurnPct": number; "newCustomers": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts } = ctx;
    const churnRate = (inputs.assumedChurnPct ?? 3) / 100;
    const newCustomers = inputs.newCustomers ?? 50;

    const monthlyRevenue: Record<string, number> = {};
    const monthlyMarketing: Record<string, number> = {};
    const monthlyCogs: Record<string, number> = {};
    const sourceTransactionIds = new Set<string>();

    transactions.forEach(tx => {
       if (!isPostable(tx)) return;
       const monthKey = (tx.date || '').substring(0, 7);
       if (!monthKey) return;

       let hasRelevantLine = false;
       tx.lines.forEach(l => {
          const acc = accounts.find(a => a.id === l.accountId);
          if (acc) {
             const name = (acc.name || '').toLowerCase();
             const type = (acc.type || '').toLowerCase();
             const cat = (acc.category || '').toLowerCase();
             const amt = Math.abs(lineAmount(l, tx));
             
             // Require expense type or marketing category to count as marketing spend
             const isExpense = type === 'expense' || cat === 'expense' || cat === 'marketing';
             const isMarketingName = name.includes('marketing') || name.includes('advertising') || name.includes('adwords') || name.includes('promotion') || name.includes('acquisition') || name.includes('sales commission');
             
             if (isExpense && isMarketingName) {
                monthlyMarketing[monthKey] = (monthlyMarketing[monthKey] || 0) + amt;
                hasRelevantLine = true;
             }
             if (type === 'income' || type === 'revenue' || cat === 'revenue' || cat === 'income' || cat === 'sales') {
                monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + amt;
                hasRelevantLine = true;
             }
             if (type === 'cost_of_goods' || cat === 'cogs' || (isExpense && (name.includes('hosting') || name.includes('cloud') || name.includes('infrastructure')))) {
                monthlyCogs[monthKey] = (monthlyCogs[monthKey] || 0) + amt;
                hasRelevantLine = true;
             }
          }
       });
       if (hasRelevantLine) sourceTransactionIds.add(tx.id);
    });

    const activeMonths = Array.from(new Set([...Object.keys(monthlyRevenue), ...Object.keys(monthlyMarketing)])).sort(byCodeUnit);
    const recentMonths = activeMonths.slice(-3);
    const monthsCount = recentMonths.length || 1;

    let totalRecentRev = 0;
    let totalRecentMktg = 0;
    let totalRecentCogs = 0;

    recentMonths.forEach(m => {
      totalRecentRev += (monthlyRevenue[m] || 0);
      totalRecentMktg += (monthlyMarketing[m] || 0);
      totalRecentCogs += (monthlyCogs[m] || 0);
    });

    const mrr = Math.round(totalRecentRev / monthsCount);
    const avgMarketingSpend = Math.round(totalRecentMktg / monthsCount);
    const avgCogs = Math.round(totalRecentCogs / monthsCount);

    if (avgMarketingSpend === 0 || mrr === 0) {
      return {
        metrics: [{ label: 'Status', value: 'Insufficient SaaS Data' }],
        charts: [],
        insights: ['Unit economics calculation requires Sales & Marketing expenses and recorded Revenue in the evaluation window to compute CAC and LTV.'],
        sourceTransactionIds: Array.from(sourceTransactionIds)
      };
    }

    // Assumptions for the period based on normalized monthly ledger data
    const grossMarginPct = mrr > 0 ? (mrr - avgCogs) / mrr : 0;
    const arpu = newCustomers > 0 ? (mrr / newCustomers) : 0; // Normalized Monthly ARPU
    
    // CAC = Monthly Marketing Spend / Monthly New Customers
    const cac = newCustomers > 0 ? (avgMarketingSpend / newCustomers) : 0;

    // LTV = (Monthly ARPU * Gross Margin) / Churn Rate
    const ltv = churnRate > 0 ? ((arpu * grossMarginPct) / churnRate) : 0;

    const ltvCacRatio = cac > 0 ? (ltv / cac) : 0;
    const paybackMonths = (arpu * grossMarginPct) > 0 ? (cac / (arpu * grossMarginPct)) : 0;

    const chartData = [
       { Metric: 'LTV ($)', Value: ltv / 100 },
       { Metric: 'CAC ($)', Value: cac / 100 }
    ];

    let ratioColor: string;
    if (ltvCacRatio >= 3) ratioColor = 'green';
    else if (ltvCacRatio >= 1) ratioColor = 'orange';
    else ratioColor = 'red';

    return {
      metrics: [
        { label: 'LTV:CAC Ratio', value: `${ltvCacRatio.toFixed(1)}x`, color: ratioColor },
        { label: 'Customer Lifetime Value', value: `$${(ltv/100).toLocaleString(undefined, {maximumFractionDigits:0})}` },
        { label: 'Customer Acquisition Cost', value: `$${(cac/100).toLocaleString(undefined, {maximumFractionDigits:0})}` },
        { label: 'Payback Period', value: `${paybackMonths.toFixed(1)} Mos` }
      ],
      charts: [
        {
          config: {
            xKey: 'Metric',
            yKeys: [{ key: 'Value', name: 'Dollars per Customer', color: '#14b8a6', type: 'bar' }]
          },
          data: chartData
        }
      ],
      insights: [
        `For every $1 spent on acquisition (CAC: $${(cac/100).toFixed(0)}), the entity expects to generate $${(ltv/100).toFixed(0)} in lifetime value.`,
        `The LTV:CAC ratio is ${ltvCacRatio.toFixed(1)}x. A ratio > 3.0x is considered healthy for a SaaS business.`,
        `It takes approximately ${paybackMonths.toFixed(1)} months to recover the CAC based on current gross margins (${(grossMarginPct*100).toFixed(1)}%).`
      ],
      sourceTransactionIds: Array.from(sourceTransactionIds)
    };
  }
};
