/**
 * Reconciliation audit functions (write the audit log row). Extracted from
 * reconciliationWriteService.ts to keep that file under the quality ratchet's 800-line limit.
 */
import type { DocumentData } from '../db/firestore';
import type { ReconcileInput } from './reconciliationWriteService';

export function reconcileAudit(input: ReconcileInput, actor: { uid: string; email?: string }) {
  return {
    action: 'reconcile',
    entityType: 'reconciliation',
    entityId: input.operations[0]?.id || 'batch',
    description: `User ${actor.email || actor.uid} executed reconciliation batch (${input.operations.length} operations)`,
  };
}

// --------------------------------------------------------------------------- clearing entries

export class ClearEntriesError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ClearEntriesError';
  }
}

export const CLEAR_MAX_ENTRIES = 500;

export interface ClearEntriesInput {
  workspaceId: string;
  transactionIds: string[];
  clearanceDate?: string;
  /** `false` undoes a clearing (CA-04). */
  cleared?: boolean;
}

export interface ClearEntriesPrepared {
  workspace: DocumentData;
  undo: boolean;
}

/** The refusals a person sees before anything is written: batch size, membership, role, date shape. */

export function clearEntriesAudit(input: ClearEntriesInput, result: { clearedCount: number; undo: boolean }) {
  return {
    action: result.undo ? 'TRANSACTIONS_UNCLEARED' : 'TRANSACTIONS_CLEARED',
    entityType: 'transaction',
    entityId: String(input.transactionIds[0]),
    description: `${result.undo ? 'Uncleared' : 'Cleared'} ${result.clearedCount} transaction(s)`,
    details: {
      count: result.clearedCount,
      ...(typeof input.clearanceDate === 'string' ? { clearanceDate: input.clearanceDate } : {}),
    },
  };
}

// --------------------------------------------------------------------------- one bank line

export class UpdateBankLineError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'UpdateBankLineError';
  }
}

export interface UpdateBankLinePrepared {
  workspace: DocumentData;
}

/** PATCH /transactions/bank-lines/:id: membership, then the line's own workspace, before the parse. */

export function updateBankLineAudit(input: { id: string; data: Record<string, unknown> }, result: { data: Record<string, unknown> }) {
  return {
    action: 'BANK_LINE_UPDATED',
    entityType: 'bank_line',
    entityId: input.id,
    description: `Updated bank line ${input.id}`,
    details: { fields: Object.keys(result.data) },
  };
}

// --------------------------------------------------------------------------- completing a reconciliation

export class CompleteReconciliationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CompleteReconciliationError';
  }
}

export interface CompleteReconciliationInput {
  workspaceId: string;
  accountId: string;
  statementDate: string;
  statementBalanceCents: number;
  reconciledTransactionIds: string[];
}

export interface CompleteReconciliationPrepared {
  workspace: DocumentData;
  reconciliationId: string;
  uniqueTxIds: string[];
  completedAt: string;
  /** BR-02: the balance this statement starts from — the last statement's ending balance, or the
   * account's recorded opening balance when this is the first reconciliation (a recorded zero counts) */
  beginningBalanceCents: number;
}

export function completeReconciliationAudit(input: CompleteReconciliationInput, result: { reconciliationId: string; reconciledCount: number }) {
  return {
    action: 'RECONCILIATION_COMPLETED',
    entityType: 'reconciliation',
    entityId: result.reconciliationId,
    description: `Completed bank reconciliation for account ${input.accountId} as of ${input.statementDate}`,
    details: {
      accountId: input.accountId,
      statementDate: input.statementDate,
      statementBalanceCents: input.statementBalanceCents,
      reconciledCount: result.reconciledCount,
    },
  };
}
