import { workspaceEditSession } from './guestActor';
import { useAuthStore } from '../stores/useAuthStore';
import { doc, getDoc } from './db/firestore';
import { db } from '../firebase';
import { saveRecordFields } from './recordWrites';
import type { InlineRecordAdapter } from './inlineRecordFields';
export const inlineRecordAdapter: InlineRecordAdapter = {
  session: () => workspaceEditSession(useAuthStore.getState()),
  read: async target => { const snap = await getDoc(doc(db, target.collection, target.id)); return snap.exists() ? snap.data() : undefined; },
  // one command for the field: the allowlist, the role, `updatedAt` and the audit line are the server's, and the
  // value the screen read travels with it so a second tab's save in between is a refusal, not an overwrite
  update: async (target, fields, expected, workspaceId) => {
    await saveRecordFields(workspaceId, target.collection, target.id, fields, expected);
  },
};
