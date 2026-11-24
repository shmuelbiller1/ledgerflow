import './helpers/dom';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import BrandingProfilesSettings from '../components/platform/settings/BrandingProfilesSettings';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

// A-77 screen: branding per label value, inherited from the books (the server save is AI #1's wiring).
beforeEach(() => {
  const workspace = setComponentWorkspace();
  useAuthStore.getState().setWorkspaces([{ ...workspace, branding: { footer: 'ספרים Books footer' }, brandingProfiles: { labels: { 'world:entity': { footer: 'Entity footer' } } } } as never]);
  useLedgerStore.setState({ dimensionNodes: [{ id: 'entity', dimensionId: 'world', description: 'Entity' }], truncatedCollections: {} } as never);
});
afterEach(async () => { cleanup(); useAuthStore.setState({ isGuest: false }); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('the branding screen opens on the books and names where values come from', () => {
  render(<BrandingProfilesSettings />);
  assert.ok(screen.getAllByRole('region', { name: 'Branding profiles' }).length > 0 || screen.getAllByLabelText('Branding profiles').length > 0);
  assert.ok(screen.getAllByText(/Branding per label/).length > 0);
});

test('a guest sees the branding but cannot change it', () => {
  useAuthStore.setState({ isGuest: true });
  render(<BrandingProfilesSettings />);
  assert.ok(screen.getByText('Only owners and accountants can change branding.'));
  assert.equal(screen.queryByRole('button', { name: 'Edit label branding' }), null);
});


test('owners can inspect profiles but cannot submit an unsavable draft', async () => {
  const { fireEvent } = await import('@testing-library/react');
  render(<BrandingProfilesSettings />);
  assert.ok(screen.getByText(/Label branding cannot be saved or applied to PDFs yet/));
  assert.ok(screen.getByText(/Label-specific branding is not yet applied to PDFs/));
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'world:entity' } });
  assert.ok(screen.getByText('Entity footer'));
  fireEvent.click(screen.getByRole('button', { name: /Edit this label/ }));
  assert.ok(screen.getByRole('form', { name: 'Edit branding profile' }));
  assert.equal((screen.getByRole('button', { name: 'Save branding' }) as HTMLButtonElement).disabled, true);
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network request'); });
  try {
    fireEvent.change(screen.getByLabelText('Footer on every page'), { target: { value: 'Draft footer' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit branding profile' }));
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal((screen.getByLabelText('Footer on every page') as HTMLTextAreaElement).value, 'Draft footer');
  } finally { fetchMock.mock.restore(); }
});
