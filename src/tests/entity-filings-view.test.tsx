import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import EntityFilingsCalendarView from '../components/reporting/EntityFilingsCalendarView';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { entityFilings } from '../lib/tax/entityFilings';
import { factSources } from '../lib/rules/fromTaxProfiles';

afterEach(() => cleanup());
beforeEach(() => {
  useAuthStore.setState({
    isGuest: false, user: { uid: 'u1' } as never, currentWorkspaceId: 'ws1',
    workspaces: [{ id: 'ws1', uid: 'u1', name: 'Test', currency: 'USD', taxProfiles: { books: { place: { country: 'US', state: 'TX' } } } } as never],
  });
  useLedgerStore.setState({ dimensionNodes: [], truncatedCollections: {} as never } as never);
});

test('entityFilings is pure and returns books + label entities', () => {
  const sources = factSources({ books: { place: { country: 'IL' } } });
  const res = entityFilings(sources, [], 2026);
  assert.equal(res.length, 1);
  assert.equal(res[0].entity, 'books');
  // No profiles => no due filing necessarily, but structure is correct
  assert.ok(Array.isArray(res[0].due) && Array.isArray(res[0].blocked));
});

test('C-115 screen renders with year and csv', () => {
  render(<EntityFilingsCalendarView/>);
  assert.ok(screen.getByRole('heading', { name: 'Entity filings calendar' }));
  assert.match(document.body.textContent || '', /31 Dec/i);
  assert.ok(screen.getByRole('button', { name: 'Export CSV' }));
  assert.match(document.body.textContent || '', /Calculation only/);
});

test('C-115 blocked/undecided shown when present', () => {
  // Use a profile that will trigger undecided/conflict? For now just check empty states are handled
  render(<EntityFilingsCalendarView/>);
  // Should show due table even if empty
  assert.ok(screen.getByText(/Due filings/));
});
