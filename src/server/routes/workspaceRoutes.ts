import { errorMessage, requestUser } from '../auth/requestUser';
import { notify } from '../services/notificationService';
import express from 'express';
import type { DecodedIdToken } from '../auth/supabaseAuth';
import { z } from 'zod';
import { getDb, validateWorkspaceMember, type Firestore } from '../db/firestore';
import { writeServerAuditLog } from '../services/auditLogService';
import { applyAccountTemplate, TemplateError } from '../services/templateService';
import { importRecords, undoImport, ImportError } from '../services/recordImportService';
import { IMPORT_KINDS, MAX_IMPORT_ROWS } from '../../lib/recordImport';
import { periodRouter } from './periodRoutes';
import { returnAuthorizationRouter } from './returnAuthorizationRoutes';
import { badDebtRouter } from './badDebtRoutes';
import { prepaidRouter, revenueSpreadRouter } from './prepaidRoutes';
import { attachmentRouter } from './attachmentRoutes';
import { incomingEventRouter } from './incomingEventRoutes';
import { tagRouter } from './tagRoutes';
import { journalTemplateRouter } from './journalTemplateRoutes';
import { reportScheduleRouter } from './reportScheduleRoutes';
import { portalLinkRouter } from './customerPortalRoutes';
import { signLinkRouter } from './estimateSignRoutes';
import { mountTeamRoutes } from './taskRoutes';
import { clientQueryRouter } from './clientQueryRoutes';
import { accountMergeRouter } from './accountMergeRoutes';
import { assetDisposalRouter } from './assetDisposalRoutes';
import { assetTransferRouter } from './assetTransferRoutes';
import { placeInServiceRouter } from './placeInServiceRoutes';
import { payRunRouter } from './payRunRoutes';
import { twoStepPolicyRouter } from './twoStepPolicyRoutes';
import { AlertSettingsError } from '../services/bookAlertService';
import { alertSettingsUpdateCommand } from '../commands/alerts';
import { importMapSaveCommand } from '../commands/importMaps';
import { workspaceInviteRevokeCommand, WorkspaceInviteError } from '../commands/workspaceInvites';
import { workspaceCancelDeletionCommand, WorkspaceLifecycleError } from '../commands/workspaceLifecycle';
import {
  workspaceModulesCommand,
  workspaceNextNumberCommand,
  workspaceOpeningBalancesCommand,
  workspaceRetentionCommand,
  workspaceSetupCompleteCommand,
} from '../commands/workspaceSettings';
import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';
import { emailRouter } from './emailRoutes';
import { taxRouter } from './taxRoutes';
import { brandingRouter } from './brandingRoutes';
import { contactMergeRouter } from './contactMergeRoutes';
import { numberingRouter } from './numberingRoutes';
import { NUMBERED_TYPES } from '../services/numberingService';
import { retentionFor, scheduledPurgeAt as purgeDate } from '../../lib/retention';
import { RetentionError } from '../services/retentionService';
import { budgetControlRouter } from './budgetControlRoutes';
import { SetupError } from '../services/openingBalanceService';
import { ModuleSettingError, moduleRecords } from '../services/moduleService';
import { allocationRuleRouter, priceListRouter, salesRepRouter, roleDashboardRouter, approvalDelegateRouter, taxProfileRouter, paymentTypeRouter, customerGroupRouter } from './savedListRoutes';
import { workspaceUsage } from '../middleware/planCapacity';
import { planFor } from '../../lib/plans';

export const workspaceRouter = express.Router();

interface AuthUser extends DecodedIdToken {
  email_verified: boolean;
}

export interface AuthenticatedRequest extends express.Request {
  user: AuthUser;
}

function sendError(res: express.Response, message: string, status: number = 500, details?: unknown) {
  res.status(status).json({ status: 'error', message, ...(details ? { details } : {}) });
}

/**
 * Middleware helper for checking per-workspace user role.
 */
export async function getWorkspaceUserRole(db: Firestore, workspaceId: string, uid: string): Promise<string> {
  const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) throw new Error('NOT_FOUND');
  const data = wsDoc.data() || {};
  if (data.uid === uid) return 'owner';
  const role = data.roles?.[uid];
  return role || 'viewer';
}

export function requireWorkspaceRole(allowedRoles: string[]) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const workspaceId = req.params.workspaceId || req.body?.workspaceId || req.query.workspaceId;
    if (!workspaceId) return sendError(res, "Workspace ID required", 400);
    // one workspace is checked: a request naming two different ones is refused, so the checked one is the one used (#375)
    if (new Set([req.params.workspaceId, req.body?.workspaceId, req.query.workspaceId].filter(v => v !== undefined && v !== null && v !== '').map(String)).size > 1) return sendError(res, 'The request names two different workspaces', 400);

    try {
      const db = getDb();
      await validateWorkspaceMember(db, String(workspaceId), authReq.user);
      const userRole = await getWorkspaceUserRole(db, String(workspaceId), authReq.user.uid);

      if (!allowedRoles.includes(userRole)) {
        return sendError(res, `Forbidden: requires one of roles [${allowedRoles.join(', ')}]`, 403);
      }

      (authReq as AuthenticatedRequest & { userRole?: string }).userRole = userRole;
      next();
    } catch (err) {
      if (errorMessage(err) === 'FORBIDDEN' || /Unauthorized|not a member/i.test(errorMessage(err) || '')) return sendError(res, 'Forbidden', 403);
      if (errorMessage(err) === 'NOT_FOUND' || /Workspace not found/i.test(errorMessage(err) || '')) return sendError(res, 'Workspace not found', 404);
      sendError(res, 'Role Authorization Error', 500, errorMessage(err));
    }
  };
}

export { allocateNextNumber } from '../services/numberingService';

/**
 * Task 5: Allocate next document number atomically within Firestore transaction.
 * POST only to prevent prefetching/crawlers from mutating state (Finding E).
 */
// Apply a chart-of-accounts template on the server (templateService): owners and accountants
// manage the chart of accounts; the dashboard layout comes only from built-in templates.
const applyTemplateSchema = z.object({
  templateId: z.string().min(1).max(100).optional(),
  accounts: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
}).refine(b => Boolean(b.templateId) !== Boolean(b.accounts), 'Send either templateId or accounts');

workspaceRouter.post('/:workspaceId/apply-template', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const body = applyTemplateSchema.parse(req.body);
    const result = await applyAccountTemplate(getDb(), { workspaceId, uid: (req as AuthenticatedRequest).user.uid, ...body });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return sendError(res, 'Invalid template request', 400, err.issues);
    if (err instanceof TemplateError) return sendError(res, errorMessage(err), err.status);
    sendError(res, 'Could not apply the template', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

// Saved CSV column layouts for statement imports (src/lib/importColumnMaps.ts), keyed by the
// file's header signature. Keep the legacy address and response while the named command owns the
// schema, transaction, idempotency, and audit entry.
workspaceRouter.post('/:workspaceId/import-maps', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  await executeCommand(req, res, {
    definition: importMapSaveCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success' } };
      if (outcome.error instanceof z.ZodError) {
        return { status: 400, body: { status: 'error', message: 'Invalid column layout', details: outcome.error.issues } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: 500,
          body: {
            status: 'error',
            message: 'Could not save the column layout',
            details: error instanceof Error ? errorMessage(error) : String(error || outcome.message),
          },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

// Closing the books: close / reopen / partial unlock / sign-offs (src/server/routes/periodRoutes.ts)
workspaceRouter.use('/:workspaceId/periods', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), periodRouter);
workspaceRouter.use('/:workspaceId/return-authorizations', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), returnAuthorizationRouter);
// Emails to customers and their send log (src/server/routes/emailRoutes.ts)
workspaceRouter.use('/:workspaceId/emails', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), emailRouter);
// Tax returns: members see them; filing checks owner/accountant in taxReturnService.ts
workspaceRouter.use('/:workspaceId/tax-returns', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), taxRouter);
workspaceRouter.use('/:workspaceId/branding', requireWorkspaceRole(['owner', 'accountant']), brandingRouter);
// Spread an invoice's income over months (K-16); before the bad-debt mount, whose role check covers every /invoices path
workspaceRouter.use('/:workspaceId/invoices', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), revenueSpreadRouter);
// Bad debt write-off and its reversal (src/server/routes/badDebtRoutes.ts)
workspaceRouter.use('/:workspaceId/invoices', requireWorkspaceRole(['owner', 'accountant']), badDebtRouter);
// Spread a bill's expense over months, and undo it (src/server/routes/prepaidRoutes.ts, K-17)
workspaceRouter.use('/:workspaceId/bills', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), prepaidRouter);
// merging is checked again for owner/accountant in the service; deleting is for every writer
workspaceRouter.use('/:workspaceId/contacts', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), contactMergeRouter);
workspaceRouter.use('/:workspaceId/budget-control', requireWorkspaceRole(['owner']), budgetControlRouter); // EG-4
workspaceRouter.use('/:workspaceId/numbering', requireWorkspaceRole(['owner', 'accountant']), numberingRouter);
// Remove a file kept with a record (K-07). Every member reaches it; who may remove which file is checked in the route
workspaceRouter.use('/:workspaceId/attachments', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), attachmentRouter);
// What Stripe and the email provider told us about this workspace (K-37): read only, owners and accountants
workspaceRouter.use('/:workspaceId/incoming-events', requireWorkspaceRole(['owner', 'accountant']), incomingEventRouter);
// Tags for the whole workspace (K-15): members read; writers rename, merge and remove (checked in the route)
workspaceRouter.use('/:workspaceId/tags', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), tagRouter);
// Customer portal links (K-27): writers create or turn them off (checked in the service)
workspaceRouter.use('/:workspaceId/customers/:customerId/portal-link', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), portalLinkRouter);
workspaceRouter.use('/:workspaceId/estimates/:estimateId/sign-link', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), signLinkRouter);
mountTeamRoutes(workspaceRouter, requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']));
// Scheduled reports (K-28, R-3): preview and send one now (owners and accountants); the daily job sends the rest
workspaceRouter.use('/:workspaceId/report-schedules', requireWorkspaceRole(['owner', 'accountant']), reportScheduleRouter);
// Journal entry templates (BD-09 / CA-27): members read; writers save and remove (checked in the route)
workspaceRouter.use('/:workspaceId/journal-templates', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), journalTemplateRouter);
// Questions about entries (BD-07): writers ask, every member answers (checked in the service)
workspaceRouter.use('/:workspaceId/queries', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), clientQueryRouter);
// Merging two accounts (CA-33): owners and accountants
workspaceRouter.use('/:workspaceId/chart-accounts', requireWorkspaceRole(['owner', 'accountant']), accountMergeRouter);
// Selling or scrapping a fixed asset (X-03): writers
workspaceRouter.use('/:workspaceId/assets/:assetId/disposal', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), assetDisposalRouter);
workspaceRouter.use('/:workspaceId/assets/:assetId/transfer', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), assetTransferRouter);
workspaceRouter.use('/:workspaceId/assets/:assetId/in-service', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), placeInServiceRouter);
// Pay runs posted by the server (U-02): owners and accountants
workspaceRouter.use('/:workspaceId/pay-runs', requireWorkspaceRole(['owner', 'accountant']), payRunRouter);
workspaceRouter.use('/:workspaceId/security', requireWorkspaceRole(['owner']), twoStepPolicyRouter);
// Settings → Alerts (S-08, S-10, S-11): keep the established address and response while the
// named command owns validation, role rechecks, the write transaction, retry protection, and audit.
workspaceRouter.put('/:workspaceId/alerts', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  await executeCommand(req, res, {
    definition: alertSettingsUpdateCommand,
    workspaceId: String(req.params.workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) {
        return { status: outcome.status, body: { status: 'success', alerts: (outcome.data as { alerts: unknown }).alerts } };
      }
      if (outcome.error instanceof z.ZodError) {
        return { status: 400, body: { status: 'error', message: 'Those alert settings are not in the expected form' } };
      }
      if (outcome.error instanceof AlertSettingsError) {
        return { status: outcome.error.status, body: { status: 'error', message: outcome.error.message } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: {
            status: 'error',
            message: 'The alerts could not be saved',
            details: error instanceof Error ? error.message : String(error || outcome.message),
          },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

// Bulk import of customers, vendors, items or accounts from a spreadsheet (K-01; rules in
// src/lib/recordImport.ts). Writers may import; the chart of accounts is owner/accountant only.
const importRecordsSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  rows: z.array(z.record(z.string(), z.string().max(5000))).min(1).max(MAX_IMPORT_ROWS),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dryRun: z.boolean().optional(),
}).strict();
const LEDGER_ADMIN_ROLES = ['owner', 'accountant'];
const roleOf = (req: express.Request) => String((req as unknown as { userRole?: string }).userRole || '');

/** L-15: what the workspace uses against its plan (entries, people, storage), for any member. */
workspaceRouter.get('/:workspaceId/usage', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), async (req, res) => {
  try {
    const usage = await workspaceUsage(getDb(), String(req.params.workspaceId));
    if (!usage) return sendError(res, 'Workspace not found', 404);
    res.json({ status: 'success', usage });
  } catch (err) {
    sendError(res, 'Could not read the usage', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

// Q-05 split rules and M-11 price lists: owners and accountants (savedListRoutes.ts)
workspaceRouter.use('/:workspaceId/allocation-rules', requireWorkspaceRole(LEDGER_ADMIN_ROLES), allocationRuleRouter);
workspaceRouter.use('/:workspaceId/price-lists', requireWorkspaceRole(LEDGER_ADMIN_ROLES), priceListRouter);
workspaceRouter.use('/:workspaceId/sales-reps', requireWorkspaceRole(LEDGER_ADMIN_ROLES), salesRepRouter);
workspaceRouter.use('/:workspaceId/tax-profiles', requireWorkspaceRole(LEDGER_ADMIN_ROLES), taxProfileRouter);
workspaceRouter.use('/:workspaceId/payment-types', requireWorkspaceRole(LEDGER_ADMIN_ROLES), paymentTypeRouter); // CC-09
workspaceRouter.use('/:workspaceId/customer-groups', requireWorkspaceRole(LEDGER_ADMIN_ROLES), customerGroupRouter); // CC-11
workspaceRouter.use('/:workspaceId/role-dashboards', requireWorkspaceRole(['owner']), roleDashboardRouter);
workspaceRouter.use('/:workspaceId/approval-delegate', requireWorkspaceRole(LEDGER_ADMIN_ROLES), approvalDelegateRouter);

/** BB-07: how many records each module holds (so a module turned off can say it still keeps them). */
workspaceRouter.get('/:workspaceId/modules/records', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper', 'viewer']), async (req, res) => {
  try {
    res.json({ status: 'success', records: await moduleRecords(getDb(), String(req.params.workspaceId)) });
  } catch (err) {
    sendError(res, 'Could not count the modules\' records', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

/** BB-07: owners and accountants turn modules on or off; nothing is deleted. */
workspaceRouter.put('/:workspaceId/modules', requireWorkspaceRole(LEDGER_ADMIN_ROLES), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceModulesCommand,
    workspaceId: String(req.params.workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) {
        return { status: outcome.status, body: { status: 'success', modules: (outcome.data as { modules: unknown }).modules } };
      }
      if (outcome.error instanceof z.ZodError) {
        return { status: 400, body: { status: 'error', message: 'Send which modules are on (true or false)', details: outcome.error.issues } };
      }
      if (outcome.error instanceof ModuleSettingError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'Could not save the modules', details: error instanceof Error ? errorMessage(error) : outcome.message },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

workspaceRouter.post('/:workspaceId/import-records', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const body = importRecordsSchema.parse(req.body);
    if (body.kind === 'accounts' && !LEDGER_ADMIN_ROLES.includes(roleOf(req))) return sendError(res, 'Only owners and accountants can change the chart of accounts', 403);
    const { user } = req as AuthenticatedRequest;
    const result = await importRecords(getDb(), { workspaceId, uid: user.uid, email: user.email, ...body });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof z.ZodError) return sendError(res, 'Invalid import request', 400, err.issues);
    if (err instanceof ImportError) return sendError(res, errorMessage(err), err.status, err.issues.length ? err.issues : undefined);
    sendError(res, 'Could not import the records', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

workspaceRouter.post('/:workspaceId/import-records/:batchId/undo', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  try {
    const { workspaceId, batchId } = req.params as Record<string, string>;
    const { user } = req as AuthenticatedRequest;
    const result = await undoImport(getDb(), { workspaceId, uid: user.uid, email: user.email, batchId, allowAccounts: LEDGER_ADMIN_ROLES.includes(roleOf(req)) });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof ImportError) return sendError(res, errorMessage(err), err.status);
    sendError(res, 'Could not undo the import', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

workspaceRouter.post('/:workspaceId/next-number', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceNextNumberCommand,
    workspaceId: String(req.params.workspaceId),
    input: { type: req.body?.type },
    formatResponse(outcome) {
      if (outcome.ok) {
        return { status: outcome.status, body: { number: (outcome.data as { number: string }).number } };
      }
      if (outcome.error instanceof z.ZodError) {
        return {
          status: 400,
          body: {
            status: 'error',
            message: `Invalid request parameters. "type" (${NUMBERED_TYPES.join(', ')}) is required in request body.`,
            details: outcome.error.issues,
          },
        };
      }
      if (outcome.status === 403) return { status: 403, body: { status: 'error', message: 'Forbidden' } };
      if (outcome.status === 404) return { status: 404, body: { status: 'error', message: 'Workspace not found' } };
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: {
            status: 'error',
            message: 'Failed to allocate next document number',
            details: error instanceof Error ? errorMessage(error) : outcome.message,
          },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

// Explicit 405 Method Not Allowed for GET/other methods on /:workspaceId/next-number
workspaceRouter.all('/:workspaceId/next-number', (req, res) => {
  res.setHeader('Allow', 'POST');
  return sendError(res, 'Method Not Allowed: allocate next document number must be called via POST.', 405);
});

import { generateInviteToken } from '../../lib/inviteManager';

export function countWorkspaceOwners(workspaceData: { uid?: string; roles?: Record<string, unknown> }): { count: number; ownerUids: string[] } {
  const ownerUids: string[] = [];
  if (workspaceData.uid) ownerUids.push(workspaceData.uid);
  if (workspaceData.roles) {
    for (const [uid, role] of Object.entries(workspaceData.roles)) {
      if (role === 'owner' && !ownerUids.includes(uid)) {
        ownerUids.push(uid);
      }
    }
  }
  return { count: ownerUids.length, ownerUids };
}

/**
 * Task 6: Get workspace user roles map
 */
workspaceRouter.get('/:workspaceId/roles', async (req, res) => {
  const authReq = req as unknown as AuthenticatedRequest;
  const { workspaceId } = req.params as Record<string, string>;

  try {
    const db = getDb();
    await validateWorkspaceMember(db, workspaceId, authReq.user);
    const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsDoc.exists) return sendError(res, 'Workspace not found', 404);
    const data = wsDoc.data() || {};
    res.json({
      status: 'success',
      ownerUid: data.uid,
      roles: data.roles || {}
    });
  } catch (err) {
    if (errorMessage(err) === 'FORBIDDEN') return sendError(res, 'Forbidden', 403);
    sendError(res, 'Failed to fetch roles', 500, errorMessage(err));
  }
});

/**
 * Update workspace user role (Owner only) - Supports POST and PATCH /:workspaceId/roles/:uid
 */
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', accountant: 'Accountant', bookkeeper: 'Bookkeeper', viewer: 'Viewer' };

const handleUpdateRole = async (req: express.Request, res: express.Response) => {
  const { workspaceId } = req.params as Record<string, string>;
  const targetUid = req.params.uid || req.body.targetUid;
  const schema = z.object({
    role: z.enum(['owner', 'accountant', 'bookkeeper', 'viewer'])
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success || typeof targetUid !== 'string' || !targetUid) return sendError(res, 'Invalid role payload or target user ID', 400, parsed.error?.issues);
  const { role } = parsed.data;

  try {
    const db = getDb();
    const wsRef = db.collection('workspaces').doc(workspaceId);

    let previousRole = 'viewer';

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(wsRef);
      if (!snap.exists) throw new Error('NOT_FOUND');
      const data = snap.data() || {};
      const { count, ownerUids } = countWorkspaceOwners(data);

      previousRole = data.roles?.[targetUid] || (data.uid === targetUid ? 'owner' : 'viewer');

      // the creator always counts as owner (workspaceRole), so never store another role for them; protect the last owner too
      if (role !== 'owner' && (data.uid === targetUid || (ownerUids.includes(targetUid) && count <= 1))) {
        throw new Error('LAST_OWNER_PROTECTION');
      }

      const roles = { ...(data.roles || {}) };
      roles[targetUid] = role;
      tx.update(wsRef, { roles, updatedAt: new Date().toISOString() });

      // Record audit log entry
      await writeServerAuditLog({
        workspaceId,
        uid: requestUser(req).uid,
        email: requestUser(req).email || '',
        action: 'ROLE_CHANGE',
        entityType: 'workspace',
        entityId: workspaceId,
        details: {
          targetUid,
          beforeRole: previousRole,
          afterRole: role,
          description: `User ${targetUid} role updated from ${previousRole} to ${role}`
        }
      }, { db, tx });
    });

    // S-15: the person is told their new role (not when they changed it themselves)
    if (previousRole !== role) {
      const label = (r: string) => ROLE_LABEL[r] || r;
      await notify(db, {
        workspaceId, kind: 'member.role_changed', title: `Your role is now ${label(role)}`,
        message: `In this workspace you are now ${label(role)} (before: ${label(previousRole)}). What you can see and change follows the new role.`,
        eventKey: `role:${targetUid}:${previousRole}:${role}:${Date.now()}`, actorUid: requestUser(req).uid, onlyUids: [String(targetUid)],
      });
    }
    res.json({ status: 'success', targetUid, role, previousRole });
  } catch (err) {
    if (errorMessage(err) === 'LAST_OWNER_PROTECTION') {
      return sendError(res, 'Cannot demote the person who created the workspace, or its last owner.', 400);
    }
    if (errorMessage(err) === 'NOT_FOUND') return sendError(res, 'Workspace not found', 404);
    sendError(res, 'Failed to update workspace role', 500, errorMessage(err));
  }
};

workspaceRouter.post('/:workspaceId/roles', requireWorkspaceRole(['owner']), handleUpdateRole);
workspaceRouter.patch('/:workspaceId/roles/:uid', requireWorkspaceRole(['owner']), handleUpdateRole);

/**
 * Invites Endpoints
 */
workspaceRouter.get('/:workspaceId/invites', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  try {
    const db = getDb();
    const snap = await db.collection('invites').where('workspaceId', '==', workspaceId).limit(100).get();
    const invites = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ status: 'success', invites });
  } catch (err) {
    sendError(res, 'Failed to fetch invites', 500, errorMessage(err));
  }
});

workspaceRouter.post('/:workspaceId/invites', requireWorkspaceRole(['owner']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  const schema = z.object({
    email: z.string().email(),
    role: z.enum(['owner', 'accountant', 'bookkeeper', 'viewer']).default('viewer')
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 'Invalid invite payload', 400, parsed.error.issues);
  const { email, role } = parsed.data;

  try {
    const db = getDb();
    const wsRef = db.collection('workspaces').doc(workspaceId);
    const wsSnap = await wsRef.get();
    if (!wsSnap.exists) return sendError(res, 'Workspace not found', 404);

    const wsData = wsSnap.data() || {};
    const members: string[] = Array.isArray(wsData.members) ? wsData.members : [];
    const maxSeats = wsData.maxSeats || Math.max(5, planFor(String(wsData.plan || 'free')).limits.seats); // plan's seats, at least 5; free access: no cap
    const currentSeatCount = new Set([...members, wsData.uid || 'owner']).size; // unique people: owner counted once (ACC-1b)

    if (wsData.bypassBilling !== true && currentSeatCount >= maxSeats) {
      return sendError(res, `Payment Required: Workspace seat limit reached (${currentSeatCount}/${maxSeats} seats used). Upgrade plan to invite more team members.`, 402);
    }

    const invite = generateInviteToken(workspaceId, email, role);
    const inviteRef = db.collection('invites').doc(invite.id || invite.token);

    await inviteRef.set({
      ...invite,
      invitedByUid: requestUser(req).uid,
      createdAt: new Date().toISOString()
    });

    // Write audit log entry
    await writeServerAuditLog({
      workspaceId,
      uid: requestUser(req).uid,
      email: requestUser(req).email || '',
      action: 'INVITE_SENT',
      entityType: 'workspace',
      entityId: workspaceId,
      details: {
        email: invite.email,
        role: invite.role,
        inviteId: invite.id,
        description: `Invite sent to ${invite.email} with role ${invite.role}`
      }
    }, { db });

    await notify(db, {
      workspaceId, kind: 'member.invited',
      title: `${invite.email} was invited`,
      message: `Invited as ${invite.role} by ${requestUser(req).email || 'a team member'}.`,
      eventKey: `member.invited:${invite.id || invite.token}`, actorUid: requestUser(req).uid,
    });
    res.json({ status: 'success', invite });
  } catch (err) {
    sendError(res, 'Failed to create workspace invite', 500, errorMessage(err));
  }
});

workspaceRouter.delete('/:workspaceId/invites/:inviteId', requireWorkspaceRole(['owner']), async (req, res) => {
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash(workspaceInviteRevokeCommand),
    workspaceId: String(req.params.workspaceId),
    input: { inviteId: String(req.params.inviteId) },
    formatResponse(outcome) {
      if (outcome.ok) {
        return { status: outcome.status, body: { status: 'success', message: 'Invite revoked successfully' } };
      }
      if (outcome.error instanceof WorkspaceInviteError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      if (outcome.error instanceof z.ZodError) {
        return { status: 400, body: { status: 'error', message: 'Invalid invite ID', details: outcome.error.issues } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'Failed to revoke invite', details: error instanceof Error ? errorMessage(error) : outcome.message },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

/** First-run setup (L-19): opening balances as one balanced entry, or "start from zero". */
workspaceRouter.post('/:workspaceId/opening-balances', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceOpeningBalancesCommand,
    workspaceId: String(req.params.workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) {
        const { workspaceId: _workspaceId, ...result } = outcome.data as Record<string, unknown>;
        return { status: outcome.status, body: { status: 'success', ...result } };
      }
      if (outcome.error instanceof z.ZodError) {
        return {
          status: 400,
          body: { status: 'error', message: 'Invalid opening balances', details: outcome.error.issues.map(issue => issue.message).join('; ') },
        };
      }
      if (outcome.error instanceof SetupError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'Failed to record the opening balances', details: error instanceof Error ? errorMessage(error) : outcome.message },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

workspaceRouter.post('/:workspaceId/setup-complete', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceSetupCompleteCommand,
    workspaceId: String(req.params.workspaceId),
    input: {},
    formatResponse(outcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success' } };
      if (outcome.error instanceof SetupError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'Failed to finish the setup', details: error instanceof Error ? errorMessage(error) : outcome.message },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

/** Retention (L-08): how long logs are kept, the recovery window, legal hold. Owners only. */
workspaceRouter.put('/:workspaceId/retention', requireWorkspaceRole(['owner']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceRetentionCommand,
    workspaceId: String(req.params.workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) {
        return { status: outcome.status, body: { status: 'success', retention: (outcome.data as { settings: unknown }).settings } };
      }
      if (outcome.error instanceof z.ZodError) {
        return {
          status: 400,
          body: { status: 'error', message: 'Invalid retention settings', details: outcome.error.issues.map(issue => issue.message).join('; ') },
        };
      }
      if (outcome.error instanceof RetentionError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'Failed to save retention settings', details: error instanceof Error ? errorMessage(error) : outcome.message },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

/**
 * Task 4: Soft-delete workspace with a recovery window (30 days by default; retention settings) (Owner only)
 * Never hard-deletes financial records or auditLogs (Finding Section 13A).
 */
workspaceRouter.delete('/:workspaceId', requireWorkspaceRole(['owner']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  try {
    const db = getDb();
    const wsRef = db.collection('workspaces').doc(workspaceId);
    const wsSnap = await wsRef.get();
    if (!wsSnap.exists) {
      return sendError(res, 'Workspace not found', 404);
    }

    const now = new Date();
    const scheduledPurgeAt = purgeDate(wsSnap.data(), now);

    await wsRef.update({
      status: 'pending_deletion',
      deletedAt: now.toISOString(),
      scheduledPurgeAt,
      updatedAt: now.toISOString()
    });

    // Audit log entry - auditLogs must NEVER be deleted
    await writeServerAuditLog({
      workspaceId,
      uid: requestUser(req).uid,
      email: requestUser(req).email || '',
      action: 'WORKSPACE_DELETION_SCHEDULED',
      entityType: 'workspace',
      entityId: workspaceId,
      details: {
        description: `Workspace marked for deletion, scheduled for purge on ${scheduledPurgeAt}`,
        scheduledPurgeAt
      }
    }, { db });

    const graceDays = retentionFor(wsSnap.data()).deletionGraceDays;
    res.json({
      status: 'success',
      message: `Workspace marked as pending deletion with a ${graceDays}-day recovery window.`,
      scheduledPurgeAt
    });
  } catch (err) {
    sendError(res, 'Failed to delete workspace', 500, errorMessage(err));
  }
});

/**
 * Keep a workspace that was scheduled for deletion, within the 30-day window (Owner only).
 * (Its own path: POST /:workspaceId/restore is the backup import in server.ts, L-130.)
 */
workspaceRouter.post('/:workspaceId/cancel-deletion', requireWorkspaceRole(['owner']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceCancelDeletionCommand,
    workspaceId: String(req.params.workspaceId),
    input: {},
    formatResponse(outcome) {
      if (outcome.ok) {
        return { status: outcome.status, body: { status: 'success', message: 'Workspace restored successfully.' } };
      }
      if (outcome.error instanceof WorkspaceLifecycleError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      if (outcome.error instanceof z.ZodError) {
        return { status: 400, body: { status: 'error', message: 'Invalid workspace restoration request', details: outcome.error.issues } };
      }
      if (outcome.status >= 500) {
        const error = outcome.error;
        return {
          status: outcome.status,
          body: { status: 'error', message: 'Failed to restore workspace', details: error instanceof Error ? errorMessage(error) : outcome.message },
        };
      }
      return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    },
  });
});

// #656: the demo-seed route was removed: no screen called it, and it wrote demo entries into real books, even a closed
// month, past the validator, the period lock and the audit. Guest mode keeps the same demo data in memory only.
