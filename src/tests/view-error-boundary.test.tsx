/**
 * F-03: a screen that throws shows "this screen failed" with Retry and the error message, the rest
 * of the app keeps working, and the crash is reported with the screen's name. Retry re-renders the
 * same subtree instead of reloading the whole app.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ViewErrorBoundary } from '../components/common/ViewErrorBoundary';
import { setComponentWorkspace } from './helpers/componentFixtures';

let explode = true;
function Boom() {
  if (explode) throw new Error('kaboom in the widget');
  return <p>Recovered content</p>;
}

describe('ViewErrorBoundary', () => {
  const originalError = console.error;
  const calls: Array<{ url: string; body: unknown }> = [];

  beforeEach(() => {
    explode = true;
    calls.length = 0;
    setComponentWorkspace('owner');
    // React prints the caught error to console.error; keep the test output readable.
    console.error = () => {};
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    console.error = originalError;
  });

  test('the failed screen is named, keeps its error message, and Retry re-renders it', async () => {
    let resets = 0;
    render(
      <ViewErrorBoundary viewName="Broken screen" onReset={() => { resets += 1; }}>
        <Boom />
      </ViewErrorBoundary>,
    );

    assert.ok(screen.getByRole('heading', { name: 'View Render Error (Broken screen)' }));
    assert.match(document.body.textContent || '', /kaboom in the widget/);
    assert.match(document.body.textContent || '', /Your ledger data remains safe and intact/);
    // F-03: the crash report's own id is shown, so a user can quote it.
    await waitFor(() => assert.match(document.body.textContent || '', /Error reference: err_\d+_[a-z0-9]+/));

    explode = false;
    fireEvent.click(screen.getByRole('button', { name: /Retry Rendering/ }));
    assert.equal(resets, 1);
    assert.ok(screen.getByText('Recovered content'));

    await waitFor(() => assert.ok(calls.some(c => c.url.includes('/api/v1/telemetry/errors'))));
    const posted = calls.find(c => c.url.includes('/api/v1/telemetry/errors'))!;
    const record = posted.body as { message: string; metadata?: { view?: string }; severity?: string };
    assert.match(record.message, /kaboom in the widget/);
    assert.equal(record.metadata?.view, 'Broken screen');
    assert.equal(record.severity, 'error');
  });
});
