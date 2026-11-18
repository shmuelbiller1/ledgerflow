import { doc, getFirestore, onSnapshot } from './db/firestore';
import { runNamedCommand } from './commandByName';
import { localUpdate } from './db/localStore';
import { guestSession } from './db/guestDatabase';
import {
  normalizeReportPreferences,
  reportPreferenceScopeKey,
  type ReportPreferenceSnapshot,
  type ReportPreferences,
} from './reportPreferences';

export interface SaveReportPreferencesInput extends ReportPreferences {
  uid: string;
  workspaceId: string;
  updatedAt?: string;
}

/** Small adapter so the two-device and offline race tests do not need a browser or a network. */
export interface ReportPreferencesSyncAdapter {
  subscribe(
    uid: string,
    workspaceId: string,
    onData: (value: ReportPreferenceSnapshot | undefined) => void,
    onError: (error: unknown) => void,
  ): () => void;
  save(input: SaveReportPreferencesInput): Promise<void>;
}

/** Read only this book's record; another key in the same private profile cannot leak into it. */
export function scopedReportPreferences(
  profile: Record<string, unknown> | null,
  scopeKey: string,
  uid: string,
  workspaceId: string,
): ReportPreferenceSnapshot | undefined {
  const container = profile?.reportPreferences;
  if (!container || typeof container !== 'object' || Array.isArray(container)) return undefined;
  const value = (container as Record<string, unknown>)[scopeKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.uid !== uid || record.workspaceId !== workspaceId) return undefined;
  return {
    ...normalizeReportPreferences(record),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

export const reportPreferencesDb: ReportPreferencesSyncAdapter = {
  subscribe(uid, workspaceId, onData, onError) {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void reportPreferenceScopeKey(uid, workspaceId).then(scopeKey => {
      if (!active) return;
      const db = getFirestore();
      unsubscribe = onSnapshot(doc(db, 'users', uid), snapshot => {
        onData(scopedReportPreferences(snapshot.data() || null, scopeKey, uid, workspaceId));
      }, onError);
    }).catch(onError);
    return () => { active = false; unsubscribe?.(); };
  },
  async save(input) {
    const scopeKey = await reportPreferenceScopeKey(input.uid, input.workspaceId);
    const updatedAt = input.updatedAt || new Date().toISOString();
    const snapshot: ReportPreferenceSnapshot = {
      ...normalizeReportPreferences(input),
      updatedAt,
    };
    // One dotted field per book, so saving book A cannot replace book B. `user.preferences` writes that dotted
    // field on the server and types `updatedAt` there; the sample company has no profile row to write, so its tab
    // keeps the layout in its own copy instead of asking.
    if (guestSession()) {
      await localUpdate('users', input.uid, { [`reportPreferences.${scopeKey}`]: { uid: input.uid, workspaceId: input.workspaceId, ...snapshot }, updatedAt });
      return;
    }
    await runNamedCommand('user.preferences', {
      reportPreferences: { scopeKey, workspaceId: input.workspaceId, preferences: snapshot },
    });
  },
};
