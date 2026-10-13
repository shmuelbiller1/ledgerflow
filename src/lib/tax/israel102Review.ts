/**
 * E-18: read-only review totals for Israeli employer payroll.
 *
 * NII Form 102 reports employee/employer National Insurance plus employee
 * health insurance. Wage income-tax withholding is shown separately: it is
 * NOT an NII Form 102 amount. Never turn this into an e-file payload.
 *
 * Official sources:
 * https://www.gov.il/en/service/socialsecuritypaymentforemployees
 * https://www.btl.gov.il/English%20Homepage/Insurance/Employers/Pages/personal100.aspx
 *
 * Inputs must be independently reviewed ILS minor units for Israeli-resident
 * salaried employees. Existing US-oriented payroll/PayRun.taxes data does
 * NOT provide these facts. There is no posting, I/O or rate calculation.
 */
export interface Israel102ReviewRun {
  id: string;
  period: string;  // civil payroll month YYYY-MM, not submission month
  status: 'processed' | 'draft' | 'failed' | 'undone' | 'awaiting_approval' | 'rejected' | 'withdrawn';
  currency: string;
  employeeCount: number;
  /** User has reviewed residency and the source figures; NOT official certification. */
  sourceReviewed: boolean;
  incomeTaxWithheldCents?: number;
  nationalEmployeeCents?: number;
  nationalEmployerCents?: number;
  healthEmployeeCents?: number;
}

export interface Israel102ReviewSummary {
  readyForFiling: false;
  canReview: boolean;
  period: string;
  runCount: number;
  employeeOccurrences: number;
  incomeTaxWithheldCents: number;  // separate income-tax stream
  nationalEmployeeCents: number;
  nationalEmployerCents: number;
  healthEmployeeCents: number;
  nationalAndHealthCents: number;  // NII review total (employee + employer + health)
  warnings: string[];
  errors: string[];
}

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;

function isMinorUnits(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

const AMOUNTS = [
  'incomeTaxWithheldCents', 'nationalEmployeeCents',
  'nationalEmployerCents', 'healthEmployeeCents',
] as const;

/**
 * Sums ONLY posted, individually checked records from the selected month.
 * Missing, noninteger, unsafe, unknown-currency or unreviewed data blocks the
 * summary: never silently treat an absent amount as zero.
 */
export function israel102Review(
  runs: readonly Israel102ReviewRun[],
  period: string,
): Israel102ReviewSummary {
  const errors: string[] = [];
  const warnings = [
    'Review-only preview, not a filed Form 102 or an approved payroll calculation.',
    'Income-tax withholding is separate from National Insurance Form 102 reporting.',
    'Verify residency, payroll classifications, deductions and the complete month with your accountant.',
  ];
  let employeeOccurrences = 0;
  let incomeTaxWithheldCents = 0;
  let nationalEmployeeCents = 0;
  let nationalEmployerCents = 0;
  let healthEmployeeCents = 0;
  let runCount = 0;
  if (!MONTH.test(period)) errors.push('Choose a valid YYYY-MM payroll month.');
  const processed = runs.filter(r => r.period === period && r.status === 'processed');
  const seen = new Set<string>();
  for (const run of processed) {
    if (!run.id.trim() || seen.has(run.id)) errors.push('Duplicate or missing pay-run identifier.');
    seen.add(run.id);
    if (run.currency.trim().toUpperCase() !== 'ILS') {
      errors.push('Only independently reviewed ILS payroll amounts are supported.');
    }
    if (!run.sourceReviewed) errors.push('One or more runs lack confirmation of source figures and Israeli-resident employee scope.');
    if (!Number.isSafeInteger(run.employeeCount) || run.employeeCount <= 0) errors.push('Each run needs a valid positive employee count.');
    for (const key of AMOUNTS) {
      if (!isMinorUnits(run[key])) errors.push('Missing or invalid exact-cent ' + key + ' on a posted run.');
    }
    if (!errors.length) {
      employeeOccurrences += run.employeeCount;
      incomeTaxWithheldCents += run.incomeTaxWithheldCents!;
      nationalEmployeeCents += run.nationalEmployeeCents!;
      nationalEmployerCents += run.nationalEmployerCents!;
      healthEmployeeCents += run.healthEmployeeCents!;
      runCount++;
      if (![employeeOccurrences, incomeTaxWithheldCents, nationalEmployeeCents, nationalEmployerCents, healthEmployeeCents]
        .every(Number.isSafeInteger)) errors.push('Total exceeds safe integer minor units.');
    }
  }
  if (processed.length === 0) warnings.push('No posted reviewed payroll runs are available for this month.');
  const nationalAndHealthCents = nationalEmployeeCents + nationalEmployerCents + healthEmployeeCents;
  if (!Number.isSafeInteger(nationalAndHealthCents)) errors.push('National Insurance and health total is outside safe integer minor units.');
  if (runs.some(r => r.period === period && r.status !== 'processed')) {
    warnings.push('Draft, awaiting-approval, reversed or rejected runs are excluded.');
  }
  return {
    readyForFiling: false,
    canReview: errors.length === 0 && processed.length > 0,
    period,
    runCount: errors.length ? 0 : runCount,
    employeeOccurrences: errors.length ? 0 : employeeOccurrences,
    incomeTaxWithheldCents: errors.length ? 0 : incomeTaxWithheldCents,
    nationalEmployeeCents: errors.length ? 0 : nationalEmployeeCents,
    nationalEmployerCents: errors.length ? 0 : nationalEmployerCents,
    healthEmployeeCents: errors.length ? 0 : healthEmployeeCents,
    nationalAndHealthCents: errors.length ? 0 : nationalAndHealthCents,
    warnings,
    errors: [...new Set(errors)],
  };
}
