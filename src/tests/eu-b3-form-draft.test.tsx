/**
 * EU-B3: typed work is kept. A form with unsaved changes is kept per form and workspace; opening it again offers
 * "Continue your unsaved invoice?" — Continue puts the typed values back, Discard clears it; a save clears it; another
 * workspace's draft is never offered; a draft older than two weeks is dropped.
 */
import './helpers/dom';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DRAFT_MAX_AGE_MS, draftKey, useFormDraft } from '../hooks/useFormDraft';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function Form({ ws, open, onSaved }: { ws: string; open: boolean; onSaved?: () => void }) {
  const [text, setText] = useState('');
  const draft = useFormDraft({ form: 'invoice', label: 'invoice', workspaceId: ws, open, dirty: text !== '', value: { text }, restore: (k: { text: string }) => setText(k.text),
    valid: (v: unknown): v is { text: string } => typeof (v as { text?: unknown } | null)?.text === 'string' });
  if (!open) return null;
  return (
    <div>
      {draft.banner}
      <input aria-label="Memo" value={text} onChange={e => setText(e.target.value)} />
      <button type="button" onClick={() => { draft.clear(); onSaved?.(); }}>Save</button>
    </div>
  );
}

test('EU-B3: closing without saving keeps it; reopening offers it; Continue restores the typed value', async () => {
  const view = render(<Form ws="w1" open />);
  fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Half paid, rest on delivery' } });
  view.rerender(<Form ws="w1" open={false} />);
  assert.ok(localStorage.getItem(draftKey('invoice', 'w1')), 'kept in this browser');
  cleanup();
  render(<Form ws="w1" open />);
  assert.ok(screen.getByText(/Continue your unsaved invoice\?/));
  assert.equal((screen.getByLabelText('Memo') as HTMLInputElement).value, '', 'not filled in until asked');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
  assert.equal((screen.getByLabelText('Memo') as HTMLInputElement).value, 'Half paid, rest on delivery');
  assert.equal(screen.queryByText(/Continue your unsaved/), null);
});

test('EU-B3: Discard and Save clear it; another workspace sees nothing', async () => {
  localStorage.setItem(draftKey('invoice', 'w1'), JSON.stringify({ savedAt: Date.now(), value: { text: 'kept' } }));
  render(<Form ws="w2" open />);
  assert.equal(screen.queryByText(/Continue your unsaved/), null, "w1's draft is not offered in w2");
  cleanup();
  render(<Form ws="w1" open />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard' })); });
  assert.equal(localStorage.getItem(draftKey('invoice', 'w1')), null, 'Discard clears it');
  cleanup();
  render(<Form ws="w1" open />);
  fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'typed' } });
  assert.ok(localStorage.getItem(draftKey('invoice', 'w1')));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
  assert.equal(localStorage.getItem(draftKey('invoice', 'w1')), null, 'a save clears it');
});

test('EU-B3: a draft older than two weeks is not offered', () => {
  localStorage.setItem(draftKey('invoice', 'w1'), JSON.stringify({ savedAt: Date.now() - DRAFT_MAX_AGE_MS - 1, value: { text: 'old' } }));
  render(<Form ws="w1" open />);
  assert.equal(screen.queryByText(/Continue your unsaved/), null);
  assert.equal(localStorage.getItem(draftKey('invoice', 'w1')), null, 'and it is removed');
});

test('EU-B3: a kept value of the wrong shape is removed, never offered', () => {
  localStorage.setItem(draftKey('invoice', 'w1'), JSON.stringify({ savedAt: Date.now(), value: null }));
  render(<Form ws="w1" open />);
  assert.equal(screen.queryByText(/Continue your unsaved/), null);
  assert.equal(localStorage.getItem(draftKey('invoice', 'w1')), null);
});
