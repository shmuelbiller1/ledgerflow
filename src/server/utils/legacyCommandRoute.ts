/**
 * The answer shape the workspace-housekeeping addresses had before them became commands, in one place.
 *
 * Each of these handlers answered `{ status: 'success', ...result }`, refused a malformed body with one
 * sentence of its own (and, in the contact case, the issues), passed a service's own status and words
 * through, and answered a server fault with its own sentence plus the cause as `details`. That is one
 * shape with three slots, so it is written once here — beside `assetCommandRoute.ts` — rather than six
 * times in the routes, and a test can hold each address to its own words without a database.
 */
import type { CommandExecutionOutcome } from '../commands/types';

export interface LegacyAnswer {
  /** The sentence the handler gave for a body it refused (a malformed shape). */
  badBody: string;
  /** The sentence the handler gave for a server fault. */
  failed: string;
  /** The handler attached the schema's issues to a malformed body (the contact and template addresses did). */
  issues?: boolean;
  /**
   * The handler wrapped its result in `data` (`{ status, data: { template, replaced } }`) instead of
   * spreading it into the answer. Only the journal-template save did.
   */
  insideData?: boolean;
}

export function legacyAnswer(answer: LegacyAnswer) {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) {
      const result = outcome.data as Record<string, unknown>;
      return { status: 200, body: { status: 'success', ...(answer.insideData ? { data: result } : result) } };
    }
    if (outcome.code === 'INVALID_INPUT') {
      return {
        status: 400,
        body: {
          status: 'error', message: answer.badBody,
          ...(answer.issues ? { details: (outcome.error as { issues?: unknown })?.issues } : {}),
        },
      };
    }
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
    return { status: 500, body: { status: 'error', message: answer.failed, details: cause } };
  };
}

/** The workspace of the address and, when the address names one, the record in it. */
export function workspaceInvocation(
  req: { params: unknown; body?: unknown; query?: unknown },
  definition: import('../commands/types').AnyCommandDefinition,
  extra: Record<string, unknown> = {},
) {
  const params = (req.params || {}) as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const workspaceId = String(params.workspaceId || '');
  // The address was reachable, with its own role check, before two-step gating existed on commands:
  // it keeps answering (a signed-in person, an owner or accountant) rather than returning a 403.
  return { definition, workspaceId, legacyRoute: true, input: { ...body, ...extra, workspaceId } };
}
