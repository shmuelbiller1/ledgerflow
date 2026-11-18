/**
 * Migrating a workspace's entries to its dimension nodes (K-39 companion work).
 *
 * The route used to do this in one `db.runTransaction`, checking the writer role both before and
 * inside it. The two halves are now split the way the rest of the batch is: `prepareDimensionMigration`
 * does the read-only work (the workspace, the entries, the nodes, and the pure migration in
 * `lib/dimensionUtils`), and `migrateDimensionsInTransaction` writes the new nodes and the rewritten
 * entries on the caller's transaction — re-checking the role and the period lock at commit, because the
 * prepare read only answers quickly and the workspace may have changed in between.
 */
import { FieldValue } from '../db/firestore';
import type { Firestore, Transaction as FirestoreTransaction } from '../db/firestore';
import type { DimensionDefinition, DimensionNode, Transaction } from '../../types';
import { migrateWorkspaceDimensionNodes } from '../../lib/dimensionUtils';
import { assertPostingOpen } from '../../lib/periodLock';
import { ledgerWrite } from './ledgerDoor';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';

/** The sentence both halves refuse with; the address has always answered these words. */
export const DIMENSION_MIGRATION_REFUSAL = 'Only owners, accountants and bookkeepers can migrate dimensions';

export interface DimensionMigrationPrepared {
  workspace: Record<string, unknown>;
  /** entries whose lines the migration would rewrite */
  updatedTransactions: Transaction[];
  /** the original record of each, as it is stored */
  originalsById: Map<string, Record<string, unknown>>;
  updatedNodes: DimensionNode[];
  migrationCount: number;
}

export interface DimensionMigrationResult {
  migrationCount: number;
  updatedTransactionCount: number;
  updatedNodeCount: number;
}

export type DimensionMigrationCaller = { uid: string; admin?: boolean };

/** A caller who may not write the books is refused before any read. */
export function assertMayMigrateDimensions(workspace: Record<string, unknown> | undefined, caller: DimensionMigrationCaller): void {
  if (!caller.admin && !LEDGER_WRITER_ROLES.includes(roleInWorkspace(workspace, caller.uid))) {
    throw Object.assign(new Error(DIMENSION_MIGRATION_REFUSAL), { status: 403 });
  }
}

/**
 * The read-only half: load the workspace, the entries and the nodes and work out what the migration
 * would change. Nothing is written.
 */
export async function prepareDimensionMigration(
  db: Firestore,
  workspaceId: string,
  caller: DimensionMigrationCaller,
  dimensions?: unknown,
): Promise<DimensionMigrationPrepared> {
  const wsData = (await db.collection('workspaces').doc(workspaceId).get()).data();
  assertMayMigrateDimensions(wsData, caller);

  const txSnap = await db.collection('transactions').where('workspaceId', '==', workspaceId).get();
  const nodeSnap = await db.collection('dimensionNodes').where('workspaceId', '==', workspaceId).get();

  const serverTxs = txSnap.docs.map(d => ({ ...(d.data() as Transaction), id: d.id }));
  const originalsById = new Map(txSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));
  const serverNodes = nodeSnap.docs.map(d => d.data() as DimensionNode);
  const dims = (Array.isArray(dimensions) ? dimensions : (wsData?.dimensions as unknown) || []) as DimensionDefinition[];

  const { updatedTransactions, updatedNodes, migrationCount } = migrateWorkspaceDimensionNodes(serverTxs, serverNodes, dims);
  return { workspace: (wsData || {}) as Record<string, unknown>, updatedTransactions, originalsById, updatedNodes, migrationCount };
}

/**
 * The write half, on the caller's transaction: re-check the role and the period lock against the
 * workspace as it is now, write the migrated nodes, and rewrite the entries whose lines moved.
 */
export async function migrateDimensionsInTransaction(
  db: Firestore,
  workspaceId: string,
  caller: DimensionMigrationCaller,
  prepared: DimensionMigrationPrepared,
  t: FirestoreTransaction,
): Promise<DimensionMigrationResult> {
  // EVERY READ FIRST: a Firestore transaction refuses a read once a write is queued, and — more
  // importantly — reading the entries here is what makes a concurrent edit a conflict instead of a
  // silent overwrite. The prepare read them outside the transaction; the write below must not trust
  // that snapshot.
  const wsNow = (await t.get(db.collection('workspaces').doc(workspaceId))).data();
  assertMayMigrateDimensions(wsNow, caller);

  const toRewrite = prepared.updatedTransactions.filter(tx => {
    if (!tx.id) return false;
    const orig = prepared.originalsById.get(tx.id);
    return Boolean(orig) && JSON.stringify(tx.lines) !== JSON.stringify(orig!.lines);
  });
  const freshDocs = toRewrite.length
    ? await t.getAll(...toRewrite.map(tx => db.collection('transactions').doc(tx.id as string)))
    : [];
  const freshById = new Map(freshDocs.map(snap => [snap.id, snap.data() as Record<string, unknown> | undefined]));

  // then the writes
  for (const node of prepared.updatedNodes) {
    const docId = `${workspaceId}_${node.dimensionId}_${node.id}`;
    t.set(db.collection('dimensionNodes').doc(docId), { ...node, workspaceId });
  }

  let updatedTransactionCount = 0;
  for (const tx of toRewrite) {
    const preparedOrig = prepared.originalsById.get(tx.id as string)!;
    const fresh = freshById.get(tx.id as string);
    // someone changed the entry while the migration was being prepared: refuse rather than replace
    // their change with the snapshot this migration read. The whole record is compared, not only its
    // lines — the write below is a full replace, so any field changing in between is a lost update.
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(preparedOrig)) {
      throw Object.assign(new Error('An entry was changed while the dimensions were being migrated. Run it again.'), { status: 409 });
    }
    if (typeof fresh.date === 'string' && fresh.date) {
      assertPostingOpen(fresh.date, wsNow as never, caller.uid);
    }
    await ledgerWrite(t, db.collection('transactions').doc(tx.id as string), {
      ...fresh,
      lines: tx.lines,
      updatedAt: FieldValue.serverTimestamp(),
    });
    updatedTransactionCount += 1;
  }

  return { migrationCount: prepared.migrationCount, updatedTransactionCount, updatedNodeCount: prepared.updatedNodes.length };
}
