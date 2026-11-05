import { Employee, TemporalValidity } from '../types';
import { TruthEngine } from '../modules/integrity/TruthEngine';
import { getLocalDateISO } from './calendarDate';
import { afterTaxLines, preTaxLines, type DeductionLine } from './payrollDeductions';

export const PAYROLL_DISCLAIMER = 'Estimations for financial forecasting, budgeting, and enterprise liability planning only. Not a certified tax calculation for official IRS/state tax returns.';

export interface PayPeriodBreakdown {
  grossPayCents: number;
  preTaxDeductionsCents: number;
  taxableGrossCents: number;
  employeeFicaSocialSecurityCents: number;
  employeeFicaMedicareCents: number;
  employeeAdditionalMedicareCents: number;
  employeeFederalTaxCents: number;
  employeeStateTaxCents: number;
  employeeCityTaxCents: number;
  employeeCountyTaxCents: number;
  netPayCents: number;
  employerFicaSocialSecurityCents: number;
  employerFicaMedicareCents: number;
  employerFutaCents: number;
  employerSutaCents: number;
  totalWithholdingCents: number;
  totalEmployerTaxCents: number;
  totalPeriodLiabilityCents: number;
  /** U-05, U-06: taken after taxes (garnishments first, then after-tax deductions) */
  postTaxDeductionsCents: number;
  garnishmentsCents: number;
  /** every deduction taken this period, by name (the one pre-tax amount kept before is "Pre-tax deductions") */
  deductionLines: DeductionLine[];
  disclaimer: string;
}

export function getPeriodsPerYear(frequency: Employee['payFrequency']): number {
  switch (frequency) {
    case 'Weekly': return 52;
    case 'Bi-Weekly': return 26;
    case 'Monthly': return 12;
    default: return 12;
  }
}

/**
 * High-precision progressive tax tier withholding engine for multiple fiscal years.
 * Accounts for real-world IRS Single, Married, and Head of Household brackets,
 * Social Security wage base caps, FUTA limits, and Additional Medicare rules.
 */

export interface TaxBracket {
  limitCents: number;
  rate: number;
}

export interface TaxYearConfig {
  standardDeductionSingleCents: number;
  standardDeductionMarriedCents: number;
  standardDeductionHeadOfHouseholdCents: number;
  socialSecurityWageBaseCents: number;
  futaWageBaseCents: number;
  additionalMedicareThresholdSingleCents: number;
  additionalMedicareThresholdMarriedCents: number;
  singleBrackets: TaxBracket[];
  marriedBrackets: TaxBracket[];
}

export const FEDERAL_TAX_YEARS: Record<number, TaxYearConfig> = {
  2024: {
    standardDeductionSingleCents: 1460000,
    standardDeductionMarriedCents: 2920000,
    standardDeductionHeadOfHouseholdCents: 2190000,
    socialSecurityWageBaseCents: 16860000, // $168,600 cap
    futaWageBaseCents: 700000, // $7,000 cap
    additionalMedicareThresholdSingleCents: 20000000, // $200,000
    additionalMedicareThresholdMarriedCents: 25000000, // $250,000
    singleBrackets: [
      { limitCents: 1160000, rate: 0.10 },
      { limitCents: 4715000, rate: 0.12 },
      { limitCents: 10052500, rate: 0.22 },
      { limitCents: 19195000, rate: 0.24 },
      { limitCents: 24372500, rate: 0.32 },
      { limitCents: 60935000, rate: 0.35 },
      { limitCents: Infinity, rate: 0.37 },
    ],
    marriedBrackets: [
      { limitCents: 2320000, rate: 0.10 },
      { limitCents: 9430000, rate: 0.12 },
      { limitCents: 20105000, rate: 0.22 },
      { limitCents: 38390000, rate: 0.24 },
      { limitCents: 48745000, rate: 0.32 },
      { limitCents: 73120000, rate: 0.35 },
      { limitCents: Infinity, rate: 0.37 },
    ]
  },
  2025: {
    standardDeductionSingleCents: 1500000,
    standardDeductionMarriedCents: 3000000,
    standardDeductionHeadOfHouseholdCents: 2250000,
    socialSecurityWageBaseCents: 17610000, // $176,100 cap
    futaWageBaseCents: 700000, // $7,000 cap
    additionalMedicareThresholdSingleCents: 20000000,
    additionalMedicareThresholdMarriedCents: 25000000,
    singleBrackets: [
      { limitCents: 1192500, rate: 0.10 },
      { limitCents: 4847500, rate: 0.12 },
      { limitCents: 10335000, rate: 0.22 },
      { limitCents: 19730000, rate: 0.24 },
      { limitCents: 25052500, rate: 0.32 },
      { limitCents: 62635000, rate: 0.35 },
      { limitCents: Infinity, rate: 0.37 },
    ],
    marriedBrackets: [
      { limitCents: 2385000, rate: 0.10 },
      { limitCents: 9695000, rate: 0.12 },
      { limitCents: 20670000, rate: 0.22 },
      { limitCents: 39460000, rate: 0.24 },
      { limitCents: 50105000, rate: 0.32 },
      { limitCents: 75160000, rate: 0.35 },
      { limitCents: Infinity, rate: 0.37 },
    ]
  },
  2026: {
    standardDeductionSingleCents: 1545000,
    standardDeductionMarriedCents: 3090000,
    standardDeductionHeadOfHouseholdCents: 2317500,
    socialSecurityWageBaseCents: 18300000, // $183,000 cap
    futaWageBaseCents: 700000, // $7,000 cap
    additionalMedicareThresholdSingleCents: 20000000,
    additionalMedicareThresholdMarriedCents: 25000000,
    singleBrackets: [
      { limitCents: 1227500, rate: 0.10 },
      { limitCents: 4992500, rate: 0.12 },
      { limitCents: 10645000, rate: 0.22 },
      { limitCents: 20322500, rate: 0.24 },
      { limitCents: 25805000, rate: 0.32 },
      { limitCents: 64515000, rate: 0.35 },
      { limitCents: Infinity, rate: 0.37 },
    ],
    marriedBrackets: [
      { limitCents: 2455000, rate: 0.10 },
      { limitCents: 9985000, rate: 0.12 },
      { limitCents: 21290000, rate: 0.22 },
      { limitCents: 40645000, rate: 0.24 },
      { limitCents: 51610000, rate: 0.32 },
      { limitCents: 77415000, rate: 0.35 },
      { limitCents: Infinity, rate: 0.37 },
    ]
  }
};

/**
 * Returns tax laws for the specified fiscal year.
 * Automatically compounds inflation adjustments for future or unindexed years.
 */
export function getFederalTaxYearConfig(year: number): TaxYearConfig {
  if (FEDERAL_TAX_YEARS[year]) {
    return FEDERAL_TAX_YEARS[year];
  }
  const baseYear = 2026;
  const delta = year - baseYear;
  const config2026 = FEDERAL_TAX_YEARS[baseYear];

  const standardDeductionSingleCents = Math.max(1200000, config2026.standardDeductionSingleCents + delta * 50000);
  const standardDeductionMarriedCents = standardDeductionSingleCents * 2;
  const standardDeductionHeadOfHouseholdCents = Math.round(standardDeductionSingleCents * 1.5);

  const scale = Math.pow(1.03, delta);
  const socialSecurityWageBaseCents = Math.round(config2026.socialSecurityWageBaseCents * scale);

  const singleBrackets = config2026.singleBrackets.map(b => ({
    limitCents: b.limitCents === Infinity ? Infinity : Math.round(b.limitCents * scale),
    rate: b.rate
  }));

  const marriedBrackets = config2026.marriedBrackets.map(b => ({
    limitCents: b.limitCents === Infinity ? Infinity : Math.round(b.limitCents * scale),
    rate: b.rate
  }));

  return {
    standardDeductionSingleCents,
    standardDeductionMarriedCents,
    standardDeductionHeadOfHouseholdCents,
    socialSecurityWageBaseCents,
    futaWageBaseCents: 700000,
    additionalMedicareThresholdSingleCents: 20000000,
    additionalMedicareThresholdMarriedCents: 25000000,
    singleBrackets,
    marriedBrackets
  };
}

export interface TemporalRegionalTaxRates {
  stateCode: string;
  stateName: string;
  stateRateSeries: TemporalValidity[];
  sutaRate?: number;
  sutaWageBaseCents?: number;
  cityCode?: string;
  cityName?: string;
  cityRateSeries?: TemporalValidity[];
  countyCode?: string;
  countyName?: string;
  countyRateSeries?: TemporalValidity[];
}

export interface RegionalTaxRates {
  stateCode: string;
  stateName: string;
  stateRate: number; 
  sutaRate: number;
  sutaWageBaseCents: number;
  cityCode?: string;
  cityName?: string;
  cityRate?: number; 
  countyCode?: string;
  countyName?: string;
  countyRate?: number; 
}

export const REGIONAL_TAX_LOOKUPS: Record<string, TemporalRegionalTaxRates> = {
  'NY': { stateCode: 'NY', stateName: 'New York', sutaRate: 0.027, sutaWageBaseCents: 1280000, stateRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.065 }], cityCode: 'NYC', cityName: 'New York City', cityRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.03876 }], countyCode: 'KC', countyName: 'Kings County', countyRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.01 }] },
  'CA': { stateCode: 'CA', stateName: 'California', sutaRate: 0.034, sutaWageBaseCents: 700000, stateRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.080 }], cityCode: 'SF', cityName: 'San Francisco', cityRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.015 }], countyCode: 'SFC', countyName: 'SF County', countyRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.005 }] },
  'TX': { stateCode: 'TX', stateName: 'Texas', sutaRate: 0.027, sutaWageBaseCents: 900000, stateRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.00 }] },
  'FL': { stateCode: 'FL', stateName: 'Florida', sutaRate: 0.027, sutaWageBaseCents: 700000, stateRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.00 }] },
  'IL': { stateCode: 'IL', stateName: 'Illinois', sutaRate: 0.031, sutaWageBaseCents: 1359000, stateRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.0495 }] },
  'OH': { stateCode: 'OH', stateName: 'Ohio', sutaRate: 0.027, sutaWageBaseCents: 900000, stateRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.035 }], cityCode: 'CLE', cityName: 'Cleveland', cityRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.02 }], countyCode: 'CC', countyName: 'Cuyahoga County', countyRateSeries: [{ validFrom: '0000-01-01', validTo: '9999-12-31', value: 0.0075 }] },
};

export function getRegionalTaxConfig(stateCode: string = 'NY', targetDateStr: string = getLocalDateISO()): RegionalTaxRates {
  const code = (stateCode || 'NY').toUpperCase();
  const config = REGIONAL_TAX_LOOKUPS[code];
  
  if (!config) {
    return {
      stateCode: code,
      stateName: `${code} (Default Bracket)`,
      stateRate: 0.045, 
      sutaRate: 0.027,
      sutaWageBaseCents: 1000000, // $10,000 default state wage base
      cityCode: 'GEN_CITY',
      cityName: 'Local City',
      cityRate: 0.01,  
      countyCode: 'GEN_COUNTY',
      countyName: 'Local County',
      countyRate: 0.005  
    };
  }

  return {
    stateCode: config.stateCode,
    stateName: config.stateName,
    stateRate: TruthEngine.resolveEffectiveValue(config.stateRateSeries, targetDateStr),
    sutaRate: config.sutaRate ?? 0.027,
    sutaWageBaseCents: config.sutaWageBaseCents ?? 1000000,
    cityCode: config.cityCode,
    cityName: config.cityName,
    cityRate: config.cityRateSeries ? TruthEngine.resolveEffectiveValue(config.cityRateSeries, targetDateStr) : undefined,
    countyCode: config.countyCode,
    countyName: config.countyName,
    countyRate: config.countyRateSeries ? TruthEngine.resolveEffectiveValue(config.countyRateSeries, targetDateStr) : undefined
  };
}

export function computeFederalIncomeTaxWithholding(
  annualSalaryCents: number, 
  payPeriods: number, 
  year: number = 2026,
  filingStatus: Employee['filingStatus'] = 'Single',
  annualPreTaxDeductionsCents: number = 0
): number {
  const config = getFederalTaxYearConfig(year);
  
  // Resolve standard deduction based on filing status
  let standardDeduction = config.standardDeductionSingleCents;
  let brackets = config.singleBrackets;

  if (filingStatus === 'Married') {
    standardDeduction = config.standardDeductionMarriedCents;
    brackets = config.marriedBrackets;
  } else if (filingStatus === 'Head of Household') {
    standardDeduction = config.standardDeductionHeadOfHouseholdCents;
    brackets = config.singleBrackets;
  }

  const taxableAnnualSalaryCents = Math.max(0, annualSalaryCents - annualPreTaxDeductionsCents - standardDeduction);
  
  let remainingCents = taxableAnnualSalaryCents;
  let previousLimitCents = 0;
  let annualTaxCents = 0;

  for (const bracket of brackets) {
    const widthCents = bracket.limitCents - previousLimitCents;
    const taxableInThisBracketCents = Math.min(remainingCents, widthCents);
    
    if (taxableInThisBracketCents <= 0) break;
    
    annualTaxCents += taxableInThisBracketCents * bracket.rate;
    remainingCents -= taxableInThisBracketCents;
    previousLimitCents = bracket.limitCents;
  }

  return Math.round(annualTaxCents / payPeriods);
}

export function computePeriodPayroll(employee: Employee, year: number = 2026): PayPeriodBreakdown {
  const payPeriods = getPeriodsPerYear(employee.payFrequency);
  const grossPayCents = Math.round(employee.salaryCents / payPeriods);
  // U-08: a contractor is paid the agreed amount in full: nothing withheld, no employer taxes
  if (employee.workerType === 'contractor') {
    return {
      grossPayCents, preTaxDeductionsCents: 0, taxableGrossCents: grossPayCents,
      employeeFicaSocialSecurityCents: 0, employeeFicaMedicareCents: 0, employeeAdditionalMedicareCents: 0,
      employeeFederalTaxCents: 0, employeeStateTaxCents: 0, employeeCityTaxCents: 0, employeeCountyTaxCents: 0,
      netPayCents: grossPayCents, employerFicaSocialSecurityCents: 0, employerFicaMedicareCents: 0, employerFutaCents: 0, employerSutaCents: 0,
      totalWithholdingCents: 0, totalEmployerTaxCents: 0, totalPeriodLiabilityCents: grossPayCents,
      postTaxDeductionsCents: 0, garnishmentsCents: 0, deductionLines: [], disclaimer: PAYROLL_DISCLAIMER,
    };
  }
  const config = getFederalTaxYearConfig(year);

  // Pre-tax deductions (401k, health, HSA): the one amount kept before, plus the named ones (U-05)
  const legacyPreTaxCents = employee.preTaxDeductionsCents || 0;
  const named = employee.deductions || [];
  const preTaxNamed = preTaxLines(named, grossPayCents, legacyPreTaxCents);
  const preTaxPeriodCents = legacyPreTaxCents + preTaxNamed.reduce((s, l) => s + l.cents, 0);
  const annualPreTaxDeductionsCents = preTaxPeriodCents * payPeriods;
  const taxableGrossAnnualCents = Math.max(0, employee.salaryCents - annualPreTaxDeductionsCents);
  const taxableGrossCents = Math.max(0, grossPayCents - preTaxPeriodCents);

  // 1. Social Security (6.2%) — Subject to annual wage base cap
  const ssAnnualWageLimit = config.socialSecurityWageBaseCents;
  const taxableSsAnnualCents = Math.min(taxableGrossAnnualCents, ssAnnualWageLimit);
  const employeeFicaSocialSecurityCents = Math.round((taxableSsAnnualCents * 0.062) / payPeriods);
  const employerFicaSocialSecurityCents = Math.round((taxableSsAnnualCents * 0.062) / payPeriods);

  // 2. Medicare (1.45% base on all wages + 0.9% Additional Medicare for high earners over threshold)
  const standardMedicareEmployeeCents = Math.round((taxableGrossAnnualCents * 0.0145) / payPeriods);
  const employerFicaMedicareCents = Math.round((taxableGrossAnnualCents * 0.0145) / payPeriods);

  const additionalMedicareThreshold = employee.filingStatus === 'Married' 
    ? config.additionalMedicareThresholdMarriedCents 
    : config.additionalMedicareThresholdSingleCents;

  const excessOverThresholdCents = Math.max(0, taxableGrossAnnualCents - additionalMedicareThreshold);
  const employeeAdditionalMedicareCents = Math.round((excessOverThresholdCents * 0.009) / payPeriods);
  const employeeFicaMedicareCents = standardMedicareEmployeeCents + employeeAdditionalMedicareCents;

  // 3. Federal Income Tax (FIT) withholding using filing status and tax year
  const employeeFederalTaxCents = computeFederalIncomeTaxWithholding(
    employee.salaryCents, 
    payPeriods, 
    year, 
    employee.filingStatus, 
    annualPreTaxDeductionsCents
  );

  // 4. Regional Tax Rates calculation (State, City, County) from employee state
  const userLocState = employee.state || 'NY';
  const regionalConfig = getRegionalTaxConfig(userLocState);

  // State Income Tax mapping on taxable wages
  const employeeStateTaxCents = Math.round(taxableGrossCents * regionalConfig.stateRate);

  // Local City Tax mapping
  const employeeCityTaxCents = Math.round(taxableGrossCents * (regionalConfig.cityRate || 0));

  // County margin surcharge mapping
  const employeeCountyTaxCents = Math.round(taxableGrossCents * (regionalConfig.countyRate || 0));

  // 5. FUTA: 0.6% on first $7,000 of wages per employee per year
  const futaTaxableAnnualCents = Math.min(taxableGrossAnnualCents, config.futaWageBaseCents);
  const employerFutaCents = Math.round((futaTaxableAnnualCents * 0.006) / payPeriods);

  // 6. SUTA: State-specific rate on state wage base cap
  const sutaTaxableAnnualCents = Math.min(taxableGrossAnnualCents, regionalConfig.sutaWageBaseCents);
  const employerSutaCents = Math.round((sutaTaxableAnnualCents * regionalConfig.sutaRate) / payPeriods);

  const totalWithholdingCents = 
    employeeFicaSocialSecurityCents + 
    employeeFicaMedicareCents + 
    employeeFederalTaxCents + 
    employeeStateTaxCents + 
    employeeCityTaxCents + 
    employeeCountyTaxCents;

  // U-06 garnishments, then U-05 after-tax deductions, from what is left (disposable earnings: gross less taxes)
  const afterTaxesCents = grossPayCents - preTaxPeriodCents - totalWithholdingCents;
  const afterTax = afterTaxLines(named, afterTaxesCents, grossPayCents, Math.max(0, grossPayCents - totalWithholdingCents));
  const garnishmentsCents = afterTax.filter(l => l.kind === 'garnishment').reduce((s, l) => s + l.cents, 0);
  const postTaxDeductionsCents = afterTax.filter(l => l.kind === 'post_tax').reduce((s, l) => s + l.cents, 0);
  const netPayCents = afterTaxesCents - garnishmentsCents - postTaxDeductionsCents;
  const deductionLines: DeductionLine[] = [
    ...(legacyPreTaxCents ? [{ id: 'pre-tax', name: 'Pre-tax deductions', kind: 'pre_tax' as const, cents: legacyPreTaxCents, requestedCents: legacyPreTaxCents }] : []),
    ...preTaxNamed, ...afterTax,
  ].filter(l => l.requestedCents > 0);

  const totalEmployerTaxCents = 
    employerFicaSocialSecurityCents + 
    employerFicaMedicareCents + 
    employerFutaCents + 
    employerSutaCents;

  // Total cash outflow expected from the enterprise: Gross wages + Employer taxes
  const totalPeriodLiabilityCents = grossPayCents + totalEmployerTaxCents;

  return {
    grossPayCents,
    preTaxDeductionsCents: preTaxPeriodCents,
    taxableGrossCents,
    employeeFicaSocialSecurityCents,
    employeeFicaMedicareCents,
    employeeAdditionalMedicareCents,
    employeeFederalTaxCents,
    employeeStateTaxCents,
    employeeCityTaxCents,
    employeeCountyTaxCents,
    netPayCents,
    employerFicaSocialSecurityCents,
    employerFicaMedicareCents,
    employerFutaCents,
    employerSutaCents,
    totalWithholdingCents,
    totalEmployerTaxCents,
    totalPeriodLiabilityCents,
    postTaxDeductionsCents,
    garnishmentsCents,
    deductionLines,
    disclaimer: PAYROLL_DISCLAIMER
  };
}

