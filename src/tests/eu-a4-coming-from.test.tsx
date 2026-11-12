/** EU-A4: the wizard's first step offers the existing importers ("Coming from QuickBooks?"), which end on the trial-balance proof. */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import SetupWizard from '../components/onboarding/SetupWizard';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';

afterEach(async () => { cleanup(); await getSupabase().auth.dispose(); });

test('EU-A4: "Bring in my books" on step 1 opens Settings → Import Data and closes the wizard', () => {
  useAuthStore.setState({ user: { uid: 'u1', getIdToken: async () => 't' } as never, isGuest: false, currentWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', uid: 'u1', name: 'Acme', currency: 'USD', roles: { u1: 'owner' } }] as never });
  const went: unknown[] = [];
  const real = useUIStore.getState().goToPage;
  useUIStore.setState({ goToPage: page => { went.push(page); } });
  let done = false;
  try {
    render(<SetupWizard onStarted={() => {}} onDone={() => { done = true; }} />);
    assert.ok(screen.getByText(/Coming from QuickBooks, Xero or Wave\?/));
    fireEvent.click(screen.getByRole('button', { name: 'Bring in my books' }));
    assert.deepEqual(went, [{ tab: 'settings', sub: 'import' }]);
    assert.equal(done, true);
  } finally {
    useUIStore.setState({ goToPage: real });
  }
  assert.ok(readFileSync('src/components/platform/settings/ImportSettings.tsx', 'utf8').includes('<MigrationTrialBalanceProof'), 'the import screen ends on the trial-balance proof');
});
