/**
 * The three fixed-asset addresses (disposal, transfer, in-service) share one shape: the address names
 * the workspace and the asset, the body carries the rest, and the handler answers the service's result
 * spread under `{ status: 'success' }`. These helpers keep that shape in one place, so the routes stay
 * the thin wrappers they were.
 *
 * They live here rather than in `routes/` because they are helpers, not a router: the route-policy
 * suite requires every file in that folder to be mounted behind verified auth, and a file of two
 * functions has no registrations to guard.
 */
import type express from 'express';
import type { AnyCommandDefinition, CommandExecutionOutcome } from '../commands/types';

/** The workspace of the mounted address and the asset named in it; the body carries the rest. */
export function assetInvocation(req: express.Request, definition: AnyCommandDefinition) {
  const params = req.params as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const workspaceId = String(params.workspaceId || '');
  return { definition, workspaceId, input: { ...body, workspaceId, assetId: String(params.assetId || '') } };
}

/** The legacy answers: a malformed body keeps the handler's sentence, a 500 keeps `details`. */
export function assetAnswer(badBody: string, what: string) {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
    if (outcome.code === 'INVALID_INPUT') return { status: 400, body: { status: 'error', message: badBody } };
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
    return { status: 500, body: { status: 'error', message: what, details: cause } };
  };
}
