import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import UsFilingCalendarReportView from '../components/reporting/UsFilingCalendarReportView';
import { US_FILING_CALENDAR, filingDueDate, filingCalendarProblems } from '../lib/tax/usFilingCalendar';

afterEach(() => cleanup());

test('C-122 filing calendar shows all 51 states and the planning disclaimer', () => {
  render(<UsFilingCalendarReportView/>);
  assert.ok(screen.getByRole('heading', { name: 'US Sales Tax Filing Calendar' }));
  assert.match(document.body.textContent || '', /does not file or pay anything/i);
  assert.equal(US_FILING_CALENDAR.length, 51);
  assert.deepEqual(filingCalendarProblems(), []);
  // Table has 51 data rows
  const rows = screen.getAllByRole('row');
  // 1 header + 51 data
  assert.equal(rows.length, 52);
});

test('C-122 filtering and due-date preview work', () => {
  render(<UsFilingCalendarReportView/>);
  fireEvent.change(screen.getByLabelText('State (code or name)'), { target: { value: 'TX' } });
  let rows = screen.getAllByRole('row');
  assert.equal(rows.length, 2); // header + TX
  assert.match(rows[1].textContent || '', /TX/);
  fireEvent.change(screen.getByLabelText('State (code or name)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'annual' } });
  rows = screen.getAllByRole('row');
  assert.ok(rows.length > 1 && rows.length < 52);
  // Due date for AL 2026-09-30 -> 2026-10-20 (weekday adjustment)
  assert.equal(filingDueDate('AL', '2026-09-30'), '2026-10-20');
  assert.equal(filingDueDate('AK', '2026-09-30'), undefined);
});

test('C-122 export button exists and says capability', () => {
  render(<UsFilingCalendarReportView/>);
  assert.ok(screen.getByRole('button', { name: 'Export CSV' }));
  assert.match(document.body.textContent || '', /Internal, test or demo only/);
});
