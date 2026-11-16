import express from 'express';
import { z } from 'zod';
import { calculateNetIncome } from '../../../lib/txFilters';
import type { Transaction } from '../../../types';
import { getDb, validateWorkspaceMember } from '../../db/firestore';
import { writeServerAuditLog } from '../../services/auditLogService';
import { executeCommand } from '../../utils/commandExecutor';
import type { CommandExecutionOutcome, CommandInvocation } from '../../commands/types';
import { periodCloseCommand } from '../../commands/periods';
import { errorMessage, requestUser } from '../../auth/requestUser';
import { FxRevaluationError, revaluateForeignBalances, undoRevaluation } from '../../services/fxRevaluationService';
import { formatTzDate } from './helpers';
import { listClosings, periodClosingsReady, readClosings, writeClosing } from '../../services/periodClosingService';
import { periodBalancesReady, readSnapshotInputs, rebuildSnapshots, snapshotFromEntries, writeSnapshot } from '../../services/balanceService';

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

/** The day after the same date one year earlier: the first day of the year ending on `closingDate`. */
export function fiscalYearStart(closingDate: string): string {
  const [y, md] = [Number(closingDate.slice(0, 4)), closingDate.slice(5)];
  const yearBefore = Date.parse(`${y - 1}-${md}T00:00:00Z`);
  const base = Number.isNaN(yearBefore) || new Date(yearBefore).toISOString().slice(5, 10) !== md ? Date.parse(`${y - 1}-02-28T00:00:00Z`) : yearBefore;
  return new Date(base + 86400000).toISOString().slice(0, 10);
}

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
  transactionRouter.post('/revaluation/run', revaluationRoute(false));
  transactionRouter.post('/revaluation/undo', async (req, res) => {
    try {
      const { workspaceId, date } = revaluationBodySchema.parse(req.body);
      const user = requestUser(req);
      const result = await undoRevaluation(getDb(), { workspaceId: String(workspaceId), user: { uid: user.uid, email: user.email, admin: user.admin }, date: String(date || '') });
      res.json({ status: 'ok', ...result });
    } catch (err) {
      return revaluationError(res, err);
    }
  });

  transactionRouter.post('/close-year', async (req, res) => {
    try {
      const { workspaceId, closingDate, lockPeriod } = req.body;
      const user = requestUser(req);
      if (!workspaceId || !closingDate) {
        return res.status(400).json({ error: 'Missing required parameters: workspaceId and closingDate (YYYY-MM-DD).' });
      }

      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists) {
        return res.status(404).json({ error: 'Workspace not found.' });
      }

      const wsData = wsDoc.data();
      const isOwnerOrAdmin = wsData?.uid === user.uid || user.admin;
      if (!isOwnerOrAdmin) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions to execute fiscal year close.' });
      }

      // Check if period is already locked past or on this date
      if (wsData?.lockDate && wsData.lockDate >= closingDate) {
        return res.status(400).json({ error: `Cannot close year: Period is already locked through ${wsData.lockDate}.` });
      }

      const today = formatTzDate(new Date(), wsData?.timezone);
      if (closingDate > today) {
        return res.status(400).json({ error: `Cannot close future accounting period. Closing date (${closingDate}) is ahead of current date (${today}).` });
      }

      // The year's profit, for the record: the twelve months ending on the closing date.
      // No closing entry is posted (CA-07): the balance sheet already carries every past year's profit
      // in retained earnings, and an entry moving revenue and expenses to retained earnings made the
      // closed year's profit and loss show zero. Closing a year locks it (when asked) and records it.
      // L-123: a locked close also writes the year end's balance snapshot, in the same serializable
      // transaction that moves the lock date, from the same entries (everything is returned from the
      // callback, so a retried attempt starts afresh).
      const yearStart = fiscalYearStart(closingDate);
      const withSnapshot = Boolean(lockPeriod) && await periodBalancesReady(db);
      // EG-3: and the closing document, from the same entries in the same transaction (no entry is posted)
      const withClosing = Boolean(lockPeriod) && await periodClosingsReady(db);
      const { year, locked, closingVersion } = await db.runTransaction(async (t) => {
        const wsNow = (await t.get(db.collection('workspaces').doc(workspaceId))).data() || {};
        if (wsNow.lockDate && wsNow.lockDate >= closingDate) return { year: null, locked: String(wsNow.lockDate), closingVersion: null };
        const { accounts, entries } = await readSnapshotInputs(db, t, workspaceId, closingDate);
        const transactions = entries as Transaction[];
        const stored = withClosing ? await readClosings(db, t, workspaceId) : [];
        const yearFigures = calculateNetIncome(transactions, accounts, yearStart, closingDate);
        if (lockPeriod) {
          t.update(db.collection('workspaces').doc(workspaceId), { lockDate: closingDate, updatedAt: new Date().toISOString() });
          const snapshot = snapshotFromEntries(workspaceId, closingDate, accounts, entries, user.uid);
          if (withSnapshot) writeSnapshot(db, t, snapshot);
          if (withClosing) {
            const closing = writeClosing(db, t, stored, { workspaceId, yearStart, yearEnd: closingDate, accounts, entries: transactions, snapshot, uid: user.uid, email: user.email, at: new Date().toISOString() });
            return { year: yearFigures, locked: null, closingVersion: closing.version };
          }
        }
        return { year: yearFigures, locked: null, closingVersion: null };
      });
      if (!year) {
        return res.status(400).json({ error: `Cannot close year: Period is already locked through ${locked}.` });
      }

      await writeServerAuditLog({
        workspaceId,
        uid: user.uid,
        email: user.email || 'authenticated-user',
        action: 'FISCAL_YEAR_CLOSE',
        entityType: 'workspace',
        entityId: workspaceId,
        details: {
          description: `Year ${yearStart} – ${closingDate} closed: net ${year.netIncome >= 0 ? 'profit' : 'loss'} of ${(Math.abs(year.netIncome) / 100).toFixed(2)} (income ${(year.income / 100).toFixed(2)}, costs ${((year.cogs + year.expense) / 100).toFixed(2)}), carried in retained earnings on the balance sheet${lockPeriod ? '; the year is locked' : ''}.`,
          closingDate,
          yearStart,
          netIncomeCents: year.netIncome,
          incomeCents: year.income,
          costsCents: year.cogs + year.expense,
          lockPeriod: !!lockPeriod,
        }
      }, { db });

      res.json({
        status: 'ok',
        message: `Year ${yearStart} – ${closingDate} closed. Its net ${year.netIncome >= 0 ? 'profit' : 'loss'} of ${(Math.abs(year.netIncome) / 100).toFixed(2)} is carried in retained earnings on the balance sheet${lockPeriod ? ', and the year is locked' : ''}.`,
        netIncomeCents: year.netIncome,
        yearStart,
        closingVersion,
      });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
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

  // L-123: "Recalculate opening balances": the snapshots of years closed before L-123, and every stale one,
  // rebuilt by the server (balanceService.rebuildSnapshots). Owners and platform admins, like /close-year.
  transactionRouter.post('/period-balances/rebuild', async (req, res) => {
    try {
      const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
      const user = requestUser(req);
      if (!workspaceId) return res.status(400).json({ error: 'Missing required parameter: workspaceId.' });
      const db = getDb();
      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists) return res.status(404).json({ error: 'Workspace not found.' });
      if (wsDoc.data()?.uid !== user.uid && !user.admin) return res.status(403).json({ error: 'Only the owner can recalculate the opening balances.' });
      res.json({ status: 'ok', ...(await rebuildSnapshots(db, workspaceId, user.uid)) });
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) });
    }
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
