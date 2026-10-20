import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import IsraelAdvanceTaxReportView from '../components/reporting/IsraelAdvanceTaxReportView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import type { Workspace } from '../model/workspace';

const mockWorkspace: Workspace = {
  id: 'ws-il-tax',
  name: 'Acme Israel Ltd',
  currency: 'ILS',
  uid: 'owner-1',
  businessType: 'custom',
  createdAt: '2026-01-01',
  roles: { 'owner-1': 'owner' },
  taxProfiles: {
    books: {
      name: 'Acme Israel Books',
      place: { country: 'IL', city: 'Tel Aviv' },
      advanceTaxRatePercent: 4.5,
      advanceTaxFrequency: 'bimonthly',
    },
    labels: {
      'world:jerusalem': {
        name: 'Jerusalem Branch',
        place: { country: 'IL', city: 'Jerusalem' },
        advanceTaxRatePercent: 3.0,
        advanceTaxFrequency: 'monthly',
      },
      'world:child': {
        name: 'Haifa Subsidiary',
      },
    },
  },
};

describe('Israel advance tax calendar view (A-101)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      workspaces: [mockWorkspace],
      currentWorkspaceId: 'ws-il-tax',
      user: { uid: 'owner-1', email: 'owner@acme.il' } as never,
    });
    useLedgerStore.setState({
      dimensionNodes: [
        { id: 'jerusalem', dimensionId: 'world', description: 'Jerusalem Branch' },
        { id: 'child', dimensionId: 'world', description: 'Haifa Subsidiary' },
      ],
    });
  });

  afterEach(() => {
    cleanup();
  });

  test('mounts cleanly, shows statutory citations, Shabbat explanation, and table with 6 bi-monthly periods', () => {
    render(<IsraelAdvanceTaxReportView />);
    const text = document.body.textContent || '';

    // Title and statutory context
    assert.match(text, /Israel: Advance Income-Tax Payment \(Mikdamot\) Calendar/);
    assert.match(text, /Section 175 of the Income Tax Ordinance/);
    assert.match(text, /סעיף 175 לפקודת מס הכנסה/);
    assert.match(text, /Shabbat and holiday postponement/i);

    // Default target is books with declared 4.5% rate
    assert.match(text, /4\.5%/);
    assert.match(text, /Acme Israel Books/);

    // Table with periods
    const table = screen.getByRole('table');
    assert.ok(table);
    const rows = table.querySelectorAll('tbody tr');
    assert.equal(rows.length, 6, 'defaults to 6 bi-monthly periods');

    // Shabbat postponement indicator on August period (2026-08-15 -> 2026-08-16)
    assert.match(text, /Postponed to Sunday/);
  });

  test('switching to monthly renders 12 periods and updates table rows', () => {
    render(<IsraelAdvanceTaxReportView />);
    const freqSelect = screen.getByLabelText('Reporting Frequency');
    act(() => {
      fireEvent.change(freqSelect, { target: { value: 'monthly' } });
    });

    const table = screen.getByRole('table');
    const rows = table.querySelectorAll('tbody tr');
    assert.equal(rows.length, 12, 'monthly frequency displays 12 periods');

    // January and December are present
    assert.match(document.body.textContent || '', /January 2026/);
    assert.match(document.body.textContent || '', /December 2026/);
  });

  test('selecting an entity profile switches to its specific rate and frequency', () => {
    render(<IsraelAdvanceTaxReportView />);
    const entitySelect = screen.getByLabelText('Entity / Tax Profile');

    // Select Jerusalem Branch
    act(() => {
      fireEvent.change(entitySelect, { target: { value: 'world:jerusalem' } });
    });

    const text = document.body.textContent || '';
    assert.match(text, /Jerusalem Branch/);
    assert.match(text, /3%/);

    // Frequency should automatically reflect the entity's monthly frequency
    const table = screen.getByRole('table');
    const rows = table.querySelectorAll('tbody tr');
    assert.equal(rows.length, 12, 'Jerusalem profile configured as monthly renders 12 rows');
  });

  test('an entity without its own rate inherits from the books', () => {
    render(<IsraelAdvanceTaxReportView />);
    const entitySelect = screen.getByLabelText('Entity / Tax Profile');

    // Select Haifa Subsidiary (world:child) which has no own rate
    act(() => {
      fireEvent.change(entitySelect, { target: { value: 'world:child' } });
    });

    const text = document.body.textContent || '';
    assert.match(text, /Haifa Subsidiary/);
    assert.match(text, /4\.5%/);
    assert.match(text, /inherited from the books/);
  });

  test('turnover input updates estimated advance payment', () => {
    render(<IsraelAdvanceTaxReportView />);

    // Turnover ₪200,000 at 4.5% = ₪9,000
    const turnoverInput = screen.getByLabelText('Period Turnover (₪)');
    act(() => {
      fireEvent.change(turnoverInput, { target: { value: '200000' } });
    });

    const text = document.body.textContent || '';
    assert.match(text, /₪9,000/);
  });
});
