// Server database entry point. The data now lives in Supabase Postgres; getDb() returns the
// Firestore-compatible layer in ./pgFirestore.ts, so routes keep their firebase-admin-style code.
import { Firestore } from './pgFirestore';
import type { DocumentData } from './pgFirestore';
import { assertPostingOpen } from '../../lib/periodLock';

export {
  AggregateQuery, CollectionReference, DocumentReference, DocumentSnapshot, FieldPath, FieldValue,
  Firestore, FirestoreError, Query, QueryDocumentSnapshot, QuerySnapshot, Timestamp, Transaction, WriteBatch,
} from './pgFirestore';
export type { DocumentData, SetOptions, WhereFilterOp, WriteResult } from './pgFirestore';

let defaultDb: Firestore | null = null;

export const getDb = (): Firestore => {
  if (!defaultDb) defaultDb = new Firestore();
  return defaultDb;
};

export function isWorkspaceMemberData(
  data: DocumentData | null | undefined,
  user: { uid: string; admin?: boolean; developerWorkspaceId?: string },
  workspaceId?: string
): boolean {
  if (!data) return false;
  if (workspaceId && user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
    return false;
  }
  return Boolean(
    data.uid === user.uid
      || (Array.isArray(data.members) && data.members.includes(user.uid))
      || (!Array.isArray(data.members) && data.roles && typeof data.roles === 'object' && Boolean((data.roles as Record<string, unknown>)[user.uid]))
      || (data.admins && typeof data.admins === 'object' && Boolean((data.admins as Record<string, unknown>)[user.uid]))
      || user.admin
  );
}

export async function validateWorkspaceMember(db: Firestore, workspaceId: string, user: { uid: string; admin?: boolean; developerWorkspaceId?: string }) {
  if (!workspaceId) throw new Error('Workspace ID is required.');
  if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
    throw new Error(`Unauthorized: API key is scoped strictly to workspace ${user.developerWorkspaceId}`);
  }

  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) {
    throw new Error('Workspace not found.');
  }
  const data: DocumentData = wsDoc.data() || {};
  if (!isWorkspaceMemberData(data, user, workspaceId)) {
    throw new Error('Unauthorized: You are not a member of this workspace.');
  }
  return { wsDoc, data };
}

export const assertWorkspaceAccess = validateWorkspaceMember;

/** Throws "Period Locked" when the date is closed for this user (src/lib/periodLock.ts). */
export async function assertPeriodOpen(db: Firestore, workspaceId: string, date: string, uid: string) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid transaction date format: ${date}. Expected YYYY-MM-DD.`);
  }
  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  assertPostingOpen(date, wsDoc.data(), uid);
}

export async function validateWorkspaceAccounts(db: Firestore, workspaceId: string, accountIds: string[]): Promise<Map<string, { id: string; name: string; type: string; category?: string }>> {
  const accountMap = new Map<string, { id: string; name: string; type: string; category?: string }>();
  const validIds = Array.from(new Set(accountIds.filter(Boolean)));
  if (validIds.length === 0) return accountMap;

  const refs = validIds.map(id => db.collection('chartAccounts').doc(id));
  const docs = await db.getAll(...refs);

  for (const accDoc of docs) {
    if (!accDoc.exists) {
      throw new Error(`Account ${accDoc.id} not found in chart of accounts.`);
    }
    const accData = accDoc.data() || {};
    if (accData.workspaceId !== workspaceId) {
      throw new Error(`Security Violation: Account ${accDoc.id} (${accData.name || 'unnamed'}) belongs to another workspace (${accData.workspaceId}). Cross-workspace ledger references are forbidden.`);
    }
    accountMap.set(accDoc.id, {
      id: accDoc.id,
      name: accData.name || 'Account',
      type: accData.type || 'asset',
      category: accData.category
    });
  }
  return accountMap;
}
