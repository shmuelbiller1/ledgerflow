import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFederalIncomeTaxWithholding,
  calculateFicaTax,
  calculateFutaTax,
  getFicaRatesOn,
  getFederalWithholdingTable,
  US_FEDERAL_WITHHOLDING_ANNUAL,
  US_FICA_FUTA_HISTORY,
} from '../lib/tax/usFederalPayroll';

describe('US Federal Payroll & Pub 15-T Golden Tests (D-15, D-18)', () => {
  it('every withholding and FICA table row carries validFrom and an authoritative IRS source', () => {
    const table = getFederalWithholdingTable('single', false, '2026-06-01');
    assert.ok(table, 'Must retrieve withholding table');

    const rates = getFicaRatesOn('2026-06-01');
    assert.ok(rates, 'Must retrieve FICA rates');

    for (const entry of US_FEDERAL_WITHHOLDING_ANNUAL) {
      assert.ok(entry.validFrom, 'Withholding entry must have validFrom');
      assert.ok(entry.source.authority.includes('IRS'), 'Source authority must be IRS');
      assert.ok(entry.source.url.startsWith('https://'), 'Source URL must be https');
      assert.ok(entry.brackets.length >= 7, 'Must have at least 7 tax brackets');
    }

    for (const fica of US_FICA_FUTA_HISTORY) {
      assert.ok(fica.validFrom, 'FICA entry must have validFrom');
      assert.ok(fica.socialSecurityWageBaseCents > 0, 'SS wage base must be positive');
      assert.equal(fica.socialSecurityEmployeeRate, 6.2);
      assert.equal(fica.medicareEmployeeRate, 1.45);
      assert.equal(fica.futaWageBaseCents, 700000); // $7,000
      assert.equal(fica.futaEffectiveRate, 0.6); // 0.6%
    }
  });

  describe('Pub 15-T Worked Golden Examples (2026 Independent Hand Calculations)', () => {
    it('Example 1: Single employee, Step 2 not checked, weekly wage $1,000 ($52,000/yr)', () => {
      // Annual wage: $52,000 (5,200,000 cents)
      // Worksheet 1A Step 2 unchecked single standard deduction adjustment: -$8,600 -> Adjusted annual wage = $43,400 (4,340,000 cents)
      // Table 1(a) Single bracket over $19,900: base tax $1,240.00 ($124,000 cents) + 12% over $19,900
      // Excess over $19,900 = $23,500 ($2,350,000 cents)
      // 12% of $23,500 = $2,820.00 ($282,000 cents)
      // Total annual tax = $1,240 + $2,820 = $4,060.00 ($406,000 cents)
      // Weekly tax = $4,060 / 52 = $78.0769... -> $78.08 (7808 cents)
      const weeklyWageCents = 100000; // $1,000.00
      const withholdingCents = calculateFederalIncomeTaxWithholding(
        weeklyWageCents,
        'single',
        false,
        'weekly',
        '2026-02-15',
      );
      assert.equal(withholdingCents, 7808, 'Weekly withholding should be $78.08 (7808 cents)');
    });

    it('Example 2: Married Filing Jointly, Step 2 not checked, biweekly wage $3,846.15 ($100,000/yr)', () => {
      // Annual wage: $100,000 (10,000,000 cents)
      // Worksheet 1A Step 2 unchecked MFJ standard deduction adjustment: -$12,900 -> Adjusted annual wage = $87,100 (8,710,000 cents)
      // Table 1(a) MFJ bracket over $39,700: base tax $2,480.00 ($248,000 cents) + 12% over $39,700
      // Excess over $39,700 = $47,400 ($4,740,000 cents)
      // 12% of $47,400 = $5,688.00 ($568,800 cents)
      // Total annual tax = $2,480 + $5,688 = $8,168.00 ($816,800 cents)
      // Biweekly tax = $8,168 / 26 = $314.1538... -> $314.15 (31415 cents)
      const biweeklyWageCents = 384615; // ~$3,846.15
      const withholdingCents = calculateFederalIncomeTaxWithholding(
        biweeklyWageCents,
        'married_filing_jointly',
        false,
        'biweekly',
        '2026-03-01',
      );
      assert.equal(withholdingCents, 31415, 'Biweekly withholding should be $314.15 (31415 cents)');
    });

    it('Example 3: Head of Household, Step 2 not checked, monthly wage $5,000 ($60,000/yr)', () => {
      // Annual wage: $60,000 (6,000,000 cents)
      // Worksheet 1A Step 2 unchecked HoH standard deduction adjustment: -$8,600 -> Adjusted annual wage = $51,400 (5,140,000 cents)
      // Table 1(a) HoH bracket over $33,250: base tax $2,055.00 ($205,500 cents) + 12% over $33,250
      // Excess over $33,250 = $18,150 ($1,815,000 cents)
      // 12% of $18,150 = $2,178.00 ($217,800 cents)
      // Total annual tax = $2,055 + $2,178 = $4,233.00 ($423,300 cents)
      // Monthly tax = $4,233 / 12 = $352.75 (35275 cents)
      const monthlyWageCents = 500000; // $5,000.00
      const withholdingCents = calculateFederalIncomeTaxWithholding(
        monthlyWageCents,
        'head_of_household',
        false,
        'monthly',
        '2026-04-15',
      );
      assert.equal(withholdingCents, 35275, 'Monthly withholding should be $352.75 (35275 cents)');
    });

    it('Example 4: Single employee, Step 2 CHECKED (two jobs / higher rate), weekly wage $1,000 ($52,000/yr)', () => {
      // Step 2 checked: Worksheet 1A Step 1f applies $0 reduction; Table 1(b) carries half of full $16,100 std deduction ($8,050 0% threshold)
      // Annual wage: $52,000 (5,200,000 cents)
      // Table 1(b) Single Step 2 checked: Over $36,450 (($64,300 + $8,600) / 2) base tax $3,284.00 ($328,400 cents) + 22% over $36,450
      // Excess over $36,450 = $15,550 ($1,555,000 cents)
      // 22% of $15,550 = $3,421.00 ($342,100 cents)
      // Total annual tax = $3,284 + $3,421 = $6,705.00 ($670,500 cents) [2 jobs * $6,705 = $13,410 == Single Std on $104,000]
      // Weekly tax = $6,705 / 52 = $128.9423... -> $128.94 (12894 cents)
      const weeklyWageCents = 100000;
      const withholdingCents = calculateFederalIncomeTaxWithholding(
        weeklyWageCents,
        'single',
        true,
        'weekly',
        '2026-05-01',
      );
      assert.equal(withholdingCents, 12894, 'Weekly Step-2-checked withholding should be $128.94 (12894 cents)');
      assert.equal(
        2 * calculateFederalIncomeTaxWithholding(5200000, 'single', true, 'annually', '2026-05-01'),
        calculateFederalIncomeTaxWithholding(10400000, 'single', false, 'annually', '2026-05-01'),
        'Two equal Step-2 jobs must withhold identical annual tax to one combined Step-2-unchecked job',
      );
    });

    it('derives every Step 2 table from the standard table and preserves the two-job identity', () => {
      const statuses = ['single', 'married_filing_jointly', 'head_of_household'] as const;
      const adjustment: Record<(typeof statuses)[number], number> = {
        single: 860000,
        married_filing_jointly: 1290000,
        head_of_household: 860000,
      };
      for (const status of statuses) {
        const standard = getFederalWithholdingTable(status, false, '2026-06-01');
        const step2 = getFederalWithholdingTable(status, true, '2026-06-01');
        assert.ok(standard && step2);
        assert.equal(step2.standardDeductionAdjustmentCents, 0);
        assert.equal(step2.brackets.length, standard.brackets.length);
        for (let index = 1; index < standard.brackets.length; index += 1) {
          assert.equal(step2.brackets[index].overCents, Math.round((standard.brackets[index].overCents + adjustment[status]) / 2));
          assert.equal(step2.brackets[index].baseTaxCents, Math.round(standard.brackets[index].baseTaxCents / 2));
          assert.equal(step2.brackets[index].rate, standard.brackets[index].rate);
        }
      }
    });

    it('Example 5: calculates withholding for 2025 dates using 2025 tax schedules', () => {
      const weeklyWageCents = 100000;
      const withholding2025 = calculateFederalIncomeTaxWithholding(
        weeklyWageCents,
        'single',
        false,
        'weekly',
        '2025-06-15',
      );
      assert.ok(withholding2025 > 0, 'Must calculate positive withholding for 2025 date');
    });

    it('Example 6: throws explicit error when payroll date is outside supported range', () => {
      assert.throws(
        () => calculateFederalIncomeTaxWithholding(100000, 'single', false, 'weekly', '2024-06-01'),
        /No federal withholding table available for date "2024-06-01"/,
      );
      assert.throws(
        () => getFicaRatesOn('2024-06-01'),
        /No FICA\/FUTA rates available for date "2024-06-01"/,
      );
    });
  });

  describe('FICA & FUTA Worked Golden Examples (2026)', () => {
    it('calculates regular FICA when employee is below wage base cap ($184,500)', () => {
      // Gross period wage: $3,000 ($300,000 cents)
      // Prior YTD: $50,000 ($5,000,000 cents)
      // SS Employee (6.2% of $3,000): $186.00 (18600 cents)
      // SS Employer (6.2% of $3,000): $186.00 (18600 cents)
      // Medicare Employee (1.45% of $3,000): $43.50 -> $44.00 (4350 cents)
      // Medicare Employer (1.45% of $3,000): $43.50 -> $44.00 (4350 cents)
      // Additional Medicare: $0 (YTD $53k < $200k)
      const fica = calculateFicaTax(300000, 5000000, 'single', '2026-03-15');
      assert.equal(fica.socialSecurityEmployeeCents, 18600);
      assert.equal(fica.socialSecurityEmployerCents, 18600);
      assert.equal(fica.medicareEmployeeCents, 4350);
      assert.equal(fica.medicareEmployerCents, 4350);
      assert.equal(fica.additionalMedicareEmployeeCents, 0);
      assert.equal(fica.totalEmployeeFicaCents, 18600 + 4350);
      assert.equal(fica.totalEmployerFicaCents, 18600 + 4350);
    });

    it('caps Social Security tax at $184,500 wage base limit for 2026', () => {
      // 2026 SSA Wage Base: $184,500 ($18,450,000 cents)
      // Prior YTD: $180,000 ($18,000,000 cents)
      // Current wage: $5,000 ($500,000 cents)
      // Subject to SS: $184,500 - $180,000 = $4,500 ($450,000 cents)
      // SS Employee (6.2% of $4,500): $279.00 (27900 cents)
      // SS Employer (6.2% of $4,500): $279.00 (27900 cents)
      // Medicare Employee (1.45% of $5,000): $72.50 -> $73 (7250 cents)
      const fica = calculateFicaTax(500000, 18000000, 'single', '2026-11-01');
      assert.equal(fica.socialSecurityEmployeeCents, 27900);
      assert.equal(fica.socialSecurityEmployerCents, 27900);
      assert.equal(fica.medicareEmployeeCents, 7250);
    });

    it('assesses 0.9% Additional Medicare tax when crossing $200,000 single threshold', () => {
      // Prior YTD: $195,000 ($19,500,000 cents)
      // Current wage: $10,000 ($1,000,000 cents)
      // New YTD: $205,000 ($20,500,000 cents)
      // Subject to Addl Medicare: $205,000 - $200,000 = $5,000 ($500,000 cents)
      // 0.9% of $5,000 = $45.00 (4500 cents)
      const fica = calculateFicaTax(1000000, 19500000, 'single', '2026-10-15');
      assert.equal(fica.additionalMedicareEmployeeCents, 4500);
    });

    it('caps FUTA tax at $7,000 wage base limit at 0.6% effective rate', () => {
      // Prior YTD: $6,000 ($600,000 cents)
      // Current wage: $2,000 ($200,000 cents)
      // Subject to FUTA: $7,000 - $6,000 = $1,000 ($100,000 cents)
      // FUTA tax (0.6% of $1,000): $6.00 (600 cents)
      const futa = calculateFutaTax(200000, 600000, '2026-04-01');
      assert.equal(futa.futaSubjectWageCents, 100000);
      assert.equal(futa.futaTaxCents, 600);
    });
  });
});
