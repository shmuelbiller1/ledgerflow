/**
 * Unit tests for Israeli advance income-tax payment (mikdamot) reminder calendar (A-101).
 * Tests statutory periods, Shabbat postponements, turnover estimates, and CSV export.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IL_ADVANCE_TAX_SCHEDULE,
  IL_ADVANCE_TAX_CALENDAR_CSV_HEADERS,
  ilAdjustDueDateForRestDay,
  ilAdvanceTaxCalendarCsvRows,
  ilAdvanceTaxEstimateCents,
  ilAdvanceTaxPeriods,
  ilAdvanceTaxPeriodStatus,
  ilAdvanceTaxProblems,
  type IlAdvanceTaxScheduleRow,
} from '../lib/tax/ilAdvanceTaxCalendar';

describe('Israel advance income-tax payment calendar (A-101)', () => {
  test('schedule table structure and problem checks', () => {
    assert.deepEqual(ilAdvanceTaxProblems(), []);
    assert.equal(IL_ADVANCE_TAX_SCHEDULE.length, 2);

    const bimonthly = IL_ADVANCE_TAX_SCHEDULE.find(s => s.frequency === 'bimonthly');
    assert.ok(bimonthly);
    assert.equal(bimonthly.statutoryDueDay, 15);
    assert.match(bimonthly.statutoryBasis, /Section 175/);
    assert.match(bimonthly.hebrewBasis, /סעיף 175/);
    assert.ok(bimonthly.source.startsWith('https://'));

    const monthly = IL_ADVANCE_TAX_SCHEDULE.find(s => s.frequency === 'monthly');
    assert.ok(monthly);
    assert.equal(monthly.statutoryDueDay, 15);

    // Problem detector assertions
    const invalidRows: IlAdvanceTaxScheduleRow[] = [
      { ...monthly, statutoryDueDay: 20 as 15 },
      { ...bimonthly, source: 'http://insecure.example' },
    ];
    const problems = ilAdvanceTaxProblems(invalidRows);
    assert.ok(problems.some(p => p.includes('Statutory due day must be 15')));
    assert.ok(problems.some(p => p.includes('needs an HTTPS source URL')));

    assert.ok(ilAdvanceTaxProblems([]).some(p => p.includes('Expected exactly 2')));
  });

  test('monthly periods generate 12 periods with correct statutory boundaries', () => {
    const periods2026 = ilAdvanceTaxPeriods(2026, 'monthly');
    assert.equal(periods2026.length, 12);

    // Period 1: January
    assert.equal(periods2026[0].periodKey, '2026-01');
    assert.equal(periods2026[0].name, 'January 2026');
    assert.equal(periods2026[0].nameHe, 'ינואר 2026');
    assert.equal(periods2026[0].startDate, '2026-01-01');
    assert.equal(periods2026[0].endDate, '2026-01-31');
    assert.equal(periods2026[0].statutoryDueDate, '2026-02-15');

    // February non-leap year (2026: 28 days)
    assert.equal(periods2026[1].startDate, '2026-02-01');
    assert.equal(periods2026[1].endDate, '2026-02-28');
    assert.equal(periods2026[1].statutoryDueDate, '2026-03-15');

    // February leap year (2024: 29 days)
    const periods2024 = ilAdvanceTaxPeriods(2024, 'monthly');
    assert.equal(periods2024[1].endDate, '2024-02-29');

    // Period 12: December (due Jan 15 of subsequent year)
    assert.equal(periods2026[11].periodKey, '2026-12');
    assert.equal(periods2026[11].startDate, '2026-12-01');
    assert.equal(periods2026[11].endDate, '2026-12-31');
    assert.equal(periods2026[11].statutoryDueDate, '2027-01-15');
  });

  test('bi-monthly periods generate 6 two-month periods with correct statutory boundaries', () => {
    const periods = ilAdvanceTaxPeriods(2026, 'bimonthly');
    assert.equal(periods.length, 6);

    // Period 1: Jan–Feb
    assert.equal(periods[0].periodKey, '2026-01-02');
    assert.equal(periods[0].name, 'Jan–Feb 2026');
    assert.equal(periods[0].nameHe, 'ינואר–פברואר 2026');
    assert.equal(periods[0].startDate, '2026-01-01');
    assert.equal(periods[0].endDate, '2026-02-28');
    assert.equal(periods[0].statutoryDueDate, '2026-03-15');

    // Period 2: Mar–Apr
    assert.equal(periods[1].periodKey, '2026-03-04');
    assert.equal(periods[1].startDate, '2026-03-01');
    assert.equal(periods[1].endDate, '2026-04-30');
    assert.equal(periods[1].statutoryDueDate, '2026-05-15');

    // Period 6: Nov–Dec (due Jan 15 of next year)
    assert.equal(periods[5].periodKey, '2026-11-12');
    assert.equal(periods[5].startDate, '2026-11-01');
    assert.equal(periods[5].endDate, '2026-12-31');
    assert.equal(periods[5].statutoryDueDate, '2027-01-15');
  });

  test('Shabbat and Friday statutory due dates are postponed to Sunday', () => {
    // 2026-08-15 is Saturday -> moves to Sunday 2026-08-16
    const sat = ilAdjustDueDateForRestDay('2026-08-15');
    assert.equal(sat.adjustedDate, '2026-08-16');
    assert.equal(sat.postponed, true);

    // 2027-01-15 is Friday -> moves to Sunday 2027-01-17
    const fri = ilAdjustDueDateForRestDay('2027-01-15');
    assert.equal(fri.adjustedDate, '2027-01-17');
    assert.equal(fri.postponed, true);

    // 2026-02-15 is Sunday -> stays 2026-02-15
    const sun = ilAdjustDueDateForRestDay('2026-02-15');
    assert.equal(sun.adjustedDate, '2026-02-15');
    assert.equal(sun.postponed, false);

    // 2026-04-15 is Wednesday -> stays 2026-04-15
    const wed = ilAdjustDueDateForRestDay('2026-04-15');
    assert.equal(wed.adjustedDate, '2026-04-15');
    assert.equal(wed.postponed, false);
  });

  test('advance tax estimate calculation strictly rounds to whole minor units', () => {
    // ₪100,000 turnover at 3.5% = ₪3,500
    const est1 = ilAdvanceTaxEstimateCents(100000_00, 3.5);
    assert.equal(est1, 3500_00);

    // ₪50,000 turnover at 2% = ₪1,000
    const est2 = ilAdvanceTaxEstimateCents(50000_00, 2.0);
    assert.equal(est2, 1000_00);

    // Odd minor units with fractional rounding: ₪1,234.56 at 3.33% = ₪41.110848 -> 4111 cents
    const est3 = ilAdvanceTaxEstimateCents(1234_56, 3.33);
    assert.equal(est3, 4111);

    // Invalid or negative inputs return 0
    assert.equal(ilAdvanceTaxEstimateCents(-1000, 3.5), 0);
    assert.equal(ilAdvanceTaxEstimateCents(1000, 0), 0);
    assert.equal(ilAdvanceTaxEstimateCents(1000, -2), 0);
    assert.equal(ilAdvanceTaxEstimateCents(NaN, 3.5), 0);
    assert.equal(ilAdvanceTaxEstimateCents(1000, Infinity), 0);
  });

  test('period status reflects upcoming, due-soon, active, and past relative to assessment date', () => {
    const period = ilAdvanceTaxPeriods(2026, 'monthly')[0]; // Jan 2026: 2026-01-01 to 2026-01-31, due 2026-02-15

    // Before period starts
    assert.equal(ilAdvanceTaxPeriodStatus(period, '2025-12-15'), 'upcoming');

    // During the month
    assert.equal(ilAdvanceTaxPeriodStatus(period, '2026-01-10'), 'active');

    // Near the deadline (within 15 days of 2026-02-15)
    assert.equal(ilAdvanceTaxPeriodStatus(period, '2026-02-05'), 'due-soon');

    // On the due date
    assert.equal(ilAdvanceTaxPeriodStatus(period, '2026-02-15'), 'due-soon');

    // After the due date
    assert.equal(ilAdvanceTaxPeriodStatus(period, '2026-02-16'), 'past');
  });

  test('CSV export returns aligned rows and headers', () => {
    const rows = ilAdvanceTaxCalendarCsvRows(2026, 'bimonthly');
    assert.equal(rows.length, 6);
    for (const r of rows) {
      assert.equal(r.length, IL_ADVANCE_TAX_CALENDAR_CSV_HEADERS.length);
      assert.ok(r[0].startsWith('2026-'));
      assert.match(r[9], /Section 175/);
    }

    const monthlyRows = ilAdvanceTaxCalendarCsvRows(2026, 'monthly');
    assert.equal(monthlyRows.length, 12);
  });
});
