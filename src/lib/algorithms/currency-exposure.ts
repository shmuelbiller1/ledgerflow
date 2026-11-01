import { AlgorithmDefinition, AlgoResult } from './types';
import { isPostable, lineAmount } from '../../lib/txFilters';

export const CURRENCY_EXPOSURE_ALGO: AlgorithmDefinition = {
  id: 'treasury_1',
  name: 'Foreign Exchange (FX) Exposure',
  domain: 'treasury',
  tags: ['FX', 'Currency', 'Risk', 'Treasury'],
  description: 'Calculates net exposure to foreign currencies by identifying transactions or accounts holding non-base currency balances, highlighting FX risk.',
  inputs: [
    { key: 'shockPct', label: 'Simulated FX Shock (%)', min: 1, max: 25, step: 1, defaultValue: 10 }
  ],
  compute: (ctx, inputs: { "shockPct": number; [key: string]: unknown }): AlgoResult => {
    const { transactions, accounting } = ctx;
    const shockPct = (inputs.shockPct ?? 10) / 100;
    
    const fxNetBalances: Record<string, number> = {};
    const sourceTransactionIds = new Set<string>();

    transactions.forEach(tx => {
       if (!isPostable(tx)) return;

       const rate = tx.exchangeRate && tx.exchangeRate > 0 && tx.exchangeRate !== 1 ? tx.exchangeRate : 1;
       const currencyCode = tx.currency || (rate !== 1 ? 'FX' : 'USD');
       
       if (rate !== 1 || (currencyCode !== 'USD' && currencyCode !== 'FX')) {
          sourceTransactionIds.add(tx.id);
          tx.lines.forEach(line => {
             // Focus on monetary balance sheet items (assets & liabilities) or net lines
             const baseAmt = lineAmount(line, tx);
             
             if (!fxNetBalances[currencyCode]) fxNetBalances[currencyCode] = 0;
             // If account type is known: assets increase exposure with debits, liabilities with credits
             if (accounting.isLiability(line.accountId) || accounting.isEquity(line.accountId)) {
               fxNetBalances[currencyCode] -= baseAmt;
             } else {
               fxNetBalances[currencyCode] += baseAmt;
             }
          });
       }
    });

    // Net exposure per foreign currency
    let totalBaseExposure = 0;
    const currencyExposureData: { currency: string; exposure: number; netBaseAmount: number }[] = [];

    Object.entries(fxNetBalances).forEach(([curr, netCents]) => {
      const absExp = Math.abs(netCents);
      totalBaseExposure += absExp;
      currencyExposureData.push({
        currency: curr,
        exposure: Number.parseFloat((absExp / 100).toFixed(2)),
        netBaseAmount: Number.parseFloat((netCents / 100).toFixed(2))
      });
    });

    if (totalBaseExposure === 0) {
      return {
        metrics: [{ label: 'FX Exposure', value: '$0' }],
        charts: [],
        insights: ['No foreign currency transactions detected. Entity operates purely in base currency with 0% FX risk.']
      };
    }

    const shockImpact = totalBaseExposure * shockPct;

    return {
      metrics: [
        { label: 'Total FX Exposure', value: `$${(totalBaseExposure / 100).toLocaleString()}`, color: 'orange' },
        { label: 'Potential Shock Loss', value: `-$${(shockImpact / 100).toLocaleString()}`, color: 'red' }
      ],
      charts: [
        {
          config: {
             xKey: 'currency',
             yKeys: [{ key: 'exposure', name: 'Exposure (Base)', color: '#f59e0b', type: 'bar' }]
          },
          data: currencyExposureData
        }
      ],
      insights: [
        `Entity has $${(totalBaseExposure / 100).toLocaleString()} net exposed to non-base currencies across ${currencyExposureData.length} foreign currencies.`,
        `A ${inputs.shockPct}% adverse move in FX rates would result in a $${(shockImpact / 100).toLocaleString()} realized shock loss.`,
        `Consider implementing forward contracts or natural hedging to mitigate currency concentration.`
      ],
      sourceTransactionIds: Array.from(sourceTransactionIds)
    };
  }
};
