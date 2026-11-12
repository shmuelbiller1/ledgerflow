/** EU-F3: the report picker names the question a report answers, and searching the question finds the report. */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReportPicker from '../components/reporting/ReportPicker';
import { REPORT_QUESTIONS, reportQuestion } from '../lib/reportQuestions';
import { REPORT_TABS_REGISTRY } from '../config/registry';

afterEach(() => cleanup());

test('EU-F3: every question belongs to a report that exists, in English and Hebrew', () => {
  for (const [id, q] of Object.entries(REPORT_QUESTIONS)) {
    assert.ok(REPORT_TABS_REGISTRY.some(r => r.id === id), id);
    assert.ok(q.en.endsWith('?') && q.he.endsWith('?'), id);
  }
  assert.equal(reportQuestion('pnl'), 'Did I make money?');
  assert.equal(reportQuestion('no-such-report'), '');
});

test('EU-F3: the current report shows its question', () => {
  render(<ReportPicker activeTab="pnl" onSelect={() => {}} />);
  assert.ok(screen.getByText('· Did I make money?'));
});

test('EU-F3: "make money" finds Profit & Loss', () => {
  render(<ReportPicker activeTab="balance-sheet" onSelect={() => {}} />);
  fireEvent.change(screen.getByLabelText('Search reports'), { target: { value: 'make money' } });
  const options = [...(screen.getByLabelText('Choose report') as HTMLSelectElement).options].filter(o => o.value).map(o => [o.textContent, o.title]);
  assert.deepEqual(options, [['Profit & Loss', 'Did I make money?']]);
});
