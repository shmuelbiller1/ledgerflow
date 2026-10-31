import { errorMessage, requestUser } from '../auth/requestUser';
import { notify } from '../services/notificationService';
import express from 'express';
import type { DecodedIdToken } from '../auth/supabaseAuth';
import { z } from 'zod';
import { getDb, validateWorkspaceMember, FieldValue, type Firestore } from '../db/firestore';
import { writeServerAuditLog } from '../services/auditLogService';
import { seedDemoWorkspace } from '../../lib/demoWorkspaceSeeder';
import { formatTzDate } from './transactionRoutes';
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
import { ScheduledReportError, sendScheduleNow } from '../services/scheduledReportService';
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
import { AlertSettingsError, saveAlertSettings } from '../services/bookAlertService';
import { emailRouter } from './emailRoutes';
import { taxRouter } from './taxRoutes';
import { brandingRouter } from './brandingRoutes';
import { contactMergeRouter } from './contactMergeRoutes';
import { numberingRouter } from './numberingRoutes';
import { allocateNextNumber, NUMBERED_TYPES, type NumberedType } from '../services/numberingService';
import { retentionFor, RetentionSettingsSchema, scheduledPurgeAt as purgeDate } from '../../lib/retention';
import { RetentionError, updateRetention } from '../services/retentionService';
import { budgetControlRouter } from './budgetControlRoutes';
import { completeSetup, recordOpeningBalances, SetupError } from '../services/openingBalanceService';
import { ModuleSettingError, moduleRecords, setModules } from '../services/moduleService';
import { allocationRuleRouter, priceListRouter, salesRepRouter, roleDashboardRouter, approvalDelegateRouter, taxProfileRouter } from './savedListRoutes';
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
// file's header signature. Anyone who imports statements (owner/accountant/bookkeeper) may save.
const importMapSchema = z.object({
  signature: z.string().regex(/^csv_\d{1,3}_[0-9a-f]{8}$/),
  columns: z.object(Object.fromEntries(['date', 'description', 'amount', 'debit', 'credit', 'payee', 'memo'].map(f => [f, z.string().min(1).max(200).optional()]))).strict(),
  skipRows: z.number().int().min(0).max(20),
}).strict();
const MAX_IMPORT_MAPS = 50;

workspaceRouter.post('/:workspaceId/import-maps', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const { signature, columns, skipRows } = importMapSchema.parse(req.body);
    const db = getDb();
    const ref = db.collection('workspaces').doc(workspaceId);
    await db.runTransaction(async (t) => {
      const maps = { ...((await t.get(ref)).data()?.importColumnMaps || {}) } as Record<string, { savedAt?: string }>;
      maps[signature] = { columns, skipRows, savedAt: new Date().toISOString() } as { savedAt: string };
      // Keep the most recently used layouts only
      const keep = Object.entries(maps).sort((a, b) => String(b[1].savedAt || '').localeCompare(String(a[1].savedAt || ''))).slice(0, MAX_IMPORT_MAPS);
      t.update(ref, { importColumnMaps: Object.fromEntries(keep), updatedAt: new Date().toISOString() });
    });
    res.json({ status: 'success' });
  } catch (err) {
    if (err instanceof z.ZodError) return sendError(res, 'Invalid column layout', 400, err.issues);
    sendError(res, 'Could not save the column layout', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
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
// Scheduled reports (K-28): send one now (owners and accountants); the daily job sends the rest
workspaceRouter.post('/:workspaceId/report-schedules/:scheduleId/send-now', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  try {
    const { workspaceId, scheduleId } = req.params as Record<string, string>;
    const result = await sendScheduleNow(getDb(), { workspaceId, scheduleId });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof ScheduledReportError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(500).json({ status: 'error', message: 'The report could not be sent', details: err instanceof Error ? err.message : String(err) });
  }
});
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
// Settings → Alerts (S-08, S-10, S-11): owners and accountants
const alertsSchema = z.object({
  cashLowCents: z.number().int().nullable().optional(),
  closeReminderDay: z.number().int().nullable().optional(),
  budgetAlerts: z.boolean().optional(),
}).strict();
workspaceRouter.put('/:workspaceId/alerts', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  try {
    const alerts = await saveAlertSettings(getDb(), { workspaceId: String(req.params.workspaceId), uid: user.uid, email: user.email, alerts: alertsSchema.parse(req.body) });
    res.json({ status: 'success', alerts });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ status: 'error', message: 'Those alert settings are not in the expected form' });
    if (err instanceof AlertSettingsError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(500).json({ status: 'error', message: 'The alerts could not be saved', details: err instanceof Error ? err.message : String(err) });
  }
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

/** BB-07: owners and accountants turn modules on or off (moduleService.ts); nothing is deleted. */
workspaceRouter.put('/:workspaceId/modules', requireWorkspaceRole(LEDGER_ADMIN_ROLES), async (req, res) => {
  try {
    const { workspaceId } = req.params as Record<string, string>;
    const { modules } = z.object({ modules: z.record(z.string(), z.boolean()) }).strict().parse(req.body);
    const { user } = req as AuthenticatedRequest;
    res.json({ status: 'success', ...(await setModules(getDb(), { workspaceId, uid: user.uid, email: user.email, modules })) });
  } catch (err) {
    if (err instanceof z.ZodError) return sendError(res, 'Send which modules are on (true or false)', 400, err.issues);
    if (err instanceof ModuleSettingError) return sendError(res, errorMessage(err), err.status);
    sendError(res, 'Could not save the modules', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
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
  const { workspaceId } = req.params as Record<string, string>;
  const rawType = req.body?.type;

  const schema = z.enum(NUMBERED_TYPES as unknown as [NumberedType, ...NumberedType[]]);
  const parsed = schema.safeParse(rawType);
  if (!parsed.success) return sendError(res, `Invalid request parameters. "type" (${NUMBERED_TYPES.join(', ')}) is required in request body.`, 400, parsed.error.issues);
  const type = parsed.data;

  try {
    const db = getDb();
    const formattedNumber = await allocateNextNumber(db, workspaceId, type);

    res.json({ number: formattedNumber });
  } catch (err) {
    if (errorMessage(err) === 'FORBIDDEN') return sendError(res, 'Forbidden', 403);
    if (errorMessage(err) === 'NOT_FOUND') return sendError(res, 'Workspace not found', 404);
    sendError(res, 'Failed to allocate next document number', 500, errorMessage(err));
  }
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
  if (!parsed.success || !targetUid) return sendError(res, 'Invalid role payload or target user ID', 400, parsed.error?.issues);
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

      // Protect last owner from demotion
      if (role !== 'owner' && ownerUids.includes(targetUid) && count <= 1) {
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
      return sendError(res, 'Cannot demote or remove the last owner of the workspace.', 400);
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
    const currentSeatCount = members.length + 1; // plus primary owner

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
  const { workspaceId, inviteId } = req.params as Record<string, string>;
  try {
    const db = getDb();
    const inviteRef = db.collection('invites').doc(inviteId);
    const snap = await inviteRef.get();
    if (!snap.exists) return sendError(res, 'Invite not found', 404);

    if (snap.data()?.workspaceId !== workspaceId) {
      return sendError(res, 'Forbidden', 403);
    }

    await inviteRef.update({
      status: 'revoked',
      updatedAt: new Date().toISOString()
    });

    res.json({ status: 'success', message: 'Invite revoked successfully' });
  } catch (err) {
    sendError(res, 'Failed to revoke invite', 500, errorMessage(err));
  }
});

/** First-run setup (L-19): opening balances as one balanced entry, or "start from zero". */
const openingBalancesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  balances: z.array(z.object({ accountId: z.string().min(1).max(127), amountCents: z.number().int() }).strict()).max(300),
}).strict();

workspaceRouter.post('/:workspaceId/opening-balances', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  const parsed = openingBalancesSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 'Invalid opening balances', 400, parsed.error.issues.map(i => i.message).join('; '));
  try {
    const user = (req as AuthenticatedRequest).user;
    const result = await recordOpeningBalances(getDb(), { workspaceId, uid: user.uid, email: user.email, ...parsed.data });
    res.json({ status: 'success', ...result });
  } catch (err) {
    if (err instanceof SetupError) return sendError(res, errorMessage(err), err.status);
    sendError(res, 'Failed to record the opening balances', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

workspaceRouter.post('/:workspaceId/setup-complete', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  try {
    await completeSetup(getDb(), { workspaceId, uid: (req as AuthenticatedRequest).user.uid });
    res.json({ status: 'success' });
  } catch (err) {
    if (err instanceof SetupError) return sendError(res, errorMessage(err), err.status);
    sendError(res, 'Failed to finish the setup', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
});

/** Retention (L-08): how long logs are kept, the recovery window, legal hold. Owners only. */
workspaceRouter.put('/:workspaceId/retention', requireWorkspaceRole(['owner']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  const parsed = RetentionSettingsSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 'Invalid retention settings', 400, parsed.error.issues.map(i => i.message).join('; '));
  try {
    const user = (req as AuthenticatedRequest).user;
    const retention = await updateRetention(getDb(), { workspaceId, uid: user.uid, email: user.email, settings: parsed.data });
    res.json({ status: 'success', retention });
  } catch (err) {
    if (err instanceof RetentionError) return sendError(res, errorMessage(err), err.status);
    sendError(res, 'Failed to save retention settings', 500, err instanceof Error ? errorMessage(err) : String(err));
  }
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
  const { workspaceId } = req.params as Record<string, string>;
  try {
    const db = getDb();
    const wsRef = db.collection('workspaces').doc(workspaceId);
    const wsSnap = await wsRef.get();
    if (!wsSnap.exists) {
      return sendError(res, 'Workspace not found', 404);
    }

    const wsData = wsSnap.data() || {};
    if (wsData.status !== 'pending_deletion') {
      return sendError(res, 'Workspace is not pending deletion', 400);
    }

    const now = new Date();
    await wsRef.update({
      status: 'active',
      deletedAt: FieldValue.delete(),
      scheduledPurgeAt: FieldValue.delete(),
      updatedAt: now.toISOString()
    });

    // Audit log entry
    await writeServerAuditLog({
      workspaceId,
      uid: requestUser(req).uid,
      email: requestUser(req).email || '',
      action: 'WORKSPACE_RESTORED',
      entityType: 'workspace',
      entityId: workspaceId,
      details: {
        description: 'Workspace restored from pending deletion'
      }
    }, { db });

    res.json({
      status: 'success',
      message: 'Workspace restored successfully.'
    });
  } catch (err) {
    sendError(res, 'Failed to restore workspace', 500, errorMessage(err));
  }
});

/**
 * Task 5: Seed Demo Data
 */
workspaceRouter.post('/:workspaceId/seed', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  const { workspaceId } = req.params as Record<string, string>;
  const db = getDb();
  
  try {
    const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
    const wsTz = wsDoc.data()?.timezone || 'UTC';
    const now = new Date();
    const today = formatTzDate(now, wsTz);
    const invoiceDue = formatTzDate(new Date(now.getTime() + 30 * 86400000), wsTz);
    const billDue = formatTzDate(new Date(now.getTime() + 15 * 86400000), wsTz);

    const demoData = seedDemoWorkspace(workspaceId);
    const batch = db.batch();

    // Write demo chart accounts
    demoData.accounts.forEach(acc => {
      const ref = db.collection('chartAccounts').doc(`${workspaceId}_${acc.id}`);
      batch.set(ref, { ...acc, uid: requestUser(req).uid, workspaceId });
    });

    // Write demo transactions
    demoData.transactions.forEach(tx => {
      const ref = db.collection('transactions').doc(`${workspaceId}_${tx.id}`);
      batch.set(ref, { ...tx, uid: requestUser(req).uid, workspaceId });
    });
    
    // Add Demo Customer
    const customerRef = db.collection('customers').doc();
    batch.set(customerRef, {
      uid: requestUser(req).uid,
      workspaceId,
      name: 'Acme Corporation',
      email: 'billing@acme.com',
      status: 'active'
    });

    // Add Demo Vendor
    const vendorRef = db.collection('vendors').doc();
    batch.set(vendorRef, {
      uid: requestUser(req).uid,
      workspaceId,
      name: 'Cloud Services Ltd',
      category: 'Software',
      status: 'active'
    });
    
    // Add Demo Invoice
    const invoiceRef = db.collection('invoices').doc();
    batch.set(invoiceRef, {
      uid: requestUser(req).uid,
      workspaceId,
      customerId: customerRef.id,
      customerName: 'Acme Corporation',
      number: `INV-DEMO-001`,
      amountCents: 500000,
      date: today,
      dueDate: invoiceDue,
      status: 'sent',
      type: 'standard',
      items: [
        {
          id: 'item-1',
          description: 'Consulting Services',
          quantity: 1,
          rateCents: 500000,
          amountCents: 500000,
          accountId: 'income-acct'
        }
      ]
    });

    // Add Demo Bill
    const billRef = db.collection('bills').doc();
    batch.set(billRef, {
      uid: requestUser(req).uid,
      workspaceId,
      vendorId: vendorRef.id,
      vendorName: 'Cloud Services Ltd',
      number: `BILL-DEMO-001`,
      amountCents: 120000,
      date: today,
      dueDate: billDue,
      status: 'pending',
      splits: [
        {
          amountCents: 120000,
          accountId: 'expense-acct',
          description: 'Server Hosting'
        }
      ]
    });

    await batch.commit();
    res.json({ status: 'success', message: 'Demo data seeded' });
  } catch (e) {
    sendError(res, 'Failed to seed demo data', 500, errorMessage(e));
  }
});
