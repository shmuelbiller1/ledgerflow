import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import type { AuditLog, WorkspaceInvite } from '../types';
import type { WorkspaceRole } from './useCurrentRole';
import { runCommand } from '../lib/runCommand';

interface TeamResponse {
  status?: string;
  message?: string;
  error?: string;
  members?: string[];
  ownerUid?: string;
  roles?: Record<string, WorkspaceRole>;
  invites?: WorkspaceInvite[];
  invite?: WorkspaceInvite;
  logs?: AuditLog[];
  auditLogs?: AuditLog[];
}

/** Authenticated workspace requests; a stale screen cannot send or display a team mutation. */
export function useTeamRequests(workspaceId: string) {
  const user = useAuthStore(s => s.user);
  const uid = user?.uid;
  const controller = useRef(new AbortController());
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  const isCurrent = useCallback(() => {
    const state = useAuthStore.getState();
    return !controller.current.signal.aborted && state.user?.uid === uid && state.currentWorkspaceId === workspaceId;
  }, [uid, workspaceId]);
  const ownerNow = useCallback(() => {
    const workspace = useAuthStore.getState().getCurrentWorkspace();
    return workspace?.uid === uid || workspace?.roles?.[uid || ''] === 'owner';
  }, [uid]);
  const request = useCallback(async (path: string, options: RequestInit = {}, ownerOnly = false): Promise<TeamResponse> => {
    if (!user || !isCurrent()) throw new Error('Open a signed-in workspace to manage its team.');
    if (ownerOnly && (!ownerNow() || busy.current)) throw new Error('Only an owner can change the team; wait for the current change.');
    if (ownerOnly) { busy.current = true; setSaving(true); }
    try {
      // The token used to be fetched here and the scope re-checked once it arrived. `runCommand` fetches the
      // token itself, so the check is kept on both sides of the request: a workspace or role that changed while
      // it was in flight must not get its write through.
      if (!isCurrent() || (ownerOnly && !ownerNow())) throw new Error('Workspace or permission changed.');
      const data = await runCommand<TeamResponse>({
        path, method: (options.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') ?? 'GET',
        body: options.body ? JSON.parse(String(options.body)) : undefined,
        signal: controller.current.signal,
      });
      if (!isCurrent()) throw new Error('Workspace changed.');
      // this route answers `{ status: 'success' }` and a 200 with anything else is still a refusal
      if (data.status !== 'success') throw new Error(data.message || data.error || 'The server refused this team request.');
      return data;
    } finally {
      if (ownerOnly) { busy.current = false; if (isCurrent()) setSaving(false); }
    }
  }, [user, isCurrent, ownerNow]);
  return { request, saving, isCurrent };
}
