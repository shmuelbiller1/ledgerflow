import express from 'express';
import { assertWorkspaceAccess, getDb } from '../db/firestore';
import { errorMessage, requestUser } from '../auth/requestUser';
import { computeMultiEntityCloseStatus } from '../../lib/selfBalancingDimensions';
import { consolidationRoleError, consolidationVerifyCommand } from '../commands/consolidation';
import { executeCommand } from '../utils/commandExecutor';
import type { Transaction, Workspace } from '../../types';

export const consolidationRouter = express.Router();

/** Strategy 2: verification is audited, but posts no entries. Keep the original response. */
consolidationRouter.post('/eliminate', async (req, res) => {
  const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
  await executeCommand(req, res, {
    definition: consolidationVerifyCommand,
    workspaceId,
    input: req.body,
    legacyRoute: true,
    legacyOperationId: 'ignore',
    formatResponse(outcome) {
      if (outcome.ok) {
        const { report, closeStatus } = outcome.data as Awaited<ReturnType<typeof consolidationVerifyCommand.handler>>;
        return { status: 200, body: { status: 'ok', report, closeStatus } };
      }
      if (outcome.code === 'INVALID_INPUT') return { status: 400, body: { error: 'Invalid elimination request', details: outcome.details } };
      if (outcome.code === 'ROLE_REQUIRED') return { status: 403, body: { error: consolidationRoleError } };
      if (outcome.code === 'NOT_A_MEMBER') return { status: 403, body: { error: 'Unauthorized: You are not a member of this workspace.' } };
      if (outcome.code === 'WORKSPACE_NOT_FOUND') return { status: 400, body: { error: 'Workspace not found.' } };
      if (outcome.status >= 500) return { status: 400, body: { error: errorMessage(outcome.error) } };
      return { status: outcome.status, body: { error: outcome.message } };
    },
  });
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
