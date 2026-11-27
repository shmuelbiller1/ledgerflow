// Synthetic, read-only diagnostic; outputs observed behavior, not a filing calculation.
import { computePeriodPayroll } from '../../src/lib/payroll-engine';
import { payRunTotals, payRunLines, contractorsToReport } from '../../src/lib/payRunPosting';
import { calculateFederalIncomeTaxWithholding } from '../../src/lib/tax/usFederalPayroll';
import { canadaSalesTaxRateTable } from '../../src/lib/tax/caSalesTax';
import type { Employee } from '../../src/types';

const employee = (extra: Partial<Employee>): Employee => ({ id:'e1', uid:'u', workspaceId:'w', name:'Synthetic', role:'Staff', salaryCents:6_000_000, payFrequency:'Monthly', status:'Active', state:'TX', filingStatus:'Single', createdAt:'2026-01-01', ...extra });
const high = employee({ salaryCents:24_000_000, filingStatus:'Married' });
const p = computePeriodPayroll(high, 2026);
const totals = payRunTotals([high], 2026);
const accounts = { bank:{id:'bank',name:'Bank'}, wages:{id:'wages',name:'Wages'}, taxExpense:{id:'tax',name:'Employer tax'}, liabilities:{id:'liable',name:'Liabilities'} };
console.log('High earner period (first month if paid from January):', JSON.stringify({ gross:p.grossPayCents, ss:p.employeeFicaSocialSecurityCents, additionalMedicare:p.employeeAdditionalMedicareCents, employerSS:p.employerFicaSocialSecurityCents }));
console.log('Pay-run source taxes and balanced journal:', JSON.stringify({ employee:totals.employees[0], lines:payRunLines(totals, accounts) }));
const k = computePeriodPayroll(employee({preTaxDeductionsCents:50_000}), 2026);
console.log('Monthly 5000 gross / 500 traditional 401k: SS, Medicare, employer SS:', k.employeeFicaSocialSecurityCents, k.employeeFicaMedicareCents, k.employerFicaSocialSecurityCents);
const ny = computePeriodPayroll(employee({state:'NY'}), 2026);
console.log('NY state-only record NYC and county withheld cents:', ny.employeeCityTaxCents, ny.employeeCountyTaxCents);
console.log('2026 Pub 15-T independent single annual 100k:', calculateFederalIncomeTaxWithholding(10_000_000, 'single', false, 'annually', '2026-06-01'));
console.log('2026 Pub 15-T independent single 52k annual Step 2 checked:', calculateFederalIncomeTaxWithholding(5_200_000, 'single', true, 'annually', '2026-06-01'));
console.log('Canada NB 2015 output:', JSON.stringify(canadaSalesTaxRateTable()({country:'CA', state:'NB'}, '2015-06-01')));
const contractor = {employeeId:'c',name:'Contractor',contractor:true,grossCents:80_000,deductionsCents:0,withheldCents:0,employerTaxCents:0,netCents:80_000};
console.log('2026 pay-run 1099 list $800:', JSON.stringify(contractorsToReport([{date:'2026-06-01',status:'processed',employees:[contractor]}], '2026')));
