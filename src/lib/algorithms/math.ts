export function calculateEOQ(annualDemand: number, orderingCost: number, holdingCost: number): number {
  if (holdingCost === 0) return 0;
  return Math.sqrt((2 * annualDemand * orderingCost) / holdingCost);
}

export function calculateWACC(
  equity: number, 
  debt: number, 
  costOfEquity: number, 
  costOfDebt: number, 
  taxRate: number
): number {
  const totalVal = equity + debt;
  if (totalVal === 0) return 0;
  const equityWeight = equity / totalVal;
  const debtWeight = debt / totalVal;
  return (equityWeight * costOfEquity) + (debtWeight * costOfDebt * (1 - taxRate));
}

export function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

export function mean(data: number[]): number {
  if (data.length === 0) return 0;
  return data.reduce((sum, val) => sum + val, 0) / data.length;
}

export function standardDeviation(data: number[]): number {
  if (data.length === 0) return 0;
  const m = mean(data);
  const variance = data.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / data.length;
  return Math.sqrt(variance);
}

// Benford's Law distribution check
export function benfordsLawExpected(digit: number): number {
  if (digit < 1 || digit > 9) return 0;
  return Math.log10(1 + 1 / digit);
}

export function extractFirstDigit(num: number): number {
  const str = Math.abs(num).toString().replace('.', '');
  for (let i = 0; i < str.length; i++) {
    const digit = Number.parseInt(str[i], 10);
    if (digit >= 1 && digit <= 9) return digit;
  }
  return 0; // If no non-zero digit found
}

export function calculateBenfordsDistribution(numbers: number[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  let validCount = 0;
  
  for (const num of numbers) {
    const digit = extractFirstDigit(num);
    if (digit >= 1 && digit <= 9) {
      counts[digit]++;
      validCount++;
    }
  }

  const distribution: Record<number, number> = {};
  for (let i = 1; i <= 9; i++) {
    distribution[i] = validCount > 0 ? counts[i] / validCount : 0;
  }
  return distribution;
}

// Net Present Value
export function calculateNPV(rate: number, initialInvestment: number, cashFlows: number[]): number {
  let npv = -initialInvestment;
  for (let i = 0; i < cashFlows.length; i++) {
    npv += cashFlows[i] / Math.pow(1 + rate, i + 1);
  }
  return npv;
}

// Internal Rate of Return (Approximate via Newton-Raphson)
export function calculateIRR(initialInvestment: number, cashFlows: number[], maxIterations = 50): number {
  let rate = 0.1; // Initial guess 10%
  for (let iter = 0; iter < maxIterations; iter++) {
    let npv = -initialInvestment;
    let derivative = 0;
    
    for (let i = 0; i < cashFlows.length; i++) {
      const t = i + 1;
      const factor = Math.pow(1 + rate, t);
      npv += cashFlows[i] / factor;
      derivative -= (t * cashFlows[i]) / (factor * (1 + rate));
    }
    
    if (Math.abs(npv) < 0.00001) {
      return rate;
    }
    
    if (Math.abs(derivative) < 1e-10) {
      return Number.NaN;
    }

    let newRate = rate - npv / derivative;
    newRate = Math.max(newRate, -0.9999);
    
    if (Math.abs(newRate - rate) < 0.00001) {
      return newRate;
    }
    rate = newRate;
  }
  return Number.NaN; // Return NaN if not converged fully
}
