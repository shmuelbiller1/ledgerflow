/**
 * Two workspace-wide transaction writes that were still hand-written in the routes: moving a
 * workspace's entries onto its dimension nodes, and emptying a workspace that holds only demo data.
 *
 * Both were already transactional and role-checked in the route. What they gained here is the same
 * door as every other write: the runner's membership, role and workspace-state checks, an idempotency
 * record for a retried request, and one audit line written with the change.
 *
 * `transaction.reset` is deliberately narrow. Real books are never wiped on the spot — the workspace is
 * deleted instead and kept for 30 days — so the command only empties a workspace that has flagged itself
 * as holding demo data, which is the rule the route has enforced since the reset address existed. The
 * audit trail is never among the tables cleared.
 */
import { z } from 'zod';
import type { Transaction as FirestoreTransaction } from '../db/firestore';
import {
  DIMENSION_MIGRATION_REFUSAL, migrateDimensionsInTransaction, prepareDimensionMigration,
  type DimensionMigrationPrepared, type DimensionMigrationResult,
} from '../services/dimensionMigrationService';
import type { AnyCommandDefinition, CommandDefinition } from './types';

const workspaceIdField = z.string().min(1, 'workspaceId is required').max(200);

/**
 * The tables a reset clears, exactly as the route listed them. `auditLogs` is absent on purpose: the
 * audit trail is the record of what happened and is never deleted by a reset.
 */
export const RESET_COLLECTIONS = [
  'transactions', 'chartAccounts', 'projects', 'budgets',
  'vendors', 'customers', 'invoices', 'bills',
  'inventory', 'assets', 'recurring', 'employees', 'payRuns',
  'taxRates', 'partners', 'autoRules', 'bankLines',
] as const;

export const transactionResetInput = z.object({
  workspaceId: workspaceIdField,
  confirmReset: z.literal(true, { message: 'Explicit confirmation required (confirmReset: true).' }),
}).strict();

export const transactionResetCommand: CommandDefinition<typeof transactionResetInput, { status: 'ok' }, { workspace: Record<string, unknown> }> = {
  name: 'transaction.reset',
  input: transactionResetInput,
  // the route has always required the workspace owner (or a platform admin); nothing narrower, nothing wider
  roles: ['owner'],
  allowPlatformAdmin: true,
  async prepare(ctx) {
    // the demo-data rule and the owner check are answered against the workspace as it is read now; they
    // are checked again inside the transaction, where the clear actually happens
    assertResettable(ctx.workspace);
    return { workspace: ctx.workspace };
  },
  async handler(ctx, tx, _input) {
    // EVERY READ FIRST. A Firestore transaction refuses a read once a write is queued (pgFirestore.ts),
    // so the workspace and all the tables are read before a single delete is queued.
    const wsNow = (await tx.get(ctx.db.collection('workspaces').doc(ctx.workspaceId))).data();
    assertResettable(wsNow);
    const snapshots = await Promise.all(
      RESET_COLLECTIONS.map(coll => tx.get(ctx.db.collection(coll).where('workspaceId', '==', ctx.workspaceId))),
    );
    // then the writes, in a single pass; one query per table, as the route ran them
    for (const snapshot of snapshots) for (const doc of snapshot.docs) tx.delete(doc.ref);
    return { status: 'ok' as const };
  },
  async preview(_ctx, _input) {
    return {
      title: 'Empty this workspace of its demo data',
      lines: [
        'Every entry, account, project, contact, document and balance in this workspace is deleted',
        'The audit trail is kept',
        'Only a workspace that holds demo data can be emptied this way; real books are deleted with the workspace instead and kept for 30 days',
      ],
    };
  },
  audit(input) {
    return {
      action: 'WORKSPACE_DATA_RESET',
      entityType: 'workspace',
      entityId: input.workspaceId,
      description: 'All financial and operational records reset by workspace owner.',
      details: { description: 'All financial and operational records reset by workspace owner.' },
    };
  },
  inverse() { return null; },
  risk: 'high',
  describe: {
    sentence: 'Empty a workspace that holds only demo data, so its sample books can be loaded again; do not use it to clear real books — delete the workspace instead, which keeps it for 30 days first.',
    example: { workspaceId: 'ws_123', confirmReset: true },
    refusals: [
      { code: 'CONFLICT', when: 'The workspace does not hold demo data, so its books are real.', next: 'Delete the workspace instead (Settings → Security); it is kept for 30 days first.' },
      { code: 'ROLE_REQUIRED', when: 'The caller is not the workspace owner.', next: 'Ask the workspace owner.' },
      { code: 'INVALID_INPUT', when: 'confirmReset was not sent as true.', next: 'Send confirmReset: true to say the deletion is intended.' },
    ],
  },
};

/** The workspace must say it holds demo data, and the caller must own it. */
function assertResettable(workspace: Record<string, unknown> | undefined): void {
  if (!workspace || workspace.isDemoLoaded !== true) {
    throw Object.assign(new Error('Only demo data can be cleared at once. To remove real books, delete the workspace (Settings → Security): it is kept for 30 days first.'), { status: 409 });
  }
}

// --------------------------------------------------------------------------- dimensions.migrate

export const dimensionsMigrateInput = z.object({
  workspaceId: workspaceIdField,
  dimensions: z.array(z.unknown()).optional(),
}).strict();

export const dimensionsMigrateCommand: CommandDefinition<
  typeof dimensionsMigrateInput, DimensionMigrationResult, DimensionMigrationPrepared
> = {
  name: 'dimensions.migrate',
  input: dimensionsMigrateInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  allowPlatformAdmin: true,
  prepare(ctx, input) {
    return prepareDimensionMigration(ctx.db, ctx.workspaceId, { uid: ctx.actor, admin: ctx.user.admin }, input.dimensions);
  },
  async handler(ctx, tx: FirestoreTransaction, _input) {
    return migrateDimensionsInTransaction(
      ctx.db, ctx.workspaceId, { uid: ctx.actor, admin: ctx.user.admin },
      ctx.prepared as DimensionMigrationPrepared, tx,
    );
  },
  async preview(_ctx, input) {
    return {
      title: 'Move this workspace\'s entries to its dimension nodes',
      lines: [
        'Each entry line that names a dimension value string is rewritten to name the node id instead',
        'Entries in a closed period are refused rather than rewritten',
        ...(input.dimensions ? [`Using the ${input.dimensions.length} dimension definitions in this request`] : []),
      ],
    };
  },
  audit(input, result) {
    return {
      action: 'DIMENSIONS_MIGRATED',
      entityType: 'workspace',
      entityId: input.workspaceId,
      description: `Moved ${result.updatedTransactionCount} entries and ${result.updatedNodeCount} nodes onto dimension node ids`,
      details: { ...result },
    };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Rewrite the entries that name a dimension value as text so they name its dimension node instead; it is a one-way tidy-up of existing data and posts nothing.',
    example: { workspaceId: 'ws_123' },
    refusals: [
      { code: 'ROLE_REQUIRED', when: 'The caller is not an owner, accountant or bookkeeper.', next: 'Ask a workspace owner to grant an appropriate role.' },
      { code: 'PERIOD_LOCKED', when: 'An entry it would rewrite is dated in a closed period.', next: 'Ask an owner to reopen the period, or reopen it and run the migration again.' },
    ],
  },
};

export const TRANSACTION_HOUSEKEEPING_COMMANDS: AnyCommandDefinition[] = [transactionResetCommand, dimensionsMigrateCommand];
export { DIMENSION_MIGRATION_REFUSAL };
