import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

afterEach(cleanup);
function Harness({ run }: { run: () => void }) {
  useKeyboardShortcuts({ 'n i': run, 'n b': run, 'n j': run });
  return <input aria-label="Draft" />;
}

test('creation sequences avoid intercepting Mac DevTools or Windows AltGr combinations', () => {
  let called = 0;
  render(<Harness run={() => called++} />);
  for (const key of ['i', 'b', 'j']) for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    const event = new window.KeyboardEvent('keydown', { key, altKey: true, ...modifier, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(called, 0);
  for (const key of ['i', 'b', 'j']) {
    fireEvent.keyDown(window, { key: 'n' });
    fireEvent.keyDown(window, { key });
  }
  assert.equal(called, 3);
});

test('typing, dialogs, mismatched and expired sequences cannot create a record', () => {
  let called = 0;
  const view = render(<Harness run={() => called++} />);
  fireEvent.keyDown(window, { key: 'n' });
  fireEvent.keyDown(view.getByLabelText('Draft'), { key: 'i' });
  fireEvent.keyDown(window, { key: 'i' });
  fireEvent.keyDown(window, { key: 'n' });
  fireEvent.keyDown(window, { key: 'x' });
  fireEvent.keyDown(window, { key: 'i' });
  view.rerender(<><Harness run={() => called++} /><div role="dialog" aria-modal="true" /></>);
  fireEvent.keyDown(window, { key: 'n' });
  fireEvent.keyDown(window, { key: 'i' });
  view.rerender(<Harness run={() => called++} />);
  for (const [key, time] of [['n', 1], ['i', 1300]] as const) {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'timeStamp', { value: time });
    window.dispatchEvent(event);
  }
  assert.equal(called, 0);
});
