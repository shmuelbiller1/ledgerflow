import { stubFetch } from './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isClientActiveForPolling, useVisibilityPolling, type VisibilityPollingOptions } from '../hooks/useVisibilityPolling';
import StatusPage from '../components/system/StatusPage';
import {
  collection,
  doc,
  getActiveSnapshotListenerCounts,
  getFirestore,
  onSnapshot,
  query,
  where,
} from '../lib/db/firestore';

/** Overrides `document.visibilityState` for visibility-polling unit tests. */
function setDocumentVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

/** Overrides `window.navigator.onLine` for offline-polling unit tests. */
function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

/** Minimal React harness mounting `useVisibilityPolling` with configurable props. */
function PollingHarness({
  callback,
  intervalMs,
  options,
}: {
  callback: () => void | Promise<void>;
  intervalMs: number;
  options?: VisibilityPollingOptions;
}) {
  useVisibilityPolling(callback, intervalMs, options);
  return <div data-testid="polling-harness">ready</div>;
}

/** Creates an in-memory Supabase client stub that counts Realtime channel creation and removal. */
function makeFakeSupabaseClient() {
  let createdChannels = 0;
  let removedChannels = 0;

  const builder = () => {
    const b = {
      eq: () => b,
      gt: () => b,
      not: () => b,
      order: () => b,
      range: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return b;
  };

  const client = {
    from: () => ({ select: () => builder() }),
    channel: () => {
      createdChannels += 1;
      const ch = {
        on: () => ch,
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: async () => {
      removedChannels += 1;
      return 'ok';
    },
  } as unknown as SupabaseClient;

  return {
    client,
    stats: () => ({ createdChannels, removedChannels }),
  };
}

describe('Visibility-aware polling and subscription cleanup', () => {
  afterEach(() => {
    cleanup();
    setDocumentVisibility('visible');
    setNavigatorOnline(true);
  });

  test('isClientActiveForPolling reflects document visibility and navigator connectivity', () => {
    setDocumentVisibility('visible');
    setNavigatorOnline(true);
    assert.equal(isClientActiveForPolling(), true);

    setDocumentVisibility('hidden');
    assert.equal(isClientActiveForPolling(), false);

    setDocumentVisibility('visible');
    setNavigatorOnline(false);
    assert.equal(isClientActiveForPolling(), false);
  });

  test('useVisibilityPolling pauses while hidden/offline, catches up on resume, and deduplicates slow calls', async () => {
    let calls = 0;
    let releaseSlowCall: (() => void) | null = null;

    const callback = () => {
      calls += 1;
      if (releaseSlowCall) {
        return new Promise<void>((resolve) => {
          releaseSlowCall = resolve;
        });
      }
      return undefined;
    };

    const { rerender, unmount } = render(
      <PollingHarness
        callback={callback}
        intervalMs={40}
        options={{ enabled: true, minResumeIntervalMs: 10 }}
      />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 95));
    });
    const visibleCalls = calls;
    assert.ok(visibleCalls >= 1, `expected active polling calls, got ${visibleCalls}`);

    // Hide the tab: zero new ticks may fire while hidden
    setDocumentVisibility('hidden');
    const beforeHiddenCount = calls;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 110));
    });
    assert.equal(calls, beforeHiddenCount, 'hidden tab must not execute background polling ticks');

    // Return to tab: immediate catch-up tick fires without waiting another full interval
    setDocumentVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new window.Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 5));
    });
    assert.equal(calls, beforeHiddenCount + 1, 'returning to visible tab should refresh immediately');

    // Deduplicate overlapping slow in-flight executions
    const slowControl: { unblock?: () => void } = {};
    const blockingCallback = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        slowControl.unblock = resolve;
      });
    };
    rerender(
      <PollingHarness
        callback={blockingCallback}
        intervalMs={25}
        options={{ enabled: true, minResumeIntervalMs: 5 }}
      />,
    );
    const beforeSlow = calls;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 95));
    });
    assert.equal(calls, beforeSlow + 1, 'slow in-flight poll must not overlap itself');
    slowControl.unblock?.();

    // Disabling stops further polls cleanly
    rerender(
      <PollingHarness
        callback={callback}
        intervalMs={25}
        options={{ enabled: false }}
      />,
    );
    const afterDisable = calls;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 70));
    });
    assert.equal(calls, afterDisable);

    unmount();
  });

  test('runImmediately defers initial execution when mounted while hidden and catches up on visibility resume', async () => {
    setDocumentVisibility('hidden');
    let calls = 0;

    render(
      <PollingHarness
        callback={() => {
          calls += 1;
        }}
        intervalMs={60_000}
        options={{ enabled: true, runImmediately: true, minResumeIntervalMs: 5 }}
      />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    assert.equal(calls, 0, 'runImmediately must not execute while tab is hidden');

    setDocumentVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new window.Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.equal(calls, 1, 'deferred initial poll must execute immediately when tab becomes visible');
  });

  test('StatusPage loads initial status and refreshes immediately when a hidden tab becomes visible', async () => {
    const urls = stubFetch(200, {
      state: 'operational',
      checkedAt: '2026-10-02T12:00:00Z',
      components: [{ id: 'database', name: 'Database', state: 'operational', detail: 'Answering.' }],
    });

    render(<StatusPage />);
    await waitFor(() => screen.getByText('Everything is working'));
    assert.equal(urls.length, 1);

    // Simulate hiding tab, waiting >1s minimum resume interval, and returning
    setDocumentVisibility('hidden');
    act(() => {
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1_050));
    });
    assert.equal(urls.length, 1, 'no status poll while tab is hidden');

    setDocumentVisibility('visible');
    act(() => {
      document.dispatchEvent(new window.Event('visibilitychange'));
    });
    await waitFor(() => assert.equal(urls.length, 2));
  });

  test('onSnapshot cleans up localListeners, fullReloadListeners, and Realtime channels across workspace switches', async () => {
    const baseline = getActiveSnapshotListenerCounts();
    const { client, stats } = makeFakeSupabaseClient();
    const fakeDb = getFirestore(() => client);

    // Subscribe to workspace A collections + user doc
    const unsubWsA = [
      onSnapshot(query(collection(fakeDb, 'transactions'), where('workspaceId', '==', 'ws-a')), () => {}),
      onSnapshot(query(collection(fakeDb, 'chartAccounts'), where('workspaceId', '==', 'ws-a')), () => {}),
      onSnapshot(query(collection(fakeDb, 'invoices'), where('workspaceId', '==', 'ws-a')), () => {}),
      onSnapshot(doc(fakeDb, 'users', 'user-1'), () => {}),
    ];

    const duringWsA = getActiveSnapshotListenerCounts();
    assert.equal(duringWsA.localListeners - baseline.localListeners, 4);
    assert.equal(duringWsA.fullReloadListeners - baseline.fullReloadListeners, 4);
    assert.equal(stats().createdChannels, 4);

    // Switch ws-a -> ws-b (unsubscribe ws-a collections while keeping user doc, subscribe ws-b)
    unsubWsA.slice(0, 3).forEach((u) => u());
    const unsubWsB = [
      onSnapshot(query(collection(fakeDb, 'transactions'), where('workspaceId', '==', 'ws-b')), () => {}),
      onSnapshot(query(collection(fakeDb, 'bills'), where('workspaceId', '==', 'ws-b')), () => {}),
    ];
    assert.equal(stats().removedChannels, 3);
    assert.equal(stats().createdChannels, 6);

    // Sign out / unmount everything
    unsubWsB.forEach((u) => u());
    unsubWsA[3]();

    const afterSignOut = getActiveSnapshotListenerCounts();
    assert.equal(afterSignOut.localListeners, baseline.localListeners, 'all localListeners must be removed');
    assert.equal(afterSignOut.tables, baseline.tables, 'empty per-table listener sets must be pruned');
    assert.equal(afterSignOut.fullReloadListeners, baseline.fullReloadListeners, 'all fullReloadListeners must be removed');
    assert.equal(stats().removedChannels, stats().createdChannels, 'every Realtime channel must be removed');
  });
});
