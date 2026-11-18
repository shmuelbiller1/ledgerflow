import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import WorkspaceArchiveExport from '../components/platform/settings/WorkspaceArchiveExport';
import { useAuthStore } from '../stores/useAuthStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useServerExport, type ExportRun } from '../hooks/useServerExport';

const originalFetch = globalThis.fetch;
const auth = useAuthStore.getState();

afterEach(() => {
  cleanup();
  useAuthStore.setState(auth, true);
  globalThis.fetch = originalFetch;
});

test('E-21 only a signed-in owner can request an archive', () => {
  setComponentWorkspace('viewer');
  render(<WorkspaceArchiveExport />);
  assert.equal((screen.getByRole('button', { name: 'Download workspace ZIP archive' }) as HTMLButtonElement).disabled, true);
  cleanup();
  setComponentWorkspace('owner');
  render(<WorkspaceArchiveExport />);
  assert.equal((screen.getByRole('button', { name: 'Download workspace ZIP archive' }) as HTMLButtonElement).disabled, false);
  cleanup();
  useAuthStore.setState({ isGuest: true, user: null });
  render(<WorkspaceArchiveExport />);
  assert.equal((screen.getByRole('button', { name: 'Download workspace ZIP archive' }) as HTMLButtonElement).disabled, true);
});

test('E-21 failed server snapshot is not replaced by a partial browser cache', async () => {
  setComponentWorkspace('owner');
  let calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls++;
    assert.equal(String(input), '/api/v1/workspaces/component-workspace/export');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    return new Response('{}', { status: 503 });
  }) as typeof fetch;
  render(<WorkspaceArchiveExport />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Download workspace ZIP archive' }));
  });
  await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /No incomplete archive was downloaded/));
  assert.equal(calls, 1);
  assert.equal((screen.getByRole('button', { name: 'Download workspace ZIP archive' }) as HTMLButtonElement).disabled, false);
});

test('E-21 workspace switch during export cannot complete under the previous workspace', async () => {
  setComponentWorkspace('owner');
  let reply: ((value: Response) => void) | undefined;
  globalThis.fetch = (() => new Promise<Response>(resolve => { reply = resolve; })) as typeof fetch;
  render(<WorkspaceArchiveExport />);
  fireEvent.click(screen.getByRole('button', { name: 'Download workspace ZIP archive' }));
  await waitFor(() => assert.ok(reply));
  await act(async () => {
    useAuthStore.setState({ currentWorkspaceId: 'another-workspace' });
    reply!(new Response('{}', { status: 200 }));
  });
  assert.equal((screen.getByRole('button', { name: 'Download workspace ZIP archive' }) as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByText(/Archived .* collections/), null);
});

test('E-21 a failed export is reported under React Strict Mode and the owner can retry', async () => {
  setComponentWorkspace('owner');
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('{}', { status: 503 }); }) as typeof fetch;
  render(<React.StrictMode><WorkspaceArchiveExport /></React.StrictMode>);
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Download workspace ZIP archive' });
  await act(async () => { fireEvent.click(button); });
  assert.equal(calls, 1);
  assert.match(screen.getByRole('alert').textContent || '', /No incomplete archive was downloaded/);
  assert.equal(button.disabled, false);
  await act(async () => { fireEvent.click(button); });
  assert.equal(calls, 2);
});

// A browser task (such as building a ZIP) may not settle until after the user cancels and retries.
test('A cancelled export settling late cannot unlock a newer export', async () => {
  setComponentWorkspace('owner');
  const runs: Array<ExportRun & { finish: () => void }> = [];
  const busy: boolean[] = [];
  const { result, unmount } = renderHook(() => useServerExport({
    allowed: true,
    setBusy: value => { busy.push(value); },
    setError: () => {},
    failure: 'Export failed',
    run: context => new Promise<void>(finish => runs.push({ ...context, finish })),
  }));

  const first = result.current.start();
  result.current.cancel();
  const second = result.current.start();
  try {
    assert.equal(runs[0].signal.aborted, true);
    runs[0].finish();
    await first;
    const blocked = result.current.start();
    assert.equal(runs.length, 2, 'the late completion did not unlock the second run');
    await blocked;
    assert.equal(runs[1].stillHere(), true);
    assert.deepEqual(busy, [true, false, true]);
  } finally {
    for (const run of runs) run.finish();
    await Promise.all([first, second]);
    unmount();
  }
  assert.deepEqual(busy, [true, false, true, false]);
});
