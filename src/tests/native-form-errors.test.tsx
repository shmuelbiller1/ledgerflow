import './helpers/dom';
import React from 'react';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useNativeFormErrors } from '../hooks/useNativeFormErrors';

afterEach(cleanup);
function Form({ active = true, extra = false, context = 'one' }: { active?: boolean; extra?: boolean; context?: string }) {
  const { formRef, showFieldError } = useNativeFormErrors(active, context);
  return <form ref={formRef}>
    <p id="existing-help">Keep this help</p>
    <label>First<input name="first" required aria-describedby="existing-help" /></label>
    <label>Second<input name="second" required /></label>
    {extra && <label>Dynamic<input name="dynamic" required /></label>}
    <button type="button" onClick={() => formRef.current?.reportValidity()}>Validate</button>
    <button type="button" onClick={() => showFieldError('first', '<script>Unsafe name</script>')}>Custom</button>
    <button type="reset">Reset</button>
  </form>;
}

test('native errors are linked, focus the first invalid, preserve the name and help, and clear on edit', async () => {
  render(<Form />);
  fireEvent.click(screen.getByText('Validate'));
  await act(async () => { await Promise.resolve(); });
  const first = screen.getByLabelText('First');
  assert.equal(document.activeElement, first);
  assert.equal(first.getAttribute('aria-invalid'), 'true');
  const ids = first.getAttribute('aria-describedby')!.split(' ');
  assert.equal(ids[0], 'existing-help');
  assert.equal(document.getElementById(ids[1])!.getAttribute('role'), 'alert');
  assert.ok(document.getElementById(ids[1])!.textContent);
  fireEvent.input(first, { target: { value: 'Corrected' } });
  assert.equal(first.getAttribute('aria-describedby'), 'existing-help');
  assert.equal(first.hasAttribute('aria-invalid'), false);
  assert.equal(document.getElementById(ids[1]), null);
});

test('repeat validation reuses nodes; reset clears all links without removing help', async () => {
  render(<Form />);
  fireEvent.click(screen.getByText('Validate'));
  fireEvent.click(screen.getByText('Validate'));
  await act(async () => { await Promise.resolve(); });
  assert.equal(screen.getAllByRole('alert').length, 2);
  fireEvent.click(screen.getByText('Reset'));
  assert.equal(screen.queryAllByRole('alert').length, 0);
  assert.equal(screen.getByLabelText('First').getAttribute('aria-describedby'), 'existing-help');
  assert.equal(screen.getByLabelText('Second').hasAttribute('aria-describedby'), false);
});

test('custom text is not HTML; changing records or closing cleans up ARIA', () => {
  const view = render(<Form />);
  fireEvent.click(screen.getByText('Custom'));
  assert.equal(screen.getByRole('alert').textContent, '<script>Unsafe name</script>');
  assert.equal(screen.getByRole('alert').querySelector('script'), null);
  assert.equal(document.activeElement, screen.getByLabelText('First'));
  view.rerender(<Form context="two" />);
  assert.equal(screen.queryAllByRole('alert').length, 0);
  fireEvent.click(screen.getByText('Custom'));
  view.rerender(<Form active={false} context="two" />);
  assert.equal(screen.queryAllByRole('alert').length, 0);
  assert.equal(screen.getByLabelText('First').getAttribute('aria-describedby'), 'existing-help');
});

test('delegated validation includes dynamic inputs and unmount removes errors', async () => {
  const view = render(<Form />);
  fireEvent.input(screen.getByLabelText('First'), { target: { value: 'One' } });
  fireEvent.input(screen.getByLabelText('Second'), { target: { value: 'Two' } });
  view.rerender(<Form extra />);
  fireEvent.click(screen.getByText('Validate'));
  await act(async () => { await Promise.resolve(); });
  assert.equal(document.activeElement, screen.getByLabelText('Dynamic'));
  const error = screen.getByRole('alert');
  view.unmount();
  assert.equal(error.isConnected, false);
});

test('clearing an error restores existing invalid state and keeps newly added help tokens', () => {
  render(<Form />);
  const first = screen.getByLabelText('First');
  first.setAttribute('aria-invalid', 'false');
  fireEvent.click(screen.getByText('Custom'));
  first.setAttribute('aria-describedby', `${first.getAttribute('aria-describedby')} later-help`);
  fireEvent.change(first, { target: { value: 'Edited' } });
  assert.equal(first.getAttribute('aria-invalid'), 'false');
  assert.equal(first.getAttribute('aria-describedby'), 'existing-help later-help');
});

test('closing before deferred focus runs does not move focus to an obsolete form', async () => {
  const view = render(<Form />);
  fireEvent.click(screen.getByText('Validate'));
  view.unmount();
  await act(async () => { await Promise.resolve(); });
  assert.equal(screen.queryAllByRole('alert').length, 0);
  assert.equal(document.activeElement, document.body);
});
