/**
 * US Federal Payroll Tax Tables and Calculation Helpers (docs/PLAN.md US-5, Task D-15 / D-18).
 *
 * Implements IRS Publication 15-T (Federal Income Tax Withholding Methods) percentage-method
 * tables for Form W-4 (2020 or later), Social Security (OASDI) wage base and rates, Medicare
 * hospital insurance (HI) including Additional Medicare Tax, and Federal Unemployment Tax (FUTA).
 *
 * All rate tables carry `validFrom`, `validTo`, and authoritative IRS / SSA sources.
 * Pure math and lookup data; calculations produce integer cents.
 */

export type UsPayrollFilingStatus =
  | 'single' // Single or Married Filing Separately
  | 'married_filing_jointly'
  | 'head_of_household';

export type UsPayFrequency =
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'annually';

export interface TaxBracket {
  overCents: number;
  baseTaxCents: number;
  rate: number; // percentage, e.g. 10, 12, 22, 24, 32, 35, 37
}

export interface FederalWithholdingTableEntry {
  validFrom: string;
  validTo?: string;
  filingStatus: UsPayrollFilingStatus;
  rateTier: 'standard' | 'higher';
  step2Checked: boolean;
  standardDeductionAdjustmentCents: number; // Worksheet 1A standard deduction adjustment
  brackets: TaxBracket[];
  source: { authority: string; url: string; title: string; retrieved: string };
}

export interface FicaRates {
  validFrom: string;
  validTo?: string;
  socialSecurityWageBaseCents: number;
  socialSecurityEmployeeRate: number; // 6.2%
  socialSecurityEmployerRate: number; // 6.2%
  medicareEmployeeRate: number; // 1.45%
  medicareEmployerRate: number; // 1.45%
  additionalMedicareThresholdCents: {
    single: number; // $200,000 (IRC § 3102(f)(1) / IRS Pub 15: employer withholding threshold for all employees)
    married_filing_jointly: number; // $250,000 (Individual 1040 reconciliation threshold)
    married_filing_separately: number; // $125,000 (Individual 1040 reconciliation threshold)
    head_of_household: number; // $200,000 (Individual 1040 reconciliation threshold)
  };
  additionalMedicareRate: number; // 0.9%
  futaWageBaseCents: number; // $7,000 (IRC § 3306(b)(1))
  futaGrossRate: number; // 6.0% (IRC § 3301)
  futaMaxCredit: number; // 5.4% (IRC § 3302)
  futaEffectiveRate: number; // 0.6% (6.0% - 5.4%)
  source: { authority: string; url: string; title: string; retrieved: string };
}

export const PAY_PERIODS_PER_YEAR: Record<UsPayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  annually: 1,
};

const DEFAULT_ADDITIONAL_MEDICARE = {
  single: 20000000, // $200,000 (Statutory employer withholding threshold IRC § 3102(f)(1))
  married_filing_jointly: 25000000, // $250,000 (1040 reconciliation IRC § 3101(b)(2))
  married_filing_separately: 12500000, // $125,000 (1040 reconciliation)
  head_of_household: 20000000, // $200,000 (1040 reconciliation)
};

/**
 * FICA & FUTA Parameters (2025 and 2026).
 * Sources:
 * - 2026 Social Security Wage Base ($184,500): SSA Press Release & Fact Sheet (October 2025)
 *   https://www.ssa.gov/oact/cola/cbb.html
 * - 2025 Social Security Wage Base ($176,100): SSA Fact Sheet / IRS Pub 15 (2025)
 * - FICA Rates: IRC § 3101(a), § 3111(a) (6.2% OASDI), IRC § 3101(b), § 3111(b) (1.45% Medicare)
 * - FUTA Rates: IRC § 3301 (6.0% gross), § 3302 (5.4% credit), § 3306(b)(1) ($7,000 limit)
 */
export const US_FICA_FUTA_HISTORY: FicaRates[] = [
  {
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    socialSecurityWageBaseCents: 18450000, // $184,500 (2026 SSA Contribution and Benefit Base)
    socialSecurityEmployeeRate: 6.2,
    socialSecurityEmployerRate: 6.2,
    medicareEmployeeRate: 1.45,
    medicareEmployerRate: 1.45,
    additionalMedicareThresholdCents: DEFAULT_ADDITIONAL_MEDICARE,
    additionalMedicareRate: 0.9,
    futaWageBaseCents: 700000, // $7,000
    futaGrossRate: 6.0,
    futaMaxCredit: 5.4,
    futaEffectiveRate: 0.6,
    source: {
      authority: 'IRS / SSA',
      url: 'https://www.ssa.gov/oact/cola/cbb.html',
      title: 'Social Security Administration 2026 Contribution and Benefit Base',
      retrieved: '2026-11-08',
    },
  },
  {
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    socialSecurityWageBaseCents: 17610000, // $176,100 (2025 SSA Contribution Base)
    socialSecurityEmployeeRate: 6.2,
    socialSecurityEmployerRate: 6.2,
    medicareEmployeeRate: 1.45,
    medicareEmployerRate: 1.45,
    additionalMedicareThresholdCents: DEFAULT_ADDITIONAL_MEDICARE,
    additionalMedicareRate: 0.9,
    futaWageBaseCents: 700000, // $7,000
    futaGrossRate: 6.0,
    futaMaxCredit: 5.4,
    futaEffectiveRate: 0.6,
    source: {
      authority: 'IRS / SSA',
      url: 'https://www.irs.gov/publications/p15',
      title: 'IRS Publication 15 (2025) Employer Tax Guide',
      retrieved: '2026-11-08',
    },
  },
];

type BracketTuple = [overCents: number, baseTaxCents: number, rate: number];

function makeBrackets(tuples: BracketTuple[]): TaxBracket[] {
  return tuples.map(([overCents, baseTaxCents, rate]) => ({ overCents, baseTaxCents, rate }));
}

// IRS Pub 15-T Section 1 Table 1(b) (Form W-4 Step 2 checked): Worksheet 1A Step 1f applies $0
// adjustment, so each Step-2 threshold equals half of (Table 1(a) threshold + Step 1g adjustment)
// and baseTaxCents equals half of Table 1(a) baseTaxCents, preserving 2 * Step2(W/2) === Std(W).
function makeStep2Brackets(std: TaxBracket[], step1gAdjustmentCents: number): TaxBracket[] {
  return std.map((b, idx) =>
    idx === 0
      ? { overCents: 0, baseTaxCents: 0, rate: b.rate }
      : {
          overCents: Math.round((b.overCents + step1gAdjustmentCents) / 2),
          baseTaxCents: Math.round(b.baseTaxCents / 2),
          rate: b.rate,
        },
  );
}

// 2026 Tax Brackets from IRS Publication 15-T (Section 1: Percentage Method Tables for Automated Payroll Systems)
// Table 1(a): Standard withholding (Form W-4 Step 2 box NOT checked)
const B2026_SINGLE_STD = makeBrackets([
  [0, 0, 0],
  [750000, 0, 10],
  [1990000, 124000, 12],
  [6430000, 656800, 22],
  [12300000, 1948200, 24],
  [22500000, 4396200, 32],
  [28500000, 6316200, 35],
  [68500000, 20316200, 37],
]);

const B2026_MFJ_STD = makeBrackets([
  [0, 0, 0],
  [1490000, 0, 10],
  [3970000, 248000, 12],
  [12850000, 1313600, 22],
  [24590000, 3896400, 24],
  [44990000, 8792400, 32],
  [56990000, 12632400, 35],
  [81990000, 21382400, 37],
]);

const B2026_HOH_STD = makeBrackets([
  [0, 0, 0],
  [1270000, 0, 10],
  [3325000, 205500, 12],
  [8800000, 862500, 22],
  [12500000, 1676500, 24],
  [22700000, 4124500, 32],
  [28700000, 6044500, 35],
  [68700000, 20044500, 37],
]);

// Table 1(b): Higher withholding (Form W-4 Step 2 box IS checked)
const B2026_SINGLE_STEP2 = makeStep2Brackets(B2026_SINGLE_STD, 860000);
const B2026_MFJ_STEP2 = makeStep2Brackets(B2026_MFJ_STD, 1290000);
const B2026_HOH_STEP2 = makeStep2Brackets(B2026_HOH_STD, 860000);

// 2025 Tax Brackets from IRS Publication 15-T (2025)
// Table 1(a): Standard withholding (Form W-4 Step 2 box NOT checked)
const B2025_SINGLE_STD = makeBrackets([
  [0, 0, 0],
  [710000, 0, 10],
  [1900000, 119000, 12],
  [6150000, 629000, 22],
  [11800000, 1872000, 24],
  [21500000, 4200000, 32],
  [27200000, 6024000, 35],
  [65400000, 19394000, 37],
]);

const B2025_MFJ_STD = makeBrackets([
  [0, 0, 0],
  [1420000, 0, 10],
  [3800000, 238000, 12],
  [12300000, 1258000, 22],
  [23600000, 3744000, 24],
  [43000000, 8400000, 32],
  [54400000, 12048000, 35],
  [78300000, 20413000, 37],
]);

const B2025_HOH_STD = makeBrackets([
  [0, 0, 0],
  [1210000, 0, 10],
  [3180000, 197000, 12],
  [8420000, 825800, 22],
  [11950000, 1602400, 24],
  [21700000, 3942400, 32],
  [27400000, 5766400, 35],
  [65600000, 19136400, 37],
]);

// Table 1(b): Higher withholding (Form W-4 Step 2 box IS checked)
const B2025_SINGLE_STEP2 = makeStep2Brackets(B2025_SINGLE_STD, 860000);
const B2025_MFJ_STEP2 = makeStep2Brackets(B2025_MFJ_STD, 1290000);
const B2025_HOH_STEP2 = makeStep2Brackets(B2025_HOH_STD, 860000);

function buildYearTables(
  year: number,
  stdBrackets: Record<UsPayrollFilingStatus, TaxBracket[]>,
  step2Brackets: Record<UsPayrollFilingStatus, TaxBracket[]>,
): FederalWithholdingTableEntry[] {
  const validFrom = `${year}-01-01`;
  const validTo = `${year}-12-31`;
  const url = 'https://www.irs.gov/publications/p15t';
  const title = `IRS Publication 15-T (${year}) Percentage Method Tables for Automated Payroll Systems`;

  const statuses: UsPayrollFilingStatus[] = ['single', 'married_filing_jointly', 'head_of_household'];

  return statuses.flatMap(status => [
    {
      validFrom,
      validTo,
      filingStatus: status,
      rateTier: 'standard',
      step2Checked: false,
      standardDeductionAdjustmentCents: status === 'married_filing_jointly' ? 1290000 : 860000,
      brackets: stdBrackets[status],
      source: { authority: 'IRS', url, title: `${title}, Table 1(a)`, retrieved: '2026-11-08' },
    },
    {
      validFrom,
      validTo,
      filingStatus: status,
      rateTier: 'higher',
      step2Checked: true,
      standardDeductionAdjustmentCents: 0,
      brackets: step2Brackets[status],
      source: { authority: 'IRS', url, title: `${title}, Table 1(b)`, retrieved: '2026-11-08' },
    },
  ]);
}

/**
 * Annual Percentage-Method Withholding Brackets for Form W-4 (2020 or later).
 * Values in cents per year.
 * Source: IRS Publication 15-T (Section 1: Percentage Method Tables for Automated Payroll Systems).
 */
export const US_FEDERAL_WITHHOLDING_ANNUAL: FederalWithholdingTableEntry[] = [
  ...buildYearTables(
    2026,
    { single: B2026_SINGLE_STD, married_filing_jointly: B2026_MFJ_STD, head_of_household: B2026_HOH_STD },
    { single: B2026_SINGLE_STEP2, married_filing_jointly: B2026_MFJ_STEP2, head_of_household: B2026_HOH_STEP2 },
  ),
  ...buildYearTables(
    2025,
    { single: B2025_SINGLE_STD, married_filing_jointly: B2025_MFJ_STD, head_of_household: B2025_HOH_STD },
    { single: B2025_SINGLE_STEP2, married_filing_jointly: B2025_MFJ_STEP2, head_of_household: B2025_HOH_STEP2 },
  ),
];

/**
 * Returns the active FICA/FUTA rates for a given date.
 */
export function getFicaRatesOn(date: string): FicaRates {
  const match = US_FICA_FUTA_HISTORY.find(
    r => r.validFrom <= date && (!r.validTo || date <= r.validTo),
  );
  if (!match) {
    throw new Error(
      `No FICA/FUTA rates available for date "${date}". Supported range: 2025-01-01 to 2026-12-31.`,
    );
  }
  return match;
}

/**
 * Finds the applicable annual federal withholding bracket table for the status, step 2, and date.
 */
export function getFederalWithholdingTable(
  filingStatus: UsPayrollFilingStatus,
  step2Checked: boolean,
  date: string,
): FederalWithholdingTableEntry | undefined {
  return US_FEDERAL_WITHHOLDING_ANNUAL.find(
    entry =>
      entry.filingStatus === filingStatus &&
      entry.step2Checked === step2Checked &&
      entry.validFrom <= date &&
      (!entry.validTo || date <= entry.validTo),
  );
}

/**
 * Calculates Federal Income Tax (FIT) withholding for a single pay period using the percentage method.
 *
 * Implements IRS Publication 15-T (2020 or later Form W-4) Worksheet 1A and Tables 1(a) / 1(b).
 *
 * @param periodWageCents - Taxable wages for the pay period in integer cents
 * @param filingStatus - Single / Married Filing Jointly / Head of Household
 * @param step2Checked - Whether Form W-4 Step 2 checkbox is ticked
 * @param frequency - Pay frequency (weekly, biweekly, monthly, etc.)
 * @param date - Payroll date (YYYY-MM-DD)
 * @returns Withholding amount in integer cents
 */
export function calculateFederalIncomeTaxWithholding(
  periodWageCents: number,
  filingStatus: UsPayrollFilingStatus,
  step2Checked: boolean,
  frequency: UsPayFrequency,
  date = '2026-01-01',
): number {
  if (periodWageCents <= 0) return 0;

  const table = getFederalWithholdingTable(filingStatus, step2Checked, date);
  if (!table) {
    throw new Error(
      `No federal withholding table available for date "${date}" and status "${filingStatus}". Supported date range: 2025-01-01 to 2026-12-31.`,
    );
  }

  const periods = PAY_PERIODS_PER_YEAR[frequency] || 1;
  const annualWageCents = periodWageCents * periods;

  // Apply Worksheet 1A annual wage adjustment (subtract standard deduction allowance when Step 2 is unchecked)
  const adjustedAnnualWageCents = Math.max(
    0,
    annualWageCents - table.standardDeductionAdjustmentCents,
  );

  if (adjustedAnnualWageCents <= 0) return 0;

  // Find the highest bracket where adjustedAnnualWageCents > bracket.overCents
  let matchedBracket = table.brackets[0];
  for (const bracket of table.brackets) {
    if (adjustedAnnualWageCents > bracket.overCents) {
      matchedBracket = bracket;
    } else {
      break;
    }
  }

  const excessCents = adjustedAnnualWageCents - matchedBracket.overCents;
  const annualTaxCents =
    matchedBracket.baseTaxCents +
    Math.round((excessCents * matchedBracket.rate) / 100);

  // Divide back to period and round to nearest cent
  return Math.max(0, Math.round(annualTaxCents / periods));
}

export interface FicaBreakdown {
  socialSecurityEmployeeCents: number;
  socialSecurityEmployerCents: number;
  medicareEmployeeCents: number;
  medicareEmployerCents: number;
  additionalMedicareEmployeeCents: number;
  totalEmployeeFicaCents: number;
  totalEmployerFicaCents: number;
}

/**
 * Calculates FICA (Social Security, Medicare, Additional Medicare) taxes.
 *
 * @param currentPeriodWageCents - Taxable gross wages for this pay period in integer cents
 * @param priorYtdSubjectWageCents - Employee's prior YTD wages subject to FICA in integer cents
 * @param filingStatus - Employee's tax filing status
 * @param date - Payroll date (YYYY-MM-DD)
 */
export function calculateFicaTax(
  currentPeriodWageCents: number,
  priorYtdSubjectWageCents = 0,
  _filingStatus: UsPayrollFilingStatus = 'single',
  date = '2026-01-01',
): FicaBreakdown {
  if (currentPeriodWageCents <= 0) {
    return {
      socialSecurityEmployeeCents: 0,
      socialSecurityEmployerCents: 0,
      medicareEmployeeCents: 0,
      medicareEmployerCents: 0,
      additionalMedicareEmployeeCents: 0,
      totalEmployeeFicaCents: 0,
      totalEmployerFicaCents: 0,
    };
  }

  const rates = getFicaRatesOn(date);
  const newYtdWageCents = priorYtdSubjectWageCents + currentPeriodWageCents;

  // Social Security (capped at wage base)
  const ssCap = rates.socialSecurityWageBaseCents;
  let ssSubjectWageCents = 0;
  if (priorYtdSubjectWageCents < ssCap) {
    ssSubjectWageCents = Math.min(
      currentPeriodWageCents,
      ssCap - priorYtdSubjectWageCents,
    );
  }

  const ssEmployee = Math.round(
    (ssSubjectWageCents * rates.socialSecurityEmployeeRate) / 100,
  );
  const ssEmployer = Math.round(
    (ssSubjectWageCents * rates.socialSecurityEmployerRate) / 100,
  );

  // Regular Medicare (no wage base cap)
  const medEmployee = Math.round(
    (currentPeriodWageCents * rates.medicareEmployeeRate) / 100,
  );
  const medEmployer = Math.round(
    (currentPeriodWageCents * rates.medicareEmployerRate) / 100,
  );

  // Additional Medicare (employee only, on wages exceeding threshold)
  // Under IRC § 3102(f)(1) and IRS Pub 15 Section 9, employers MUST withhold Additional Medicare Tax
  // at the $200,000 threshold regardless of the employee's filing status.
  const addlThreshold = rates.additionalMedicareThresholdCents.single; // $200,000
  let addlSubjectWageCents = 0;

  if (newYtdWageCents > addlThreshold) {
    if (priorYtdSubjectWageCents >= addlThreshold) {
      addlSubjectWageCents = currentPeriodWageCents;
    } else {
      addlSubjectWageCents = newYtdWageCents - addlThreshold;
    }
  }

  const addlMedicareEmployee = Math.round(
    (addlSubjectWageCents * rates.additionalMedicareRate) / 100,
  );

  return {
    socialSecurityEmployeeCents: ssEmployee,
    socialSecurityEmployerCents: ssEmployer,
    medicareEmployeeCents: medEmployee,
    medicareEmployerCents: medEmployer,
    additionalMedicareEmployeeCents: addlMedicareEmployee,
    totalEmployeeFicaCents: ssEmployee + medEmployee + addlMedicareEmployee,
    totalEmployerFicaCents: ssEmployer + medEmployer,
  };
}

export interface FutaBreakdown {
  futaSubjectWageCents: number;
  futaTaxCents: number; // Effective rate after max state credit (0.6%)
}

/**
 * Calculates FUTA (Federal Unemployment) tax. Employer-only; taxable on first $7,000 per employee per year.
 */
export function calculateFutaTax(
  currentPeriodWageCents: number,
  priorYtdSubjectWageCents = 0,
  date = '2026-01-01',
): FutaBreakdown {
  if (currentPeriodWageCents <= 0) {
    return { futaSubjectWageCents: 0, futaTaxCents: 0 };
  }

  const rates = getFicaRatesOn(date);
  const futaCap = rates.futaWageBaseCents;

  let futaSubjectWageCents = 0;
  if (priorYtdSubjectWageCents < futaCap) {
    futaSubjectWageCents = Math.min(
      currentPeriodWageCents,
      futaCap - priorYtdSubjectWageCents,
    );
  }

  const futaTaxCents = Math.round(
    (futaSubjectWageCents * rates.futaEffectiveRate) / 100,
  );

  return {
    futaSubjectWageCents,
    futaTaxCents,
  };
}
