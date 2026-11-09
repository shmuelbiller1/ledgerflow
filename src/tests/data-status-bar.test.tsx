/**
 * F-02 (I-01, I-02, AA-02): the one line above every screen that says what is still loading, what
 * failed (with a retry), and which lists are cut at their limit — so a screen's totals or its
 * "nothing here" are never mistaken for the whole workspace.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DataStatusBar from '../components/layout/DataStatusBar';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { CORE_KEYS } from '../lib/ledgerCollections';
import { setComponentWorkspace } from './helpers/componentFixtures';

/** Every core collection has arrived, so only the keys a test names can appear in the bar. */
function coreLoaded(extra: Record<string, boolean> = {}) {
  const loaded: Record<string, boolean> = {};
  for (const key of CORE_KEYS) loaded[key] = true;
  return { ...loaded, ...extra };
}

describe('DataStatusBar', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ truncatedCollections: {} });
    useDataNeedsStore.setState({ asked: [], loaded: coreLoaded(), loadedWorkspaceId: 'component-workspace', failed: {} });
  });
  afterEach(() => cleanup());

  test('says what is loading, in the screen words, without promising that nothing exists', () => {
    useDataNeedsStore.setState({ asked: ['payments'], loaded: coreLoaded(), failed: {} });
    render(<DataStatusBar />);
    const status = screen.getByRole('status');
    assert.match(status.textContent || '', /Loading payments/);
  });

  test('a list cut at its limit says totals may be incomplete', () => {
    useLedgerStore.setState({ truncatedCollections: { invoices: true } });
    render(<DataStatusBar />);
    assert.match(screen.getByRole('status').textContent || '', /Only the most recent 10,000 invoices are loaded: totals on screen may be incomplete\./);
  });

  test('a failed collection says screens may look empty and offers a retry that clears it', async () => {
    useDataNeedsStore.setState({ asked: ['payments'], loaded: coreLoaded(), failed: { payments: 'timeout' } });
    render(<DataStatusBar />);
    const alert = screen.getByRole('alert');
    assert.match(alert.textContent || '', /Couldn't load payments\. Screens that use them may look empty\./);
    fireEvent.click(screen.getByRole('button', { name: 'try again' }));
    await waitFor(() => assert.equal(screen.queryByRole('alert'), null));
    assert.match(screen.getByRole('status').textContent || '', /Loading payments/);
  });

  test('nothing signed in: no bar at all', () => {
    useAuthStore.setState({ user: null, currentWorkspaceId: null, workspaces: [] });
    const { container } = render(<DataStatusBar />);
    assert.equal(container.textContent, '');
  });

  test('every collection loaded and complete: no bar', () => {
    const { container } = render(<DataStatusBar />);
    assert.equal(container.textContent, '');
  });
});
