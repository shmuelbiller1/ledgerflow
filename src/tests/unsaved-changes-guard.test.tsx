/**
 * F-9 / P2-63: a form with unsaved changes is not lost silently.
 *
 * Two halves, both tested here:
 *  - `useUnsavedChangesGuard` registers `beforeunload` only while the form is dirty, so refresh,
 *    the back gesture and closing the tab ask first; saving or cleaning the form removes it.
 *  - the journal-entry dialog (the third primary bookkeeping form, after invoice and bill) asks
 *    before discarding a typed entry on its own Close, backdrop and Discard controls.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import JournalEntryModal from '../components/ledger/JournalEntryModal';
import { useLedgerStore } from '../stores/useLedgerStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';

const bank = makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' });
const fees = makeChartAccount({ id: 'fees', code: '6100', name: 'Bank fees', type: 'expense', category: 'Expenses' });

function GuardedForm() {
  const [text, setText] = useState('');
  useUnsavedChangesGuard(text !== '', 'unsaved memo');
  return (
    <div>
      <input aria-label="Memo" value={text} onChange={e => setText(e.target.value)} />
      <button type="button" onClick={() => setText('')}>Save</button>
    </div>
  );
}

/** Dispatch a real beforeunload and report whether the page was stopped from leaving. */
function leaveAttempt(): boolean {
  const event = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => cleanup());

describe('useUnsavedChangesGuard', () => {
  test('a clean form lets the page go, a dirty one asks, and saving removes the guard', () => {
    render(<GuardedForm />);
    assert.equal(leaveAttempt(), false, 'nothing typed: refresh and close are not intercepted');

    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'half written' } });
    assert.equal(leaveAttempt(), true, 'typed: the browser shows its leave-site prompt');

    fireEvent.click(screen.getByText('Save'));
    assert.equal(leaveAttempt(), false, 'after the form is clean nothing is intercepted');
  });

  test('an unmounted form leaves no listener behind', () => {
    const view = render(<GuardedForm />);
    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'typed' } });
    view.unmount();
    assert.equal(leaveAttempt(), false, 'the listener is removed with the component');
  });
});

describe('journal entry unsaved changes (I-07 parity)', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ accounts: [bank, fees], baseCurrency: 'AUD', transactions: [], lockDate: null });
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  });

  test('closing a typed entry asks first; answering no keeps it, yes closes', () => {
    let closed = 0;
    const asked: string[] = [];
    let answer = false;
    window.confirm = (message?: string) => { asked.push(String(message)); return answer; };

    render(<JournalEntryModal isOpen onClose={() => { closed++; }} user={{ uid: 'test-user' } as never}
      accounts={[bank, fees]} workspaceId="component-workspace" />);

    // untouched: closes without asking, as the invoice and bill dialogs do
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    assert.equal(closed, 1, 'an empty entry closes at once');
    assert.deepEqual(asked, []);

    // typed: closing asks first
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'fees' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    assert.equal(closed, 1, 'kept open when the answer is no');
    assert.match(asked[0], /Discard your changes to this journal entry/);
    assert.ok(screen.getByLabelText('Debit amount for line 1'), 'the typed entry is still there');

    answer = true;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    assert.equal(closed, 2, 'closing after the person agrees');
  });
});
