import { z } from 'zod';
import { authAdmin } from '../auth/supabaseAuth';
import { HttpError } from '../auth/requestUser';
import type { Firestore } from '../db/firestore';
import { BRAND_NAME } from '../../config/brand';
import { isEmailShape } from '../../lib/textShape';
import type { WorkspaceGroup } from '../../lib/workspaceGroups';
import { ratesKey } from '../../lib/workspaceGroups';
import {
  createGroupInTransaction,
  deleteGroupInTransaction,
  keepRatesInTransaction,
  prepareCreateGroup,
  prepareDeleteGroup,
  prepareKeepRates,
  prepareSetLineMerges,
  prepareShareGroup,
  prepareUnshareGroup,
  prepareUpdateGroup,
  setLineMergesInTransaction,
  shareGroupInTransaction,
  unshareGroupInTransaction,
  updateGroupInTransaction,
  type GroupKeepRatesResult,
  type GroupLineMergesResult,
  type GroupShareResult,
  type GroupUnshareResult,
  type GroupUpdateResult,
  WorkspaceGroupError,
} from '../services/workspaceGroupService';
import { COMMAND_ROLES, type CommandDefinition } from './types';

/**
 * Groups of books (DA-01): the person's own groups of the workspaces they can open — `scope:
 * 'person'` commands, so no single workspace gates or grants the write. The route bodies from
 * accountRoutes.ts live here as schema → prepare (checks and the access read) → handler (the write
 * inside the runner's transaction); the routes stay as thin wrappers.
 */

/** Who the group is shared with is found by sign-in email; tests substitute the directory lookup. */
let uidByEmail = async (email: string): Promise<string | undefined> => {
  try { return (await authAdmin.getUserByEmail(email)).uid; } catch { return undefined; }
};
export function setGroupEmailLookupForTests(lookup: typeof uidByEmail): void { uidByEmail = lookup; }

const groupIdInput = z.string().min(1);
const structureFields = (input: { parentId?: unknown; ownership?: unknown; investments?: unknown; acquired?: unknown }) => ({
  ...(input.parentId !== undefined ? { parentId: input.parentId as string | null } : {}),
  ...(input.ownership !== undefined ? { ownership: input.ownership as Record<string, number> } : {}),
  ...(input.investments !== undefined ? { investments: input.investments as Record<string, string> } : {}),
  ...(input.acquired !== undefined ? { acquired: input.acquired as Record<string, string> } : {}),
});

async function readOwnGroup(ctx: { actor: string; db: Firestore }, groupId: string): Promise<Record<string, unknown>> {
  const data = (await ctx.db.collection('workspaceGroups').doc(groupId).get()).data();
  if (!data || data.ownerUid !== ctx.actor) throw new WorkspaceGroupError(404, 'Group not found');
  return data;
}

// --------------------------------------------------------------------------- groups.create

export const groupCreateInput = z.object({
  name: z.unknown(),
  workspaceIds: z.unknown().optional(),
  parentId: z.unknown().optional(),
  ownership: z.unknown().optional(),
  investments: z.unknown().optional(),
  acquired: z.unknown().optional(),
}).strict();
type GroupCreateInput = z.output<typeof groupCreateInput>;
export type GroupCreateResult = { group: WorkspaceGroup };

const createFields = (input: GroupCreateInput) => ({
  name: input.name as string,
  workspaceIds: (input.workspaceIds as string[] | undefined) || [],
  ...structureFields(input),
});

export const groupCreateCommand: CommandDefinition<typeof groupCreateInput, GroupCreateResult, { open: Set<string> }> = {
  name: 'groups.create',
  input: groupCreateInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx, input: GroupCreateInput) {
    return { open: await prepareCreateGroup(ctx.db, { uid: ctx.actor, ...createFields(input) }) };
  },
  async handler(ctx, tx, input: GroupCreateInput) {
    const prepared = ctx.prepared as { open: Set<string> };
    const group = await createGroupInTransaction(ctx.db, tx, { uid: ctx.actor, ...createFields(input) }, prepared.open);
    return { group };
  },
  async preview(ctx, input: GroupCreateInput) {
    await prepareCreateGroup(ctx.db, { uid: ctx.actor, ...createFields(input) });
    const name = createFields(input).name.trim();
    return {
      title: `Create the group “${name}”`,
      lines: [
        `${createFields(input).workspaceIds.length} workspace(s) join it; their books do not change`,
        'Members you can no longer open leave the view; only you see and change the group',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'GROUP_CREATED',
      entityType: 'workspaceGroups',
      entityId: result.group.id,
      description: `Created the group “${result.group.name}” with ${result.group.workspaceIds.length} workspace(s)`,
      details: { name: result.group.name, workspaceIds: result.group.workspaceIds },
    };
  },
  inverse(_input, result) {
    return { command: 'groups.delete', input: { groupId: result.group.id } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Create a group of the workspaces you can open for cross-company views; do not use it to change anything inside a workspace — membership changes no books.',
    example: { name: 'My companies', workspaceIds: ['ws_holding', 'ws_subsidiary'] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The input carries unexpected fields.', next: 'Send name, workspaceIds and optionally parentId, ownership, investments, acquired.' },
      { code: 'BAD_GROUP', when: 'The name is missing or over 80 characters, a workspace is listed twice, or the holding structure is inconsistent.', next: 'Fix the named field; the message says which rule failed.' },
      { code: 'NOT_FOUND', when: 'A listed workspace does not exist or is not openable by you.', next: 'Use only workspaces you can open.' },
      { code: 'CONFLICT', when: 'You already keep the maximum number of groups.', next: 'Remove a group first.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'groups.share', label: 'Share the group with your accountant' }],
  },
};

// --------------------------------------------------------------------------- groups.update

export const groupUpdateInput = z.object({
  groupId: groupIdInput,
  name: z.unknown().optional(),
  workspaceIds: z.unknown().optional(),
  parentId: z.unknown().optional(),
  ownership: z.unknown().optional(),
  investments: z.unknown().optional(),
  acquired: z.unknown().optional(),
}).strict();
type GroupUpdateInput = z.output<typeof groupUpdateInput>;

const updateFields = (input: GroupUpdateInput) => ({
  ...(input.name !== undefined ? { name: input.name as string } : {}),
  ...(input.workspaceIds !== undefined ? { workspaceIds: input.workspaceIds as string[] } : {}),
  ...structureFields(input),
});

export const groupUpdateCommand: CommandDefinition<typeof groupUpdateInput, GroupUpdateResult, { open: Set<string> }> = {
  name: 'groups.update',
  input: groupUpdateInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx, input: GroupUpdateInput) {
    return { open: await prepareUpdateGroup(ctx.db, { uid: ctx.actor, groupId: input.groupId, ...updateFields(input) }) };
  },
  async handler(ctx, tx, input: GroupUpdateInput) {
    const prepared = ctx.prepared as { open: Set<string> };
    return updateGroupInTransaction(ctx.db, tx, { uid: ctx.actor, groupId: input.groupId, ...updateFields(input) }, prepared.open);
  },
  async preview(ctx, input: GroupUpdateInput) {
    const open = await prepareUpdateGroup(ctx.db, { uid: ctx.actor, groupId: input.groupId, ...updateFields(input) });
    const data = await readOwnGroup(ctx, input.groupId);
    const before = (Array.isArray(data.workspaceIds) ? data.workspaceIds : []).filter(w => open.has(w));
    const fields = updateFields(input);
    return {
      title: `Change the group “${String(data.name || input.groupId)}”`,
      lines: [
        ...(fields.name !== undefined ? [`Name: ${String(data.name || '')} → ${fields.name.trim()}`] : []),
        ...(fields.workspaceIds !== undefined ? [`Members: ${before.length} → ${fields.workspaceIds.length}`] : []),
        ...(input.parentId !== undefined ? ['The holding structure changes'] : []),
        'The books of the member workspaces do not change',
      ],
    };
  },
  audit(input, result) {
    const fields = Object.keys(result.previous);
    if (fields.length === 0) return null;
    return {
      action: 'GROUP_UPDATED',
      entityType: 'workspaceGroups',
      entityId: input.groupId,
      description: `Updated the group “${result.group.name}”: ${fields.join(', ')}`,
      details: { previous: result.previous },
    };
  },
  inverse(input, result) {
    if (Object.keys(result.previous).length === 0) return null;
    return { command: 'groups.update', input: { groupId: input.groupId, ...result.previous } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Rename a group, change its member workspaces, or its holding structure; members you can no longer open stay in it unseen. Do not use it to share — that is groups.share.',
    example: { groupId: 'grp_0123456789abcdef0123', name: 'Group companies', workspaceIds: ['ws_holding', 'ws_subsidiary'] },
    refusals: [
      { code: 'BAD_GROUP', when: 'The new name, members or structure break a rule.', next: 'Fix the named field; the message says which rule failed.' },
      { code: 'NOT_FOUND', when: 'The group is not yours, does not exist, or a listed workspace is not openable.', next: 'List your groups and use one of them, with workspaces you can open.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'groups.delete', label: 'Delete the group' }],
  },
};

// --------------------------------------------------------------------------- groups.delete

export const groupDeleteInput = z.object({ groupId: groupIdInput }).strict();
type GroupDeleteInput = z.output<typeof groupDeleteInput>;
export type GroupDeleteResult = { name: string };

export const groupDeleteCommand: CommandDefinition<typeof groupDeleteInput, GroupDeleteResult> = {
  name: 'groups.delete',
  input: groupDeleteInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(_ctx, input: GroupDeleteInput) {
    prepareDeleteGroup({ uid: _ctx.actor, groupId: input.groupId });
  },
  async handler(ctx, tx, input: GroupDeleteInput) {
    return deleteGroupInTransaction(ctx.db, tx, { uid: ctx.actor, groupId: input.groupId });
  },
  async preview(ctx, input: GroupDeleteInput) {
    const data = await readOwnGroup(ctx, input.groupId);
    return {
      title: `Delete the group “${String(data.name || input.groupId)}”`,
      lines: ['The member workspaces and their books stay as they are; only the grouping is removed'],
    };
  },
  audit(input, result) {
    return {
      action: 'GROUP_DELETED',
      entityType: 'workspaceGroups',
      entityId: input.groupId,
      description: `Deleted the group “${result.name}”`,
      details: { name: result.name },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Delete one of your groups of workspaces; there is no undo — the member workspaces lose nothing, but the grouping and its kept translation rates are gone. Do not use it to remove a workspace itself.',
    example: { groupId: 'grp_0123456789abcdef0123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The group is not yours or does not exist.', next: 'List your groups and use one of them.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'groups.create', label: 'Start a new group' }],
  },
};

// --------------------------------------------------------------------------- groups.share / groups.unshare

export const groupShareInput = z.object({ groupId: groupIdInput, email: z.string().min(1).max(254) }).strict();
type GroupShareInput = z.output<typeof groupShareInput>;
type SharePrepared = { open: Set<string>; withUid: string; withEmail: string };

async function resolveShareTarget(input: GroupShareInput): Promise<{ email: string; withUid: string }> {
  const email = input.email.trim().toLowerCase();
  if (!isEmailShape(email)) throw new HttpError('Enter the email they sign in with', 400);
  const withUid = await uidByEmail(email);
  if (!withUid) throw new HttpError(`No one signs in to ${BRAND_NAME} with that email yet: ask them to sign up first`, 404);
  return { email, withUid };
}

export const groupShareCommand: CommandDefinition<typeof groupShareInput, GroupShareResult, SharePrepared> = {
  name: 'groups.share',
  input: groupShareInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx, input: GroupShareInput): Promise<SharePrepared> {
    const { email, withUid } = await resolveShareTarget(input);
    const open = await prepareShareGroup(ctx.db, { uid: ctx.actor, email: ctx.email, groupId: input.groupId, withUid, withEmail: email });
    return { open, withUid, withEmail: email };
  },
  async handler(ctx, tx, input: GroupShareInput) {
    const prepared = ctx.prepared as SharePrepared;
    return shareGroupInTransaction(ctx.db, tx, { uid: ctx.actor, email: ctx.email, groupId: input.groupId, withUid: prepared.withUid, withEmail: prepared.withEmail }, prepared.open);
  },
  async preview(ctx, input: GroupShareInput) {
    const { email, withUid } = await resolveShareTarget(input);
    await prepareShareGroup(ctx.db, { uid: ctx.actor, groupId: input.groupId, withUid, withEmail: email });
    const data = await readOwnGroup(ctx, input.groupId);
    const already = Array.isArray(data.sharedWith) && (data.sharedWith as string[]).includes(withUid);
    return {
      title: `Share the group “${String(data.name || input.groupId)}”`,
      lines: already
        ? [`${email} already reads it`]
        : [`${email} reads the group and its group reports, each member under their own access`, 'Sharing gives no access to any workspace'],
    };
  },
  audit(input, result) {
    if (!result.changed) return null;
    const group = result.group;
    return {
      action: 'GROUP_SHARED',
      entityType: 'workspaceGroups',
      entityId: input.groupId,
      description: `Shared the group “${group.name}” with ${input.email.trim().toLowerCase()}`,
      details: { groupName: group.name },
    };
  },
  inverse(input, result) {
    if (!result.changed) return null;
    return { command: 'groups.unshare', input: { groupId: input.groupId, withUid: result.withUid } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Share one of your groups of books with someone by the email they sign in with; they read it, only you change it. Do not use it to give them a workspace itself.',
    example: { groupId: 'grp_0123456789abcdef0123', email: 'accountant@example.com' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The email is missing or longer than 254 characters.', next: 'Enter the email they sign in with.' },
      { code: 'BAD_EMAIL', when: 'The text is not an email shape.', next: 'Enter the email they sign in with.' },
      { code: 'NOT_FOUND', when: 'Nobody signs in with that email yet, or the group is not yours.', next: 'Ask them to sign up first; list your groups for the id.' },
      { code: 'BAD_GROUP', when: 'The group is already yours or is shared with the maximum number of people.', next: 'Share a different group, or stop sharing this one first.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'groups.unshare', label: 'Stop sharing the group' }],
  },
};

export const groupUnshareInput = z.object({ groupId: groupIdInput, withUid: z.string().min(1) }).strict();
type GroupUnshareInput = z.output<typeof groupUnshareInput>;

export const groupUnshareCommand: CommandDefinition<typeof groupUnshareInput, GroupUnshareResult> = {
  name: 'groups.unshare',
  input: groupUnshareInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx, input: GroupUnshareInput) {
    await prepareUnshareGroup({ uid: ctx.actor, groupId: input.groupId, withUid: input.withUid });
  },
  async handler(ctx, tx, input: GroupUnshareInput) {
    return unshareGroupInTransaction(ctx.db, tx, { uid: ctx.actor, groupId: input.groupId, withUid: input.withUid });
  },
  async preview(ctx, input: GroupUnshareInput) {
    const data = (await ctx.db.collection('workspaceGroups').doc(input.groupId).get()).data();
    const leaving = input.withUid === ctx.actor && Array.isArray(data?.sharedWith) && (data.sharedWith as string[]).includes(ctx.actor);
    if (!data || (data.ownerUid !== ctx.actor && !leaving)) throw new WorkspaceGroupError(404, 'Group not found');
    return {
      title: leaving ? `Leave the group “${String(data.name || input.groupId)}”` : 'Stop sharing a group',
      lines: leaving
        ? ['You stop reading it; nothing in any workspace changes']
        : ['They stop reading it; nothing in any workspace changes'],
    };
  },
  audit(input, result) {
    if (!result.changed) return null;
    return {
      action: 'GROUP_UNSHARED',
      entityType: 'workspaceGroups',
      entityId: input.groupId,
      description: result.left ? 'Left a group that was shared with you' : `Stopped sharing the group with ${result.removedEmail || input.withUid}`,
    };
  },
  inverse(input, result) {
    if (!result.changed || result.left || !result.removedEmail) return null;
    return { command: 'groups.share', input: { groupId: input.groupId, email: result.removedEmail } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Stop sharing one of your groups with someone, or leave a group shared with you, by their user id; do not use it to remove them from a workspace.',
    example: { groupId: 'grp_0123456789abcdef0123', withUid: 'user_123' },
    refusals: [
      { code: 'NOT_FOUND', when: 'The group is not yours (nor shared with you, when leaving), or does not exist.', next: 'List your groups and use one of them.' },
      { code: 'INVALID_INPUT', when: 'The group or person id is missing.', next: 'Send groupId and withUid.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'groups.share', label: 'Share the group again' }],
  },
};

// --------------------------------------------------------------------------- groups.setlinemerges

export const groupSetLineMergesInput = z.object({ groupId: groupIdInput, merges: z.unknown().optional() }).strict();
type GroupSetLineMergesInput = z.output<typeof groupSetLineMergesInput>;

export const groupSetLineMergesCommand: CommandDefinition<typeof groupSetLineMergesInput, GroupLineMergesResult> = {
  name: 'groups.setlinemerges',
  input: groupSetLineMergesInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx, input: GroupSetLineMergesInput) {
    prepareSetLineMerges({ uid: ctx.actor, groupId: input.groupId, merges: input.merges });
  },
  async handler(ctx, tx, input: GroupSetLineMergesInput) {
    return setLineMergesInTransaction(ctx.db, tx, { uid: ctx.actor, groupId: input.groupId, merges: input.merges });
  },
  async preview(ctx, input: GroupSetLineMergesInput) {
    prepareSetLineMerges({ uid: ctx.actor, groupId: input.groupId, merges: input.merges });
    const data = await readOwnGroup(ctx, input.groupId);
    const before = data.lineMerges && typeof data.lineMerges === 'object' ? Object.keys(data.lineMerges).length : 0;
    const after = input.merges && typeof input.merges === 'object' && !Array.isArray(input.merges) ? Object.keys(input.merges).length : 0;
    return {
      title: `Set the combined lines of “${String(data.name || input.groupId)}”`,
      lines: [`Combined lines: ${before} → ${after}`, 'Only the account-by-account group view changes; no books change'],
    };
  },
  audit(input, result) {
    return {
      action: 'GROUP_LINES_SET',
      entityType: 'workspaceGroups',
      entityId: input.groupId,
      description: `${Object.keys(result.merges).length} combined line(s) on the group`,
      details: { merges: Object.keys(result.merges).length, previous: result.previous ? Object.keys(result.previous).length : 0 },
    };
  },
  inverse(input, result) {
    return { command: 'groups.setlinemerges', input: { groupId: input.groupId, merges: result.previous || {} } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Replace a group\'s line mapping (which rows of its account-by-account view combine into another); do not use it to restate any member\'s books — the view changes, the books do not.',
    example: { groupId: 'grp_0123456789abcdef0123', merges: { 'income|Sales|Retail': 'income|Sales' } },
    refusals: [
      { code: 'BAD_GROUP', when: 'The mapping is not pairs within one section, or a combined line takes lines itself.', next: 'Send pairs of line keys within the same section; the message says which rule failed.' },
      { code: 'NOT_FOUND', when: 'The group is not yours or does not exist.', next: 'List your groups and use one of them.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
  },
};

// --------------------------------------------------------------------------- groups.keeprates

export const groupKeepRatesInput = z.object({
  groupId: groupIdInput,
  reportCurrency: z.unknown().optional(),
  startDate: z.unknown().optional(),
  endDate: z.unknown().optional(),
  rates: z.unknown().optional(),
}).strict();
type GroupKeepRatesInput = z.output<typeof groupKeepRatesInput>;
type KeepRatesPrepared = { open: Set<string> };

const keepRatesFields = (input: GroupKeepRatesInput) => ({
  reportCurrency: input.reportCurrency as string,
  startDate: input.startDate as string,
  endDate: input.endDate as string,
  rates: input.rates as Record<string, { closing: number; average: number; historical: number }>,
});

export const groupKeepRatesCommand: CommandDefinition<typeof groupKeepRatesInput, GroupKeepRatesResult, KeepRatesPrepared> = {
  name: 'groups.keeprates',
  input: groupKeepRatesInput,
  roles: COMMAND_ROLES,
  scope: 'person',
  async prepare(ctx, input: GroupKeepRatesInput): Promise<KeepRatesPrepared> {
    return { open: await prepareKeepRates(ctx.db, { uid: ctx.actor, groupId: input.groupId, ...keepRatesFields(input) }) };
  },
  async handler(ctx, tx, input: GroupKeepRatesInput) {
    const prepared = ctx.prepared as KeepRatesPrepared;
    return keepRatesInTransaction(ctx.db, tx, { uid: ctx.actor, groupId: input.groupId, ...keepRatesFields(input) }, prepared.open);
  },
  async preview(ctx, input: GroupKeepRatesInput) {
    await prepareKeepRates(ctx.db, { uid: ctx.actor, groupId: input.groupId, ...keepRatesFields(input) });
    const data = await readOwnGroup(ctx, input.groupId);
    const fields = keepRatesFields(input);
    const key = ratesKey(fields.reportCurrency, fields.startDate, fields.endDate);
    const had = Boolean((data.rates as Record<string, unknown> | undefined)?.[key]);
    return {
      title: `Keep the ${fields.reportCurrency} rates of “${String(data.name || input.groupId)}”`,
      lines: [
        `${fields.startDate} to ${fields.endDate}: ${Object.keys(fields.rates).length} currencies${had ? ' (replacing the kept ones)' : ''}`,
        'The same period opens with these rates next time; the newest 120 are kept',
      ],
    };
  },
  audit(input, _result) {
    return {
      action: 'GROUP_RATES_KEPT',
      entityType: 'workspaceGroups',
      entityId: input.groupId,
      description: `Kept ${String(input.reportCurrency)} rates for ${String(input.startDate)} to ${String(input.endDate)} (${Object.keys((input.rates || {}) as Record<string, unknown>).length} currencies)`,
    };
  },
  inverse(input, result) {
    if (!result.previousRates) return null;
    return {
      command: 'groups.keeprates',
      input: {
        groupId: input.groupId,
        reportCurrency: input.reportCurrency,
        startDate: input.startDate,
        endDate: input.endDate,
        rates: result.previousRates,
      },
    };
  },
  risk: 'normal',
  describe: {
    sentence: 'Keep the closing, average and historical rates a group was translated with for one reporting currency and period, so the same period reopens with them; do not use it for today\'s rates — reports read those live.',
    example: { groupId: 'grp_0123456789abcdef0123', reportCurrency: 'USD', startDate: '2026-01-01', endDate: '2026-12-31', rates: { EUR: { closing: 1.2, average: 1.1, historical: 1.05 } } },
    refusals: [
      { code: 'BAD_GROUP', when: 'The currency, period or rates fail validation.', next: 'Send a three-letter reporting currency, a YYYY-MM-DD period, and three positive rates per other currency.' },
      { code: 'NOT_FOUND', when: 'The group is not yours or does not exist.', next: 'List your groups and use one of them.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
  },
};
