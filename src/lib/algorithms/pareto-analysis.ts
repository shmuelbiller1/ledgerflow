import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, lineAmount } from '../../lib/txFilters';

export const PARETO_ANALYSIS_ALGO: AlgorithmDefinition = {
  id: 'intelligence_pareto',
  name: 'Pareto (80/20) Concentration',
  domain: 'finance',
  tags: ['Concentration', 'Risk', 'Vendors', 'Revenue'],
  description: 'Applies the Pareto Principle to determine if 80% of cash flow is concentrated within a small subset of vendors or customers, indicating high reliance risk.',
  inputs: [
    {
      key: 'analyzeRevenue',
      label: 'Analyze Revenue (1) or Expenses (0)',
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0
    }
  ],
  compute: (ctx, inputs: { "analyzeRevenue": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounts } = ctx;
    const isRevenue = inputs['analyzeRevenue'] === 1;
    
    // 1. Group by entity (Payee / Description)
    const entityVolume: Record<string, number> = {};
    let totalVolume = 0;
    
    transactions.forEach(tx => {
      if (!isPostable(tx)) return;

      // Classify based on account types/categories
      const isMatchingTx = tx.lines.some(l => {
        const acc = accounts.find(a => a.id === l.accountId);
        if (!acc) return false;
        const catLower = (acc.category || '').toLowerCase();
        const typeLower = (acc.type || '').toLowerCase();
        if (isRevenue) {
          return typeLower === 'income' || typeLower === 'revenue' || catLower === 'revenue' || catLower === 'sales';
        } else {
          return typeLower === 'expense' || typeLower === 'cost_of_goods' || catLower === 'cogs' || catLower === 'expense' || catLower === 'direct costs' || catLower === 'operations';
        }
      });

      if (!isMatchingTx) return;

      const rate = tx.exchangeRate || 1;
      const relevantCents = tx.lines.filter(l => {
        const acc = accounts.find(a => a.id === l.accountId);
        if (!acc) return false;
        const catLower = (acc.category || '').toLowerCase();
        const typeLower = (acc.type || '').toLowerCase();
        if (isRevenue) {
          return typeLower === 'income' || typeLower === 'revenue' || catLower === 'revenue' || catLower === 'sales';
        } else {
          return typeLower === 'expense' || typeLower === 'cost_of_goods' || catLower === 'cogs' || catLower === 'expense' || catLower === 'direct costs';
        }
      }).reduce((sum, l) => sum + Math.abs(lineAmount(l, tx)), 0) || Math.abs(tx.totalAmountCents);

      const absAmount = Math.round(relevantCents * rate);
      if (absAmount === 0) return;
      
      const name = (tx.payee || tx.description || 'Unknown').trim();
      if (!name || name.toLowerCase() === 'unknown') return;
      
      if (!entityVolume[name]) entityVolume[name] = 0;
      entityVolume[name] += absAmount;
      totalVolume += absAmount;
    });
    
    // Sort entities by volume (descending)
    const sortedEntities = Object.keys(entityVolume).sort((a, b) => entityVolume[b] - entityVolume[a]);
    
    if (sortedEntities.length === 0 || totalVolume === 0) {
      return {
        metrics: [{ label: 'Status', value: 'No Data' }],
        charts: [],
        insights: ['No relevant transactions found for the selected analysis mode.']
      };
    }
    
    // Calculate Pareto curve
    let cumulativeVolume = 0;
    const target80 = totalVolume * 0.8;
    let entitiesTo80 = 0;
    
    const chartData = [];
    
    for (let i = 0; i < sortedEntities.length; i++) {
      const entity = sortedEntities[i];
      const volume = entityVolume[entity];
      cumulativeVolume += volume;
      
      const cumulativePct = totalVolume > 0 ? (cumulativeVolume / totalVolume) * 100 : 0;
      
      if (cumulativeVolume <= target80 || entitiesTo80 === 0) { // Catch the one that crosses the line
         if (cumulativeVolume >= target80 && entitiesTo80 === 0) {
             entitiesTo80 = i + 1;
         } else if (cumulativeVolume < target80) {
             entitiesTo80 = i + 1;
         }
      }
      
      // Keep chart clean, top 20 or until 90%
      if (i < 20 || cumulativePct < 90) {
        chartData.push({
          Entity: entity.substring(0, 15),
          'Volume ($)': Number.parseFloat((volume / 100).toFixed(2)),
          'Cumulative (%)': Number.parseFloat(cumulativePct.toFixed(1))
        });
      }
    }
    
    // Prevent zero if target crossed on first item
    if (entitiesTo80 === 0 && sortedEntities.length > 0) entitiesTo80 = 1;
    
    const concentrationPct = sortedEntities.length > 0 ? (entitiesTo80 / sortedEntities.length) * 100 : 0;
    
    const insights = [];
    insights.push(`Analyzed ${sortedEntities.length} unique entities generating $${(totalVolume / 100).toLocaleString()}.`);
    
    if (concentrationPct <= 20) {
      insights.push(`⚠️ High Concentration Risk: 80% of volume comes from just ${entitiesTo80} entities (${concentrationPct.toFixed(1)}% of total pool).`);
    } else {
      insights.push(`Volume is well-distributed. It takes ${entitiesTo80} entities (${concentrationPct.toFixed(1)}% of total pool) to reach 80% of volume.`);
    }

    return {
      metrics: [
        { label: 'Total Entities', value: sortedEntities.length },
        { label: 'Entities to 80%', value: entitiesTo80, color: concentrationPct <= 20 ? 'text-rose-500' : 'text-slate-500' },
        { label: 'Concentration', value: `${concentrationPct.toFixed(1)}%`, color: concentrationPct <= 20 ? 'text-rose-500' : 'text-slate-500' }
      ],
      charts: [
        {
          config: {
            xKey: 'Entity',
            yKeys: [
              { key: 'Volume ($)', name: 'Volume ($)', color: '#94a3b8', type: 'bar' },
              { key: 'Cumulative (%)', name: 'Cumulative (%)', color: '#6366f1', type: 'line' }
            ]
          },
          data: chartData
        }
      ],
      insights
    };
  }
};

