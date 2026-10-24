import express from 'express';
import { z } from 'zod';
import { errorMessage, requestUser } from '../auth/requestUser';
import { getDb } from '../db/firestore';
import { formatTzDate } from '../../lib/utils';
import { requireWorkspaceRole } from './workspaceRoutes';
import { stockCheckReport, StockClosingError, writeStockClosing } from '../services/stockClosingService';

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
    try {
      const closing = await writeStockClosing(getDb(), { ...parsed.data, uid: requestUser(req).uid });
      res.json({ status: 'ok', closing });
    } catch (e) {
      if (e instanceof StockClosingError) return res.status(e.status).json({ error: e.message });
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  router.get('/stock-closing', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), async (req, res) => {
    const parsed = z.object({ workspaceId: z.string().min(1).max(200), asOf: day.optional() }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Say the workspace and, optionally, the day (YYYY-MM-DD)' });
    try {
      const db = getDb();
      const ws = (await db.collection('workspaces').doc(parsed.data.workspaceId).get()).data() || {};
      const today = formatTzDate(new Date(), typeof ws.timezone === 'string' ? ws.timezone : 'UTC');
      res.json({ status: 'ok', ...(await stockCheckReport(db, { ...parsed.data, today })) });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });
}
