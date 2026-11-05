import { currencyDigits } from '../../lib/currencyMinorUnits';
import { parseLocalDate } from '../../lib/calendarDate';
// Architecture: Core Integrity Engine
// Enforces that numbers, facts, and validations are strictly correct. No false info.
import { TemporalValidity, ChartAccount } from '../../types';
import Decimal from 'decimal.js';
import { evaluateAmountExpression } from '../../lib/amountExpression';

import { lineAmount } from '../../lib/txFilters';
import { computeBalanceSheet } from '../../server/reports/computeReports';

export class TruthEngine {
  static resolveEffectiveValue(timeSeries: TemporalValidity[], targetDateStr: string): number {
    const targetTime = parseLocalDate(targetDateStr).getTime();
    if (Number.isNaN(targetTime)) {
      throw new Error(`Integrity Violation: Invalid target date format -> ${targetDateStr}`);
    }

    const sortedSeries = [...timeSeries].sort((a, b) => parseLocalDate(b.validFrom).getTime() - parseLocalDate(a.validFrom).getTime());

    for (const record of sortedSeries) {
      const fromTime = parseLocalDate(record.validFrom).getTime();
      const toTime = record.validTo ? parseLocalDate(record.validTo).getTime() : Infinity;

      if (targetTime >= fromTime && targetTime <= toTime) {
        return record.value;
      }
    }

    throw new Error(`Integrity Violation: No effective temporal value found for date ${targetDateStr}. System refuses to guess rates.`);
  }

  static evaluateHistoricalConversion(amountCents: number, exchangeRatesTimeline: TemporalValidity[], transactionDate: string): number {
    const exchangeRate = this.resolveEffectiveValue(exchangeRatesTimeline, transactionDate);
    if (exchangeRate <= 0) throw new Error('Integrity Violation: Exchange rate must be strictly positive.');
    return new Decimal(amountCents).mul(exchangeRate).round().toNumber();
  }

  static evaluateHistoricalTaxLiability(amountCents: number, taxRatesTimeline: TemporalValidity[], transactionDate: string): number {
    const taxRate = this.resolveEffectiveValue(taxRatesTimeline, transactionDate);
    if (taxRate < 0) throw new Error('Integrity Violation: Tax rate cannot be negative.');
    return new Decimal(amountCents).mul(taxRate).round().toNumber();
  }
  
  static deriveSignedTotal(lines: Array<Partial<import("../../types").TransactionLine>>, accounts?: ChartAccount[]): number {
    if (!lines || lines.length === 0) return 0;
    
    if (accounts && accounts.length > 0) {
      const assetLines = lines.filter(l => {
        const acc = accounts.find(a => a.id === l.accountId);
        return acc && acc.type === 'asset';
      });
      if (assetLines.length > 0) {
        return assetLines.reduce((sum, l) => sum + lineAmount(l as unknown as import("../../types").TransactionLine), 0);
      }
      
      const liabilityLines = lines.filter(l => {
        const acc = accounts.find(a => a.id === l.accountId);
        return acc && acc.type === 'liability';
      });
      if (liabilityLines.length > 0) {
        // Liability increasing (credit/negative) means inflow of cash
        return -liabilityLines.reduce((sum, l) => sum + lineAmount(l as unknown as import("../../types").TransactionLine), 0);
      }
    }
    
    // Fallback when accounts context is absent: sum of debit legs
    const debitSum = lines
      .filter(l => (l.amountCents || 0) > 0)
      .reduce((sum, l) => sum + lineAmount(l as unknown as import("../../types").TransactionLine), 0);
    return debitSum || Math.abs(lineAmount(lines[0] as unknown as import("../../types").TransactionLine));
  }

  /** Minor units of `currency` (BM-04: whole yen, three-decimal dinars); cents when no currency is given. */
  static parseAmountToCents(amountString: string | number | null | undefined, currency?: string | null): number {
    if (amountString === null || amountString === undefined) {
      throw new Error('Integrity Violation: Amount cannot be empty');
    }
    let s = String(amountString).trim();
    if (!s) throw new Error('Integrity Violation: Amount cannot be empty');

    // Handle unicode minus, currency symbols, commas, and whitespace
    s = s.replace(/\u2212/g, '-').replace(/[$€£¥]/g, '').replace(/,/g, '').trim();

    // Handle parenthesized negatives: (123.45) -> -123.45 (only if not an arithmetic expression)
    if (s.startsWith('(') && s.endsWith(')') && !/[+\-*/]/.test(s.slice(1, -1))) {
      s = '-' + s.slice(1, -1).trim();
    }

    // Handle trailing CR (credit / negative) / DR (debit / positive)
    let isCR = false;
    let isDR = false;
    if (/[\s]?(CR|cr)$/i.test(s)) {
      isCR = true;
      s = s.replace(/[\s]?(CR|cr)$/i, '').trim();
    } else if (/[\s]?(DR|dr)$/i.test(s)) {
      isDR = true;
      s = s.replace(/[\s]?(DR|dr)$/i, '').trim();
    }

    try {
      let val: number;
      // If the string contains arithmetic operators (+, -, *, /, or parenthesis), route through evaluateAmountExpression
      const digits = currencyDigits(currency);
      if (/[+\-*/(]/.test(s) && !/^-?[0-9.]+$/.test(s)) {
        // the expression is worked out in cents; another currency's units are scaled from them
        const cents = evaluateAmountExpression(s);
        val = digits === 2 ? cents : Math.round(cents * 10 ** (digits - 2));
      } else {
        val = new Decimal(s).mul(10 ** digits).round().toNumber();
      }
      if (Number.isNaN(val)) throw new Error('Integrity Violation: Parsed amount is NaN');
      if (isCR) val = -Math.abs(val);
      if (isDR) val = Math.abs(val);
      return val;
    } catch (e) {
      throw new Error(`Integrity Violation: Invalid amount format: ${amountString}`, { cause: e });
    }
  }

  static parseAmountToCentsOrZero(amountString: string | number | null | undefined, currency?: string | null): number {
    if (amountString === null || amountString === undefined) return 0;
    const s = String(amountString).trim();
    if (!s) return 0;
    try {
      return TruthEngine.parseAmountToCents(s, currency);
    } catch {
      return 0;
    }
  }

  static validateAccountingIntegrity(entries: Array<{ amount: number, type: 'debit' | 'credit' }>): boolean {
    let balance = new Decimal(0);
    for (const entry of entries) {
      if (typeof entry.amount !== 'number' || Number.isNaN(entry.amount)) {
        throw new Error('Integrity Violation: Financial amounts must be precise numbers.');
      }
      const val = new Decimal(Math.abs(entry.amount));
      balance = entry.type === 'debit' ? balance.plus(val) : balance.minus(val);
    }
    
    return balance.abs().lessThan(0.01);
  }

  static assertImmutabilityId(recordId: string | null | undefined): void {
    if (!recordId) {
       throw new Error('Integrity Violation: All integrity records must carry a cryptographic or system identifier.');
    }
  }

  static sanitizeFact(input: string): string {
    return input.trim();
  }

  static calculateStraightLineDepreciation(costCents: number, salvageValueCents: number, usefulLifePeriods: number): number {
    if (usefulLifePeriods <= 0) throw new Error('Integrity Violation: Useful life must be strictly positive.');
    if (salvageValueCents > costCents) throw new Error('Integrity Violation: Salvage value cannot exceed initial cost.');
    return new Decimal(costCents).minus(salvageValueCents).div(usefulLifePeriods).round().toNumber();
  }

  static calculateDecliningBalanceDepreciation(bookValueCents: number, depreciationRate: number): number {
    if (depreciationRate <= 0 || depreciationRate > 1) throw new Error('Integrity Violation: Rate must be between 0 and 1.');
    return new Decimal(bookValueCents).mul(depreciationRate).round().toNumber();
  }

  static calculateLoanAmortizationPayment(principalCents: number, annualInterestRate: number, totalPeriods: number, paymentsPerYear: number = 12): number {
    if (totalPeriods <= 0) throw new Error('Integrity Violation: Periods must be strictly positive.');
    if (paymentsPerYear <= 0) throw new Error('Integrity Violation: Payments per year must be strictly positive.');
    if (annualInterestRate === 0) return new Decimal(principalCents).div(totalPeriods).round().toNumber();
    
    const ratePerPeriod = new Decimal(annualInterestRate).div(paymentsPerYear);
    const p = new Decimal(principalCents);
    const onePlusRToN = ratePerPeriod.plus(1).pow(totalPeriods);
    
    const pmt = p.mul(ratePerPeriod).mul(onePlusRToN).div(onePlusRToN.minus(1));
    return pmt.round().toNumber();
  }

  static calculateWACInventoryCost(currentQuantity: number, currentTotalValueCents: number, incomingQuantity: number, incomingValueCents: number): number {
    const totalQuantity = new Decimal(currentQuantity).plus(incomingQuantity);
    if (totalQuantity.lessThanOrEqualTo(0)) return 0;
    const totalValueCents = new Decimal(currentTotalValueCents).plus(incomingValueCents);
    return totalValueCents.div(totalQuantity).round().toNumber();
  }

  static analyzeBudgetVariance(actualCents: number, budgetedCents: number, isRevenue: boolean = false): { varianceCents: number, variancePercentage: number, isFavorable: boolean } {
    const a = new Decimal(actualCents);
    const b = new Decimal(budgetedCents);
    const varianceCents = isRevenue ? a.minus(b) : b.minus(a);
    const variancePercentage = b.greaterThan(0) ? varianceCents.abs().div(b).mul(100).toNumber() : 0;
    return {
      varianceCents: varianceCents.toNumber(),
      variancePercentage,
      isFavorable: varianceCents.greaterThanOrEqualTo(0)
    };
  }

  static calculateDoubleDecliningBalanceDepreciation(bookValueCents: number, usefulLifePeriods: number, multiplier: number = 2): number {
    if (usefulLifePeriods <= 0) throw new Error('Integrity Violation: Useful life must be strictly positive.');
    const depreciationRate = new Decimal(multiplier).div(usefulLifePeriods);
    return new Decimal(bookValueCents).mul(depreciationRate).round().toNumber();
  }

  static calculateSumOfTheYearsDigitsDepreciation(costCents: number, salvageValueCents: number, usefulLifePeriods: number, currentPeriod: number): number {
    if (usefulLifePeriods <= 0) throw new Error('Integrity Violation: Useful life must be strictly positive.');
    if (currentPeriod <= 0 || currentPeriod > usefulLifePeriods) throw new Error('Integrity Violation: Current period is out of bounds.');
    
    const n = new Decimal(usefulLifePeriods);
    const sumOfDigits = n.mul(n.plus(1)).div(2);
    const remainingLife = n.minus(currentPeriod).plus(1);
    const depreciationBase = new Decimal(costCents).minus(salvageValueCents);
    
    return depreciationBase.mul(remainingLife.div(sumOfDigits)).round().toNumber();
  }

  static calculateEconomicOrderQuantity(annualDemand: number, costPerOrderCents: number, holdingCostPerUnitCents: number): number {
    if (holdingCostPerUnitCents <= 0) throw new Error('Integrity Violation: Holding cost must be positive.');
    const d = new Decimal(annualDemand);
    const s = new Decimal(costPerOrderCents);
    const h = new Decimal(holdingCostPerUnitCents);
    return d.mul(s).mul(2).div(h).sqrt().round().toNumber();
  }

  static calculateROI(netProfitCents: number, investmentCostCents: number): number {
    if (investmentCostCents === 0) return 0;
    return new Decimal(netProfitCents).div(investmentCostCents).mul(100).toNumber();
  }

  static calculateWACC(
    equityValueCents: number,
    debtValueCents: number,
    costOfEquity: number,
    costOfDebt: number,
    corporateTaxRate: number
  ): number {
    const e = new Decimal(equityValueCents);
    const d = new Decimal(debtValueCents);
    const totalCapital = e.plus(d);
    if (totalCapital.lessThanOrEqualTo(0)) return 0;
    
    // Normalize percentage inputs (> 1 assumed to be e.g. 21% or 10%)
    const normKe = costOfEquity > 1 ? new Decimal(costOfEquity).div(100) : new Decimal(costOfEquity);
    const normKd = costOfDebt > 1 ? new Decimal(costOfDebt).div(100) : new Decimal(costOfDebt);
    const normTax = corporateTaxRate > 1 ? new Decimal(corporateTaxRate).div(100) : new Decimal(corporateTaxRate);

    const equityWeight = e.div(totalCapital);
    const debtWeight = d.div(totalCapital);
    
    const equityComponent = equityWeight.mul(normKe);
    const debtComponent = debtWeight.mul(normKd).mul(new Decimal(1).minus(normTax));
    
    return equityComponent.plus(debtComponent).toNumber();
  }

  static calculateCAGR(beginningValueCents: number, endingValueCents: number, numYears: number): number {
    if (beginningValueCents <= 0 || endingValueCents <= 0 || numYears <= 0) return 0;
    const b = new Decimal(beginningValueCents);
    const e = new Decimal(endingValueCents);
    return e.div(b).pow(new Decimal(1).div(numYears)).minus(1).toNumber();
  }

  static calculateMACRSDepreciation(costCents: number, yearIdx: number, assetClassYears: number): number {
      const tables: Record<number, number[]> = {
          3: [0.3333, 0.4445, 0.1481, 0.0741],
          5: [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576],
          7: [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446]
      };
      const table = tables[assetClassYears] || [];
      const rate = table[yearIdx] || 0;
      return new Decimal(costCents).mul(rate).round().toNumber();
  }

  static calculateNPV(discountRate: number, initialInvestmentCents: number, cashFlowsCents: number[]): number {
    let npv = new Decimal(initialInvestmentCents).neg();
    const r = new Decimal(1).plus(discountRate);
    for (let t = 0; t < cashFlowsCents.length; t++) {
      npv = npv.plus(new Decimal(cashFlowsCents[t]).div(r.pow(t + 1)));
    }
    return npv.round().toNumber();
  }

  static calculateGrossProfitMargin(revenueCents: number, cogsCents: number): number {
    if (revenueCents === 0) return 0;
    const r = new Decimal(revenueCents);
    return r.minus(cogsCents).div(r).mul(100).toNumber();
  }

  static calculateBreakEvenUnits(fixedCostsCents: number, variableCostPerUnitCents: number, pricePerUnitCents: number): number {
    const contributionMargin = new Decimal(pricePerUnitCents).minus(variableCostPerUnitCents);
    if (contributionMargin.lessThanOrEqualTo(0)) throw new Error('Integrity Violation: Contribution margin must be positive to break even.');
    return new Decimal(fixedCostsCents).div(contributionMargin).ceil().toNumber();
  }

  static calculateCurrentRatio(currentAssetsCents: number, currentLiabilitiesCents: number): number {
    if (currentLiabilitiesCents === 0) return 0;
    return new Decimal(currentAssetsCents).div(currentLiabilitiesCents).toNumber();
  }

  static calculateQuickRatio(currentAssetsCents: number, inventoryCents: number, currentLiabilitiesCents: number): number {
    if (currentLiabilitiesCents === 0) return 0;
    return new Decimal(currentAssetsCents).minus(inventoryCents).div(currentLiabilitiesCents).toNumber();
  }

  static calculateDebtToEquityRatio(totalLiabilitiesCents: number, totalEquityCents: number): number {
    if (totalEquityCents === 0) return 0;
    return new Decimal(totalLiabilitiesCents).div(totalEquityCents).toNumber();
  }

  // Fallback for typed arrays
  static generateVectorizedDCF(
    forecastsLen: number,
    baseFCFsCents: Float64Array,
    waccOptions: Float64Array, 
    growthOptions: Float64Array
  ): Float64Array {
    const totalScenarios = waccOptions.length * growthOptions.length;
    const results = new Float64Array(totalScenarios);
    
    let scenarioIdx = 0;
    
    for (let w = 0; w < waccOptions.length; w++) {
       const waccNum = waccOptions[w];
       const wacc = new Decimal(waccNum);
       for (let g = 0; g < growthOptions.length; g++) {
          const growthNum = growthOptions[g];
          const growth = new Decimal(growthNum);
          
          if (wacc.lessThanOrEqualTo(growth)) {
             results[scenarioIdx++] = 0; 
             continue;
          }
          
          let npv = new Decimal(0);
          for (let t = 0; t < forecastsLen; t++) {
             npv = npv.plus(new Decimal(baseFCFsCents[t]).div(wacc.plus(1).pow(t + 1)));
          }
          
          const finalFCF = new Decimal(baseFCFsCents[forecastsLen - 1]);
          const terminalValue = finalFCF.mul(growth.plus(1)).div(wacc.minus(growth));
          npv = npv.plus(terminalValue.div(wacc.plus(1).pow(forecastsLen)));
          
          results[scenarioIdx++] = npv.round().toNumber();
       }
    }
    
    return results;
  }

  static evaluateAltmanZScore(
    workingCapital: number, retainedEarnings: number,
    ebit: number, mktValueEquity: number, totalLiabilities: number,
    totalAssets: number, sales: number
  ): number {
    if (totalAssets === 0 || totalLiabilities === 0) return 0;
    const X1 = new Decimal(workingCapital).div(totalAssets);
    const X2 = new Decimal(retainedEarnings).div(totalAssets);
    const X3 = new Decimal(ebit).div(totalAssets);
    const X4 = new Decimal(mktValueEquity).div(totalLiabilities);
    const X5 = new Decimal(sales).div(totalAssets);
    
    return X1.mul(1.2).plus(X2.mul(1.4)).plus(X3.mul(3.3)).plus(X4.mul(0.6)).plus(X5.mul(0.999)).toNumber();
  }

  static calculateFCFF(ebit: number, taxRate: number, depreciation: number, capitalExpenditure: number, changeInNWC: number): number {
    return new Decimal(ebit).mul(new Decimal(1).minus(taxRate))
            .plus(depreciation).minus(capitalExpenditure).minus(changeInNWC).toNumber();
  }

  static calculateFCFE(netIncome: number, depreciation: number, capitalExpenditure: number, changeInNWC: number, netBorrowing: number): number {
    return new Decimal(netIncome).plus(depreciation).minus(capitalExpenditure).minus(changeInNWC).plus(netBorrowing).toNumber();
  }

  static calculateDCFValuation(
    forecastedFCFF: number[],
    wacc: number,
    terminalGrowthRate: number
  ): number {
    if (wacc <= terminalGrowthRate) throw new Error("Integrity Violation: WACC must be strictly greater than Terminal Growth Rate to avoid infinite valuation.");
    let impliedValue = new Decimal(0);
    const w = new Decimal(wacc);
    const tgr = new Decimal(terminalGrowthRate);

    for (let t = 0; t < forecastedFCFF.length; t++) {
      impliedValue = impliedValue.plus(new Decimal(forecastedFCFF[t]).div(w.plus(1).pow(t + 1)));
    }
    const finalYearFCFF = new Decimal(forecastedFCFF[forecastedFCFF.length - 1]);
    const terminalValue = finalYearFCFF.mul(tgr.plus(1)).div(w.minus(tgr));
    impliedValue = impliedValue.plus(terminalValue.div(w.plus(1).pow(forecastedFCFF.length)));
    return impliedValue.round().toNumber();
  }

  static calculateRuleOf40(growthRatePct: number, ebitdaMarginPct: number): number {
    return new Decimal(growthRatePct).plus(ebitdaMarginPct).toNumber();
  }

  static calculateCAC(totalMarketingAndSalesCostCents: number, newCustomersAcquired: number): number {
    if (newCustomersAcquired <= 0) return Infinity; // infinite CAC if no customers acquired
    return new Decimal(totalMarketingAndSalesCostCents).div(newCustomersAcquired).round().toNumber();
  }

  static calculateLTV(arpuCents: number, grossMarginPct: number, churnRatePct: number): number {
    if (churnRatePct <= 0 || churnRatePct > 100) return Infinity;
    const a = new Decimal(arpuCents);
    const g = new Decimal(grossMarginPct).div(100);
    const c = new Decimal(churnRatePct).div(100);
    return a.mul(g).div(c).round().toNumber();
  }

  static calculateLTVtoCAC(ltvCents: number, cacCents: number): number {
    if (cacCents === 0) return 0;
    return new Decimal(ltvCents).div(cacCents).toNumber();
  }

  static calculateMagicNumber(currentQtrARR: number, priorQtrARR: number, priorQtrSMCost: number): number {
    if (priorQtrSMCost === 0) return 0;
    return new Decimal(currentQtrARR).minus(priorQtrARR).div(priorQtrSMCost).toNumber();
  }

  static calculateDSO(accountsReceivableCents: number, totalCreditSalesCents: number, daysInPeriod: number): number {
    if (totalCreditSalesCents === 0) return 0;
    return new Decimal(accountsReceivableCents).div(totalCreditSalesCents).mul(daysInPeriod).toNumber();
  }

  static calculateDuPontROE(netIncome: number, sales: number, assets: number, equity: number): { roe: number, profitMargin: number, assetTurnover: number, equityMultiplier: number } {
    if (sales === 0 || assets === 0 || equity === 0) return { roe: 0, profitMargin: 0, assetTurnover: 0, equityMultiplier: 0 };
    
    const profitMargin = new Decimal(netIncome).div(sales);
    const assetTurnover = new Decimal(sales).div(assets);
    const equityMultiplier = new Decimal(assets).div(equity);
    
    return {
      profitMargin: profitMargin.toNumber(),
      assetTurnover: assetTurnover.toNumber(),
      equityMultiplier: equityMultiplier.toNumber(),
      roe: profitMargin.mul(assetTurnover).mul(equityMultiplier).toNumber()
    };
  }

  static calculateSharpeRatio(portfolioReturnPct: number, riskFreeRatePct: number, standardDeviationPct: number): number {
    if (standardDeviationPct === 0) return 0;
    return new Decimal(portfolioReturnPct).minus(riskFreeRatePct).div(standardDeviationPct).toNumber();
  }

  static calculateCAPM(riskFreeRatePct: number, beta: number, expectedMarketReturnPct: number): number {
    return new Decimal(riskFreeRatePct).plus(new Decimal(beta).mul(new Decimal(expectedMarketReturnPct).minus(riskFreeRatePct))).toNumber();
  }

  static calculateEVA(nopat: number, totalCapital: number, wacc: number): number {
    return new Decimal(nopat).minus(new Decimal(totalCapital).mul(wacc)).round().toNumber();
  }

  static evaluatePiotroskiFScore(
    roaS: boolean, cfoS: boolean, roaDeltaS: boolean, qualityOfEarningsS: boolean,
    leverageDeltaS: boolean, liquidityDeltaS: boolean, equityIssueS: boolean,
    marginDeltaS: boolean, turnoverDeltaS: boolean
  ): number {
    let score = 0;
    if (roaS) score++;
    if (cfoS) score++;
    if (roaDeltaS) score++;
    if (qualityOfEarningsS) score++;
    if (leverageDeltaS) score++;
    if (liquidityDeltaS) score++;
    if (equityIssueS) score++;
    if (marginDeltaS) score++;
    if (turnoverDeltaS) score++;
    return score;
  }

  static scanOrphanedAccountReferences(accounts: Array<{ id: string }>, transactions: import("../../types").Transaction[]): {
    orphanedAccountIds: string[];
    orphanedLines: Array<{
      transactionId: string;
      date: string;
      accountId: string;
      amountCents: number;
    }>;
    totalOrphanedAmountCents: number;
  } {
    const { orphanedLines } = computeBalanceSheet(accounts as unknown as ChartAccount[], transactions);
    const orphanedAccountIdsSet = new Set<string>();
    const formattedOrphanedLines = orphanedLines.map(l => {
      orphanedAccountIdsSet.add(l.accountId);
      return {
        transactionId: l.transactionId || '',
        date: l.date || '',
        accountId: l.accountId,
        amountCents: l.amountCents
      };
    });

    return {
      orphanedAccountIds: Array.from(orphanedAccountIdsSet),
      orphanedLines: formattedOrphanedLines,
      totalOrphanedAmountCents: formattedOrphanedLines.reduce((sum, l) => sum + Math.abs(l.amountCents), 0)
    };
  }
}


