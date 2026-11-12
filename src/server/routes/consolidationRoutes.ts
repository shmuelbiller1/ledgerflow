import express from 'express';
import { z } from 'zod';
import { assertWorkspaceAccess, getDb } from '../db/firestore';
import { requestUser } from '../auth/requestUser';
import { getWorkspaceUserRole } from './workspaceRoutes';
import { buildSelfProvingEliminations, computeMultiEntityCloseStatus } from '../../lib/selfBalancingDimensions';
import { writeServerAuditLog } from '../services/auditLogService';
import type { Transaction, Workspace } from '../../types';

export const consolidationRouter = express.Router();

const eliminateBodySchema = z.object({
  workspaceId: z.string().min(1),
  entityWorkspaceIds: z.array(z.string().min(1)).min(1).max(50),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'asOfDate must be YYYY-MM-DD').optional(),
  reportingCurrency: z.string().min(3).max(8).optional(),
  exchangeRates: z.record(z.string(), z.number().positive()).optional(),
});

/**
 * Strategy 2 — Self-Proving Multi-Entity Intercompany Elimination & Close-Status Verification.
 * Replaces the legacy 501 stub with cryptographic bilateral matching across authorized entity books.
 */
consolidationRouter.post('/eliminate', async (req, res) => {
  try {
    const user = requestUser(req);
    const primaryWorkspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
    if (!primaryWorkspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const db = getDb();
    if (user.developerWorkspaceId && user.developerWorkspaceId !== primaryWorkspaceId) {
      return res.status(403).json({ error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
    }
    await assertWorkspaceAccess(db, primaryWorkspaceId, user);
    if (!user.admin) {
      const role = await getWorkspaceUserRole(db, primaryWorkspaceId, user.uid);
      if (!['owner', 'accountant', 'bookkeeper'].includes(role)) {
        return res.status(403).json({ error: 'Only owners, accountants and bookkeepers can run intercompany eliminations' });
      }
    }

    const parsed = eliminateBodySchema.safeParse({
      ...req.body,
      entityWorkspaceIds: Array.isArray(req.body?.entityWorkspaceIds)
        ? req.body.entityWorkspaceIds
        : undefined,
    });
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid elimination request', details: parsed.error.issues });
    }

    const entityIds = [...new Set([parsed.data.workspaceId, ...parsed.data.entityWorkspaceIds])];
    if (user.developerWorkspaceId && entityIds.some(id => id !== user.developerWorkspaceId)) {
      return res.status(403).json({ error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
    }
    const entityData: Array<{ workspace: Workspace; transactions: Transaction[] }> = [];

    for (const entityId of entityIds) {
      const { data: wsData } = await assertWorkspaceAccess(db, entityId, user);
      if (!user.admin) {
        const subRole = await getWorkspaceUserRole(db, entityId, user.uid);
        if (!['owner', 'accountant', 'bookkeeper'].includes(subRole)) {
          return res.status(403).json({ error: 'Only owners, accountants and bookkeepers can run intercompany eliminations' });
        }
      }
      const txSnap = await db.collection('transactions').where('workspaceId', '==', entityId).get();
      const txs = txSnap.docs.map(d => ({ ...(d.data() as Transaction), id: d.id }));
      entityData.push({
        workspace: { ...(wsData as Workspace), id: entityId },
        transactions: txs,
      });
    }

    const effectiveDate = parsed.data.asOfDate || new Date().toISOString().slice(0, 10);
    const primaryCurrency = entityData[0]?.workspace?.currency || 'USD';
    const translation = {
      reportingCurrency: parsed.data.reportingCurrency || primaryCurrency,
      exchangeRates: parsed.data.exchangeRates,
    };
    const report = buildSelfProvingEliminations(
      entityData.map(e => ({ workspaceId: e.workspace.id, currency: e.workspace.currency, transactions: e.transactions })),
      effectiveDate,
      translation,
    );
    const closeStatus = computeMultiEntityCloseStatus(entityData, effectiveDate, translation);

    await writeServerAuditLog({
      workspaceId: primaryWorkspaceId,
      uid: user.uid,
      email: user.email || '',
      action: 'CONSOLIDATION_ELIMINATIONS_VERIFIED',
      entityType: 'consolidation',
      entityId: primaryWorkspaceId,
      details: {
        description: `Verified intercompany eliminations across ${entityIds.length} entities as of ${effectiveDate}`,
        entityWorkspaceIds: entityIds,
        asOfDate: effectiveDate,
        selfProving: report.selfProving,
        matchedCount: report.matchedCount,
        discrepancyCount: report.discrepancyCount,
        totalEliminatedCents: report.totalEliminatedCents,
      },
    }, { db });

    return res.json({
      status: 'ok',
      report,
      closeStatus,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a member|Forbidden|Unauthorized/i.test(message)) {
      return res.status(403).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
});

consolidationRouter.get('/close-status', async (req, res) => {
  try {
    const user = requestUser(req);
    const workspaceId = typeof req.query?.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
    const periodEnd = typeof req.query?.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOfDate)
      ? req.query.asOfDate
      : new Date().toISOString().slice(0, 10);
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId query parameter is required' });
    }
    const db = getDb();
    if (user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
      return res.status(403).json({ error: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}` });
    }
    const { data: wsData } = await assertWorkspaceAccess(db, workspaceId, user);
    const txSnap = await db.collection('transactions').where('workspaceId', '==', workspaceId).get();
    const txs = txSnap.docs.map(d => ({ ...(d.data() as Transaction), id: d.id }));
    const closeStatus = computeMultiEntityCloseStatus(
      [{ workspace: { ...(wsData as Workspace), id: workspaceId }, transactions: txs }],
      periodEnd,
    );
    return res.json({ status: 'ok', closeStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a member|Forbidden|Unauthorized/i.test(message)) {
      return res.status(403).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
});
