import { Transaction, Project, TransactionLine, AnalyticalMetrics, ChartAccount } from "../types";
import { TruthEngine } from '../modules/integrity/TruthEngine';

import { format, addMonths } from "date-fns";

import { predictHoltWinters } from "../lib/algorithms";
import { parseLocalDate } from '../lib/utils';
import { isPostable, calculateTransactionImpact, lineAmount, isExpenseAccount, isInflow, isOutflow } from '../lib/txFilters';

export interface Insight {
  type: string;
  title: string;
  description: string;
  impact: "low" | "medium" | "high" | "critical";
  confidence: number;
}

export class StrategicEngine {
  static analyze(data: { metrics: AnalyticalMetrics; projects: Project[] }, transactions: Transaction[], accounts: ChartAccount[]): Insight[] {
    if (!transactions || transactions.length === 0 || !data?.metrics || !data.metrics.kpis || (data.metrics.kpis.revenue === 0 && data.metrics.kpis.expenses === 0)) {
      return [];
    }
    const insights: Insight[] = [];
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    
    // 1. Burn Rate Analysis (Deterministic)
    const currentBurn = data.metrics.kpis.expenses;
    const prevBurn = data.metrics.kpis.prevExpenses;

    if (prevBurn > 0) {
      const burnIncrease = ((currentBurn - prevBurn) / prevBurn) * 100;
      if (burnIncrease > 15) {
        insights.push({
          type: "risk",
          title: "Burn Rate Acceleration",
          description: `Operational burn has increased by ${burnIncrease.toFixed(1)}% compared to the previous period. Investigate variable overhead.`,
          impact: "high",
          confidence: 1.0
        });
      }
    }

    // 2. Liquidity Analytics
    const netIncome = data.metrics.kpis.revenue - data.metrics.kpis.expenses;
    if (netIncome < 0 && data.metrics.kpis.expenses > 0) {
        const totalCash = data.metrics.kpis.totalCash;
        const runwayMonths = data.metrics.kpis.runwayMonths;
        
        if (runwayMonths < 6) {
          insights.push({
            type: "risk",
            title: "Capital Runway Exhaustion",
            description: `Current burn rates indicate a projected runway of ${runwayMonths.toFixed(1)} months based on $${(totalCash / 100).toLocaleString()} net liquidity.`,
            impact: "critical",
            confidence: 0.95
          });
        }
    }

    // 3. Anomalous Vendor Spike Detection
    const vendorActivity: Record<string, number[]> = {};
    const vendorPrices: Record<string, Record<string, number>> = {}; // vendor -> item -> price

    transactions.filter(isPostable).forEach(t => {
       const vendor = (t.payee || (t.description || "Vendor").split(' ')[0]).toUpperCase();
       const impact = Math.abs(calculateTransactionImpact(t, accountMap));
       if (impact === 0) return;

       if (!vendorActivity[vendor]) vendorActivity[vendor] = [];
       vendorActivity[vendor].push(impact);

       // Deep Item Tracking for Arbitrage
       const desc = (t.description || '').toLowerCase();
       if (!vendorPrices[vendor]) vendorPrices[vendor] = {};
       // Crude item extraction for advice
       const matches = desc.match(/[a-z]{3,}/g);
       if (matches) {
          matches.slice(0, 2).forEach(m => {
             if (!vendorPrices[vendor][m] || impact < vendorPrices[vendor][m]) {
                vendorPrices[vendor][m] = impact;
             }
          });
       }
    });

    // Detect Cross-Vendor Arbitrage Opportunities
    const itemCompetivity: Record<string, { min: number, minVendor: string, max: number, maxVendor: string }> = {};
    Object.entries(vendorPrices).forEach(([vendor, items]) => {
       Object.entries(items).forEach(([item, price]) => {
          if (!itemCompetivity[item]) {
             itemCompetivity[item] = { min: price, minVendor: vendor, max: price, maxVendor: vendor };
          } else {
             if (price < itemCompetivity[item].min) {
                itemCompetivity[item].min = price;
                itemCompetivity[item].minVendor = vendor;
             }
             if (price > itemCompetivity[item].max) {
                itemCompetivity[item].max = price;
                itemCompetivity[item].maxVendor = vendor;
             }
          }
       });
    });

    Object.entries(itemCompetivity).forEach(([item, data]) => {
       const delta = data.max - data.min;
       if (delta > data.min * 0.25 && data.min > 0) {
          insights.push({
             type: "efficiency",
             title: `Arbitrage Found: ${item.toUpperCase()}`,
             description: `Identified 25%+ price variance. Sourcing from ${data.minVendor} instead of ${data.maxVendor} yields approximately $${(delta / 100).toFixed(2)} per cycle.`,
             impact: "high",
             confidence: 0.9
          });
       }
    });

    for (const [vendor, amounts] of Object.entries(vendorActivity)) {
       if (amounts.length >= 3) {
          const current = amounts[amounts.length - 1];
          const avg = amounts.slice(0, -1).reduce((a, b) => a + b, 0) / (amounts.length - 1 || 1);
          if (current > avg * 1.8) {
             insights.push({
                type: "integrity",
                title: `Spend Anomaly: ${vendor}`,
                description: `Outflow to ${vendor} is 80% higher than historical baseline ($${(current/100).toFixed(2)} vs avg $${(avg/100).toFixed(2)}).`,
                impact: "medium",
                confidence: 0.88
             });
          }
       }
    }

    // 4. Tax Liability Projection
    if (data.metrics.kpis.revenue > 0) {
       const estTax = (data.metrics.kpis.revenue - data.metrics.kpis.expenses) * 0.25; // 25% est tax
       if (estTax > 0) {
          insights.push({
             type: "efficiency",
             title: "Tax Liability Projection",
             description: `Projected tax liability for current cycle is approximately $${(estTax / 100).toLocaleString()}. Allocate to reserve.`,
             impact: "low",
             confidence: 0.7
          });
       }
    }

    // 5. Project Liquidity Risk
    const atRiskProjects = data.projects.filter(p => {
       if (p.status !== 'active' || p.budgetCents <= 0) return false;
       
       const spentCents = transactions.filter(isPostable).reduce((sum, t) => {
          const projectLine = t.lines?.find((l: TransactionLine) => l.project === p.id);
          if (projectLine) {
             const amt = lineAmount(projectLine, t);
             const account = accountMap.get(projectLine.accountId);
             if (isExpenseAccount(account) && amt > 0) {
               return sum + amt;
             }
          }
          return sum;
       }, 0);

       return (spentCents / p.budgetCents) > 0.9;
    });

    if (atRiskProjects.length > 0) {
      insights.push({
        type: "risk",
        title: "Budget Saturation",
        description: `${atRiskProjects.length} core projects (including ${atRiskProjects[0].name}) have utilized >90% of allocated capital core.`,
        impact: "critical",
        confidence: 1.0
      });
    }

    // 6. Duplicate Identification
    const seen: Record<string, string[]> = {};
    transactions.forEach(t => {
      const impact = calculateTransactionImpact(t, accountMap);
      const key = `${t.date}-${impact}-${t.description.substring(0, 8).toLowerCase()}`;
      if (!seen[key]) seen[key] = [];
      seen[key].push(t.id);
    });
    const dupCount = Object.values(seen).filter(ids => ids.length > 1).length;
    if (dupCount > 0) {
      insights.push({
        type: "integrity",
        title: "Potential Duplicates",
        description: `Detected ${dupCount} sets of transactions with identical signatures (Amt/Date/Target). High audit risk.`,
        impact: "high",
        confidence: 0.98
      });
    }

    // 7. Flow Variance Analysis (Volatility Index)
    const dailyInflow = transactions.filter(t => isInflow(t, accountMap)).length;
    const dailyOutflow = transactions.filter(t => isOutflow(t, accountMap)).length;
    if (dailyOutflow > dailyInflow * 3) {
       insights.push({
          type: "efficiency",
          title: "High Outbound Density",
          description: "Transaction frequency is heavily skewed towards outbound vectors. Operational drag is significant.",
          impact: "medium",
          confidence: 0.85
       });
    }

    // 8. Recursive Sector Risk (Concentration)
    const categoryExposure: Record<string, number> = {};
    transactions.filter(isPostable).forEach(t => {
       t.lines?.forEach(l => {
         const acc = accountMap.get(l.accountId);
         if (isExpenseAccount(acc)) {
           const cat = l.accountName || l.accountId;
           categoryExposure[cat] = (categoryExposure[cat] || 0) + lineAmount(l, t);
         }
       });
    });

    const totalExposure = Object.values(categoryExposure).reduce((a, b) => a + b, 0);
    for (const [cat, amt] of Object.entries(categoryExposure)) {
       if (amt > totalExposure * 0.45 && cat !== 'Unknown') {
          insights.push({
             type: "risk",
             title: "Structural Concentration",
             description: `Sector '${cat}' represents ${((amt / totalExposure) * 100).toFixed(1)}% of total capital flow. Diversification recommended.`,
             impact: "high",
             confidence: 0.92
          });
       }
    }

    // 9. Monte Carlo Simulation for Runway Confidence
    const simulation = this.runMonteCarlo(data.metrics, transactions);
    if (simulation) {
      data.metrics.kpis.monteCarloRunway = simulation;
      if (simulation.failureProbability > 0.05) {
        insights.push({
          type: "risk",
          title: "Statistical Runway Risk",
          description: `Simulation modeling (10k sequences) indicates a ${(simulation.failureProbability * 100).toFixed(1)}% probability of capital exhaustion within the next 90 days.`,
          impact: simulation.failureProbability > 0.2 ? "critical" : "high",
          confidence: 0.99
        });
      }
    }

    // 10. Lagged Correlation Detection (e.g. Marketing -> Revenue)
    const correlationMatrix = this.detectCorrelations(transactions);
    if (correlationMatrix.length > 0) {
      data.metrics.kpis.correlations = { pairs: correlationMatrix };
      correlationMatrix.forEach(pair => {
        if (pair.score > 0.7) {
          insights.push({
             type: "efficiency",
             title: "Causal Revenue Driver",
             description: `High correlation (${(pair.score * 100).toFixed(0)}%) detected between '${pair.a}' and '${pair.b}' with a ${pair.lag}-day lag. Optimizing ${pair.a} may drive future yield.`,
             impact: "medium",
             confidence: pair.score
          });
        }
      });
    }

    // 11. Goal Seek Logic: Reaching Positive Cash Flow
    if (data.metrics.kpis.netCash < 0) {
      const gap = Math.abs(data.metrics.kpis.netCash);
      const safeExpenses = data.metrics.kpis.expenses || 1;
      
      insights.push({
        type: "efficiency",
        title: "Mathematical Goal Seek",
        description: `To reach break-even status, a ${((gap / (data.metrics.kpis.revenue || 1)) * 100).toFixed(1)}% increase in revenue OR a ${((gap / safeExpenses) * 100).toFixed(1)}% reduction in overhead is required.`,
        impact: "high",
        confidence: 1.0
      });
    }

    // 12. Corporate Vitality Proxy (Deterministic)
    const safeExpensesForProxy = data.metrics.kpis.expenses > 0 ? data.metrics.kpis.expenses : 1;
    const liquidityProxy = (data.metrics.kpis.revenue * 3) / (safeExpensesForProxy * 2); // Velocity-weighted proxy
    
    if (liquidityProxy < 1.2) {
       insights.push({
         type: "risk",
         title: "Liquidity Constraint Detected",
         description: `Deterministic check: Velocity-weighted Liquidity Proxy is ${liquidityProxy.toFixed(2)}. Business may face friction meeting short-term obligations.`,
         impact: "high",
         confidence: 1.0
       });
    }

    // 13. Revenue Acceleration Analysis
    const revs = data.metrics.timeSeries.map((d) => d.inflow);
    if (revs.length > 30) {
       const firstHalf = revs.slice(0, Math.floor(revs.length / 2)).reduce((a: number, b: number) => a + b, 0);
       const secondHalf = revs.slice(Math.floor(revs.length / 2)).reduce((a: number, b: number) => a + b, 0);
       const acceleration = (secondHalf - firstHalf) / (firstHalf || 1);
       
       if (Math.abs(acceleration) > 0.1) {
          insights.push({
            type: acceleration > 0 ? "growth" : "risk",
            title: `Revenue ${acceleration > 0 ? 'Acceleration' : 'Deceleration'}`,
            description: `Velocity check: Top-line yield has shifted by ${(acceleration * 100).toFixed(1)}% relative to the prior window.`,
            impact: "medium",
            confidence: 0.95
          });
       }
    }

    return insights;
  }

  private static runMonteCarlo(metrics: AnalyticalMetrics, _transactions: Transaction[]) {
    const dailyOutflows = metrics.timeSeries.filter(d => d.outflow > 0).map(d => d.outflow);
    if (dailyOutflows.length < 10) return null;

    const mean = dailyOutflows.reduce((a, b) => a + b, 0) / (dailyOutflows.length || 1);
    const variance = dailyOutflows.reduce((varSum: number, node: number) => varSum + Math.pow(node - mean, 2), 0) / (dailyOutflows.length || 1);
    const stdDev = Math.sqrt(variance);

    const SIMULATIONS = 10000;
    const DAYS = 90;
    let failures = 0;
    const endBalances = [];

    const startingCash = metrics.kpis.totalCash / 100;

    for (let s = 0; s < SIMULATIONS; s++) {
      let balance = startingCash;
      let failed = false;
      for (let d = 0; d < DAYS; d++) {
        // Simple normal distribution sample (Box-Muller)
        const u = 1 - Math.random();
        const v = 1 - Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        
        const change = mean + (z * stdDev);
        balance -= change;
        
        if (balance <= 0) {
          failed = true;
          break;
        }
      }
      if (failed) failures++;
      endBalances.push(balance);
    }

    endBalances.sort((a, b) => a - b);
    return {
      confidence95: Math.max(0, endBalances[Math.floor(SIMULATIONS * 0.05)]),
      confidence50: Math.max(0, endBalances[Math.floor(SIMULATIONS * 0.50)]),
      failureProbability: failures / SIMULATIONS
    };
  }

  private static detectCorrelations(transactions: Transaction[]) {
    // Group categories by daily spend
    const dailySpend: Record<string, Record<string, number>> = {};
    const categoriesSet = new Set<string>();
    
    transactions.slice(0, 500).forEach(t => {
      const date = t.date;
      if (!dailySpend[date]) dailySpend[date] = {};
      
      t.lines?.forEach(l => {
        const cat = l.accountName || l.accountId;
        dailySpend[date][cat] = (dailySpend[date][cat] || 0) + Math.abs(l.amountCents);
        categoriesSet.add(cat);
      });
    });

    const dates = Object.keys(dailySpend).sort();
    const categories = Array.from(categoriesSet);
    const results: { a: string; b: string; score: number; lag: number }[] = [];

    // Check correlations between each pair
    for (let i = 0; i < categories.length; i++) {
      for (let j = 0; j < categories.length; j++) {
        if (i === j) continue;
        const catA = categories[i];
        const catB = categories[j];
        
        // Check lags from 0 to 14 days
        for (let lag = 0; lag <= 14; lag += 7) {
          const score = this.calculateLaggedPearson(dailySpend, dates, catA, catB, lag);
          if (score > 0.6) {
             results.push({ a: catA, b: catB, score, lag });
          }
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  private static calculateLaggedPearson(daily: Record<string, Record<string, number>>, dates: string[], catA: string, catB: string, lag: number) {
    const seriesA: number[] = [];
    const seriesB: number[] = [];

    for (let i = 0; i < dates.length - lag; i++) {
       seriesA.push(daily[dates[i]][catA] || 0);
       seriesB.push(daily[dates[i+lag]][catB] || 0);
    }

    if (seriesA.length < 10) return 0;

    const n = seriesA.length;
    let sumA = 0, sumB = 0, sumA2 = 0, sumB2 = 0, sumAB = 0;
    for (let i = 0; i < n; i++) {
       sumA += seriesA[i];
       sumB += seriesB[i];
       sumA2 += seriesA[i] * seriesA[i];
       sumB2 += seriesB[i] * seriesB[i];
       sumAB += seriesA[i] * seriesB[i];
    }

    const denom = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
    return denom === 0 ? 0 : (n * sumAB - sumA * sumB) / denom;
  }

  static getForecast(transactions: Transaction[], accounts: ChartAccount[]) {
    const monthlyInflow: Record<string, number> = {};
    const monthlyOutflow: Record<string, number> = {};
    const accountMap = new Map(accounts.map(a => [a.id, a]));
    
    transactions.filter(isPostable).forEach(t => {
      const month = t.date.substring(0, 7);
      const impact = calculateTransactionImpact(t, accountMap);
      
      if (impact > 0) {
        monthlyInflow[month] = (monthlyInflow[month] || 0) + (impact / 100);
      } else if (impact < 0) {
        monthlyOutflow[month] = (monthlyOutflow[month] || 0) + (Math.abs(impact) / 100);
      }
    });

    const months = Array.from(new Set([...Object.keys(monthlyInflow), ...Object.keys(monthlyOutflow)])).sort();
    const inflowValues = months.map(m => monthlyInflow[m] || 0);
    const outflowValues = months.map(m => monthlyOutflow[m] || 0);

    if (inflowValues.length < 4) return null;

    // Use Holt-Winters for superior forecasting over simple linear trend
    const forecastInflow = predictHoltWinters(inflowValues, 3, 6);
    const forecastOutflow = predictHoltWinters(outflowValues, 3, 6);

    const projections = [];
    let currentBalance = inflowValues[inflowValues.length - 1] - outflowValues[outflowValues.length - 1];
    const now = new Date();

    for (let i = 0; i < 6; i++) {
      const futureMonth = addMonths(now, i + 1);
      const inflow = Math.max(0, forecastInflow[i]);
      const outflow = Math.max(0, forecastOutflow[i]);
      currentBalance += (inflow - outflow);
      
      projections.push({
        month: format(futureMonth, 'MMM yyyy'),
        inflow: inflow,
        outflow: outflow,
        balance: currentBalance
      });
    }

    const trend = forecastInflow[5] - forecastOutflow[5];

    return {
      projections,
      insights: [
        "Forecast generated via Holt-Winters Triple Exponential Smoothing.",
        trend > 0 ? "Momentum indicates positive capital growth." : "Caution: Net deficit projected in future cycles."
      ],
      riskLevel: trend > 0 ? "low" : "medium",
      recommendations: [
        trend < 0 ? "Review variable costs to offset projected deficit." : "Allocate surplus to long-term capital initiatives."
      ]
    };
  }

  static analyzeUnitEconomics(items: import("../types").InventoryItem[], transactions: Transaction[], accounts: ChartAccount[]) {
    if (!items.length) return [];

    const now = new Date().getTime();
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    const totalInventoryValue = items.reduce((sum, item) => sum + (item.unitCostCents * (item.quantityAtHand || 0)), 0) || 1;
    
    // 1. UNIT ECONOMICS LEARNING POOL
    const postableTxs = transactions.filter(isPostable);
    const expenses = postableTxs.filter(t => isOutflow(t, accountMap));
    const absOverhead = Math.abs(expenses.reduce((sum, t) => sum + calculateTransactionImpact(t, accountMap), 0));

    // 2. TEMPORAL VENDOR SOURCING GRAPH (Self-learning from history)
    const sourcingGraph: Record<string, Record<string, { price: number, weight: number, date: number }>> = {};
    
    postableTxs.forEach(t => {
      const desc = (t.description || '').toLowerCase();
      const vendor = (t.payee || "Market Source").toUpperCase();
      const impact = Math.abs(calculateTransactionImpact(t, accountMap));
      if (impact === 0) return;
      const tDate = parseLocalDate(t.date).getTime();
      
      // Learning Weight: Decays over time (Recency Bias)
      const ageInDays = (now - tDate) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.max(0.1, Math.exp(-ageInDays / 90)); // 90-day half-life

      items.forEach(item => {
        const itemNameLower = item.name.toLowerCase();
        const skuLower = item.sku.toLowerCase();
        
        if (desc.includes(itemNameLower) || desc.includes(skuLower)) {
          if (!sourcingGraph[item.id]) sourcingGraph[item.id] = {};
          
          // Data Chain Filter: Only accept as unit price if roughly within market range (50% - 500% of base)
          const isPlausibleUnitPrice = impact > (item.unitCostCents * 0.5) && impact < (item.unitCostCents * 5);
          
          if (isPlausibleUnitPrice) {
            const existing = sourcingGraph[item.id][vendor];
            if (!existing || tDate > existing.date) {
              sourcingGraph[item.id][vendor] = { price: impact, weight: recencyWeight, date: tDate };
            }
          }
        }
      });
    });

    // 5. DETERMINISTIC CONSOLIDATION
    const analyzedItems = items.map(item => {
      const itemNameLower = item.name.toLowerCase();
      const skuLower = (item.sku || '').toLowerCase(); // an imported item may not carry a SKU: match by name only
      
      // RELATIONAL DATA DISCOVERY (SKU prioritized over description)
      const itemTransactions = postableTxs.filter(t => {
        const desc = (t.description || '').toLowerCase();
        const matchesSku = skuLower && (desc.includes(skuLower) || t.id.includes(skuLower));
        const matchesName = desc.includes(itemNameLower);
        return matchesSku || matchesName;
      });
      
      const sales = itemTransactions.filter(t => isInflow(t, accountMap));
      const salesCount = sales.length;
      const totalOps = itemTransactions.length;

      // DYNAMIC LANDED COST (Refined)
      const directExpenses = expenses.filter(t => {
        const desc = (t.description || '').toLowerCase();
        return desc.includes(itemNameLower) || (skuLower && desc.includes(skuLower));
      });
      
      const directCostTotal = Math.abs(directExpenses.reduce((sum, t) => sum + calculateTransactionImpact(t, accountMap), 0));
      const directAllocation = item.quantityAtHand > 0 ? directCostTotal / item.quantityAtHand : 0;

      // VELOCITY-AWARE OVERHEAD (New)
      // Items with higher turn rate share less overhead per cycle
      const stockValue = item.unitCostCents * (item.quantityAtHand || 0);
      const weight = stockValue / totalInventoryValue;
      
      // Calculate Velocity: Days since first transaction vs total sales
      const firstTx = itemTransactions.length > 0 
        ? itemTransactions.reduce((min, t) => {
            const time = parseLocalDate(t.date).getTime();
            return time < min ? time : min;
          }, Infinity) 
        : now;
      const monthsActive = Math.max(1, (now - firstTx) / (1000 * 60 * 60 * 24 * 30.44));
      const monthlyVelocity = salesCount / monthsActive;
      const velocityFactor = Math.max(0.5, Math.min(2.0, 1 / (monthlyVelocity + 0.1))); // High velocity = low overhead load

      const indirectAllocation = item.quantityAtHand > 0 ? (absOverhead * weight * velocityFactor) / item.quantityAtHand : 0;

      // ARBITRAGE INTELLIGENCE
      const vendors = sourcingGraph[item.id] || {};
      const vendorList = Object.entries(vendors).sort((a, b) => a[1].price - b[1].price);
      const bestOption = vendorList[0] ? { name: vendorList[0][0], price: vendorList[0][1].price } : null;
      const worstOption = vendorList.length > 1 ? { name: vendorList[vendorList.length-1][0], price: vendorList[vendorList.length-1][1].price } : null;
      
      const potentialSaving = bestOption && bestOption.price < item.unitCostCents 
        ? item.unitCostCents - bestOption.price 
        : 0;

      // ANOMALY ENGINE & CONVERGENCE
      const purchasePrices = itemTransactions.filter(t => isOutflow(t, accountMap)).map(t => Math.abs(calculateTransactionImpact(t, accountMap)));
      let volatility = 0;
      let convergence = 0; // 1 = perfectly stable prices across sources
      
      if (purchasePrices.length > 2) {
        const avg = purchasePrices.reduce((a, b) => a + b, 0) / (purchasePrices.length || 1);
        const variance = purchasePrices.reduce((acc, p) => acc + Math.pow(p - avg, 2), 0) / (purchasePrices.length || 1);
        const stdDev = Math.sqrt(variance);
        volatility = stdDev / (avg || 1);
        convergence = Math.max(0, 1 - (volatility * 2));
      }

      // INTEGRITY SCORE (Refined)
      const volumeScore = Math.min(40, totalOps * 2.5);
      const varietyScore = Math.min(30, Object.keys(vendors).length * 15);
      const recencyScore = vendorList.length > 0 
        ? vendorList.reduce((max, v) => v[1].weight > max ? v[1].weight : max, 0) * 30 
        : 0;
      const baseIntegrity = volumeScore + varietyScore + recencyScore;
      const integrity = Math.round(baseIntegrity * (0.8 + (convergence * 0.2)));

      const trueCost = item.unitCostCents + directAllocation + indirectAllocation;
      const margin = item.unitPriceCents - trueCost;
      const marginPct = (margin / (item.unitPriceCents || 1)) * 100;

      // STRATEGIC VALUE (Velocity + Margin Stability)
      const profitContribution = (salesCount * margin) / 100;
      const stratValue = Number(((profitContribution * 0.1) + (marginPct / 5) + (monthlyVelocity / 2)).toFixed(2));

      // TRUE EOQ VIA INTEGRITY ENGINE
      const annualDemandEstimate = Math.round(monthlyVelocity * 12);
      let eoq = 0;
      try {
        // Assume $20 cost per order, and 20% of unit cost holding cost
        const orderCost = 2000;
        const holdingCost = Math.max(1, Math.round(item.unitCostCents * 0.2));
        eoq = TruthEngine.calculateEconomicOrderQuantity(Math.max(1, annualDemandEstimate), orderCost, holdingCost);
      } catch {
        // Safe fallback
      }

      return {
        ...item,
        isAnalysisAccurate: integrity > 35,
        integrityScore: Math.min(100, integrity),
        confidence: integrity > 85 ? 'Verified' : integrity > 60 ? 'High' : 'Speculative',
        anomaly: volatility > 0.45,
        convergence: Number(convergence.toFixed(2)),
        trajectory: purchasePrices.length > 2 ? (purchasePrices[purchasePrices.length-1] > purchasePrices[0] ? 1 : -1) : 0,
        landedCostStructure: {
          base: item.unitCostCents,
          direct: Math.round(directAllocation),
          indirect: Math.round(indirectAllocation)
        },
        arbitrage: {
          bestVendor: bestOption?.name || "Market Average",
          bestPrice: bestOption?.price || 0,
          worstPrice: worstOption?.price || 0,
          saving: Math.round(potentialSaving)
        },
        trueCostCents: Math.round(trueCost),
        marginCents: Math.round(margin),
        marginPercentage: Number(marginPct.toFixed(1)),
        resilience: marginPct > 55 ? 'High Margin' : marginPct > 35 ? 'Stable' : marginPct > 15 ? 'Normal' : 'Critical',
        strategicValue: stratValue,
        eoq,
        maturityIndex: Math.round((integrity * 0.6) + (convergence * 40))
      };
    });

    const strategicTotal = analyzedItems.reduce((acc, i) => acc + i.strategicValue, 0) || 1;
    return analyzedItems.map(item => ({
      ...item,
      isCoreDriver: (item.strategicValue / strategicTotal) > 0.05
    })).sort((a, b) => b.strategicValue - a.strategicValue);
  }
}
