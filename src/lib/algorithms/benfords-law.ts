import { AlgorithmDefinition, AlgoResult } from './types';

export const BENFORDS_LAW_ALGO: AlgorithmDefinition = {
  id: 'forensics_benford',
  name: 'Benford\'s Law Fraud Analysis',
  domain: 'forensics',
  tags: ['Fraud', 'Audit', 'Compliance', 'Mathematical'],
  description: 'Analyzes transaction amounts against Benford\'s Law of anomalous numbers to detect potential fraud, artificial transactions, or systemic data anomalies.',
  inputs: [
    {
      key: 'minAmount',
      label: 'Minimum Amount Filter',
      min: 0,
      max: 1000,
      step: 10,
      defaultValue: 10
    }
  ],
  compute: (ctx, inputs: { "minAmount": number; [key: string]: unknown }): AlgoResult => {
    const { transactions } = ctx;
    const minAmount = inputs['minAmount'] ?? 10;
    
    // 1. Filter and Extract Leading Digits
    const validTransactions = transactions.filter(t => Math.abs(t.totalAmountCents / 100) >= minAmount);
    
    const digitCounts: Record<number, number> = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0 };
    let totalCount = 0;
    
    validTransactions.forEach(tx => {
      const amountStr = String(Math.abs(tx.totalAmountCents)).replace(/^0+/, '');
      let leadingDigit = 0;
      
      const match = amountStr.match(/^[1-9]/);
      if (match) {
        leadingDigit = Number.parseInt(match[0], 10);
      }
      
      if (leadingDigit >= 1 && leadingDigit <= 9) {
        digitCounts[leadingDigit]++;
        totalCount++;
      }
    });
    
    if (totalCount < 30) {
      return {
        metrics: [
          { label: 'Sample Size', value: totalCount, color: 'text-amber-500' }
        ],
        charts: [],
        insights: [
          'Not enough data. Benford\'s Law analysis requires at least ~30 transactions to be statistically meaningful.'
        ]
      };
    }
    
    // 2. Calculate Benford's Expected Distribution vs Actual
    const chartData = [];
    let maxDeviation = 0;
    let maxDeviationDigit = 1;
    let totalMAD = 0; // Mean Absolute Deviation
    
    for (let i = 1; i <= 9; i++) {
      const expectedPct = Math.log10(1 + 1 / i) * 100;
      const actualPct = totalCount === 0 ? 0 : (digitCounts[i] / totalCount) * 100;
      const deviation = Math.abs(actualPct - expectedPct);
      
      totalMAD += deviation;
      if (deviation > maxDeviation) {
        maxDeviation = deviation;
        maxDeviationDigit = i;
      }
      
      chartData.push({
        digit: i.toString(),
        Actual: Number.parseFloat(actualPct.toFixed(2)),
        Expected: Number.parseFloat(expectedPct.toFixed(2))
      });
    }
    
    const avgMAD = totalMAD / 9;
    
    // 3. Interpret the MAD
    // For Benford's first digit, MAD thresholds generally:
    // 0.0 - 0.006: Close conformity
    // 0.006 - 0.012: Acceptable conformity
    // 0.012 - 0.015: Marginally acceptable
    // > 0.015: Nonconformity
    // Here our MAD is in percentage points (0 to 100), so divide by 100 for standard scale
    const madScale = avgMAD / 100;
    
    let conformity = 'Close Conformity';
    let conformityColor = 'text-emerald-500';
    if (madScale > 0.015) {
      conformity = 'Nonconformity (High Risk)';
      conformityColor = 'text-rose-500';
    } else if (madScale > 0.012) {
      conformity = 'Marginal (Monitor)';
      conformityColor = 'text-amber-500';
    } else if (madScale > 0.006) {
      conformity = 'Acceptable';
      conformityColor = 'text-blue-500';
    }
    
    const insights = [];
    insights.push(`Analyzed ${totalCount} transactions using Benford's Law distribution.`);
    
    if (madScale > 0.012) {
      insights.push(`⚠️ The dataset shows significant deviation from expected natural numbers. High risk of fabricated data or systemic rounding rules.`);
      insights.push(`The digit "${maxDeviationDigit}" appears ${chartData[maxDeviationDigit - 1].Actual.toFixed(1)}% of the time, deviating heavily from the expected ${chartData[maxDeviationDigit - 1].Expected.toFixed(1)}%.`);
    } else {
      insights.push(`The dataset conforms well to naturally occurring financial distributions. No obvious mathematical anomalies detected.`);
    }

    return {
      metrics: [
        { label: 'Conformity Level', value: conformity, color: conformityColor },
        { label: 'Mean Abs Deviation (MAD)', value: madScale.toFixed(4) },
        { label: 'Sample Size', value: totalCount }
      ],
      charts: [
        {
          config: {
            xKey: 'digit',
            yKeys: [
              { key: 'Expected', name: 'Expected (Benford)', color: '#94a3b8', type: 'line' },
              { key: 'Actual', name: 'Actual Distribution', color: '#6366f1', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights
    };
  }
};
