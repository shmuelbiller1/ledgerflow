import './helpers/dom';
import React, { useState } from 'react';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useDetailReturnFocus } from '../hooks/useDetailReturnFocus';

function List({ name }: { name: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const openerId = useDetailReturnFocus(selected);
  return selected ? <section><button onClick={() => setSelected(null)}>Back to {name}</button></section>
    : <button id={openerId('mixed אבג / #')} onClick={() => setSelected('mixed אבג / #')}>View {name}</button>;
}
afterEach(cleanup);
test('Back focuses the remounted record opener, including mixed-language IDs, without stealing initial focus', () => {
  render(<><List name="customers" /><List name="vendors" /></>);
  assert.equal(document.activeElement, document.body);
  const first = screen.getByRole('button', { name: 'View customers' });
  first.focus();
  fireEvent.click(first);
  assert.equal(first.isConnected, false);
  fireEvent.click(screen.getByRole('button', { name: 'Back to customers' }));
  assert.equal(document.activeElement, screen.getByRole('button', { name: 'View customers' }));
  fireEvent.click(screen.getByRole('button', { name: 'View vendors' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to vendors' }));
  assert.equal(document.activeElement, screen.getByRole('button', { name: 'View vendors' }));
});
