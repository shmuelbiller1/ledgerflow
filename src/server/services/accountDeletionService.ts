/**
 * Deleting a person's account (L-09). Shared books are never deleted or left without an owner:
 * - a workspace they own together with another owner: they leave it (the other owner keeps it);
 * - a workspace where they are the only member: scheduled for deletion with the usual 30-day
 *   recovery window (then purged by workspacePurgeService);
 * - a workspace they own alone but where others work: the deletion stops until they make someone
 *   else an owner (the person is told which workspaces);
 * - a workspace they only belong to: they leave it.
 * Then their personal data (profile, templates, notifications, sign-in log) and the sign-in itself
 * are deleted. Business records they created stay with the workspace.
 */
import type { Firestore } from '../db/firestore';
import { pseudonymiseEmailAddress } from '../../lib/auditHashChain';
import { writeServerAuditLog } from './auditLogService';
import { scheduledPurgeAt as purgeDate } from '../../lib/retention';

export interface WorkspaceForDeletion { id: string; data: Record<string, unknown> }
export interface AccountDeletionPlan {
  scheduleDeletion: WorkspaceForDeletion[];
  leave: WorkspaceForDeletion[];
  blocked: Array<{ id: string; name: string; otherMembers: number }>;
}

const ownersOf = (data: Record<string, unknown>): string[] => {
  const owners = new Set<string>();
  if (typeof data.uid === 'string') owners.add(data.uid);
  for (const [uid, role] of Object.entries((data.roles || {}) as Record<string, string>)) if (role === 'owner') owners.add(uid);
  return [...owners];
};
const membersOf = (data: Record<string, unknown>): string[] => {
  const members = new Set<string>(Array.isArray(data.members) ? (data.members as string[]) : []);
  if (typeof data.uid === 'string') members.add(data.uid);
  for (const uid of Object.keys((data.roles || {}) as Record<string, string>)) members.add(uid);
  return [...members];
};

export function planAccountDeletion(uid: string, workspaces: WorkspaceForDeletion[]): AccountDeletionPlan {
  const plan: AccountDeletionPlan = { scheduleDeletion: [], leave: [], blocked: [] };
  for (const ws of workspaces) {
    if (ws.data.status === 'pending_deletion') continue;
    const members = membersOf(ws.data);
    if (!members.includes(uid)) continue;
    const others = members.filter(m => m !== uid);
    const isOwner = ownersOf(ws.data).includes(uid);
    if (!isOwner) plan.leave.push(ws);
    else if (ownersOf(ws.data).some(o => o !== uid)) plan.leave.push(ws);
    else if (others.length === 0) plan.scheduleDeletion.push(ws);
    else plan.blocked.push({ id: ws.id, name: String(ws.data.name || ws.id), otherMembers: others.length });
  }
  return plan;
}

/** The workspace without this person: removed from members and roles; ownership moves to another owner. */
export function withoutMember(uid: string, data: Record<string, unknown>): Record<string, unknown> {
  const roles = { ...((data.roles || {}) as Record<string, string>) };
  delete roles[uid];
  const members = (Array.isArray(data.members) ? (data.members as string[]) : []).filter(m => m !== uid);
  const update: Record<string, unknown> = { roles, members };
  if (data.uid === uid) {
    const nextOwner = Object.entries(roles).find(([, role]) => role === 'owner')?.[0];
    if (nextOwner) update.uid = nextOwner;
  }
  return update;
}

export class AccountDeletionBlocked extends Error {
  constructor(readonly workspaces: AccountDeletionPlan['blocked']) {
    super(`Make someone else an owner of ${workspaces.map(w => `"${w.name}"`).join(', ')} first (Settings → Team), or remove its other members.`);
  }
}

export async function deleteAccount(db: Firestore, user: { uid: string; email?: string }, deleteSignIn: (uid: string) => Promise<void>): Promise<{ scheduledForDeletion: string[]; left: string[] }> {
  const seen = new Map<string, WorkspaceForDeletion>();
  for (const snap of [
    await db.collection('workspaces').where('uid', '==', user.uid).get(),
    await db.collection('workspaces').where('members', 'array-contains', user.uid).get(),
  ]) {
    snap.docs.forEach(d => seen.set(d.id, { id: d.id, data: d.data() || {} }));
  }
  const plan = planAccountDeletion(user.uid, [...seen.values()]);
  if (plan.blocked.length) throw new AccountDeletionBlocked(plan.blocked);

  const now = new Date();
  // #944: the books keep who did what (the uid), never the erased person's email. Neither audit hash
  // chain covers the top-level email fields, so replacing them keeps every chain verifiable.
  const erasedEmail = pseudonymiseEmailAddress(user.uid, process.env.SYSTEM_SALT || '');
  for (const ws of plan.scheduleDeletion) {
    const scheduledPurgeAt = purgeDate(ws.data, now);
    await db.collection('workspaces').doc(ws.id).update({ status: 'pending_deletion', deletedAt: now.toISOString(), scheduledPurgeAt, updatedAt: now.toISOString() });
    await writeServerAuditLog({
      workspaceId: ws.id, uid: user.uid, email: erasedEmail, action: 'WORKSPACE_DELETION_SCHEDULED', entityType: 'workspace', entityId: ws.id,
      details: { description: `The owner deleted their account; workspace scheduled for purge on ${scheduledPurgeAt}`, scheduledPurgeAt },
    }, { db });
  }
  for (const ws of plan.leave) {
    await db.collection('workspaces').doc(ws.id).update({ ...withoutMember(user.uid, ws.data), updatedAt: now.toISOString() });
    await writeServerAuditLog({
      workspaceId: ws.id, uid: user.uid, email: erasedEmail, action: 'MEMBER_LEFT', entityType: 'workspace', entityId: ws.id,
      details: { description: 'Left the workspace when deleting their account' },
    }, { db });
  }

  // personal data
  await db.collection('users').doc(user.uid).delete().catch((err) => {
    console.warn('[accountDeletion] Optional users doc cleanup warning:', err instanceof Error ? err.message : String(err));
  });
  await db.collection('recoveryCodes').doc(user.uid).delete().catch((err) => {
    console.warn('[accountDeletion] Optional recoveryCodes doc cleanup warning:', err instanceof Error ? err.message : String(err));
  });
  for (const table of ['customTemplates', 'notifications', 'loginAudits']) {
    const snap = await db.collection(table).where('uid', '==', user.uid).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  // DA-01: their own groups of books (the workspaces in them are not touched)
  for (const d of (await db.collection('workspaceGroups').where('ownerUid', '==', user.uid).get()).docs) await d.ref.delete();
  // DA-01: groups others shared with this person no longer name them
  for (const d of (await db.collection('workspaceGroups').where('sharedWith', 'array-contains', user.uid).get()).docs) {
    const data = d.data() || {};
    const emails = { ...((data.sharedEmails as Record<string, string>) || {}) };
    delete emails[user.uid];
    await d.ref.update({ sharedWith: (data.sharedWith as string[]).filter(u => u !== user.uid), sharedEmails: emails });
  }
  // #944: earlier audit rows by this person keep their uid and hashes, with the email fields pseudonymised
  for (const d of (await db.collection('auditLogs').where('uid', '==', user.uid).get()).docs) {
    const data = d.data() || {};
    const update: Record<string, string> = {};
    for (const field of ['email', 'userEmail', 'actorEmail']) {
      if (typeof data[field] === 'string' && data[field] && data[field] !== erasedEmail) update[field] = erasedEmail;
    }
    if (Object.keys(update).length) await d.ref.update(update);
  }
  // #944: support messages they wrote and error reports from their sessions keep the uid (so the thread and the
  // report still make sense) but not their email; the user agent, which can identify a device, goes too
  // (messages name their author as `authorUid`; older rows may also carry `authorEmail`, and the oldest `uid`/`email`)
  const messages = new Map<string, { ref: { update: (v: Record<string, unknown>) => Promise<unknown> }; data: Record<string, unknown> }>();
  for (const field of ['authorUid', 'uid']) {
    for (const d of (await db.collection('supportMessages').where(field, '==', user.uid).get()).docs) messages.set(d.id, { ref: d.ref, data: d.data() || {} });
  }
  for (const { ref, data } of messages.values()) {
    const update: Record<string, string> = {};
    for (const field of ['authorEmail', 'email']) {
      if (typeof data[field] === 'string' && data[field] && data[field] !== erasedEmail) update[field] = erasedEmail;
    }
    if (Object.keys(update).length) await ref.update(update);
  }
  for (const d of (await db.collection('errorLogs').where('userId', '==', user.uid).get()).docs) {
    const data = d.data() || {};
    const update: Record<string, unknown> = {};
    if (typeof data.userEmail === 'string' && data.userEmail && data.userEmail !== erasedEmail) update.userEmail = erasedEmail;
    if (data.userAgent !== undefined) update.userAgent = null;
    if (Object.keys(update).length) await d.ref.update(update);
  }
  await deleteSignIn(user.uid);
  return { scheduledForDeletion: plan.scheduleDeletion.map(w => w.id), left: plan.leave.map(w => w.id) };
}
