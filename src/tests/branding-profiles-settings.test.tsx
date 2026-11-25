import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import BrandingProfilesSettings from '../components/platform/settings/BrandingProfilesSettings';
import { getSupabase } from '../lib/db/client';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

// A-77 screen: branding per label value, inherited from the books; saved through PUT /branding-profiles (AUP-01).
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


test('owners can edit a label\'s branding and save it (AUP-01)', async () => {
  const { fireEvent } = await import('@testing-library/react');
  render(<BrandingProfilesSettings />);
  assert.equal(screen.queryByText(/cannot be saved or applied to PDFs yet/), null, 'the old "not available" notice is gone');
  assert.ok(screen.getByText(/A document on that label \(or a label under it\) uses them/));
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'world:entity' } });
  assert.ok(screen.getByText('Entity footer'));
  fireEvent.click(screen.getByRole('button', { name: /Edit this label/ }));
  assert.ok(screen.getByRole('form', { name: 'Edit branding profile' }));
  fireEvent.change(screen.getByLabelText('Footer on every page'), { target: { value: 'Draft footer' } });
  assert.equal((screen.getByRole('button', { name: 'Save branding' }) as HTMLButtonElement).disabled, false);
});
