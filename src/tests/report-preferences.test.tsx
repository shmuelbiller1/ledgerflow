import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useReportPreferencesSync } from '../hooks/useReportPreferencesSync';
import {
  localReportPreferencesKey,
  normalizeRecentReports,
  normalizeReportPreferences,
  PINNED_PAGES_KEY,
  RECENT_REPORTS_KEY,
  reportPreferenceScopeKey,
  type ReportPreferenceSnapshot,
} from '../lib/reportPreferences';
import { scopedReportPreferences, type ReportPreferencesSyncAdapter, type SaveReportPreferencesInput } from '../lib/reportPreferencesDb';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { setComponentWorkspace } from './helpers/componentFixtures';

const initialUI = useUIStore.getState();
const initialAuth = useAuthStore.getState();

function setScope(uid: string, workspaceId: string) {
  setComponentWorkspace('owner');
  const current = useAuthStore.getState();
  useAuthStore.setState({
    user: current.user ? { ...current.user, uid } : null,
    currentWorkspaceId: workspaceId,
    isGuest: false,
  });
}

function fakeAdapter() {
  const listeners = new Map<string, { next: (snapshot: ReportPreferenceSnapshot | undefined) => void; error: (error: unknown) => void }>();
  const saves: SaveReportPreferencesInput[] = [];
  let saveImplementation: (input: SaveReportPreferencesInput) => Promise<void> = async () => {};
  const adapter: ReportPreferencesSyncAdapter = {
    subscribe: (uid, workspaceId, next, error) => {
      const id = `${uid}|${workspaceId}`;
      listeners.set(id, { next, error });
      return () => listeners.delete(id);
    },
    save: input => {
      saves.push(input);
      return saveImplementation(input);
    },
  };
  return {
    adapter,
    saves,
    listeners,
    failSave: () => { saveImplementation = async () => { throw new Error('offline'); }; },
    succeedSave: () => { saveImplementation = async () => {}; },
    holdSave: () => {
      let release = () => {};
      saveImplementation = () => new Promise<void>(resolve => { release = resolve; });
      return () => release();
    },
    emit(id: string, snapshot: ReportPreferenceSnapshot | undefined) {
      const listener = listeners.get(id);
      assert.ok(listener, `active subscription for ${id}`);
      listener.next(snapshot);
    },
  };
}

async function mount(fake: ReturnType<typeof fakeAdapter>, uid = 'user-a', workspaceId = 'ws-a') {
  setScope(uid, workspaceId);
  const mounted = renderHook(() => useReportPreferencesSync(fake.adapter));
  await waitFor(() => assert.ok(fake.listeners.has(`${uid}|${workspaceId}`)));
  return mounted;
}

const remote = (recentReportIds: string[], updatedAt: string, pinnedPages: ReportPreferenceSnapshot['pinnedPages'] = []): ReportPreferenceSnapshot => ({
  recentReportIds,
  pinnedPages,
  updatedAt,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUIStore.setState(initialUI, true);
  useAuthStore.setState(initialAuth, true);
});

describe('D-47 preference validation and identity', () => {
  test('recent IDs are registered, unique and bounded; synced pages are internal registered routes', () => {
    assert.deepEqual(normalizeRecentReports(['bogus', 'pnl', 'pnl', 'balance-sheet', 'cash-flow', 'group-summary', 'by-label', 'general-ledger']), [
      'pnl', 'balance-sheet', 'cash-flow', 'group-summary', 'by-label',
    ]);
    const normalized = normalizeReportPreferences({
      recentReportIds: ['pnl', 7, null],
      pinnedPages: [
        { tab: 'reports', sub: 'pnl' },
        { tab: 'reports', sub: 'pnl' },
        { tab: 'https://evil.example', sub: 'pnl' },
        { tab: 'settings', sub: 'branding' },
        { tab: 'consolidation' },
        { tab: 'reports', sub: 'gone' },
        null,
      ],
    });
    assert.deepEqual(normalized, {
      recentReportIds: ['pnl'],
      pinnedPages: [{ tab: 'reports', sub: 'pnl' }, { tab: 'settings', sub: 'branding' }, { tab: 'consolidation' }],
    });
  });

  test('profile scope keys are stable, distinct and bounded even for long Unicode identities', async () => {
    const longWorkspace = `ספרים-${'x'.repeat(300)}`;
    const [a, again, b] = await Promise.all([
      reportPreferenceScopeKey('user-a', longWorkspace),
      reportPreferenceScopeKey('user-a', longWorkspace),
      reportPreferenceScopeKey('user-b', longWorkspace),
    ]);
    assert.equal(a, again);
    assert.notEqual(a, b);
    assert.match(a, /^rp_[a-f0-9]{64}$/);
    assert.notEqual(localReportPreferencesKey('user-a', 'ws/a'), localReportPreferencesKey('user-a', 'ws:a'));
  });

  test('the profile reader selects and validates only the requested user/book record', async () => {
    const key = await reportPreferenceScopeKey('user-a', 'ws-a');
    const profile = {
      reportPreferences: {
        [key]: {
          uid: 'user-a', workspaceId: 'ws-a', updatedAt: '2026-10-24T10:00:00Z',
          recentReportIds: ['pnl', 'not-registered', 'pnl'],
          pinnedPages: [{ tab: 'reports', sub: 'pnl' }, { tab: 'https://evil.example', sub: 'pnl' }],
        },
        otherBook: { uid: 'user-a', workspaceId: 'ws-b', recentReportIds: ['cash-flow'] },
      },
    };
    assert.deepEqual(scopedReportPreferences(profile, key, 'user-a', 'ws-a'), {
      recentReportIds: ['pnl'], pinnedPages: [{ tab: 'reports', sub: 'pnl' }], updatedAt: '2026-10-24T10:00:00Z',
    });
    assert.equal(scopedReportPreferences(profile, key, 'user-a', 'ws-b'), undefined);
    assert.equal(scopedReportPreferences(profile, key, 'user-b', 'ws-a'), undefined);
    assert.equal(scopedReportPreferences(null, key, 'user-a', 'ws-a'), undefined);
  });
});

describe('D-47 live sync hook', () => {
  test('a signed-in scope never inherits another user\'s old device-global cache', async () => {
    localStorage.setItem(RECENT_REPORTS_KEY, JSON.stringify(['pnl']));
    localStorage.setItem(PINNED_PAGES_KEY, JSON.stringify([{ tab: 'reports', sub: 'pnl' }]));
    const fake = fakeAdapter();
    const mounted = await mount(fake);
    assert.deepEqual(useUIStore.getState().recentReports, []);
    assert.deepEqual(useUIStore.getState().pinnedPages, []);
    act(() => fake.emit('user-a|ws-a', remote(['cash-flow'], '2026-10-24T10:00:00Z')));
    await waitFor(() => assert.deepEqual(useUIStore.getState().recentReports, ['cash-flow']));
    assert.deepEqual(useUIStore.getState().pinnedPages, []);
    mounted.unmount();
  });

  test('the first remote snapshot and a second device update replace a clean device cache without a write loop', async () => {
    const fake = fakeAdapter();
    localStorage.setItem(localReportPreferencesKey('user-a', 'ws-a'), JSON.stringify({ recentReportIds: ['cash-flow'], pinnedPages: [], pendingSync: false }));
    const mounted = await mount(fake);
    act(() => fake.emit('user-a|ws-a', remote(['pnl'], '2026-10-24T10:00:00Z', [{ tab: 'reports', sub: 'pnl' }])));
    await waitFor(() => assert.deepEqual(useUIStore.getState().recentReports, ['pnl']));
    assert.deepEqual(useUIStore.getState().pinnedPages, [{ tab: 'reports', sub: 'pnl' }]);
    assert.equal(useUIStore.getState().reportPreferencesStatus, 'synced');

    act(() => fake.emit('user-a|ws-a', remote(['group-summary'], '2026-10-24T10:01:00Z', [{ tab: 'settings', sub: 'branding' }])));
    await waitFor(() => assert.deepEqual(useUIStore.getState().recentReports, ['group-summary']));
    assert.deepEqual(useUIStore.getState().pinnedPages, [{ tab: 'settings', sub: 'branding' }]);
    const cached = JSON.parse(localStorage.getItem(localReportPreferencesKey('user-a', 'ws-a'))!);
    assert.deepEqual(cached, { recentReportIds: ['group-summary'], pinnedPages: [{ tab: 'settings', sub: 'branding' }], pendingSync: false });
    assert.equal(fake.saves.length, 0, 'remote hydration does not echo back to the database');
    mounted.unmount();
  });

  test('a report selection and pin save the complete user/workspace record; reconnect retries a refused save', async () => {
    const fake = fakeAdapter();
    await mount(fake);
    act(() => fake.emit('user-a|ws-a', undefined));
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'synced'));

    fake.failSave();
    act(() => useUIStore.getState().recordRecentReport('pnl'));
    await waitFor(() => assert.equal(fake.saves.length, 1));
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'error'));
    assert.equal(fake.saves[0].uid, 'user-a');
    assert.equal(fake.saves[0].workspaceId, 'ws-a');
    assert.deepEqual(fake.saves[0].recentReportIds, ['pnl']);
    assert.equal(JSON.parse(localStorage.getItem(localReportPreferencesKey('user-a', 'ws-a'))!).pendingSync, true);

    fake.succeedSave();
    act(() => { window.dispatchEvent(new window.Event('online')); });
    await waitFor(() => assert.equal(fake.saves.length, 2));
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'synced'));
    assert.equal(JSON.parse(localStorage.getItem(localReportPreferencesKey('user-a', 'ws-a'))!).pendingSync, false);

    act(() => useUIStore.getState().togglePinnedPage({ tab: 'reports', sub: 'pnl' }));
    await waitFor(() => assert.equal(fake.saves.length, 3));
    assert.deepEqual(fake.saves[2].pinnedPages, [{ tab: 'reports', sub: 'pnl' }]);
  });

  test('profile completion retries a first-login edit whose first update found no profile', async () => {
    const fake = fakeAdapter();
    await mount(fake);
    act(() => fake.emit('user-a|ws-a', undefined));
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'synced'));

    fake.failSave();
    act(() => useUIStore.getState().recordRecentReport('pnl'));
    await waitFor(() => assert.equal(fake.saves.length, 1));
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'error'));
    fake.succeedSave();
    act(() => fake.emit('user-a|ws-a', undefined)); // useLedgerData has now created the profile
    await waitFor(() => assert.equal(fake.saves.length, 2));
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'synced'));
    assert.deepEqual(fake.saves[1].recentReportIds, ['pnl']);
  });

  test('a remote answer during a pending local write cannot clobber the edit', async () => {
    const fake = fakeAdapter();
    const release = fake.holdSave();
    await mount(fake);
    act(() => fake.emit('user-a|ws-a', undefined));
    act(() => useUIStore.getState().recordRecentReport('pnl'));
    await waitFor(() => assert.equal(fake.saves.length, 1));

    act(() => fake.emit('user-a|ws-a', remote(['cash-flow'], '2026-10-24T10:00:00Z')));
    assert.deepEqual(useUIStore.getState().recentReports, ['pnl']);
    act(() => release());
    await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesStatus, 'synced'));
    assert.deepEqual(useUIStore.getState().recentReports, ['pnl']);
  });

  test('an unsynced device edit survives reload and wins over the older first remote snapshot', async () => {
    const fake = fakeAdapter();
    localStorage.setItem(localReportPreferencesKey('user-a', 'ws-a'), JSON.stringify({ recentReportIds: ['cash-flow'], pinnedPages: [], pendingSync: true }));
    await mount(fake);
    act(() => fake.emit('user-a|ws-a', remote(['pnl'], '2026-10-24T09:00:00Z')));
    await waitFor(() => assert.equal(fake.saves.length, 1));
    assert.deepEqual(fake.saves[0].recentReportIds, ['cash-flow']);
    assert.deepEqual(useUIStore.getState().recentReports, ['cash-flow']);
  });

  test('switching books unsubscribes the old scope and never shows its preferences in the new one', async () => {
    const fake = fakeAdapter();
    await mount(fake);
    act(() => fake.emit('user-a|ws-a', remote(['pnl'], '2026-10-24T10:00:00Z')));
    await waitFor(() => assert.deepEqual(useUIStore.getState().recentReports, ['pnl']));
    localStorage.setItem(localReportPreferencesKey('user-a', 'ws-b'), JSON.stringify({ recentReportIds: ['group-summary'], pinnedPages: [], pendingSync: false }));

    act(() => setScope('user-a', 'ws-b'));
    await waitFor(() => assert.ok(fake.listeners.has('user-a|ws-b')));
    assert.equal(fake.listeners.has('user-a|ws-a'), false);
    assert.deepEqual(useUIStore.getState().recentReports, ['group-summary']);
    act(() => fake.emit('user-a|ws-b', remote(['balance-sheet'], '2026-10-24T10:02:00Z')));
    await waitFor(() => assert.deepEqual(useUIStore.getState().recentReports, ['balance-sheet']));
    assert.equal(fake.saves.length, 0);
  });

  test('blocked device storage stays usable and is reported instead of claiming persistence', async () => {
    const prototype = Object.getPrototypeOf(window.localStorage) as Storage;
    const originalSetItem = prototype.setItem;
    prototype.setItem = () => { throw new Error('storage denied'); };
    try {
      setComponentWorkspace('owner');
      useAuthStore.setState({ user: null, isGuest: true, currentWorkspaceId: 'guest' });
      const mounted = renderHook(() => useReportPreferencesSync(fakeAdapter().adapter));
      await waitFor(() => assert.equal(useUIStore.getState().reportPreferencesDeviceError, true));
      assert.equal(useUIStore.getState().reportPreferencesStatus, 'device');
      act(() => useUIStore.getState().togglePinnedPage({ tab: 'reports', sub: 'pnl' }));
      assert.deepEqual(useUIStore.getState().pinnedPages, [{ tab: 'reports', sub: 'pnl' }]);
      mounted.unmount();
    } finally {
      prototype.setItem = originalSetItem;
    }
  });
});
