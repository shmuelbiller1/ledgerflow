import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, lineAmount, transactionDate } from '../../lib/txFilters';

export const CASH_RUNWAY_ALGO: AlgorithmDefinition = {
  id: 'planning_runway',
  name: 'Runway & Burn Rate Predictor',
  domain: 'planning',
  tags: ['Forecasting', 'Cash', 'Burn', 'Survival'],
  description: 'Calculates the current cash position against the moving average monthly burn rate to predict the "Zero Cash Date" (Runway in months).',
  inputs: [
    {
      key: 'burnWindowMonths',
      label: 'Trailing Burn Window (Months)',
      min: 1,
      max: 12,
      step: 1,
      defaultValue: 3
    }
  ],
  compute: (ctx, inputs: { "burnWindowMonths": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts, accounting } = ctx;
    const burnWindowMonths = inputs['burnWindowMonths'] ?? 3;
    
    // 1. Calculate current cash position (sum of all Cash/Bank accounts)
    const cashAccounts = accounts.filter(a => accounting.isCash(a.id));
    const cashAccountIds = new Set(cashAccounts.map(a => a.id));
    
    const openingCashCents = cashAccounts.reduce((sum, a) => sum + (a.openingBalanceCents || 0), 0);
    let netTxCashFlow = 0;
    const sourceTransactionIds = new Set<string>();
    
    // Group transactions by YYYY-MM
    const monthlyNet: Record<string, number> = {};
    
    transactions.forEach(tx => {
      if (!isPostable(tx)) return;
      let netCashImpact = 0;
      let hasCashLine = false;
      if (tx.lines && tx.lines.length > 0) {
        tx.lines.forEach(l => {
          if (cashAccountIds.has(l.accountId)) {
            netCashImpact += lineAmount(l, tx);
            hasCashLine = true;
          }
        });
      }
      if (hasCashLine) {
        sourceTransactionIds.add(tx.id);
      }
      netTxCashFlow += netCashImpact;
      
      const monthKey = (tx.date || '').substring(0, 7); // YYYY-MM
      if (monthKey) {
        if (!monthlyNet[monthKey]) monthlyNet[monthKey] = 0;
        monthlyNet[monthKey] += netCashImpact;
      }
    });

    // Check if live balanceCents is already computed and nonzero, or reconstruct
    const computedStoreCash = cashAccounts.reduce((sum, a) => sum + (a.balanceCents || 0), 0);
    const reconstructedCash = openingCashCents + netTxCashFlow;
    const currentCashCents = computedStoreCash !== 0 && netTxCashFlow === 0 ? computedStoreCash : reconstructedCash;
    
    // 2. Calculate average burn over the requested window across trailing calendar months (Bug 3)
    const referenceDate = new Date();
    let latestTxMonth = '';
    transactions.forEach(tx => {
      const tDate = transactionDate(tx);
      if (tDate && tDate > latestTxMonth) {
        latestTxMonth = tDate.substring(0, 7);
      }
    });

    let endYear = referenceDate.getFullYear();
    let endMonth = referenceDate.getMonth(); // 0-indexed

    if (latestTxMonth) {
      const [ly, lm] = latestTxMonth.split('-').map(Number);
      if (ly && lm) {
        const latestTxDateObj = new Date(ly, lm - 1, 1);
        if (latestTxDateObj.getTime() > referenceDate.getTime()) {
          endYear = ly;
          endMonth = lm - 1;
        }
      }
    }

    const recentMonths: string[] = [];
    for (let i = 0; i < burnWindowMonths; i++) {
      let m = endMonth - i;
      let y = endYear;
      while (m < 0) {
        m += 12;
        y -= 1;
      }
      const monthStr = String(m + 1).padStart(2, '0');
      recentMonths.unshift(`${y}-${monthStr}`);
    }
    
    let totalBurn = 0;
    let burnMonthsCount = 0;
    
    recentMonths.forEach(m => {
      const netFlow = monthlyNet[m] || 0;
      // Only count net outflows as contributing to the burn (Bug 2 - one good month doesn't erase the burn)
      if (netFlow < 0) {
        totalBurn += Math.abs(netFlow);
      }
      burnMonthsCount++;
    });
    
    const avgMonthlyBurnCents = burnMonthsCount > 0 ? (totalBurn / burnMonthsCount) : 0;
    
    // 3. Compute Runway
    let runwayMonths = -1; // -1 means infinite/profitable
    if (avgMonthlyBurnCents > 0 && currentCashCents > 0) {
      runwayMonths = currentCashCents / avgMonthlyBurnCents;
    }
    
    // Format values
    const cashFormatted = `$${(currentCashCents / 100).toLocaleString()}`;
    const burnFormatted = avgMonthlyBurnCents > 0 ? `$${(avgMonthlyBurnCents / 100).toLocaleString()}/mo` : '$0/mo';
    
    let runwayText = 'Infinite (Profitable)';
    let runwayColor = 'text-emerald-500';
    
    // Bug 1 - robust check for empty workspace
    if (accounts.length === 0 || transactions.length === 0 || cashAccounts.length === 0) {
      runwayText = 'No Data';
      runwayColor = 'text-slate-400';
    } else if (runwayMonths !== -1) {
      runwayText = `${runwayMonths.toFixed(1)} Months`;
      if (runwayMonths < 3) runwayColor = 'text-rose-500';
      else if (runwayMonths < 6) runwayColor = 'text-amber-500';
      else runwayColor = 'text-blue-500';
    } else if (currentCashCents <= 0) {
      runwayText = 'Out of Cash';
      runwayColor = 'text-rose-500';
    }
    
    const insights = [];
    insights.push(`Current liquid cash position is ${cashFormatted} across ${cashAccounts.length} cash accounts.`);
    if (accounts.length > 0 && transactions.length > 0 && cashAccounts.length > 0) {
      if (avgMonthlyBurnCents > 0) {
        insights.push(`Based on the last ${burnMonthsCount} calendar month(s), the average net monthly burn rate is ${burnFormatted}.`);
      } else {
        insights.push(`The company has generated net positive cash flow overall across the last ${burnMonthsCount} calendar month(s). No active net burn rate.`);
      }
    } else {
      insights.push(`No transaction history found in the evaluation window.`);
    }
    
    if (runwayMonths > 0 && runwayMonths < 3) {
      insights.push(`CRITICAL: Cash runway is critically short (${runwayMonths.toFixed(1)} months). Immediate capital injection or expense reduction required.`);
    }

    // Prepare chart data
    const chartData = recentMonths.map(m => ({
      Month: m,
      'Net Flow': Number.parseFloat(((monthlyNet[m] || 0) / 100).toFixed(2))
    }));

    return {
      metrics: [
        { label: 'Current Cash', value: cashFormatted },
        { label: 'Avg Monthly Burn', value: burnFormatted, color: 'text-amber-500' },
        { label: 'Estimated Runway', value: runwayText, color: runwayColor }
      ],
      charts: [
        {
          config: {
            xKey: 'Month',
            yKeys: [
              { key: 'Net Flow', name: 'Net Cash Flow ($)', color: '#6366f1', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights,
      sourceTransactionIds: Array.from(sourceTransactionIds)
    };
  }
};
