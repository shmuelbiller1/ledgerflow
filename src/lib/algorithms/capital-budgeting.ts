import type { AlgoResultRow } from './types';
import { AlgorithmDefinition, AlgoResult } from './types';
import { calculateNPV, calculateIRR } from './math';
import { isPostable, lineAmount } from '../../lib/txFilters';

export const CAPITAL_BUDGETING_ALGO: AlgorithmDefinition = {
  id: 'valuation_1',
  name: 'WACC & Capital Budgeting Analysis',
  domain: 'finance',
  tags: ['Valuation', 'NPV', 'IRR', 'WACC', 'Payback'],
  description: 'Computes Weighted Average Cost of Capital (WACC) and evaluates project viability using NPV, IRR, Profitability Index, and Discounted Payback Period.',
  inputs: [
    { key: 'initialInvestment', label: 'Initial Outlay ($)', min: 0, max: 10000000, step: 5000, defaultValue: 0 },
    { key: 'costOfEquityPct', label: 'Cost of Equity (%)', min: 1, max: 30, step: 0.5, defaultValue: 10 },
    { key: 'costOfDebtPct', label: 'Cost of Debt (%)', min: 1, max: 20, step: 0.5, defaultValue: 5 },
    { key: 'taxRatePct', label: 'Corporate Tax Rate (%)', min: 0, max: 50, step: 1, defaultValue: 21 },
    { key: 'equityDebtRatio', label: 'Equity Weight (%)', min: 0, max: 100, step: 5, defaultValue: 70 }
  ],
  compute: (ctx, inputs: { "initialInvestment": number; "costOfEquityPct": number; "costOfDebtPct": number; "taxRatePct": number; "equityDebtRatio": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounting } = ctx;
    const ke = (inputs['costOfEquityPct'] ?? 10) / 100;
    const kd = (inputs['costOfDebtPct'] ?? 5) / 100;
    const tax = (inputs['taxRatePct'] ?? 21) / 100;
    const equityPct = (inputs['equityDebtRatio'] ?? 70) / 100;
    const debtPct = 1 - equityPct;
    
    // WACC = (E/V * Ke) + (D/V * Kd * (1 - Tax))
    const wacc = (equityPct * ke) + (debtPct * kd * (1 - tax));
    const waccPct = (wacc * 100).toFixed(2);
    
    // Group transaction cash flows by year
    const yearlyFlows: Record<string, number> = {};

    transactions.forEach(tx => {
      if (!isPostable(tx)) return;
      const year = tx.date.substring(0, 4);
      if (!yearlyFlows[year]) yearlyFlows[year] = 0;
      
      // Calculate net cash flow impact based on cash accounts
      let netImpact = 0;
      let hasCashAccount = false;

      tx.lines.forEach(l => {
         const amt = lineAmount(l, tx);
         if (accounting.isCash(l.accountId)) {
             hasCashAccount = true;
             netImpact += amt; // Inflows positive, outflows negative
         }
      });

      // If no explicit cash account was touched, compute Operating Net Income impact
      if (!hasCashAccount) {
        tx.lines.forEach(l => {
          const amt = lineAmount(l, tx);
          if (accounting.isRevenue(l.accountId)) {
            netImpact += Math.abs(amt);
          } else if (accounting.isExpense(l.accountId) || accounting.isCOGS(l.accountId)) {
            netImpact -= Math.abs(amt);
          }
        });
      }

      yearlyFlows[year] += (netImpact / 100);
    });
    
    const sortedYears = Object.keys(yearlyFlows).sort();
    let cashFlowArray = sortedYears.map(y => yearlyFlows[y]);
    
    // Determine Initial Investment (Capex): User explicit input takes strict precedence
    let initialInvestment = inputs['initialInvestment'] ?? 0;
    if (initialInvestment === 0 && cashFlowArray.length > 0 && cashFlowArray[0] < 0) {
      initialInvestment = Math.abs(cashFlowArray[0]);
      cashFlowArray = cashFlowArray.slice(1);
    }

    if (cashFlowArray.length === 0 && initialInvestment === 0) {
      return {
        metrics: [
          { label: 'WACC (Hurdle Rate)', value: `${waccPct}%`, color: 'blue' },
          { label: 'Internal Rate of Return (IRR)', value: 'N/A', color: 'gray' },
          { label: 'Net Present Value', value: '$0', color: 'gray' },
          { label: 'Profitability Index', value: '0.00', color: 'gray' },
          { label: 'Discounted Payback', value: 'N/A', color: 'gray' }
        ],
        charts: [],
        insights: [
          `The enterprise hurdle rate (WACC) is calculated at ${waccPct}%.`,
          'No transaction cash flows or initial project outlay specified in ledger or inputs. Provide an initial outlay or record project transactions to evaluate NPV/IRR.'
        ]
      };
    }

    const npv = calculateNPV(wacc, initialInvestment, cashFlowArray);
    const irr = calculateIRR(initialInvestment, cashFlowArray);
    
    // Profitability Index = (NPV + Initial Investment) / Initial Investment
    const profitabilityIndex = initialInvestment > 0 ? (npv + initialInvestment) / initialInvestment : 0;
    
    // Discounted Payback Period
    let discountedPayback = -1;
    let cumulativeDCF = -initialInvestment;
    
    const dcfChartData: AlgoResultRow[] = [];
    
    for (let i = 0; i < cashFlowArray.length; i++) {
       const dcf = cashFlowArray[i] / Math.pow(1 + wacc, i + 1);
       cumulativeDCF += dcf;
       
       dcfChartData.push({
         Year: `Yr ${i+1}`,
         'Nominal Cash Flow': cashFlowArray[i],
         'Discounted Cash Flow': dcf,
         'Cumulative DCF': cumulativeDCF
       });

       if (cumulativeDCF >= 0 && discountedPayback === -1) {
         // Interpolate exact year fraction
         const prevCumulative = cumulativeDCF - dcf;
         discountedPayback = i + (dcf === 0 ? 0 : Math.abs(prevCumulative) / dcf);
       }
    }

    const chartData = [
      { Parameter: 'Cost of Equity', 'Rate (%)': Number.parseFloat((ke * 100).toFixed(2)) },
      { Parameter: 'Cost of Debt (After-Tax)', 'Rate (%)': Number.parseFloat((kd * (1 - tax) * 100).toFixed(2)) },
      { Parameter: 'Blended WACC', 'Rate (%)': Number.parseFloat(waccPct) }
    ];

    const irrFormatted = !Number.isNaN(irr) ? `${(irr * 100).toFixed(2)}%` : 'N/A';
    const isIrrViable = !Number.isNaN(irr) && irr >= wacc;

    const insights = [
      `The enterprise hurdle rate (WACC) is calculated at ${waccPct}%, factoring an equity weight of ${inputs['equityDebtRatio']}% and a tax shield on debt of ${inputs['taxRatePct']}%.`,
      `The projected NPV stands at $${npv.toLocaleString(undefined, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} against an initial capital outlay of $${initialInvestment.toLocaleString()}.`,
      !Number.isNaN(irr) 
        ? (isIrrViable ? `The Internal Rate of Return (IRR) is ${irrFormatted}, clearing the ${waccPct}% WACC hurdle rate and indicating a value-accretive investment.` : `The Internal Rate of Return (IRR) is ${irrFormatted}, failing to meet the ${waccPct}% hurdle rate.`)
        : 'Internal Rate of Return (IRR) could not be calculated due to non-standard cash flow pattern.',
      profitabilityIndex >= 1 
        ? `Profitability Index is ${profitabilityIndex.toFixed(2)} (> 1.0), indicating the present value of future cash flows exceeds the initial investment.`
        : `Profitability Index is ${profitabilityIndex.toFixed(2)} (< 1.0), signaling wealth destruction. Project should be rejected.`,
    ];

    if (discountedPayback !== -1) {
       insights.push(`The Discounted Payback Period is ${discountedPayback.toFixed(1)} years.`);
    } else {
       insights.push(`The project does not reach discounted payback within the modeled ${cashFlowArray.length}-year horizon.`);
    }

    return {
      metrics: [
        { label: 'WACC (Hurdle Rate)', value: `${waccPct}%`, color: 'blue' },
        { label: 'Internal Rate of Return (IRR)', value: irrFormatted, color: isIrrViable ? 'green' : !Number.isNaN(irr) ? 'red' : 'gray' },
        { label: 'Net Present Value', value: `$${Math.round(npv).toLocaleString()}`, color: npv >= 0 ? 'green' : 'red' },
        { label: 'Profitability Index', value: profitabilityIndex.toFixed(2), color: profitabilityIndex >= 1 ? 'green' : 'red' },
        { label: 'Discounted Payback', value: discountedPayback !== -1 ? `${discountedPayback.toFixed(1)} Yrs` : 'Never', color: discountedPayback !== -1 ? 'green' : 'red' }
      ],
      charts: [
        {
          config: {
            xKey: 'Year',
            yKeys: [
              { key: 'Nominal Cash Flow', name: 'Nominal CF', color: '#94a3b8', type: 'bar' },
              { key: 'Discounted Cash Flow', name: 'Discounted CF', color: '#6366f1', type: 'bar' },
              { key: 'Cumulative DCF', name: 'Cumulative NPV', color: '#10b981', type: 'line' }
            ]
          },
          data: dcfChartData
        },
        {
          config: {
            xKey: 'Parameter',
            yKeys: [
              { key: 'Rate (%)', name: 'Discount Rate %', color: '#8b5cf6', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights
    };
  }
};
