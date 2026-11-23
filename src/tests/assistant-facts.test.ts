import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantFacts, todayIn } from '../server/services/assistantFacts';

test('SBX-2 Part 6: the facts block states today, last month, this financial year and the currency', () => {
  const f = assistantFacts({ today: '2026-11-23', timeZone: 'Asia/Jerusalem', currency: 'USD', fiscalYearStartMonth: 1 });
  assert.match(f, /Monday 2026-11-23 \(Asia\/Jerusalem\)/);
  assert.match(f, /"last month" is October 2026/);
  assert.match(f, /"this year" means 2026-01-01 to today/);
  assert.match(f, /kept in USD/);
  assert.match(f, /USD: 120000 is 1,200\.00/);
  assert.match(f, /never minor units/);
});

test('SBX-2 Part 6: January rolls back a year; a financial year starting in April', () => {
  assert.match(assistantFacts({ today: '2027-01-10' }), /"last month" is December 2026/);
  assert.match(assistantFacts({ today: '2026-03-05', fiscalYearStartMonth: 4 }), /starts on April 1: "this year" means 2025-04-01/);
  assert.match(assistantFacts({ today: '2026-04-01', fiscalYearStartMonth: 4 }), /2026-04-01 to today/);
  assert.match(assistantFacts({ today: '2026-04-01', currency: 'nope' }), /currency is not set/);
});

test('SBX-2 Part 6: today follows the workspace time zone; an unknown zone falls back to UTC', () => {
  const late = new Date('2026-11-22T23:30:00Z');
  assert.equal(todayIn('Asia/Jerusalem', late), '2026-11-23');
  assert.equal(todayIn('America/Los_Angeles', late), '2026-11-22');
  assert.equal(todayIn('Not/AZone', late), '2026-11-22');
});

test('SBX-2 Part 6: minor units follow the currency (JPY none, KWD three)', () => {
  assert.match(assistantFacts({ today: '2026-11-23', currency: 'JPY' }), /JPY: 120000 is 120,000\)/);
  assert.match(assistantFacts({ today: '2026-11-23', currency: 'KWD' }), /KWD: 120000 is 120\.000\)/);
});

test('SBX-2 Part 6: a financial year starting mid-month uses the start day (same bounds as the rest of the app)', () => {
  assert.match(assistantFacts({ today: '2026-07-05', fiscalYearStartMonth: 7, fiscalYearStartDay: 15 }), /starts on July 15: "this year" means 2025-07-15 to today/);
  assert.match(assistantFacts({ today: '2026-07-20', fiscalYearStartMonth: 7, fiscalYearStartDay: 15 }), /"this year" means 2026-07-15 to today/);
});
