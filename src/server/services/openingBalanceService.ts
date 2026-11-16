import type { Firestore, Transaction } from '../db/firestore';
import { ledgerCreate } from './ledgerDoor';
import { FieldValue } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { isOpeningBalanceEquity, OPENING_BALANCE_TYPE, openingEntry, type OpeningEntry } from '../../lib/openingBalances';
import { workspaceRole } from '../../lib/periodLock';
import type { ChartAccount } from '../../types';
import { writeServerAuditLog } from './auditLogService';

/**
 * First-run setup (L-19, BO-03): post the opening balances as one balanced entry and mark the
 * workspace's setup as done; or mark it done without balances ("start from zero"). Owners and
 * accountants; one database transaction with the audit entry. Opening balances are recorded
 * once: to change them, reverse the entry in the ledger and enter them again.
 */

export class SetupError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

const SETUP_ROLES = ['owner', 'accountant'];
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface OpeningBalancesInput {
  workspaceId: string;
  uid: string;
  email?: string;
  date: string;
  balances: Array<{ accountId: string; amountCents: number }>;
}

export interface OpeningBalanceWriteResult extends OpeningEntry {
  workspaceId: string;
  transactionId: string | null;
}

export function openingBalanceAuditSummary(input: Pick<OpeningBalancesInput, 'date'>, result: OpeningBalanceWriteResult) {
  return {
    action: 'OPENING_BALANCES_RECORDED',
    entityType: 'workspace',
    entityId: result.workspaceId,
    description: `Opening balances on ${input.date}: ${result.lines.length} lines, ${result.equityCents} cents to Opening Balance Equity`,
    details: { transactionId: result.transactionId },
  };
}

/** Read-only inputs for a command preview; the write transaction repeats every check. */
export async function previewOpeningBalances(db: Firestore, input: OpeningBalancesInput): Promise<OpeningEntry> {
  if (!DAY.test(input.date)) throw new SetupError(400, 'The start date must be YYYY-MM-DD');
  const workspace = (await db.collection('workspaces').doc(input.workspaceId).get()).data();
  if (!workspace) throw new SetupError(404, 'Workspace not found');
  if (!SETUP_ROLES.includes(workspaceRole(workspace, input.uid))) throw new SetupError(403, 'Only owners and accountants set up the books');
  const accounts = (await db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId).get()).docs
    .map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  const equity = accounts.find(a => isOpeningBalanceEquity(a) && !a.isArchived);
  if (!equity) throw new SetupError(400, 'Add an "Opening Balance Equity" account (equity) to the chart of accounts first');
  const existing = (await db.collection('transactions').where('workspaceId', '==', input.workspaceId).where('metadata.type', '==', OPENING_BALANCE_TYPE).get()).docs
    .map(d => d.data()).filter(tx => !tx.reversalEventId && tx.status !== 'void');
  if (existing.length) throw new SetupError(409, 'Opening balances are already recorded. To change them, reverse that entry in the ledger first.');
  try {
    return openingEntry(accounts, input.balances, equity);
  } catch (err) {
    throw new SetupError(400, err instanceof Error ? err.message : String(err));
  }
}

/** The opening-balance write, inside the command runner's transaction. */
export async function recordOpeningBalancesInTransaction(
  db: Firestore,
  t: Transaction,
  input: OpeningBalancesInput,
): Promise<OpeningBalanceWriteResult> {
  if (!DAY.test(input.date)) throw new SetupError(400, 'The start date must be YYYY-MM-DD');
  const wsRef = db.collection('workspaces').doc(input.workspaceId);
  const workspace = (await t.get(wsRef)).data();
  if (!workspace) throw new SetupError(404, 'Workspace not found');
  if (!SETUP_ROLES.includes(workspaceRole(workspace, input.uid))) throw new SetupError(403, 'Only owners and accountants set up the books');
  const accounts = (await t.get(db.collection('chartAccounts').where('workspaceId', '==', input.workspaceId))).docs
    .map(d => ({ ...d.data(), id: d.id }) as ChartAccount);
  const equity = accounts.find(a => isOpeningBalanceEquity(a) && !a.isArchived);
  if (!equity) throw new SetupError(400, 'Add an "Opening Balance Equity" account (equity) to the chart of accounts first');

  const existing = (await t.get(db.collection('transactions').where('workspaceId', '==', input.workspaceId).where('metadata.type', '==', OPENING_BALANCE_TYPE))).docs
    .map(d => d.data()).filter(tx => !tx.reversalEventId && tx.status !== 'void');
  if (existing.length) throw new SetupError(409, 'Opening balances are already recorded. To change them, reverse that entry in the ledger first.');

  let entry: OpeningEntry;
  try {
    entry = openingEntry(accounts, input.balances, equity);
  } catch (err) {
    throw new SetupError(400, err instanceof Error ? err.message : String(err));
  }

  let transactionId: string | null = null;
  if (entry.lines.length) {
    let prepared;
    try {
      prepared = await TransactionValidator.validateAndPrepare({
        id: db.collection('transactions').doc().id, workspaceId: input.workspaceId, uid: input.uid,
        date: input.date, description: 'Opening balances', currency: workspace.currency || 'USD', exchangeRate: 1,
        status: 'completed', type: 'actual', lines: entry.lines, metadata: { type: OPENING_BALANCE_TYPE },
      }, { workspaceId: input.workspaceId, user: { uid: input.uid }, wsData: workspace }, undefined, t);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SetupError(/Period Locked/i.test(message) ? 409 : 400, message);
    }
    ledgerCreate(t, db.collection('transactions').doc(prepared.id), { ...prepared, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transactionId = prepared.id;
  }
  const now = new Date().toISOString();
  t.update(wsRef, { setupCompletedAt: now, openingBalanceDate: input.date, updatedAt: now });
  return { ...entry, workspaceId: input.workspaceId, transactionId };
}

/** Service compatibility wrapper. Commands call recordOpeningBalancesInTransaction directly. */
export async function recordOpeningBalances(db: Firestore, input: OpeningBalancesInput): Promise<OpeningEntry & { transactionId: string | null }> {
  return db.runTransaction(async t => {
    const result = await recordOpeningBalancesInTransaction(db, t, input);
    const summary = openingBalanceAuditSummary(input, result);
    await writeServerAuditLog({
      workspaceId: input.workspaceId,
      uid: input.uid,
      email: input.email || '',
      action: summary.action,
      entityType: summary.entityType,
      entityId: summary.entityId,
      details: { description: summary.description, ...summary.details },
    }, { db, tx: t });
    const { workspaceId: _workspaceId, ...publicResult } = result;
    return publicResult;
  });
}

export interface SetupCompletionResult {
  workspaceId: string;
  completedAt: string;
  changed: boolean;
}

/** "Start from zero" / "Skip": mark setup done inside the command's transaction. */
export async function completeSetupInTransaction(
  db: Firestore,
  tx: Transaction,
  input: { workspaceId: string; uid: string },
): Promise<SetupCompletionResult> {
  const ref = db.collection('workspaces').doc(input.workspaceId);
  const workspace = (await tx.get(ref)).data();
  if (!workspace) throw new SetupError(404, 'Workspace not found');
  if (!SETUP_ROLES.includes(workspaceRole(workspace, input.uid))) throw new SetupError(403, 'Only owners and accountants set up the books');
  if (workspace.setupCompletedAt) {
    return { workspaceId: input.workspaceId, completedAt: String(workspace.setupCompletedAt), changed: false };
  }
  const now = new Date().toISOString();
  tx.update(ref, { setupCompletedAt: now, updatedAt: now });
  return { workspaceId: input.workspaceId, completedAt: now, changed: true };
}

export async function completeSetup(db: Firestore, input: { workspaceId: string; uid: string }): Promise<void> {
  await db.runTransaction(tx => completeSetupInTransaction(db, tx, input));
}
