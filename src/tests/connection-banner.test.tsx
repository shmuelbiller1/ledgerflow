/**
 * F-07 (offline banner): the connection banner says when the browser is offline, when a save is in
 * flight, and when the connection came back — and it says nothing when all is well.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import ConnectionBanner from '../components/platform/ConnectionBanner';
import { useUIStore } from '../stores/useUIStore';

describe('ConnectionBanner', () => {
  beforeEach(() => useUIStore.setState({ isOnline: true, isSyncing: false }));
  afterEach(() => cleanup());

  test('nothing to say while online, idle and never disconnected', () => {
    const { container } = render(<ConnectionBanner />);
    assert.equal(container.textContent, '');
  });

  test('offline is an alert, in words that say edits wait', () => {
    render(<ConnectionBanner />);
    act(() => useUIStore.setState({ isOnline: false }));
    assert.match(screen.getByRole('alert').textContent || '', /Working offline — changes can't be saved until you reconnect/);
  });

  test('a save in flight says so, and a reconnection confirms everything is saved', () => {
    render(<ConnectionBanner />);
    act(() => useUIStore.setState({ isOnline: false }));
    act(() => useUIStore.setState({ isOnline: true }));
    assert.match(screen.getByRole('status').textContent || '', /All changes saved/);

    cleanup();
    act(() => useUIStore.setState({ isOnline: true, isSyncing: true }));
    render(<ConnectionBanner />);
    assert.match(screen.getByRole('status').textContent || '', /Saving changes to cloud…/);
  });
});
