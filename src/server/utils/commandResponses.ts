/**
 * The reply a route sends when a command refused (the `formatResponse` tail every command route
 * needs). The shape is the same everywhere, so it lives here once:
 *
 * - a 5xx answer hides the failure behind one sentence the route chooses, and keeps the server's
 *   own message in `details` (support reads it; the client shows the sentence);
 * - a 4xx answer carries the command's own sentence, which the command wrote for the caller.
 */
import { errorMessage } from '../auth/requestUser';
import type { CommandExecutionOutcome } from '../commands/types';

export type CommandRefusalOutcome = Extract<CommandExecutionOutcome, { ok: false }>;

export function commandFailureResponse(
  outcome: CommandRefusalOutcome,
  serverMessage: string,
): { status: number; body: unknown } {
  if (outcome.status >= 500) {
    const error = outcome.error;
    return {
      status: outcome.status,
      body: {
        status: 'error',
        message: serverMessage,
        details: error instanceof Error ? errorMessage(error) : String(error || outcome.message),
      },
    };
  }
  return { status: outcome.status, body: { status: 'error', message: outcome.message } };
}
