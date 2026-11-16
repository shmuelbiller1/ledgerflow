import express from 'express';
import { z } from 'zod';
import { getDb, validateWorkspaceMember } from '../../db/firestore';
import { writeServerAuditLog } from '../../services/auditLogService';
import { executeCommand } from '../../utils/commandExecutor';
import type { CommandExecutionOutcome, CommandInvocation } from '../../commands/types';
import {
  periodBalancesRebuildCommand,
  periodCloseCommand,
  periodFxRevaluationCommand,
  periodFxRevaluationUndoCommand,
  periodYearCloseCommand,
  fiscalYearStart,
} from '../../commands/periods';
import { errorMessage, requestUser } from '../../auth/requestUser';
import { FxRevaluationError, revaluateForeignBalances } from '../../services/fxRevaluationService';
import { listClosings } from '../../services/periodClosingService';

const revaluationBodySchema = z.object({
  workspaceId: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** today's rates may be fetched when missing; historical month-ends require each rate to be supplied */
  rates: z.record(z.string(), z.number().positive()).optional(),
}).strict();

/** What an error costs the caller: the service's own status and the plain sentence to show. */
function revaluationError(res: express.Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ status: 'error', message: 'This needs the workspace to revalue, and a date as YYYY-MM-DD if you name one.' });
    return;
  }
  if (err instanceof FxRevaluationError) {
    res.status(err.status).json({ status: 'error', message: err.message });
    return;
  }
  res.status(500).json({ status: 'error', message: 'The revaluation could not be run.', details: errorMessage(err) });
}

function revaluationRoute(dryRun: boolean) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const parsed = revaluationBodySchema.parse(req.body);
      const user = requestUser(req);
      const result = await revaluateForeignBalances(getDb(), {
        workspaceId: parsed.workspaceId,
        user: { uid: user.uid, email: user.email, admin: user.admin },
        date: parsed.date,
        rates: parsed.rates,
        dryRun,
      });
      res.json({ status: 'ok', ...result });
    } catch (err) {
      revaluationError(res, err);
    }
  };
}

function revaluationCommandResponse(outcome: CommandExecutionOutcome, action: 'run' | 'undo') {
  if (outcome.ok) return { status: 200, body: { status: 'ok', ...(outcome.data as Record<string, unknown>) } };
  if (outcome.error instanceof z.ZodError || outcome.code === 'WORKSPACE_REQUIRED') {
    return { status: 400, body: { status: 'error', message: 'This needs the workspace to revalue, and a date as YYYY-MM-DD if you name one.' } };
  }
  if (outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER') {
    return {
      status: 403,
      body: { status: 'error', message: action === 'run' ? 'Only owners and accountants run the currency revaluation' : 'Only owners and accountants undo a currency revaluation' },
    };
  }
  if (outcome.code === 'WORKSPACE_NOT_FOUND') return { status: 404, body: { status: 'error', message: 'Workspace not found' } };
  if (outcome.error instanceof FxRevaluationError) {
    return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
  }
  if (outcome.status >= 500) {
    return { status: outcome.status, body: { status: 'error', message: 'The revaluation could not be run.', details: errorMessage(outcome.error ?? outcome.message) } };
  }
  return { status: outcome.status, body: { status: 'error', message: outcome.message } };
}

function revaluationInvocation(definition: CommandInvocation['definition'], workspaceId: string, input: unknown, action: 'run' | 'undo'): CommandInvocation {
  return { definition, workspaceId, input, formatResponse: outcome => revaluationCommandResponse(outcome, action) };
}

export { fiscalYearStart };

/** Adapt the legacy hard-close endpoint to the shared period command and its established wire shape. */
export function closeMonthInvocation(workspaceId: string, month: string): CommandInvocation {
  return {
    definition: periodCloseCommand,
    workspaceId,
    input: { month, mode: 'hard' },
    formatResponse(outcome: CommandExecutionOutcome) {
      if (outcome.ok) {
        const result = outcome.data as { lockDate: string };
        return {
          status: 200,
          body: {
            status: 'ok', month,
            closingDate: result.lockDate,
            lockDate: result.lockDate,
            message: `Period ${month} locked through ${result.lockDate}.`,
          },
        };
      }
      const message = outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER'
        ? 'Only owner or accountant can close a period'
        : outcome.status >= 500
          ? outcome.error instanceof Error ? outcome.error.message : outcome.error === undefined ? outcome.message : String(outcome.error)
          : outcome.message;
      return {
        status: outcome.status,
        body: { error: message, ...(outcome.details !== undefined ? { details: outcome.details } : {}) },
      };
    },
  };
}

/** Period work: currency revaluation, year-end and month-end close, workspace reset. Part of /api/v1/transactions (F-06), registered in the original order. */
export function registerPeriodRoutes(transactionRouter: express.Router): void {
  // ==========================================
  // MONTH-END CURRENCY REVALUATION (R-07)
  // ==========================================
  // The entry a period end needs: the open foreign invoices and bills valued at today's rate, the
  // difference against an unrealized FX gain/loss account, and its reversal the next day so the
  // documents keep their own rates. preview posts nothing; run posts both. Every rule — which
  // documents, which accounts, when nothing is posted at all — is in the service and in
  // src/lib/fxRevaluation.ts, where it is tested.
  //
  // What used to be here (behind LF_ENABLE_LEGACY_REVALUATION) applied one rate to every asset and
  // liability account, home-currency ones included, on invented rates when the rate service was down
  // (L-187). It is gone: the flag no longer means anything.
  transactionRouter.post('/revaluation/preview', revaluationRoute(true));
  transactionRouter.post('/revaluation/run', async (req, res) => {
    try {
      const parsed = revaluationBodySchema.parse(req.body);
      await executeCommand(req, res, revaluationInvocation(
        periodFxRevaluationCommand, parsed.workspaceId, { date: parsed.date, rates: parsed.rates }, 'run',
      ));
    } catch (err) {
      revaluationError(res, err);
    }
  });
  transactionRouter.post('/revaluation/undo', async (req, res) => {
    try {
      const parsed = revaluationBodySchema.parse(req.body);
      await executeCommand(req, res, revaluationInvocation(
        periodFxRevaluationUndoCommand, parsed.workspaceId, { date: parsed.date }, 'undo',
      ));
    } catch (err) {
      revaluationError(res, err);
    }
  });

  transactionRouter.post('/close-year', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
    const { workspaceId, closingDate, lockPeriod } = body;
    if (!workspaceId || !closingDate) {
      return res.status(400).json({ error: 'Missing required parameters: workspaceId and closingDate (YYYY-MM-DD).' });
    }
    await executeCommand(req, res, {
      definition: periodYearCloseCommand,
      workspaceId: typeof workspaceId === 'string' ? workspaceId : '',
      input: { closingDate, lockPeriod },
      formatResponse(outcome) {
        if (outcome.ok) {
          const result = outcome.data as { yearStart: string; closingDate: string; lockPeriod: boolean; year: { netIncome: number }; closingVersion: number | null };
          return {
            status: 200,
            body: {
              status: 'ok',
              message: `Year ${result.yearStart} – ${result.closingDate} closed. Its net ${result.year.netIncome >= 0 ? 'profit' : 'loss'} of ${(Math.abs(result.year.netIncome) / 100).toFixed(2)} is carried in retained earnings on the balance sheet${result.lockPeriod ? ', and the year is locked' : ''}.`,
              netIncomeCents: result.year.netIncome,
              yearStart: result.yearStart,
              closingVersion: result.closingVersion,
            },
          };
        }
        if (outcome.code === 'WORKSPACE_NOT_FOUND') return { status: 404, body: { error: 'Workspace not found.' } };
        if (outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER') {
          return { status: 403, body: { error: 'Forbidden: Insufficient permissions to execute fiscal year close.' } };
        }
        if (outcome.code === 'INVALID_INPUT') {
          return { status: 400, body: { error: 'Missing required parameters: workspaceId and closingDate (YYYY-MM-DD).' } };
        }
        const error = outcome.error;
        return { status: outcome.status, body: { error: error instanceof Error ? error.message : outcome.message } };
      },
    });
  });

  // EG-3: the period-closing documents, every version (superseded ones too), read-only; any member, a viewer too
  transactionRouter.get('/period-closings', async (req, res) => {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    if (!workspaceId) return res.status(400).json({ error: 'Missing required parameter: workspaceId.' });
    const db = getDb();
    try {
      await validateWorkspaceMember(db, workspaceId, requestUser(req));
    } catch (err) {
      return /not found/i.test(errorMessage(err)) ? res.status(404).json({ error: 'Workspace not found.' }) : res.status(403).json({ error: 'Forbidden' });
    }
    try {
      res.json({ status: 'ok', closings: await listClosings(db, workspaceId) });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });

  // L-123: the named command rebuilds missing closed-year and stale snapshots in the runner transaction;
  // keep the historical URL and response shape for existing clients.
  transactionRouter.post('/period-balances/rebuild', async (req, res) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!workspaceId) return res.status(400).json({ error: 'Missing required parameter: workspaceId.' });
    await executeCommand(req, res, {
      definition: periodBalancesRebuildCommand,
      workspaceId,
      input: {},
      formatResponse(outcome) {
        if (outcome.ok) {
          const result = outcome.data as { built: string[] };
          return { status: 200, body: { status: 'ok', built: result.built } };
        }
        if (outcome.code === 'WORKSPACE_NOT_FOUND') return { status: 404, body: { error: 'Workspace not found.' } };
        if (outcome.code === 'ROLE_REQUIRED' || outcome.code === 'NOT_A_MEMBER') {
          return { status: 403, body: { error: 'Only the owner can recalculate the opening balances.' } };
        }
        return {
          status: outcome.status,
          body: { error: outcome.error instanceof Error ? outcome.error.message : outcome.message },
        };
      },
    });
  });

  // Hard close through the end of a month. Same service as the Month-End Close screen
  // (src/server/services/periodCloseService.ts): owner/accountant only, refused while drafts are
  // dated in the period, audited. The year-end closing entry is /close-year.
  transactionRouter.post('/close-month', async (req, res) => {
    const { workspaceId, month } = (req.body || {}) as { workspaceId?: string; month?: string };
    if (!workspaceId || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Missing or invalid parameters: workspaceId and month (YYYY-MM) required.' });
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'Month must be YYYY-MM' });
    }
    await executeCommand(req, res, closeMonthInvocation(workspaceId, month));
  });

  transactionRouter.post('/reset', async (req, res) => {
    try {
      const { workspaceId, confirmReset } = req.body;
      const user = requestUser(req);
      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
    
      // Only the workspace owner or a global admin can completely reset the workspace data
      if (!wsDoc.exists || (wsDoc.data()?.uid !== user.uid && !user.admin)) {
        return res.status(403).json({ error: 'Forbidden: Only the workspace owner or a global admin can reset data.' });
      }

      if (confirmReset !== true) {
        return res.status(400).json({ error: 'Explicit confirmation required (confirmReset: true).' });
      }
      // Real books are never wiped on the spot: delete the workspace instead (30-day window, then
      // purge). Only a workspace holding demo data can be emptied at once.
      if (wsDoc.data()?.isDemoLoaded !== true) {
        return res.status(409).json({ error: 'Only demo data can be cleared at once. To remove real books, delete the workspace (Settings → Security): it is kept for 30 days first.' });
      }

      // Never wipe auditLogs - the audit trail must be preserved
      const collections = [
        'transactions', 'chartAccounts', 'projects', 'budgets', 
        'vendors', 'customers', 'invoices', 'bills', 
        'inventory', 'assets', 'recurring', 'employees', 'payRuns', 
        'taxRates', 'partners', 'autoRules', 'bankLines'
      ];

      for (const coll of collections) {
        let hasMore = true;
        while (hasMore) {
          const snapshot = await db.collection(coll)
            .where('workspaceId', '==', workspaceId)
            .limit(500)
            .get();

          if (snapshot.empty) {
            hasMore = false;
            break;
          }

          const batch = db.batch();
          snapshot.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      // Record persistent audit log of the reset action
      await writeServerAuditLog({
        workspaceId,
        uid: user.uid,
        email: user.email || 'authenticated-user',
        action: 'WORKSPACE_DATA_RESET',
        entityType: 'workspace',
        entityId: workspaceId,
        details: {
          description: 'All financial and operational records reset by workspace owner.'
        }
      }, { db });

      res.json({ status: 'ok' });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
  });
}
