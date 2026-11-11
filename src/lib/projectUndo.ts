import { workspaceActor } from './guestActor';
import { guestSession } from './db/guestDatabase';
import { doc, getDoc, deleteDoc, setDoc } from './db/firestore';
import { db } from '../firebase';
import { useAuthStore } from '../stores/useAuthStore';
import { toast } from 'sonner';

/** Deliberately restricted to project metadata; financial documents retain their posting flow. */
export async function deleteProjectWithUndo(id: string) {
  const initial = useAuthStore.getState();
  const workspaceId = initial.currentWorkspaceId;
  const uid = workspaceActor(initial)?.uid;
  const sampleSession = guestSession();
  function allowed() {
    const state = useAuthStore.getState();
    const workspace = state.workspaces.find(w => w.id === workspaceId);
    const role = uid && workspace?.roles?.[uid];
    return Boolean(uid && workspaceId && workspaceActor(state)?.uid === uid && guestSession() === sampleSession && state.currentWorkspaceId === workspaceId && (workspace?.uid === uid || role === 'owner' || role === 'accountant' || role === 'bookkeeper'));
  }
  if (!allowed()) throw new Error('This workspace is read-only.');
  const ref = doc(db, 'projects', id);
  const record = await getDoc(ref);
  if (!record.exists()) throw new Error('Project no longer exists.');
  const data = structuredClone(record.data()!);
  if (data.workspaceId !== workspaceId || !allowed()) throw new Error('Workspace changed. Reopen the project.');
  await deleteDoc(ref);
  if (!allowed()) return;
  const deadline = Date.now() + 10000;
  let restored = false;
  let busy = false;
  async function undo() {
    if (busy || restored) return;
    if (Date.now() >= deadline || !allowed()) { toast.error('Undo expired or workspace changed.'); return; }
    busy = true;
    try {
      if ((await getDoc(ref)).exists()) throw new Error('A record already uses this ID. It was not overwritten.');
      if (!allowed() || Date.now() >= deadline) throw new Error('Undo expired or workspace changed.');
      await setDoc(ref, data);
      restored = true;
      toast.dismiss(notification);
      if (allowed()) toast.success('Project restored');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not restore project. Retry before Undo expires.'); }
    finally { busy = false; }
  }
  const notification = toast.success('Deleted', { duration: 10000, action: { label: 'Undo', onClick: event => { event.preventDefault(); void undo(); } } });
  return undo;
}
