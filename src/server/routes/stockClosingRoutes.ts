import express from 'express';
import { z } from 'zod';
import { errorMessage } from '../auth/requestUser';
import { getDb } from '../db/firestore';
import { formatTzDate } from '../../lib/calendarDate';
import { requireWorkspaceRole } from './workspaceRoutes';
import { stockCheckReport } from '../services/stockClosingService';
import { inventoryStockClosingCommand } from '../commands/inventory';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * EG-7, mounted on the inventory router (/api/v1/inventory):
 * - POST /stock-closing: an owner takes the stock closing of a locked period end (stockClosingService.ts);
 * - GET /stock-closing: every member reads it with the stock invariant checks (read only).
 */
export function registerStockClosingRoutes(router: express.Router): void {
  router.post('/stock-closing', requireWorkspaceRole(['owner']), async (req, res) => {
    const parsed = z.object({ workspaceId: z.string().min(1).max(200), asOf: day.optional() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say the workspace and, if not the lock date, the period end (YYYY-MM-DD)' });
    // Import lazily to avoid the executor's existing workspaceRoutes role-helper cycle during router setup.
    const { executeCommand, withLegacyInputIdempotencyHash } = await import('../utils/commandExecutor');
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(inventoryStockClosingCommand),
      workspaceId: parsed.data.workspaceId,
      input: { ...(parsed.data.asOf ? { asOf: parsed.data.asOf } : {}) },
      formatResponse: outcome => (outcome.ok
        ? { status: 200, body: { status: 'ok', closing: (outcome.data as { closing: unknown }).closing } }
        : { status: outcome.code === 'PERIOD_LOCKED' ? 409 : outcome.status, body: { error: outcome.message } }),
    });
  });

  router.get('/stock-closing', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), async (req, res) => {
    const parsed = z.object({ workspaceId: z.string().min(1).max(200), asOf: day.optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Say the workspace and, optionally, the day (YYYY-MM-DD)' });
    // requireWorkspaceRole checked the body's workspace before the query's: read only the one it checked
    const bodyWs = (req.body as { workspaceId?: unknown } | undefined)?.workspaceId;
    if (bodyWs !== undefined && bodyWs !== parsed.data.workspaceId) return res.status(400).json({ error: 'The workspace in the body and in the address differ' });
    try {
      const db = getDb();
      const ws = (await db.collection('workspaces').doc(parsed.data.workspaceId).get()).data() || {};
      const today = formatTzDate(new Date(), typeof ws.timezone === 'string' ? ws.timezone : 'UTC');
      res.json({ status: 'ok', ...(await stockCheckReport(db, { ...parsed.data, today, currency: typeof ws.currency === 'string' ? ws.currency : 'USD' })) });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });
}
