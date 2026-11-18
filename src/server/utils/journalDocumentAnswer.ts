import { errorMessage } from '../auth/requestUser';
import { POST_REFUSAL } from '../services/journalDocumentService';
import type { CommandExecutionOutcome } from '../commands/types';

/** The lease and revenue addresses' existing response shape, including their 400/403 refusals. */
export function journalDocumentAnswer(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) return { status: 200, body: outcome.data };
  if (outcome.code === 'ROLE_REQUIRED') return { status: 403, body: { error: POST_REFUSAL } };
  const message = outcome.error ? errorMessage(outcome.error) : outcome.message;
  const status = outcome.status === 500 ? (/Unauthorized|Forbidden/i.test(message) ? 403 : 400) : outcome.status;
  return { status, body: { error: message } };
}
