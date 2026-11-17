/**
 * The two ledger-batch addresses (`/recategorize` and `/batch`) keep the answers their handlers gave
 * before they became commands. Those answers are not the runner's: each handler had its own sentences,
 * its own 409 body, and one place where a 403 was never a status the caller could receive.
 *
 * The mapping lives here rather than inline in `bulkRoutes.ts` so it can be tested without a database —
 * a route file cannot be mounted in a unit test (the writer-role middleware reads a real workspace), and
 * the accepted answers are exactly what this batch has to preserve. It is a helper, not a router, so it
 * belongs in `utils/` beside `assetCommandRoute.ts`.
 */
import type { CommandExecutionOutcome } from '../commands/types';
import { BatchVersionConflict } from '../services/ledgerBatchUpdate';

/**
 * `POST /transactions/recategorize`:
 * - `{ status: 'success', ...result }`
 * - 400 `{ error: 'Invalid request', details: issues }` for a body the schema rejected
 * - the service's own status, its sentence, and `entryId` when it names the entry that refused
 * - 500 `{ error: <cause> }`
 */
export function recategorizeAnswer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
  // a body naming no workspace never reached the handler (requireLedgerWriter answers it first), so the
  // only refusal before the service is the schema's
  if (outcome.code === 'INVALID_INPUT') {
    return { status: 400, body: { error: 'Invalid request', details: (outcome.error as { issues?: unknown })?.issues } };
  }
  if (outcome.status === 403 || outcome.code === 'NOT_A_MEMBER') return { status: 403, body: { error: outcome.message } };
  if (outcome.status < 500) {
    const entryId = (outcome.error as { entryId?: string } | undefined)?.entryId;
    return { status: outcome.status, body: { error: outcome.message, ...(entryId ? { entryId } : {}) } };
  }
  const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
  return { status: 500, body: { error: cause } };
}

/**
 * `POST /transactions/batch`:
 * - `{ status: 'ok' }` on success
 * - 400 `{ error: 'Missing workspaceId or updates' }` for the handler's one pre-transaction refusal
 * - 409 `version_conflict` with the entry as it is now, with nothing in the batch saved
 * - otherwise the handler's sentence: 403 only for its own membership refusal, 400 for everything else
 */
export function batchAnswer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } };
  if (outcome.code === 'WORKSPACE_REQUIRED') return { status: 400, body: { error: 'Missing workspaceId or updates' } };
  if (outcome.error instanceof BatchVersionConflict) {
    return {
      status: 409,
      body: {
        error: 'version_conflict',
        message: outcome.error.message,
        conflictTransactionId: outcome.error.transactionId,
        currentTransaction: outcome.error.current,
      },
    };
  }
  const status = outcome.status === 403 ? 403 : 400;
  // the handler answered with the thrown sentence; the runner replaces a status-less error's message
  // (e.g. "Period Locked: … closed through …" from assertPostingOpen) with its generic 500 wording
  const message = outcome.status >= 500 && outcome.error instanceof Error ? outcome.error.message : outcome.message;
  return { status, body: { error: message } };
}
