/**
 * EG-6 (BF-04): landed cost (src/server/services/landedCostService.ts), mounted on the inventory router.
 * POST /api/v1/inventory/landed-cost  { workspaceId, charge, receiptBillIds, basis, weights?, date?, inventoryAccountId?, dryRun? }
 *   owners and accountants; `dryRun` answers what would post (with its planHash) and writes nothing; a retry posts nothing
 *   (`replayed`); with expectedPlanHash, a plan that changed since the review is refused (409 with `plan`).
 * POST /api/v1/inventory/landed-cost/:entryId/undo  { workspaceId }: reverses the entry and its stock moves together.
 */
import express from 'express';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { z } from 'zod';
import { errorMessage, type RequestUser } from '../auth/requestUser';
import { getWorkspaceUserRole } from './workspaceRoutes';
import { inventoryLandedCostCommand, inventoryLandedCostInput, inventoryLandedCostUndoCommand, inventoryLandedCostUndoInput } from '../commands/inventory';

export const landedCostRouter = express.Router();

/** The legacy gate before the body is read: a non-member answers 403 (the command runner checks again). */
const membersGate = (roles: readonly string[]): express.RequestHandler => async (req, res, next) => {
  const workspaceId = String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || '');
  if (!workspaceId) return void res.status(400).json({ error: 'Workspace ID required' });
  try {
    const db = getDb();
    await validateWorkspaceMember(db, workspaceId, (req as unknown as { user: RequestUser }).user);
    const role = await getWorkspaceUserRole(db, workspaceId, (req as unknown as { user: RequestUser }).user.uid);
    if (!roles.includes(role)) return void res.status(403).json({ error: `Forbidden: requires one of roles [${roles.join(', ')}]` });
    next();
  } catch (error) {
    if (/Unauthorized|not a member|FORBIDDEN/i.test(errorMessage(error))) return void res.status(403).json({ error: 'Forbidden' });
    if (errorMessage(error) === 'NOT_FOUND' || /Workspace not found/i.test(errorMessage(error))) return void res.status(404).json({ error: 'Workspace not found' });
    res.status(500).json({ error: 'Role Authorization Error', details: errorMessage(error) });
  }
};

const ChargeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bill'), billId: z.string().min(1), line: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('manual'), amountCents: z.number().int().positive(), accountId: z.string().min(1),
    allocationId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'allocationId: 8–80 letters, digits, - or _'), description: z.string().trim().max(200).optional(),
  }),
]);

export const LandedCostSchema = z.object({
  workspaceId: z.string().min(1),
  charge: ChargeSchema,
  receiptBillIds: z.array(z.string().min(1)).min(1, 'Choose at least one bill whose goods were received').max(50),
  basis: z.enum(['value', 'quantity', 'weight']),
  weights: z.record(z.string(), z.number().nonnegative()).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD').optional(),
  inventoryAccountId: z.string().min(1).optional(),
  cogsAccountId: z.string().min(1).optional(),
  /** the planHash of the reviewed dry run: a different plan now is refused (409, with the new plan) */
  expectedPlanHash: z.string().regex(/^[0-9a-f]{32}$/, 'expectedPlanHash: the planHash of the reviewed plan').optional(),
  dryRun: z.boolean().optional(),
});

landedCostRouter.post('/', membersGate(['owner', 'accountant']), async (req, res) => {
  const parsed = inventoryLandedCostInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields', details: parsed.error.issues });
  // Import lazily to avoid the executor's existing workspaceRoutes role-helper cycle during router setup.
  const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash(inventoryLandedCostCommand),
    workspaceId: String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || ''),
    input: parsed.data,
    formatResponse: outcome => (outcome.ok
      ? { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } }
      : {
        status: outcome.status,
        body: { error: outcome.message, ...((outcome.error as { plan?: unknown } | undefined)?.plan ? { plan: (outcome.error as { plan?: unknown }).plan } : {}) },
      }),
  });
});

landedCostRouter.post('/:entryId/undo', membersGate(['owner', 'accountant']), async (req, res) => {
  const workspaceId = String((req.body as { workspaceId?: unknown } | undefined)?.workspaceId || '');
  if (!workspaceId) return res.status(400).json({ error: 'Workspace ID required' });
  const parsed = inventoryLandedCostUndoInput.safeParse({ entryId: String((req.params as Record<string, string>).entryId || '') });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields' });
  const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash(inventoryLandedCostUndoCommand),
    workspaceId,
    input: parsed.data,
    formatResponse: outcome => (outcome.ok
      ? { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } }
      : {
        status: outcome.status,
        body: { error: outcome.message, ...((outcome.error as { plan?: unknown } | undefined)?.plan ? { plan: (outcome.error as { plan?: unknown }).plan } : {}) },
      }),
  });
});
