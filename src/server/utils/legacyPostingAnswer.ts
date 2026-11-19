import { errorMessage } from '../auth/requestUser';
import type { CommandExecutionOutcome } from '../commands/types';
import type { DocumentPostResult } from '../services/documentPostService';
import { LedgerPostingError } from '../services/cogsStockService';
import { BulkRefusal } from '../services/ledgerBulkCommit';

/** Both old posting addresses return the ledger body and only the entries actually written. */
export function legacyPostingAnswer(outcome: CommandExecutionOutcome) {
  if (outcome.ok) {
    const { body, transactions, cogsPendingReason } = outcome.data as DocumentPostResult;
    return { status: 200, body: { ...body, transactions, ...(cogsPendingReason ? { cogsPendingReason } : {}) } };
  }
  if (outcome.error instanceof BulkRefusal) return { status: outcome.error.status, body: outcome.error.body };
  if (outcome.error instanceof LedgerPostingError) return { status: outcome.error.status, body: { error: outcome.error.message } };
  if (outcome.code === 'NOT_A_MEMBER' || outcome.code === 'WORKSPACE_NOT_FOUND') {
    return { status: 403, body: { error: 'Not a member' } };
  }
  if (outcome.code === 'WORKSPACE_REQUIRED') return { status: 400, body: { error: 'Missing workspaceId' } };
  return { status: outcome.status >= 500 ? 400 : outcome.status, body: { error: outcome.error ? errorMessage(outcome.error) : outcome.message } };
}
