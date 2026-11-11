import { workspaceEditSession } from './guestActor';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { assertProjectRenameSafe } from './projectRenameGuard';
import { doc, getDoc, updateDoc } from './db/firestore';
import { db } from '../firebase';
import type { DetailAdapter } from './recordDetails';
export const recordDetailsAdapter: DetailAdapter = {
  session: () => workspaceEditSession(useAuthStore.getState()),
  guardProjectRename: (_target, oldName) => { const state = useLedgerStore.getState(); assertProjectRenameSafe(oldName, state.transactions, !!state.truncatedCollections.transactions || !useDataNeedsStore.getState().loaded.transactions || !!useDataNeedsStore.getState().failed.transactions); },
  read: async target => { const snap = await getDoc(doc(db, target.kind, target.id)); return snap.exists() ? snap.data() : undefined; },
  update: async (target, changes) => { const session = recordDetailsAdapter.session();
    await updateDoc(doc(db, target.kind, target.id), { ...changes, updatedAt: new Date().toISOString() });
    const current = recordDetailsAdapter.session();
    if (current && current.uid === session?.uid && current.workspaceId === session.workspaceId && current.sampleSession === session.sampleSession) useLedgerStore.setState(state => ({ [target.kind]: state[target.kind].map(record => record.id === target.id ? { ...record, ...changes } : record) })); },
};
