import { workspaceEditSession } from './guestActor';
import { useAuthStore } from '../stores/useAuthStore';
import { doc, getDoc, updateDoc } from './db/firestore';
import { db } from '../firebase';
import type { InlineRecordAdapter } from './inlineRecordFields';
export const inlineRecordAdapter: InlineRecordAdapter = {
  session: () => workspaceEditSession(useAuthStore.getState()),
  read: async target => { const snap = await getDoc(doc(db, target.collection, target.id)); return snap.exists() ? snap.data() : undefined; },
  update: async (target, fields) => { await updateDoc(doc(db, target.collection, target.id), { ...fields, updatedAt: new Date().toISOString() }); },
};
