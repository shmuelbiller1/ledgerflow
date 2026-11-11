import { guestSession, SAMPLE_WORKSPACE_ID } from '../../lib/db/guestDatabase';
import { moveGuestStage, readGuestStages } from '../../lib/guestSettings';
import { create } from 'zustand';
import { getIdToken } from '../../firebase';
import type { StageKind } from '../../lib/stages';

/**
 * Custom stages (BG-06) read once per list: every row's chip shares one request for its kind.
 */
interface Loaded { stages: string[]; current: Record<string, string> }
interface StageState {
  byKey: Record<string, Loaded | undefined>;
  asked: Record<string, boolean>;
  load: (workspaceId: string, kind: StageKind) => void;
  set: (workspaceId: string, kind: StageKind, id: string, stage: string) => Promise<void>;
}

const keyOf = (workspaceId: string, kind: StageKind) => `${workspaceId}:${kind}`;
const url = (workspaceId: string) => `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/stages`;

export const useStageStore = create<StageState>((set, get) => ({
  byKey: {},
  asked: {},
  load: (workspaceId, kind) => {
    const key = keyOf(workspaceId, kind);
    if (guestSession()) {
      const loaded = readGuestStages(workspaceId, kind);
      set(s => ({ asked: { ...s.asked, [key]: true }, byKey: { ...s.byKey, [key]: { stages: loaded.stages, current: loaded.current } } }));
      return;
    }
    if (workspaceId === SAMPLE_WORKSPACE_ID) return;
    if (get().asked[key]) return;
    set(s => ({ asked: { ...s.asked, [key]: true } }));
    (async () => {
      const res = await fetch(`${url(workspaceId)}?kind=${kind}`, { headers: { Authorization: `Bearer ${await getIdToken()}` } });
      if (!res.ok) return;
      const data = await res.json();
      set(s => ({ byKey: { ...s.byKey, [key]: { stages: Array.isArray(data.stages) ? data.stages : [], current: data.current || {} } } }));
    })().catch(() => {});
  },
  set: async (workspaceId, kind, id, stage) => {
    const sampleSession = guestSession();
    if (sampleSession) {
      moveGuestStage(workspaceId, kind, id, stage);
    } else {
      if (workspaceId === SAMPLE_WORKSPACE_ID) throw new Error('The sample company is closed.');
      const res = await fetch(url(workspaceId), { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getIdToken()}` }, body: JSON.stringify({ kind, id, stage }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'The stage was not saved');
    }
    if (guestSession() !== sampleSession) return;
    const key = keyOf(workspaceId, kind);
    set(s => {
      const loaded = s.byKey[key] || { stages: [], current: {} };
      const current = { ...loaded.current };
      if (stage) current[id] = stage; else delete current[id];
      return { byKey: { ...s.byKey, [key]: { ...loaded, current } } };
    });
  },
}));

/** Forget what was read (after the stages themselves changed in Settings). */
export const resetStages = () => useStageStore.setState({ byKey: {}, asked: {} });
