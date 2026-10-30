import { errorMessage } from '../auth/requestUser';
import express from "express";
import { 
  DepreciationRequestSchema,
  InventoryWACRequestSchema,
  AmortizationRequestSchema,
  InventoryEOQRequestSchema,
  KPIRequestSchema,
  TemporalMathRequestSchema,
  ValuationRequestSchema
} from "../../schemas.ts";
import { TruthEngine } from "../../modules/integrity/TruthEngine.ts";
import { logSafe, logSafeDetail } from '../utils/logSafe';

export const mathRouter = express.Router();

function sendError(res: express.Response, message: string, status: number = 500, details?: any) {
  console.error(`[API Error] ${status}: ${logSafe(message)} (Path: ${logSafe(res.req?.originalUrl || "unknown")})`, logSafeDetail(details));
  res.status(status).json({
    status: "error",
    message,
    ...(details && { details })
  });
}

mathRouter.post("/depreciation", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = DepreciationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    
    const { type, costCents, salvageValueCents, usefulLifePeriods, depreciationRate, multiplier, currentPeriod } = parsed.data;
    
    let amount = 0;
    if (type === 'straight_line') {
      amount = TruthEngine.calculateStraightLineDepreciation(costCents, salvageValueCents, usefulLifePeriods);
    } else if (type === 'declining_balance' && depreciationRate !== undefined) {
      amount = TruthEngine.calculateDecliningBalanceDepreciation(costCents, depreciationRate);
    } else if (type === 'double_declining_balance') {
      amount = TruthEngine.calculateDoubleDecliningBalanceDepreciation(costCents, usefulLifePeriods, multiplier !== undefined ? multiplier : 2);
    } else if (type === 'sum_of_years_digits' && currentPeriod !== undefined) {
      amount = TruthEngine.calculateSumOfTheYearsDigitsDepreciation(costCents, salvageValueCents, usefulLifePeriods, currentPeriod);
    } else {
      return sendError(res, "Invalid parameters for requested depreciation type.", 400);
    }
    
    res.json({
      success: true,
      type,
      depreciationPerPeriodCents: amount
    });
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});

mathRouter.post("/inventory/wac", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = InventoryWACRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    
    const { currentQty, currentValueCents, incomingQty, incomingValueCents } = parsed.data;
    
    const newAverageCostCents = TruthEngine.calculateWACInventoryCost(
      currentQty, currentValueCents, incomingQty, incomingValueCents
    );
    
    res.json({
      success: true,
      newAverageCostCents,
      totalQuantity: currentQty + incomingQty,
      totalValueCents: currentValueCents + incomingValueCents
    });
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});

mathRouter.post("/amortization", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = AmortizationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    
    const { principalCents, annualInterestRate, totalPeriods, paymentsPerYear } = parsed.data;
    
    const periodicPaymentCents = TruthEngine.calculateLoanAmortizationPayment(
      principalCents, annualInterestRate, totalPeriods, paymentsPerYear !== undefined ? paymentsPerYear : 12
    );
    
    res.json({
      success: true,
      periodicPaymentCents,
      principalCents: principalCents,
      annualInterestRate: annualInterestRate,
      totalPeriods: totalPeriods
    });
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});

mathRouter.post("/inventory/eoq", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = InventoryEOQRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    
    const { annualDemand, costPerOrderCents, holdingCostPerUnitCents } = parsed.data;
    
    const eoq = TruthEngine.calculateEconomicOrderQuantity(
      annualDemand, costPerOrderCents, holdingCostPerUnitCents
    );
    
    res.json({
      success: true,
      eoq
    });
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});

mathRouter.post("/kpi", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = KPIRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    
    const { 
      netProfitCents, investmentCostCents,
      discountRate, initialInvestmentCents, cashFlowsCents,
      revenueCents, cogsCents,
      fixedCostsCents, variableCostPerUnitCents, pricePerUnitCents,
      currentAssetsCents, currentLiabilitiesCents, inventoryCents,
      totalLiabilitiesCents, totalEquityCents
    } = parsed.data;
    
    const result: any = { success: true };
    
    if (netProfitCents !== undefined && investmentCostCents !== undefined) {
      result.roiPercentage = TruthEngine.calculateROI(netProfitCents, investmentCostCents);
    }
    if (discountRate !== undefined && initialInvestmentCents !== undefined && Array.isArray(cashFlowsCents)) {
      result.npvCents = TruthEngine.calculateNPV(discountRate, initialInvestmentCents, cashFlowsCents);
    }
    if (revenueCents !== undefined && cogsCents !== undefined) {
      result.grossProfitMarginPercentage = TruthEngine.calculateGrossProfitMargin(revenueCents, cogsCents);
    }
    if (fixedCostsCents !== undefined && variableCostPerUnitCents !== undefined && pricePerUnitCents !== undefined) {
      result.breakEvenUnits = TruthEngine.calculateBreakEvenUnits(fixedCostsCents, variableCostPerUnitCents, pricePerUnitCents);
    }
    if (currentAssetsCents !== undefined && currentLiabilitiesCents !== undefined) {
      result.currentRatio = TruthEngine.calculateCurrentRatio(currentAssetsCents, currentLiabilitiesCents);
      if (inventoryCents !== undefined) {
        result.quickRatio = TruthEngine.calculateQuickRatio(currentAssetsCents, inventoryCents, currentLiabilitiesCents);
      }
    }
    if (totalLiabilitiesCents !== undefined && totalEquityCents !== undefined) {
      result.debtToEquityRatio = TruthEngine.calculateDebtToEquityRatio(totalLiabilitiesCents, totalEquityCents);
    }
    
    res.json(result);
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});

mathRouter.post("/temporal", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = TemporalMathRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    const { type, amountCents, targetDate, timeSeries } = parsed.data;
    
    let effectiveValue = 0;
    let calculatedAmountCents = 0;
    
    if (type === 'tax') {
      calculatedAmountCents = TruthEngine.evaluateHistoricalTaxLiability(amountCents, timeSeries as any, targetDate);
      effectiveValue = TruthEngine.resolveEffectiveValue(timeSeries as any, targetDate);
    } else if (type === 'currency') {
      calculatedAmountCents = TruthEngine.evaluateHistoricalConversion(amountCents, timeSeries as any, targetDate);
      effectiveValue = TruthEngine.resolveEffectiveValue(timeSeries as any, targetDate);
    }
    
    res.json({
      success: true,
      type,
      amountCents: amountCents,
      targetDate,
      effectiveValue,
      calculatedAmountCents
    });
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});

mathRouter.post("/valuation", async (req: express.Request, res: express.Response) => {
  try {
    const parsed = ValuationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "Validation failed", 400, parsed.error.issues);
    }
    
    const result: any = { success: true };
    const { 
      equityCents, debtCents, costOfEquity, costOfDebt, taxRate,
      forecastedFCFF, wacc, terminalGrowthRate,
      workingCapital, retainedEarnings, ebit, mktValueEquity, totalLiabilities, totalAssets, sales
    } = parsed.data;

    if (equityCents !== undefined && debtCents !== undefined && costOfEquity !== undefined && costOfDebt !== undefined && taxRate !== undefined) {
      result.waccInfo = {
        wacc: TruthEngine.calculateWACC(equityCents, debtCents, costOfEquity, costOfDebt, taxRate)
      };
    }

    if (forecastedFCFF && wacc !== undefined && terminalGrowthRate !== undefined) {
      result.dcfInfo = {
        impliedValuationCents: TruthEngine.calculateDCFValuation(forecastedFCFF, wacc, terminalGrowthRate)
      };
    }

    if (workingCapital !== undefined && retainedEarnings !== undefined && ebit !== undefined && mktValueEquity !== undefined && totalLiabilities !== undefined && totalAssets !== undefined && sales !== undefined) {
       result.riskInfo = {
          altmanZScore: TruthEngine.evaluateAltmanZScore(workingCapital, retainedEarnings, ebit, mktValueEquity, totalLiabilities, totalAssets, sales)
       };
    }

    res.json(result);
  } catch (err) {
    sendError(res, errorMessage(err), 400);
  }
});
