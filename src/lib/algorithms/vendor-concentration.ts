import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, isOutflow, lineAmount } from '../../lib/txFilters';

export const VENDOR_CONCENTRATION_ALGO: AlgorithmDefinition = {
  id: 'intelligence_4',
  name: 'Vendor Concentration Risk',
  domain: 'operations',
  tags: ['Risk', 'Supply Chain', 'Vendor', 'Concentration'],
  description: 'Calculates the Herfindahl-Hirschman Index (HHI) and top-vendor reliance to identify dangerous supply chain or operational dependencies.',
  inputs: [
    { key: 'topN', label: 'Top N Vendors to Analyze', min: 3, max: 20, step: 1, defaultValue: 5 }
  ],
  compute: (ctx, inputs: { "topN": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts } = ctx;
    const topN = inputs.topN ?? 5;
    const vendorSpend: Record<string, number> = {};
    let totalSpend = 0;

    transactions.forEach(tx => {
      if (!isPostable(tx)) return;

      // Look at expenses
      const isExpense = tx.lines.some(l => {
         const acc = accounts.find(a => a.id === l.accountId);
         if (!acc) return false;
         const catLower = (acc.category || '').toLowerCase();
         return acc.type === 'expense' || acc.type === 'cost_of_goods' || catLower === 'cogs' || catLower === 'expense' || catLower === 'direct costs';
      });

      if (isExpense || isOutflow(tx, accounts as unknown as import("../../types").ChartAccount[] | Map<string, import("../../types").ChartAccount> | undefined)) {
         const payee = (tx.payee || tx.description || 'Unknown Vendor').toUpperCase().trim();
         if (!vendorSpend[payee]) vendorSpend[payee] = 0;
         
         const expCents = tx.lines
           .filter(l => {
             const acc = accounts.find(a => a.id === l.accountId);
             if (!acc) return false;
             const catLower = (acc.category || '').toLowerCase();
             return acc.type === 'expense' || acc.type === 'cost_of_goods' || catLower === 'cogs' || catLower === 'expense';
           })
           .reduce((s, l) => s + Math.abs(lineAmount(l, tx)), 0) || Math.abs(Math.round((tx.totalAmountCents || 0) * (tx.exchangeRate || 1)));

         const convertedAmt = expCents;
         vendorSpend[payee] += convertedAmt;
         totalSpend += convertedAmt;
      }
    });

    if (totalSpend === 0) {
      return {
        metrics: [{ label: 'Status', value: 'Insufficient Expense Data' }],
        charts: [],
        insights: ['Not enough outgoing transactions to calculate vendor concentration.']
      };
    }

    const sortedVendors = Object.entries(vendorSpend).sort((a, b) => b[1] - a[1]);
    const topVendors = sortedVendors.slice(0, topN);
    
    // Calculate HHI
    let hhi = 0;
    const chartData = [];
    let topNSpend = 0;

    sortedVendors.forEach(([vendor, spend], index) => {
      const marketShare = (spend / totalSpend) * 100;
      hhi += (marketShare * marketShare);
      
      if (index < topN) {
        chartData.push({
          Vendor: vendor,
          'Share %': Number.parseFloat(marketShare.toFixed(1)),
          Spend: spend / 100
        });
        topNSpend += spend;
      }
    });

    // Remainder
    if (sortedVendors.length > topN) {
      chartData.push({
        Vendor: 'All Others',
        'Share %': Number.parseFloat(((totalSpend - topNSpend) / totalSpend * 100).toFixed(1)),
        Spend: (totalSpend - topNSpend) / 100
      });
    }

    const topVendorReliance = topVendors.length > 0 ? (topVendors[0][1] / totalSpend) * 100 : 0;
    
    let hhiStatus = 'Low Risk';
    let hhiColor = 'green';
    if (hhi > 2500) {
      hhiStatus = 'High Concentration Risk';
      hhiColor = 'red';
    } else if (hhi > 1500) {
      hhiStatus = 'Moderate Concentration';
      hhiColor = 'orange';
    }

    return {
      metrics: [
        { label: 'HHI Score (Out of 10,000)', value: Math.round(hhi).toString(), color: hhiColor },
        { label: 'Risk Level', value: hhiStatus, color: hhiColor },
        { label: 'Top Vendor Reliance', value: `${topVendorReliance.toFixed(1)}%`, color: topVendorReliance > 30 ? 'red' : 'green' }
      ],
      charts: [
        {
          config: {
            xKey: 'Vendor',
            yKeys: [{ key: 'Share %', name: 'Wallet Share %', color: '#8b5cf6', type: 'bar' }]
          },
          data: chartData
        }
      ],
      insights: [
        `The Herfindahl-Hirschman Index (HHI) for operating expenses is ${Math.round(hhi)}.`,
        hhi > 2500 ? 'CRITICAL: The index exceeds 2,500, indicating a highly concentrated and risky supply chain.' : 'The supply chain shows a healthy distribution of vendor dependencies.',
        `The largest single vendor (${topVendors[0]?.[0] || 'N/A'}) accounts for ${topVendorReliance.toFixed(1)}% of all operating expenditures.`
      ]
    };
  }
};
