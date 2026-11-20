/**
 * E-54: the Uniform Structure research screen renders the transcribed layouts and the
 * sample fixture, and says plainly that the writer is not built yet.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import UniformStructureReportView from '../components/reporting/UniformStructureReportView';
import { UNIFORM_RECORD_LAYOUTS, UNIFORM_FIXTURE } from '../lib/tax/uniformStructure';
import { useUIStore } from '../stores/useUIStore';

const initialUI = useUIStore.getState();
afterEach(() => {
  cleanup();
  useUIStore.setState(initialUI, true);
});

test('the screen lists every record layout with its width and field count', () => {
  render(<UniformStructureReportView />);
  for (const layout of UNIFORM_RECORD_LAYOUTS) {
    assert.ok(screen.getByText(layout.code), `expected record ${layout.code}`);
  }
  // spot-check the widest and narrowest records
  assert.ok(screen.getByText('A000'));
  assert.ok(screen.getByText('466'));
  assert.ok(screen.getByText('445'));
});

test('the screen names the sample fixture and the not-built writer', () => {
  render(<UniformStructureReportView />);
  assert.ok(screen.getByText(/Example Consulting Ltd\./));
  assert.ok(screen.getByText(/The writer is not built yet/));
  assert.ok(screen.getByText(/Research fixture, not a filing/));
  assert.equal(UNIFORM_FIXTURE.documents.length, 1);
  assert.ok(screen.getByText(/Journal totals \(agorot, ILS minor units\)/));
  assert.equal(screen.queryByRole('button'), null, 'research screen offers no filing action');
});

test('missing research layouts explain the problem and the next step', () => {
  render(<UniformStructureReportView layouts={[]} />);
  assert.ok(screen.getByRole('heading', { name: 'Research layouts are unavailable' }));
  assert.ok(screen.getByText(/Refresh this page/));
  assert.equal(screen.queryByRole('table'), null);
});

test('Hebrew copy includes the limitations, table headings and money units', () => {
  useUIStore.setState({ language: 'he' });
  render(<UniformStructureReportView />);
  assert.ok(screen.getByRole('heading', { name: 'מבנה אחיד (מחקר)' }));
  assert.ok(screen.getByRole('columnheader', { name: 'רוחב' }));
  assert.ok(screen.getByRole('columnheader', { name: 'שדות' }));
  assert.ok(screen.getByText(/הכותב עדיין לא נבנה/));
  assert.ok(screen.getByText(/סכומי היומן \(באגורות\)/));
});
