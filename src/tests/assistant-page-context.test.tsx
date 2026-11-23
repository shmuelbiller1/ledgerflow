import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { capturePageText, captureSelectedPageText } from '../components/intelligence/assistantPageText';
import FloatingAssistant from '../components/intelligence/FloatingAssistant';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useUIStore } from '../stores/useUIStore';
import { getSupabase } from '../lib/db/client';

const originalRects = HTMLElement.prototype.getClientRects;
afterEach(async () => { cleanup(); HTMLElement.prototype.getClientRects = originalRects; getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });
function pretendVisible() {
  HTMLElement.prototype.getClientRects = () => ({ length: 1, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
}

test('capture reads rendered text, never form values or hidden/private/dialog text, and masks card numbers', () => {
  pretendVisible();
  const root = document.createElement('main');
  root.innerHTML = `<h1>Invoice INV-123</h1><p>Card 4111 1111 1111 1111</p><input value="secret input"><textarea>secret field</textarea>
    <div hidden>hidden detail</div><div style="display:none">not visible</div><div style="opacity:0">transparent</div>
    <div data-assistant-private>private detail</div><div data-assistant-exclude>assistant text</div><div role="dialog">modal text</div>`;
  document.body.append(root);
  const text = capturePageText(root);
  assert.match(text, /Invoice INV-123/);
  assert.match(text, /1111/);
  assert.doesNotMatch(text, /4111|secret|hidden detail|not visible|transparent|private detail|assistant text|modal text/);
  root.remove();
});

test('highlighted text is limited to the page and excludes private material', () => {
  pretendVisible();
  const root = document.createElement('main');
  root.innerHTML = '<p>Invoice Alpha</p><p data-assistant-private>private</p><p>Invoice Beta</p>';
  document.body.append(root);
  const range = document.createRange();
  range.setStart(root.firstChild!.firstChild!, 8); range.setEnd(root.lastChild!.firstChild!, 7);
  const selected = window.getSelection()!; selected.removeAllRanges(); selected.addRange(range);
  assert.equal(captureSelectedPageText(root), 'Alpha Invoice');
  selected.removeAllRanges(); root.remove();
});

test('page text is opt-in, editable, sent only after review, and cleared on navigation', async () => {
  pretendVisible(); setComponentWorkspace('owner');
  useUIStore.setState({ activeTab: 'dashboard' });
  const requests: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    if (path.endsWith('/sandboxes')) return Response.json({ sandboxes: [{ id: 'draft', createdAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z', pendingSteps: 0 }] });
    requests.push({ path, body: JSON.parse(String(init?.body)) });
    return Response.json({ status: 'success', answer: 'Check the invoice.', path: 'model' });
  }) as typeof fetch;
  render(<><main id="main-content"><h1>Invoice INV-123</h1><input aria-label="Private note" value="unsaved secret" readOnly /><p>Acme owes 100</p></main><FloatingAssistant /></>);
  fireEvent.click(screen.getByRole('button', { name: 'AI assistant' }));
  const panel = screen.getByRole('dialog', { name: 'Floating AI assistant' });
  await within(panel).findByLabelText('Draft workspace');
  fireEvent.change(within(panel).getByLabelText('Your question'), { target: { value: 'What is this?' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Send question' }));
  await waitFor(() => assert.equal(requests.length, 1));
  assert.deepEqual(requests[0].body, { question: 'What is this?' });
  await waitFor(() => assert.equal((within(panel).getByLabelText('Your question') as HTMLTextAreaElement).value, ''));
  fireEvent.click(within(panel).getByLabelText('Share page text with the assistant'));
  fireEvent.click(within(panel).getByRole('button', { name: 'Capture page text' }));
  const preview = within(panel).getByLabelText('Page text to share') as HTMLTextAreaElement;
  assert.match(preview.value, /Invoice INV-123/);
  assert.doesNotMatch(preview.value, /unsaved secret/);
  fireEvent.change(preview, { target: { value: 'Invoice INV-123, Acme owes 100' } });
  fireEvent.change(within(panel).getByLabelText('Your question'), { target: { value: 'What is this invoice?' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Send question' }));
  await waitFor(() => assert.equal(requests.length, 2));
  const question = (requests[1].body as { question: string }).question;
  assert.match(question, /^What is this invoice\?/);
  assert.match(question, /untrusted data/);
  assert.match(question, /Invoice INV-123, Acme owes 100/);
  assert.doesNotMatch(question, /unsaved secret/);
  act(() => useUIStore.setState({ activeTab: 'sales' }));
  assert.equal(within(panel).queryByLabelText('Page text to share'), null);
  fireEvent.change(within(panel).getByLabelText('Your question'), { target: { value: 'What changed?' } });
  await waitFor(() => assert.equal((within(panel).getByRole('button', { name: 'Send question' }) as HTMLButtonElement).disabled, false));
  fireEvent.click(within(panel).getByRole('button', { name: 'Send question' }));
  assert.match((within(panel).getByRole('alert')).textContent || '', /Capture or enter page text/);
  assert.equal(requests.length, 2);
});
