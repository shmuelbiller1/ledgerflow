import { inlineEditName } from './helpers/inlineEditName';
/**
 * A-37 screen: custom fields. Hand-checked from the workspace's definitions and the loaded
 * records: the definitions table shows every field with its kind and options, a writer adds and
 * removes definition rows (Save appears only when something changed), the values grid shows each
 * record's stored value with the field's own editor, and a viewer reads but cannot change.
 */
import { stubFetch } from './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CustomFieldsSettings from '../components/platform/settings/CustomFieldsSettings';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getSupabase } from '../lib/db/client';

const customFields = [
  { id: 'f1', entityType: 'customer', key: 'region', label: 'Region', type: 'text' },
  { id: 'f2', entityType: 'customer', key: 'creditLimit', label: 'Credit limit', type: 'number' },
  { id: 'f3', entityType: 'item', key: 'grade', label: 'Grade', type: 'choice', choices: ['A', 'B'] },
];

describe('Settings → Custom fields', () => {
  beforeEach(() => {
    stubFetch(404);
    useAuthStore.setState({
      isGuest: false, user: { uid: 'u1', email: 'owner@shop.test' } as never,
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD', customFields }] as never,
    });
    useLedgerStore.setState({
      customers: [
        { id: 'c1', name: 'Acme Ltd', workspaceId: 'w1', metadata: { customFields: { region: 'North', creditLimit: 5000 } } },
        { id: 'c2', name: 'Beta GmbH', workspaceId: 'w1', metadata: {} },
      ] as never,
      vendors: [] as never,
      inventory: [{ id: 'i1', name: 'Widget', workspaceId: 'w1', metadata: { customFields: { grade: 'A' } } }] as never,
    });
  });
  afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

  test('the definitions table shows every field with its kind and options', () => {
    render(<CustomFieldsSettings />);
    const defsTable = screen.getByRole('table', { name: 'Custom field definitions' });
    assert.equal(within(defsTable).getAllByRole('row').slice(1).length, 3);
    assert.equal((screen.getByLabelText('Name of field 1') as HTMLInputElement).value, 'Region');
    assert.equal((screen.getByLabelText('Key of field 1') as HTMLInputElement).value, 'region');
    assert.equal((screen.getByLabelText('Kind of field 1') as HTMLSelectElement).value, 'text');
    assert.equal((screen.getByLabelText('Kind of field 2') as HTMLSelectElement).value, 'number');
    assert.equal((screen.getByLabelText('Name of field 3') as HTMLInputElement).value, 'Grade');
    assert.equal((screen.getByLabelText('Kind of field 3') as HTMLSelectElement).value, 'choice');
    assert.equal((screen.getByLabelText('Options of field 3') as HTMLInputElement).value, 'A, B');
  });

  test('a writer adds a definition row, then discards it', () => {
    render(<CustomFieldsSettings />);
    const saveButton = screen.getByRole('button', { name: 'Save definitions' });
    assert.ok(saveButton.matches(':disabled'), 'nothing changed yet');
    assert.ok(!screen.queryByRole('button', { name: 'Discard changes' }), 'nothing to discard yet');
    fireEvent.click(screen.getByRole('button', { name: 'Add on vendors' }));
    const defsTable = screen.getByRole('table', { name: 'Custom field definitions' });
    assert.equal(within(defsTable).getAllByRole('row').slice(1).length, 4);
    assert.ok(!screen.getByRole('button', { name: 'Save definitions' }).matches(':disabled'));
    assert.ok(screen.getByRole('button', { name: 'Discard changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    assert.equal(within(screen.getByRole('table', { name: 'Custom field definitions' })).getAllByRole('row').slice(1).length, 3);
    assert.ok(screen.getByRole('button', { name: 'Save definitions' }).matches(':disabled'));
    assert.ok(!screen.queryByRole('button', { name: 'Discard changes' }));
  });

  test('cannot add a definition when secure identifiers are unavailable', () => {
    render(<CustomFieldsSettings />);
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    try {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      fireEvent.click(screen.getByRole('button', { name: 'Add on vendors' }));
      const defsTable = screen.getByRole('table', { name: 'Custom field definitions' });
      assert.equal(within(defsTable).getAllByRole('row').slice(1).length, 3);
      assert.ok(screen.getByRole('button', { name: 'Save definitions' }).matches(':disabled'));
    } finally {
      Object.defineProperty(globalThis, 'crypto', original);
    }
  });

  test('values show each record’s stored value with the field’s own editor', () => {
    render(<CustomFieldsSettings />);
    const valuesTable = screen.getByRole('table', { name: 'Custom field values on customers' });
    const rows = within(valuesTable).getAllByRole('row').slice(1);
    assert.match(rows[0].textContent || '', /Acme Ltd/);
    assert.match(rows[0].textContent || '', /North/);
    assert.match(rows[0].textContent || '', /5,000|5000/);
    assert.match(rows[1].textContent || '', /Beta GmbH/);
    assert.ok(screen.getByLabelText(inlineEditName('Edit Region of Acme Ltd')));
    assert.ok(screen.getByLabelText(inlineEditName('Edit Credit limit of Beta GmbH')));
    fireEvent.change(screen.getByLabelText('Which records'), { target: { value: 'item' } });
    assert.ok(screen.getByLabelText(inlineEditName('Edit Grade of Widget')));
  });

  test('a viewer reads the fields but cannot change them', () => {
    useAuthStore.setState({
      user: { uid: 'u9' } as never,
      workspaces: [{ id: 'w1', uid: 'u1', name: 'W', currency: 'USD', customFields, roles: { u9: 'viewer' } }] as never,
    });
    render(<CustomFieldsSettings />);
    assert.ok(!screen.queryByRole('button', { name: 'Add on customers' }));
    assert.ok(screen.getByText('Owners and accountants can change these definitions.'));
    assert.ok(!screen.queryByRole('button', { name: 'Save definitions' }));
  });
});
