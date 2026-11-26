import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import FloatingAssistant from '../components/intelligence/FloatingAssistant';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { getSupabase } from '../lib/db/client';

afterEach(async () => { cleanup(); getSupabase().realtime.disconnect(); await getSupabase().auth.dispose(); });

test('non-modal assistant preserves the underlying form and chat when minimized', async () => {
  setComponentWorkspace('owner');
  globalThis.fetch = (async () => Response.json({ sandboxes: [] })) as typeof fetch;
  render(<><label htmlFor="draft-form">Invoice note</label><input id="draft-form" /><FloatingAssistant /></>);
  fireEvent.change(screen.getByLabelText('Invoice note'), { target: { value: 'Unsaved work' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask Flo' }));
  const panel = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  await within(panel).findByRole('button', { name: 'Start assistant' });
  fireEvent.change(within(panel).getByLabelText('Your question'), { target: { value: 'open sales' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Send question' }));
  const link = within(panel).getByRole('link', { name: 'Open sales in a new tab' });
  assert.equal(link.getAttribute('href'), '/#sales');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal((screen.getByLabelText('Invoice note') as HTMLInputElement).value, 'Unsaved work');
  fireEvent.click(within(panel).getByRole('button', { name: 'Minimize assistant' }));
  assert.equal(screen.queryByRole('dialog', { name: 'Flo · your AI assistant' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Flo' }));
  assert.ok(screen.getByRole('link', { name: 'Open sales in a new tab' }));
  assert.equal((screen.getByLabelText('Invoice note') as HTMLInputElement).value, 'Unsaved work');
});

test('size and keyboard movement remain in the viewport and the question remains intact', async () => {
  setComponentWorkspace('owner');
  globalThis.fetch = (async () => Response.json({ sandboxes: [] })) as typeof fetch;
  render(<FloatingAssistant />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Flo' }));
  const panel = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  await within(panel).findByRole('button', { name: 'Start assistant' });
  fireEvent.change(within(panel).getByLabelText('Your question'), { target: { value: 'Draft text' } });
  const width = parseInt(panel.style.width, 10);
  fireEvent.click(within(panel).getByRole('button', { name: 'Make assistant smaller' }));
  assert.ok(parseInt(panel.style.width, 10) < width);
  fireEvent.keyDown(within(panel).getByRole('button', { name: /Move assistant/ }), { key: 'ArrowLeft' });
  assert.ok(parseInt(panel.style.left, 10) >= 0);
  fireEvent.click(within(panel).getByRole('button', { name: 'Make assistant bigger' }));
  assert.equal((within(panel).getByLabelText('Your question') as HTMLTextAreaElement).value, 'Draft text');
  act(() => { window.dispatchEvent(new window.Event('resize')); });
  await waitFor(() => assert.ok(parseInt(panel.style.width, 10) <= window.innerWidth));
});

test('Escape minimizes the non-modal assistant and returns focus to its launcher', async () => {
  setComponentWorkspace('owner');
  globalThis.fetch = (async () => Response.json({ sandboxes: [] })) as typeof fetch;
  render(<FloatingAssistant />);
  const launcher = screen.getByRole('button', { name: 'Ask Flo' });
  launcher.focus(); fireEvent.click(launcher);
  const panel = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  assert.equal(panel.getAttribute('aria-modal'), null);
  const move = within(panel).getByRole('button', { name: /Move assistant/ });
  move.focus();
  fireEvent.keyDown(move, { key: 'Escape' });
  await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Flo · your AI assistant' }), null));
  await waitFor(() => assert.ok(document.activeElement === launcher, 'focus returned to launcher'));
});

test('draft list can be refreshed after a draft is closed in the other tab', async () => {
  setComponentWorkspace('owner');
  let open = [1, 2, 3];
  globalThis.fetch = (async () => Response.json({ sandboxes: open.map(n => ({ id: `draft-${n}`, createdAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z', pendingSteps: 0 })) })) as typeof fetch;
  render(<FloatingAssistant />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Flo' }));
  const panel = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  const add = await within(panel).findByRole('button', { name: 'Open another draft' });
  assert.equal((add as HTMLButtonElement).disabled, true);
  open = [2, 3];
  fireEvent.click(within(panel).getByRole('button', { name: 'Refresh drafts' }));
  await waitFor(() => assert.equal((add as HTMLButtonElement).disabled, false));
  assert.equal((within(panel).getByLabelText('Draft workspace') as HTMLSelectElement).value, 'draft-2');
});

test('the assistant hides while a modal owns the page and returns with its conversation intact', async () => {
  setComponentWorkspace('owner');
  globalThis.fetch = (async () => Response.json({ sandboxes: [] })) as typeof fetch;
  const { useDialog } = await import('../hooks/useDialog');
  function Modal({ close }: { close: () => void }) {
    const { dialogProps, titleId } = useDialog(close);
    return <div {...dialogProps}><h2 id={titleId}>Editing invoice</h2><input aria-label="Invoice field" /></div>;
  }
  function Screen() {
    const [modal, setModal] = React.useState(false);
    return <><button type="button" onClick={() => setModal(true)}>Open invoice modal</button>{modal && <Modal close={() => setModal(false)} />}<FloatingAssistant /></>;
  }
  render(<Screen />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Flo' }));
  const assistant = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  await within(assistant).findByRole('button', { name: 'Start assistant' });
  fireEvent.change(within(assistant).getByLabelText('Your question'), { target: { value: 'My question' } });
  const opener = screen.getByRole('button', { name: 'Open invoice modal' });
  opener.focus(); fireEvent.click(opener);
  assert.ok(screen.getByRole('dialog', { name: 'Editing invoice' }));
  assert.equal(screen.queryByRole('dialog', { name: 'Flo · your AI assistant' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Ask Flo' }), null);
  fireEvent.keyDown(screen.getByLabelText('Invoice field'), { key: 'Escape' });
  assert.equal(screen.queryByRole('dialog', { name: 'Editing invoice' }), null);
  assert.ok(document.activeElement === opener, 'closing the modal returns focus to its page control');
  const restored = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  assert.equal((within(restored).getByLabelText('Your question') as HTMLTextAreaElement).value, 'My question');
});

test('starting a draft keeps a question already typed in the floating assistant', async () => {
  setComponentWorkspace('owner');
  let opened = false;
  globalThis.fetch = (async (input, init) => {
    const path = String(input);
    const draft = { id: 'new-draft', createdAt: '2026-11-23T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z', pendingSteps: 0 };
    if (path.endsWith('/sandboxes') && init?.method === 'POST') { opened = true; return Response.json({ sandbox: draft }); }
    return Response.json({ sandboxes: opened ? [draft] : [] });
  }) as typeof fetch;
  render(<FloatingAssistant />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask Flo' }));
  const panel = screen.getByRole('dialog', { name: 'Flo · your AI assistant' });
  const start = await within(panel).findByRole('button', { name: 'Start assistant' });
  fireEvent.change(within(panel).getByLabelText('Your question'), { target: { value: 'Draft an invoice for Acme' } });
  fireEvent.click(start);
  await within(panel).findByLabelText('Draft workspace');
  assert.equal((within(panel).getByLabelText('Your question') as HTMLTextAreaElement).value, 'Draft an invoice for Acme');
});
