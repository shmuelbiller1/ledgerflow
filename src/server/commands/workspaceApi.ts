import crypto from 'node:crypto';
import { z } from 'zod';
import { WorkspaceSchema } from '../../schemas';
import { NEW_WORKSPACE_MODULES } from '../../lib/modules';
import { writeServerAuditLog } from '../services/auditLogService';
import { authAdmin } from '../auth/supabaseAuth';
import { HttpError } from '../auth/requestUser';
import { countWorkspaceOwners } from '../services/workspaceOwners';
import { restoreWorkspaceBackup, type RestoreResult } from '../services/workspaceRestoreService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const memberAddInput = z.object({ memberUid: z.string().min(1).optional(), email: z.string().min(1).optional() }).strict()
  .refine(v => v.memberUid || v.email, 'Either memberUid or email must be provided');
type MembersResult = { workspaceId: string; memberUid: string; members: string[]; changed: boolean };

export const workspaceMemberAddCommand: CommandDefinition<typeof memberAddInput, MembersResult, string> = {
  name: 'workspace.addmember', input: memberAddInput, roles: ['owner'], capacity: 'seats',
  async prepare(_ctx, input) {
    if (input.memberUid) return input.memberUid;
    try { return (await authAdmin.getUserByEmail(input.email!)).uid; }
    catch { return `uid_${crypto.createHash('md5').update(input.email!.toLowerCase().trim()).digest('hex').slice(0, 16)}`; }
  },
  async handler(ctx, tx) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const data = (await tx.get(ref)).data();
    if (!data) throw new HttpError('Workspace not found', 404);
    const uid = ctx.prepared as string;
    const memberList: string[] = Array.isArray(data.members) ? [...data.members] : [];
    const changed = !memberList.includes(uid);
    if (changed) { memberList.push(uid); tx.update(ref, { members: memberList, updatedAt: new Date().toISOString() }); }
    return { workspaceId: ctx.workspaceId, memberUid: uid, members: memberList, changed };
  },
  async preview(_ctx, input) { return { title: 'Add a workspace member', lines: [input.memberUid || input.email!, 'The member list changes; no role is assigned'] }; },
  audit() { return null; }, inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Add a person to a workspace by user id or email; do not use it to assign a role, which is a separate action.', example: { memberUid: 'user_123' }, refusals: [
    { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask a workspace owner.' },
    { code: 'INVALID_INPUT', when: 'Neither user id nor email is given.', next: 'Send one of them.' },
  ] },
};

const memberRemoveInput = z.object({ memberUid: z.string().min(1) }).strict();
export const workspaceMemberRemoveCommand: CommandDefinition<typeof memberRemoveInput, MembersResult> = {
  name: 'workspace.removemember', input: memberRemoveInput, roles: ['owner'],
  async handler(ctx, tx, input) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const data = (await tx.get(ref)).data();
    if (!data) throw new HttpError('Workspace not found', 404);
    const { count, ownerUids } = countWorkspaceOwners(data);
    if (ownerUids.includes(input.memberUid) && count <= 1) throw new HttpError('Cannot demote or remove the last owner of the workspace.', 400);
    const members: string[] = (Array.isArray(data.members) ? data.members as string[] : []).filter(m => m !== input.memberUid);
    const roles = { ...(data.roles || {}) }; delete roles[input.memberUid];
    tx.update(ref, { members, roles, updatedAt: new Date().toISOString() });
    return { workspaceId: ctx.workspaceId, memberUid: input.memberUid, members, changed: true };
  },
  async preview(_ctx, input) { return { title: 'Remove a workspace member', lines: [input.memberUid, 'Their workspace role is removed too; the last owner cannot be removed'] }; },
  audit(_input, result) { return { action: 'MEMBER_REMOVED', entityType: 'workspace', entityId: result.workspaceId, description: `Member ${result.memberUid} removed from workspace`, details: { removedUid: result.memberUid, description: `Member ${result.memberUid} removed from workspace` } }; },
  inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Remove a member and their workspace role; do not use it to remove the last owner.', example: { memberUid: 'user_123' }, refusals: [
    { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask a workspace owner.' },
    { code: 'CONFLICT', when: 'The member is the last owner.', next: 'Add another owner first.' },
  ] },
};

const restoreInput = z.object({ backup: z.unknown() }).strict();
export const workspaceRestoreBackupCommand: CommandDefinition<typeof restoreInput, RestoreResult> = {
  name: 'workspace.restorebackup', input: restoreInput, roles: ['owner'],
  async handler(ctx, tx, input) { return restoreWorkspaceBackup(ctx.db, ctx.workspaceId, input.backup, { uid: ctx.actor, email: ctx.email }, tx); },
  async preview() { return { title: 'Restore a workspace backup', lines: ['Replace the restorable records in this workspace; closed-period and backup integrity checks apply', 'Uploaded file bytes are not restored'] }; },
  // The restore service writes its detailed audit in the same transaction as the replacement.
  audit() { return null; }, inverse() { return null; }, risk: 'high',
  describe: { sentence: 'Replace the workspace books with a backup exported by the server; do not use it to undo one record, because it replaces the restorable workspace records.', example: { backup: { schemaVersion: 1 } }, refusals: [
    { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask a workspace owner.' },
    { code: 'CONFLICT', when: 'Closed books or a foreign record prevent replacement.', next: 'Use a valid current backup for this workspace.' },
  ] },
};

const workspaceProvisionInput = z.object({ fields: z.record(z.string(), z.unknown()) }).strict();
export const workspaceApiCreateCommand: CommandDefinition<typeof workspaceProvisionInput, { workspace: Record<string, unknown> }> = {
  name: 'workspace.apicreate', input: workspaceProvisionInput, scope: 'person', roles: ['owner'], denyWorkspaceApiKey: true,
  async handler(ctx, tx, input) {
    if (ctx.user.developerWorkspaceId) throw new HttpError('Forbidden: Workspace-scoped API keys cannot create workspaces', 403);
    const validation = WorkspaceSchema.safeParse({ ...input.fields, id: undefined, uid: ctx.actor, admins: undefined, isClosed: false, lockDate: undefined, createdAt: new Date().toISOString() });
    if (!validation.success) throw new HttpError('Validation Error: ' + validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '), 400);
    const newId = `ws_${crypto.randomUUID().replace(/-/g, '')}`;
    const workspace = { modules: NEW_WORKSPACE_MODULES, ...validation.data, id: newId, uid: ctx.actor, createdAt: validation.data.createdAt || new Date().toISOString() };
    const ref = ctx.db.collection('workspaces').doc(newId);
    if ((await tx.get(ref)).exists) throw new HttpError('Workspace ID already exists', 409);
    tx.create(ref, workspace);
    // Person-scope audit must name the newly created workspace, not person:<uid>.
    await writeServerAuditLog({ workspaceId: newId, uid: ctx.actor, email: ctx.email, action: 'WORKSPACE_CREATED', entityType: 'workspace', entityId: newId, details: { description: `Created workspace "${workspace.name}"`, currency: workspace.currency } }, { db: ctx.db, tx });
    return { workspace };
  },
  async preview(_ctx, input) { return { title: 'Create a workspace', lines: [`Name: ${String(input.fields.name || '')}`, 'The signed-in person owns the new workspace'] }; },
  audit() { return null; }, inverse() { return null; }, risk: 'normal',
  describe: { sentence: 'Create a new workspace for the signed-in person through the developer API; do not use it to edit an existing workspace.', example: { fields: { name: 'New books', currency: 'USD' } }, refusals: [
    { code: 'FORBIDDEN', when: 'The API key is restricted to an existing workspace.', next: 'Sign in as a person or use an unscoped key.' },
    { code: 'INVALID_INPUT', when: 'The workspace fields fail validation.', next: 'Correct the workspace fields.' },
  ] },
};

export const WORKSPACE_API_COMMANDS: AnyCommandDefinition[] = [workspaceMemberAddCommand, workspaceMemberRemoveCommand, workspaceRestoreBackupCommand, workspaceApiCreateCommand];
