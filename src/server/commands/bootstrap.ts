import { z } from 'zod';
import type { CommandDefinition } from './types';

/**
 * The two rows a person needs before any workspace exists to send a command to: their own profile, and the first
 * workspace they own.
 *
 * Both were written from `useLedgerData`'s subscription callbacks — the same `setDoc` a ledger screen used, in an
 * `onSnapshot` that fires whenever the collection is empty. Three things go wrong there and none of them are
 * visible from the screen: two tabs opening at once both see an empty collection and both write, so a person gets
 * two personal workspaces; a failure arrives inside a listener where there is nothing to retry; and the row is
 * written without the audit trail every other row in the product carries.
 *
 * These are `scope: 'person'` commands, the same shape as `groups.*`: they act on the caller's own account, so the
 * runner asks only for a signed-in person. `workspace.create` is the one command whose workspace is the row it
 * writes, which is why it cannot be workspace-scoped.
 */
const text = (max: number) => z.string().trim().max(max);

export const userProvisionInput = z.object({}).strict();

export type UserProfileRow = {
  uid: string;
  email: string;
  role: 'client';
  createdAt: string;
};

export type UserProvisionResult = { profile: UserProfileRow; created: boolean };

export const userProvisionCommand: CommandDefinition<typeof userProvisionInput, UserProvisionResult> = {
  name: 'user.provision',
  input: userProvisionInput,
  roles: ['owner'],
  scope: 'person',
  async handler(ctx, tx) {
    const ref = ctx.db.collection('users').doc(ctx.actor);
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      // a profile that exists is left exactly as it is: this is the row the person's own name and role live on,
      // and a bootstrap that runs on every sign-in must not reset either
      return { profile: snapshot.data() as UserProfileRow, created: false };
    }
    const profile: UserProfileRow = {
      uid: ctx.actor,
      email: ctx.email || '',
      role: 'client',
      createdAt: new Date().toISOString(),
    };
    tx.set(ref, profile);
    return { profile, created: true };
  },
  async preview(ctx) {
    const snapshot = await ctx.db.collection('users').doc(ctx.actor).get();
    return snapshot.exists
      ? { title: 'Your profile is already set up', lines: ['Nothing will be written'] }
      : { title: 'Create your profile', lines: [ctx.email || ctx.actor, 'A person profile, not a workspace role'] };
  },
  audit(_input, result) {
    return result.created
      ? { action: 'USER_PROVISIONED', entityType: 'users', entityId: result.profile.uid, description: 'Created the person profile on first sign-in' }
      : null;
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Create the signed-in person’s own profile row if it is missing; do not use it to change a name, an email or a role — those are set elsewhere.',
    example: {},
    refusals: [
      { code: 'INVALID_INPUT', when: 'The input carries any field.', next: 'Send an empty object: the profile is built from the signed-in person.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'workspace.create', label: 'Open your first workspace' }],
  },
};

export const workspaceCreateInput = z.object({
  name: text(120).optional(),
  businessType: text(40).optional(),
  currency: text(3).length(3).optional(),
  /**
   * The caller's single personal workspace: the same row every time. Asking twice returns the one they have
   * instead of opening a second empty book, and it keeps working after that workspace is deleted or purged,
   * because the answer is read from the row and not from a replay of an old request.
   */
  personal: z.boolean().optional(),
}).strict();
type WorkspaceCreateInput = z.output<typeof workspaceCreateInput>;

export type WorkspaceRow = { id: string; uid: string; name: string; businessType: string; currency: string; createdAt: string };
export type WorkspaceCreateResult = { workspace: WorkspaceRow; created: boolean };

/**
 * The row id of a person's personal workspace.
 *
 * base64url so the id is injective: `personal-` plus the uid with punctuation stripped could give two people the
 * same row, and this is the one row whose id is derived rather than generated.
 */
const personalWorkspaceId = (uid: string) => `personal-${Buffer.from(uid, 'utf8').toString('base64url')}`;

export const workspaceCreateCommand: CommandDefinition<typeof workspaceCreateInput, WorkspaceCreateResult> = {
  name: 'workspace.create',
  input: workspaceCreateInput,
  roles: ['owner'],
  scope: 'person',
  async handler(ctx, tx, input: WorkspaceCreateInput) {
    // the caller owns what it creates, on the same field the database's `lf_ws_role` already reads
    const ref = ctx.db.collection('workspaces').doc(input.personal ? personalWorkspaceId(ctx.actor) : undefined);
    if (input.personal) {
      const existing = await tx.get(ref);
      if (existing.exists) {
        // the row is the answer: no write, no audit line, and the person is never left without a workspace because
        // a request they made last month is on record
        return { workspace: { id: ref.id, ...(existing.data() as Omit<WorkspaceRow, 'id'>) }, created: false };
      }
    }
    const workspace: WorkspaceRow = {
      id: ref.id,
      uid: ctx.actor,
      name: input.name || 'Personal Workspace',
      businessType: input.businessType || 'personal',
      currency: (input.currency || 'USD').toUpperCase(),
      createdAt: new Date().toISOString(),
    };
    const { id: _rowId, ...row } = workspace;
    tx.set(ref, row);
    return { workspace, created: true };
  },
  async preview(ctx, input: WorkspaceCreateInput) {
    const existing = input.personal
      ? await ctx.db.collection('workspaces').doc(personalWorkspaceId(ctx.actor)).get()
      : undefined;
    if (existing?.exists) return { title: 'You already have your personal workspace', lines: ['Nothing will be written'] };
    return {
      title: `Open the workspace “${input.name || 'Personal Workspace'}”`,
      lines: [
        'You are its owner; no books, accounts or documents are created with it',
        `Books open in ${(input.currency || 'USD').toUpperCase()}`,
      ],
    };
  },
  audit(_input, result) {
    return result.created
      ? {
        action: 'WORKSPACE_CREATED',
        entityType: 'workspaces',
        entityId: result.workspace.id,
        description: `Opened the workspace “${result.workspace.name}”`,
        details: { name: result.workspace.name, currency: result.workspace.currency },
      }
      : null;
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Open a new empty workspace that you own; do not use it to copy, import or seed another workspace’s books — an import is its own command.',
    example: { name: 'Personal Workspace', businessType: 'personal', currency: 'USD', personal: true },
    refusals: [
      { code: 'INVALID_INPUT', when: 'The currency is not three letters, or the input carries unexpected fields.', next: 'Send a name, a business type and a three-letter currency, or nothing at all.' },
      { code: 'UNAUTHENTICATED', when: 'The request has no signed-in person.', next: 'Sign in and run the command again.' },
    ],
    next: [{ command: 'workspace.modules', label: 'Choose which screens this workspace shows' }],
  },
};
