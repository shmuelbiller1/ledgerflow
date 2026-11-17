/**
 * Workspace writes that were still hand-written in `workspaceRoutes.ts` (the last batch of the
 * CMD-1 conversion): applying a chart-of-accounts template, importing records and undoing an import,
 * changing someone's role, inviting a person, and scheduling the workspace's deletion.
 *
 * Three shapes here, each the runner's:
 * - the template, the import and the undo hold their write in the runner's transaction; the service
 *   did its own reads in a `prepare…` step, so the audit line commits with the write;
 * - the role change and the invite read the workspace before the transaction and re-read it inside
 *   (`tx.get`); what the person is told afterwards is an `afterCommit` side effect, so a rolled-back
 *   change sends no notice, and a replayed one sends none twice;
 * - scheduling a deletion says a closed period is irrelevant (no date), yet it is still a role-gated
 *   write an owner makes, so the runner's membership and role gates apply as they did on the route.
 */
import { z } from 'zod';
import { generateInviteToken } from '../../lib/inviteManager';
import { planFor } from '../../lib/plans';
import { retentionFor, scheduledPurgeAt } from '../../lib/retention';
import { notify } from '../services/notificationService';
import { prepareAccountTemplate, applyTemplateInTransaction } from '../services/templateService';
import {
  prepareImportRecords, importRecordsInTransaction, prepareUndoImport, undoImportInTransaction, ImportError,
  type ImportRecordsInput, type PreparedImport,
} from '../services/recordImportService';
import { countWorkspaceOwners } from '../services/workspaceOwners';
import type { CommandDefinition } from './types';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', accountant: 'Accountant', bookkeeper: 'Bookkeeper', viewer: 'Viewer' };

/** A refusal the route had its own status for (the seat cap, the last owner, a missing workspace). */
export class WorkspaceAdminError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'WorkspaceAdminError';
  }
}

// --------------------------------------------------------------------------- apply a chart template

export const workspaceApplyTemplateInput = z.object({
  templateId: z.string().min(1).max(100).optional(),
  accounts: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
}).refine(b => Boolean(b.templateId) !== Boolean(b.accounts), 'Send either templateId or accounts');

type ApplyTemplateInput = z.output<typeof workspaceApplyTemplateInput>;
type TemplateResult = { created: number; removed: number; kept: number };

export const workspaceApplyTemplateCommand: CommandDefinition<typeof workspaceApplyTemplateInput, TemplateResult> = {
  name: 'workspace.applytemplate',
  input: workspaceApplyTemplateInput,
  roles: ['owner', 'accountant'],
  async prepare(_ctx, input: ApplyTemplateInput) {
    return prepareAccountTemplate(input);
  },
  async handler(ctx, tx, input: ApplyTemplateInput) {
    return applyTemplateInTransaction(ctx.db, tx, { workspaceId: ctx.workspaceId, uid: ctx.actor, ...input }, ctx.prepared as ReturnType<typeof prepareAccountTemplate>);
  },
  async preview(_ctx, input: ApplyTemplateInput) {
    const prepared = prepareAccountTemplate(input);
    return {
      title: input.templateId ? `Apply the ${input.templateId} chart of accounts` : 'Apply the sent chart of accounts',
      lines: [
        `${prepared.accounts.length} account(s) in the template`,
        'A workspace with no entries yet gets these in place of its current accounts; otherwise only missing ones are added',
        ...(prepared.topology ? ['The dashboard layout follows the template'] : []),
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'CHART_TEMPLATE_APPLIED',
      entityType: 'workspace',
      entityId: 'chart',
      description: `Applied a chart template: ${result.created} account(s) added${result.removed ? `, ${result.removed} replaced` : ''}`,
      details: { created: result.created, removed: result.removed, kept: result.kept },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Replace a new workspace\'s chart of accounts with a template\'s, or add the template\'s missing accounts to a workspace that already has entries; do not use it to edit one account — use accounts.update.',
    example: { templateId: 'consulting' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'Both templateId and accounts are sent, or neither, or no account is valid.', next: 'Send either a templateId or the accounts, at least one with a name and a type.' },
      { code: 'NOT_FOUND', when: 'No such template, or the workspace does not exist.', next: 'Choose a listed template.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner or accountant.', next: 'Ask an owner or accountant to apply it.' },
    ],
  },
};

// --------------------------------------------------------------------------- import records

export const workspaceImportRecordsInput = z.object({
  kind: z.enum(['customers', 'vendors', 'items', 'accounts']),
  rows: z.array(z.record(z.string(), z.string().max(5000))).min(1).max(2000),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dryRun: z.boolean().optional(),
}).strict();

type ImportInput = z.output<typeof workspaceImportRecordsInput>;
type ImportResult = {
  kind: string; created: number; skipped: unknown[]; errors: unknown[]; openingStockCents: number;
  dryRun: boolean; batchId: string | null; openingTransactionId: string | null;
};

export const workspaceImportRecordsCommand: CommandDefinition<typeof workspaceImportRecordsInput, ImportResult, { prepped: PreparedImport; allowAccounts: boolean }> = {
  name: 'workspace.importrecords',
  input: workspaceImportRecordsInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async prepare(ctx, input: ImportInput) {
    // only owners and accountants may change the chart of accounts, whoever imports
    const allowAccounts = ['owner', 'accountant'].includes(ctx.role);
    const prepped = await prepareImportRecords(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, ...input } as ImportRecordsInput);
    return { prepped, allowAccounts };
  },
  async handler(ctx, tx, input: ImportInput) {
    const { prepped, allowAccounts } = ctx.prepared as { prepped: PreparedImport; allowAccounts: boolean };
    if (input.kind === 'accounts' && !allowAccounts) {
      throw new ImportError(403, 'Only owners and accountants can change the chart of accounts');
    }
    return importRecordsInTransaction(ctx.db, tx, { workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, ...input } as ImportRecordsInput, prepped) as Promise<ImportResult>;
  },
  async preview(ctx, input: ImportInput) {
    const prepped = await prepareImportRecords(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, ...input } as ImportRecordsInput);
    return {
      title: `Import ${input.rows.length} row(s) of ${input.kind}`,
      lines: [
        `${prepped.prepared.records.length} row(s) look good`,
        ...(prepped.prepared.errors.length ? [`${prepped.prepared.errors.length} row(s) have problems`] : []),
        input.dryRun ? 'This is a check only: nothing is saved' : 'All rows are saved together, or none',
      ],
    };
  },
  audit(_input, result) {
    return {
      action: 'records_imported',
      entityType: result.kind,
      entityId: result.batchId || result.kind,
      description: `Imported ${result.created} ${result.kind} from a spreadsheet${result.skipped.length ? ` (${result.skipped.length} already existed)` : ''}`,
      details: { kind: result.kind, created: result.created, skipped: result.skipped.length },
    };
  },
  inverse(_input, result) {
    return result.batchId ? { command: 'workspace.undoimport', input: { batchId: result.batchId } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Create customers, vendors, items or accounts from a spreadsheet in one go, skipping the ones that already exist; do not use it to change a record — use its own update command.',
    example: { kind: 'customers', rows: [{ Name: 'Acme, Inc.' }] },
    refusals: [
      { code: 'INVALID_INPUT', when: 'A row is unusable, the file is empty, or it is longer than the row limit.', next: 'Check the rows the error lists and send them again.' },
      { code: 'FORBIDDEN', when: 'A bookkeeper imports accounts.', next: 'Ask an owner or accountant to import the chart.' },
    ],
  },
};

export const workspaceUndoImportInput = z.object({
  batchId: z.string().regex(/^imp_[0-9a-f]{16}$/, 'Unknown import'),
}).strict();

type UndoImportResult = { kind: string; removed: number; kept: string[]; reversalTransactionId: string | null };

export const workspaceUndoImportCommand: CommandDefinition<typeof workspaceUndoImportInput, UndoImportResult, { allowAccounts: boolean }> = {
  name: 'workspace.undoimport',
  input: workspaceUndoImportInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async prepare(ctx, input) {
    await prepareUndoImport(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, batchId: input.batchId, allowAccounts: false });
    return { allowAccounts: ['owner', 'accountant'].includes(ctx.role) };
  },
  async handler(ctx, tx, input) {
    const allowAccounts = (ctx.prepared as { allowAccounts: boolean }).allowAccounts;
    return undoImportInTransaction(ctx.db, tx, {
      workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, batchId: input.batchId, allowAccounts,
    }) as Promise<UndoImportResult>;
  },
  async preview(ctx, input) {
    await prepareUndoImport(ctx.db, { workspaceId: ctx.workspaceId, uid: ctx.actor, email: ctx.email, batchId: input.batchId, allowAccounts: false });
    return {
      title: 'Undo an import',
      lines: ['Records nothing uses yet are removed', 'Records already used on documents are kept, and listed'],
    };
  },
  audit(_input, result) {
    return {
      action: 'records_import_undone',
      entityType: result.kind,
      entityId: 'import',
      description: `Undid an import: removed ${result.removed}${result.kept.length ? `, kept ${result.kept.length} in use` : ''}`,
      details: { removed: result.removed, kept: result.kept.length },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Remove the records an import created, keeping any that are already in use; do not use it to delete one record — use its own delete command.',
    example: { batchId: 'imp_0123456789abcdef' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The batch id is not one of ours.', next: 'Send the batch id the import answered with.' },
      { code: 'NOT_FOUND', when: 'Nothing is left from that import, or it belongs to another workspace.', next: 'Check the import in this workspace.' },
      { code: 'FORBIDDEN', when: 'A bookkeeper undoes an accounts import.', next: 'Ask an owner or accountant to undo the chart import.' },
    ],
  },
};

// --------------------------------------------------------------------------- change a role

export const workspaceUpdateRoleInput = z.object({
  role: z.enum(['owner', 'accountant', 'bookkeeper', 'viewer']),
  targetUid: z.string().min(1).max(200).optional(),
}).strict();

type UpdateRoleResult = { targetUid: string; role: string; previousRole: string };

export const workspaceUpdateRoleCommand: CommandDefinition<typeof workspaceUpdateRoleInput, UpdateRoleResult> = {
  name: 'workspace.updaterole',
  input: workspaceUpdateRoleInput,
  roles: ['owner'],
  async prepare(_ctx, input) {
    // the uid comes from the path (PATCH) or the body (POST); the route resolved the pair before parsing
    return { targetUid: input.targetUid || '' };
  },
  async handler(ctx, tx, input) {
    const targetUid = (input.targetUid || (ctx.prepared as { targetUid: string }).targetUid) as string;
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const data = (await tx.get(ref)).data();
    if (!data) throw new WorkspaceAdminError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    const { count, ownerUids } = countWorkspaceOwners(data);
    const previousRole = (data.roles as Record<string, string> | undefined)?.[targetUid] || (data.uid === targetUid ? 'owner' : 'viewer');
    // the creator always counts as owner, so never store another role for them; protect the last owner too
    if (input.role !== 'owner' && (data.uid === targetUid || (ownerUids.includes(targetUid) && count <= 1))) {
      throw new WorkspaceAdminError(400, 'Cannot demote the person who created the workspace, or its last owner.', 'LAST_OWNER_PROTECTION');
    }
    tx.update(ref, { roles: { ...((data.roles as Record<string, string>) || {}), [targetUid]: input.role }, updatedAt: new Date().toISOString() });
    // S-15: the person is told their new role, not when they changed it themselves; after the commit,
    // so a rolled-back change says nothing and a replayed one says it once
    if (previousRole !== input.role) {
      const label = (r: string) => ROLE_LABEL[r] || r;
      ctx.afterCommit(async () => {
        await notify(ctx.db, {
          workspaceId: ctx.workspaceId, kind: 'member.role_changed', title: `Your role is now ${label(input.role)}`,
          message: `In this workspace you are now ${label(input.role)} (before: ${label(previousRole)}). What you can see and change follows the new role.`,
          eventKey: `role:${targetUid}:${previousRole}:${input.role}:${Date.now()}`, actorUid: ctx.actor, onlyUids: [targetUid],
        });
      });
    }
    return { targetUid, role: input.role, previousRole };
  },
  async preview(ctx, input) {
    const targetUid = input.targetUid || '';
    const data = (await ctx.db.collection('workspaces').doc(ctx.workspaceId).get()).data() || {};
    const previousRole = (data.roles as Record<string, string> | undefined)?.[targetUid] || (data.uid === targetUid ? 'owner' : 'viewer');
    return {
      title: `Make ${targetUid} ${ROLE_LABEL[input.role] || input.role}`,
      lines: [`Before: ${ROLE_LABEL[previousRole] || previousRole}`, 'They are told and see what their new role allows'],
    };
  },
  audit(_input, result) {
    return {
      action: 'ROLE_CHANGE',
      entityType: 'workspace',
      entityId: result.targetUid,
      description: `${result.targetUid} moved from ${result.previousRole} to ${result.role}`,
      details: { targetUid: result.targetUid, beforeRole: result.previousRole, afterRole: result.role },
    };
  },
  inverse(_input, result) {
    return { command: 'workspace.updaterole', input: { targetUid: result.targetUid, role: result.previousRole } };
  },
  risk: 'normal',
  describe: {
    sentence: 'Change what one member of the workspace may do by giving them another role; do not use it to invite someone — that is workspace.invite.',
    example: { targetUid: 'uid_123', role: 'accountant' },
    refusals: [
      { code: 'LAST_OWNER_PROTECTION', when: 'The person is the creator or the last owner and the new role is not owner.', next: 'Make another owner first, then change this one.' },
      { code: 'NOT_FOUND', when: 'The workspace does not exist.', next: 'Choose a workspace you own.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask an owner to change the role.' },
    ],
  },
};

// --------------------------------------------------------------------------- invite a person

export const workspaceInviteInput = z.object({
  email: z.string().email().max(200),
  role: z.enum(['owner', 'accountant', 'bookkeeper', 'viewer']).default('viewer'),
}).strict();

type InviteResult = { invite: { id?: string; inviteId?: string; workspaceId: string; email: string; role: string; expiresAt: string; token: string; status: string } };

export const workspaceInviteCommand: CommandDefinition<typeof workspaceInviteInput, InviteResult, { maxSeats: number; usedSeats: number }> = {
  name: 'workspace.invite',
  input: workspaceInviteInput,
  roles: ['owner'],
  async prepare(ctx) {
    const data = (await ctx.db.collection('workspaces').doc(ctx.workspaceId).get()).data();
    if (!data) throw new WorkspaceAdminError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    const members: string[] = Array.isArray(data.members) ? data.members : [];
    // plan's seats, at least 5; bypass billing has no cap
    const maxSeats = Number(data.maxSeats) || Math.max(5, planFor(String(data.plan || 'free')).limits.seats);
    // unique people: the creator is counted once (ACC-1b)
    const usedSeats = new Set([...members, String(data.uid || 'owner')]).size;
    if (data.bypassBilling !== true && usedSeats >= maxSeats) {
      throw new WorkspaceAdminError(402, `Payment Required: Workspace seat limit reached (${usedSeats}/${maxSeats} seats used). Upgrade plan to invite more team members.`, 'SEAT_LIMIT_REACHED');
    }
    return { maxSeats, usedSeats };
  },
  async handler(ctx, tx, input) {
    const invite = generateInviteToken(ctx.workspaceId, input.email, input.role);
    // the seats may have filled between the check and the commit: re-read inside the transaction
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const data = (await tx.get(ref)).data();
    if (!data) throw new WorkspaceAdminError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    const { maxSeats, usedSeats } = ctx.prepared as { maxSeats: number; usedSeats: number };
    const members: string[] = Array.isArray(data.members) ? data.members : [];
    const seatsNow = new Set([...members, String(data.uid || 'owner')]).size;
    if (data.bypassBilling !== true && seatsNow >= maxSeats && seatsNow !== usedSeats) {
      throw new WorkspaceAdminError(402, `Payment Required: Workspace seat limit reached (${seatsNow}/${maxSeats} seats used). Upgrade plan to invite more team members.`, 'SEAT_LIMIT_REACHED');
    }
    const id = invite.id || invite.token;
    tx.set(ctx.db.collection('invites').doc(id), { ...invite, invitedByUid: ctx.actor, createdAt: new Date().toISOString() });
    ctx.afterCommit(async () => {
      await notify(ctx.db, {
        workspaceId: ctx.workspaceId, kind: 'member.invited',
        title: `${invite.email} was invited`,
        message: `Invited as ${invite.role} by ${ctx.email || 'a team member'}.`,
        eventKey: `member.invited:${id}`, actorUid: ctx.actor,
      });
    });
    return { invite: { ...invite, id } };
  },
  async preview(ctx, input) {
    return { title: `Invite ${input.email}`, lines: [`As ${ROLE_LABEL[input.role] || input.role}`, 'The invitation says who sent it and which workspace it is for'] };
  },
  audit(_input, result) {
    return {
      action: 'INVITE_SENT',
      entityType: 'workspace',
      entityId: result.invite.id || result.invite.token,
      description: `Invite sent to ${result.invite.email} with role ${result.invite.role}`,
      details: { email: result.invite.email, role: result.invite.role, inviteId: result.invite.id },
    };
  },
  inverse(_input, result) {
    const inviteId = result.invite.id;
    return inviteId ? { command: 'workspace.inviterevoke', input: { inviteId } } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Invite one person by e-mail to join this workspace in a role; do not use it to mint an API key — that is apikey.provision.',
    example: { email: 'sam@example.com', role: 'bookkeeper' },
    refusals: [
      { code: 'PAYMENT_REQUIRED', when: 'The plan has no free seat left.', next: 'Upgrade the plan or remove a member first.' },
      { code: 'NOT_FOUND', when: 'The workspace does not exist.', next: 'Choose a workspace you own.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask an owner to invite them.' },
    ],
  },
};

// --------------------------------------------------------------------------- schedule the deletion

export const workspaceScheduleDeletionInput = z.object({}).strict();

type ScheduleDeletionResult = { scheduledPurgeAt: string; graceDays: number };

export const workspaceScheduleDeletionCommand: CommandDefinition<typeof workspaceScheduleDeletionInput, ScheduleDeletionResult> = {
  name: 'workspace.scheduledeletion',
  input: workspaceScheduleDeletionInput,
  roles: ['owner'],
  async handler(ctx, tx) {
    const ref = ctx.db.collection('workspaces').doc(ctx.workspaceId);
    const data = (await tx.get(ref)).data();
    if (!data) throw new WorkspaceAdminError(404, 'Workspace not found', 'WORKSPACE_NOT_FOUND');
    const now = new Date();
    // the workspace's own recovery window, as the retention screen reads it (`scheduledPurgeAt`)
    const graceDays = retentionFor(data).deletionGraceDays;
    const purgeAt = scheduledPurgeAt(data, now);
    tx.update(ref, {
      status: 'pending_deletion',
      deletedAt: now.toISOString(),
      scheduledPurgeAt: purgeAt,
      updatedAt: now.toISOString(),
    });
    return { scheduledPurgeAt: purgeAt, graceDays };
  },
  async preview() {
    return {
      title: 'Schedule this workspace for deletion',
      lines: ['Nothing is removed at once: the workspace stops accepting changes', 'An owner can restore it inside the recovery window'],
    };
  },
  audit(_input, result) {
    return {
      action: 'WORKSPACE_DELETION_SCHEDULED',
      entityType: 'workspace',
      entityId: 'self',
      description: `Workspace marked for deletion, scheduled for purge on ${result.scheduledPurgeAt}`,
      details: { scheduledPurgeAt: result.scheduledPurgeAt },
    };
  },
  inverse(_input, result) {
    return result ? { command: 'workspace.canceldeletion', input: {} } : null;
  },
  risk: 'normal',
  describe: {
    sentence: 'Schedule this workspace for deletion after its recovery window, keeping the books readable until then; do not use it to remove one record.',
    example: {},
    refusals: [
      { code: 'NOT_FOUND', when: 'The workspace does not exist.', next: 'Choose an existing workspace.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner.', next: 'Ask an owner to schedule it.' },
    ],
  },
};
