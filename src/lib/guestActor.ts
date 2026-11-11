import { SAMPLE_UID, SAMPLE_WORKSPACE_ID, guestSession } from './db/guestDatabase';
import type { User } from './db/auth';

/** A local editor, NOT an Auth User: deliberately cannot mint a token or enter auth.currentUser. */
const sampleActor = Object.freeze({ uid: SAMPLE_UID, email: null });
export function workspaceActor(state: { user: User | null; isGuest: boolean; currentWorkspaceId: string | null }) {
  return state.user ?? (state.isGuest && state.currentWorkspaceId === SAMPLE_WORKSPACE_ID ? sampleActor : null);
}

/** Shared metadata-editor scope: local permission is confined to the sample, never server auth. */
export function workspaceEditSession(state: Parameters<typeof workspaceActor>[0] & { getCurrentWorkspace(): import('../types').Workspace | undefined }) {
  const actor = workspaceActor(state);
  const workspace = state.getCurrentWorkspace();
  if (!actor || !workspace || workspace.id !== state.currentWorkspaceId) return null;
  const role = workspace.uid === actor.uid ? 'owner' : workspace.roles?.[actor.uid];
  return { uid: actor.uid, workspaceId: workspace.id, writable: ['owner', 'accountant', 'bookkeeper'].includes(role || ''), ...(state.isGuest && !state.user && guestSession() ? { sampleSession: guestSession()! } : {}) };
}
