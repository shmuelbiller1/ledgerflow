import { workspaceActor } from './guestActor';
import { guestRows, guestSession } from './db/guestDatabase';
import { localDelete, localSet } from './db/localStore';
import { runNamedCommand } from './commandByName';
import { useAuthStore } from '../stores/useAuthStore';
import { toast } from 'sonner';

/**
 * Deleting a project, with the ten seconds of regret that makes it safe.
 *
 * The delete and the undo are commands now. The browser used to read the row, delete it, and keep the snapshot in a
 * closure: a reload lost it, a second tab could not know the id had been taken again, and nothing anywhere recorded
 * that the project had existed. `project.delete` answers with the row it removed, and its `inverse()` names
 * `project.restore` with that row — so the Undo button runs the same step back an accountant could run tomorrow.
 *
 * The ten-second window and the workspace checks stay here, because they are about *this toast* and *this tab*:
 * they decide whether to offer the step back, not whether it is allowed. The server decides that.
 */
/** Deliberately restricted to project metadata; financial documents retain their posting flow. */
export async function deleteProjectWithUndo(id: string) {
  const initial = useAuthStore.getState();
  const workspaceId = initial.currentWorkspaceId ?? undefined;
  const uid = workspaceActor(initial)?.uid;
  const sampleSession = guestSession();
  function allowed() {
    const state = useAuthStore.getState();
    const workspace = state.workspaces.find(w => w.id === workspaceId);
    const role = uid && workspace?.roles?.[uid];
    return Boolean(uid && workspaceId && workspaceActor(state)?.uid === uid && guestSession() === sampleSession && state.currentWorkspaceId === workspaceId && (workspace?.uid === uid || role === 'owner' || role === 'accountant' || role === 'bookkeeper'));
  }
  if (!allowed()) throw new Error('This workspace is read-only.');
  if (!workspaceId) throw new Error('This workspace is read-only.');

  // the sample company has no workspace on the server, so its delete and its undo go to the local store
  let project: Record<string, unknown> | undefined;
  if (sampleSession) {
    const rows = guestRows('projects');
    const row = rows.find(candidate => candidate.id === id)?.data;
    if (!row || row.workspaceId !== workspaceId) throw new Error('Project no longer exists.');
    project = structuredClone({ ...row, id });
    await localDelete('projects', id);
  } else {
    // the server keeps the row it removed, so the answer is only used to prove the delete happened — the restore
    // below needs nothing but the id, and would work from another tab or after a reload
    const answer = await runNamedCommand<{ project: Record<string, unknown> }>('project.delete', { id }, { workspaceId })
      .catch((error: unknown) => {
        throw new Error(String((error as Error)?.message || '').includes('not in the selected workspace')
          ? 'Project no longer exists.'
          : (error as Error).message);
      });
    project = answer.project;
  }
  if (!allowed()) return;
  const deadline = Date.now() + 10000;
  let restored = false;
  let busy = false;
  async function undo() {
    if (busy || restored) return;
    if (Date.now() >= deadline || !allowed()) { toast.error('Undo expired or workspace changed.'); return; }
    busy = true;
    try {
      if (!allowed() || Date.now() >= deadline) throw new Error('Undo expired or workspace changed.');
      if (sampleSession) await localSet('projects', id, project!);
      else await runNamedCommand('project.restore', { id }, { workspaceId });
      restored = true;
      toast.dismiss(notification);
      if (allowed()) toast.success('Project restored');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not restore project. Retry before Undo expires.'); }
    finally { busy = false; }
  }
  const notification = toast.success('Deleted', { duration: 10000, action: { label: 'Undo', onClick: event => { event.preventDefault(); void undo(); } } });
  return undo;
}
