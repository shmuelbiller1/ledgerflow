import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useUIStore } from '../stores/useUIStore';
import { parsePinned } from '../lib/pinnedPages';
import {
  localReportPreferencesKey,
  normalizeReportPreferences,
  parseRecentReports,
  PINNED_PAGES_KEY,
  RECENT_REPORTS_KEY,
  sameReportPreferences,
  type LocalReportPreferences,
  type ReportPreferenceSnapshot,
  type ReportPreferences,
  type ReportPreferencesSyncStatus,
} from '../lib/reportPreferences';
import { reportPreferencesDb, type ReportPreferencesSyncAdapter } from '../lib/reportPreferencesDb';

const SAVE_DEBOUNCE_MS = 120;

function readLocal(uid: string, workspaceId: string): { preferences: LocalReportPreferences; failed: boolean } {
  try {
    const scoped = localStorage.getItem(localReportPreferencesKey(uid, workspaceId));
    if (scoped !== null) {
      const parsed = JSON.parse(scoped) as LocalReportPreferences;
      return {
        preferences: { ...normalizeReportPreferences(parsed), pendingSync: parsed.pendingSync === true },
        failed: false,
      };
    }
    // Only guests inherit D-44/I-21's device-global copy. An authenticated scope must never
    // attribute another signed-in user's unscoped values to this user or workspace.
    if (uid === 'guest') {
      const legacy = normalizeReportPreferences({
        recentReportIds: parseRecentReports(localStorage.getItem(RECENT_REPORTS_KEY)),
        pinnedPages: parsePinned(localStorage.getItem(PINNED_PAGES_KEY)),
      });
      return { preferences: { ...legacy, pendingSync: false }, failed: false };
    }
    return { preferences: { recentReportIds: [], pinnedPages: [], pendingSync: false }, failed: false };
  } catch {
    return { preferences: { recentReportIds: [], pinnedPages: [], pendingSync: false }, failed: true };
  }
}

function writeLocal(uid: string, workspaceId: string, preferences: ReportPreferences, pendingSync: boolean): boolean {
  try {
    localStorage.setItem(localReportPreferencesKey(uid, workspaceId), JSON.stringify({ ...preferences, pendingSync }));
    return true;
  } catch {
    return false;
  }
}

/**
 * D-47: live, per-user and per-workspace recent reports and page pins. The scoped device copy is
 * available immediately; the first remote snapshot wins unless this device has an unsynced edit.
 * A second device's updates apply only while this device has no pending write.
 */
export function useReportPreferencesSync(adapter: ReportPreferencesSyncAdapter = reportPreferencesDb): void {
  const uid = useAuthStore(state => state.user?.uid ?? null);
  const isGuest = useAuthStore(state => state.isGuest);
  const workspaceId = useAuthStore(state => state.currentWorkspaceId);

  useEffect(() => {
    let active = true;
    const ownerId = uid || (isGuest ? 'guest' : '');
    if (!ownerId || !workspaceId) {
      useUIStore.setState({
        recentReports: [],
        pinnedPages: [],
        reportPreferencesStatus: 'device',
        reportPreferencesDeviceError: false,
      });
      return undefined;
    }

    const local = readLocal(ownerId, workspaceId);
    let deviceFailed = local.failed;
    let revision = uid && local.preferences.pendingSync ? 1 : 0;
    let savedRevision = 0;
    let remoteReady = false;
    let receivedRemote = false;
    let writeInFlight = false;
    let saveRequested = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let stopRemote: (() => void) | undefined;
    let applying = false;
    let lastRemoteUpdatedAt = '';

    const setStatus = (reportPreferencesStatus: ReportPreferencesSyncStatus) => {
      if (active) useUIStore.setState({ reportPreferencesStatus, reportPreferencesDeviceError: deviceFailed });
    };
    const currentPreferences = (): ReportPreferences => {
      const state = useUIStore.getState();
      return normalizeReportPreferences({ recentReportIds: state.recentReports, pinnedPages: state.pinnedPages });
    };
    const persist = (preferences: ReportPreferences, pendingSync: boolean) => {
      deviceFailed = !writeLocal(ownerId, workspaceId, preferences, pendingSync);
      if (active) useUIStore.setState({ reportPreferencesDeviceError: deviceFailed });
    };
    const apply = (preferences: ReportPreferences, pendingSync: boolean) => {
      applying = true;
      persist(preferences, pendingSync);
      useUIStore.setState({ recentReports: preferences.recentReportIds, pinnedPages: preferences.pinnedPages });
      applying = false;
    };

    apply(local.preferences, local.preferences.pendingSync);
    setStatus(uid ? 'loading' : 'device');

    const stopStore = useUIStore.subscribe((state, previous) => {
      if (applying || (state.recentReports === previous.recentReports && state.pinnedPages === previous.pinnedPages)) return;
      revision += 1;
      const preferences = normalizeReportPreferences({ recentReportIds: state.recentReports, pinnedPages: state.pinnedPages });
      persist(preferences, Boolean(uid));
      if (uid && remoteReady) requestSave();
    });

    const flushSave = async () => {
      saveTimer = null;
      if (!active || !uid || !remoteReady || !saveRequested) return;
      if (writeInFlight) return;
      saveRequested = false;
      writeInFlight = true;
      const writingRevision = revision;
      const preferences = currentPreferences();
      const updatedAt = new Date().toISOString();
      setStatus('saving');
      try {
        await adapter.save({ uid, workspaceId, ...preferences, updatedAt });
        if (!active) return;
        savedRevision = Math.max(savedRevision, writingRevision);
        lastRemoteUpdatedAt = updatedAt;
        writeInFlight = false;
        const clean = savedRevision === revision;
        persist(currentPreferences(), !clean);
        if (saveRequested || !clean) requestSave();
        else setStatus('synced');
      } catch {
        if (!active) return;
        writeInFlight = false;
        saveRequested = true; // retry on the next edit or reconnect; never spin in a failure loop
        persist(currentPreferences(), true);
        setStatus('error');
      }
    };

    function requestSave() {
      if (!active || !uid || !remoteReady) return;
      saveRequested = true;
      if (writeInFlight || saveTimer) return;
      setStatus('saving');
      saveTimer = setTimeout(() => { void flushSave(); }, SAVE_DEBOUNCE_MS);
    }

    const onRemote = (snapshot: ReportPreferenceSnapshot | undefined) => {
      if (!active || !uid) return;
      const hasLocalEdit = revision !== savedRevision;
      if (!receivedRemote) {
        receivedRemote = true;
        remoteReady = true;
        lastRemoteUpdatedAt = snapshot?.updatedAt || '';
        if (snapshot && !hasLocalEdit) {
          const preferences = normalizeReportPreferences(snapshot);
          apply(preferences, false);
          savedRevision = revision;
          setStatus('synced');
        } else if (hasLocalEdit || Object.values(currentPreferences()).some(value => value.length > 0)) {
          requestSave();
        } else {
          savedRevision = revision;
          setStatus('synced');
        }
        return;
      }
      if (!snapshot) {
        // The app's profile-creation write may finish just after a first-login preference edit.
        // Its empty scoped snapshot is the signal that updateDoc can now succeed.
        if (saveRequested || revision !== savedRevision) requestSave();
        return;
      }
      if (writeInFlight || revision !== savedRevision) {
        // The in-flight/next local write is already the later user action. Its echo must not schedule
        // another write; a genuinely newer local edit calls requestSave from the store subscription.
        return;
      }
      if (snapshot.updatedAt && snapshot.updatedAt === lastRemoteUpdatedAt) return;
      const preferences = normalizeReportPreferences(snapshot);
      lastRemoteUpdatedAt = snapshot.updatedAt || '';
      if (!sameReportPreferences(preferences, currentPreferences())) apply(preferences, false);
      else persist(preferences, false);
      savedRevision = revision;
      setStatus('synced');
    };

    const connect = () => {
      if (!active || !uid) return;
      stopRemote?.();
      try {
        stopRemote = adapter.subscribe(uid, workspaceId, onRemote, () => {
          if (!active) return;
          if (!receivedRemote) remoteReady = false;
          setStatus('error');
        });
      } catch {
        if (!receivedRemote) remoteReady = false;
        setStatus('error');
      }
    };

    if (uid) connect();

    const onOnline = () => {
      if (!active || !uid) return;
      if (!receivedRemote) connect();
      else if (saveRequested || revision !== savedRevision) requestSave();
    };
    window.addEventListener('online', onOnline);

    return () => {
      active = false;
      if (saveTimer) clearTimeout(saveTimer);
      stopRemote?.();
      stopStore();
      window.removeEventListener('online', onOnline);
    };
  }, [adapter, uid, isGuest, workspaceId]);
}
