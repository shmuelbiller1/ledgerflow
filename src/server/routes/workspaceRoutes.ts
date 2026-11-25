import { isForbidden } from '../http/serverKit';
import { errorMessage } from '../auth/requestUser';
import express from 'express';
import type { DecodedIdToken } from '../auth/supabaseAuth';
import { z } from 'zod';
import { TemplateError } from '../services/templateService';
import { ImportError } from '../services/recordImportService';
import { getDb, validateWorkspaceMember } from '../db/firestore';
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
import type { CommandExecutionOutcome } from '../commands/types';
import {
  workspaceApplyTemplateCommand, workspaceImportRecordsCommand, workspaceInviteCommand,
  workspaceScheduleDeletionCommand, workspaceUndoImportCommand, workspaceUpdateRoleCommand,
} from '../commands/workspaceAdmin';
import { emailRouter } from './emailRoutes';
import { taxRouter } from './taxRoutes';
import { brandingProfilesRouter, brandingRouter } from './brandingRoutes';
import { contactMergeRouter } from './contactMergeRoutes';
import { numberingRouter } from './numberingRoutes';
import { NUMBERED_TYPES } from '../services/numberingService';
import { RetentionError } from '../services/retentionService';
import { budgetControlRouter } from './budgetControlRoutes';
import { SetupError } from '../services/openingBalanceService';
import { ModuleSettingError, moduleRecords } from '../services/moduleService';
import { allocationRuleRouter, priceListRouter, salesRepRouter, roleDashboardRouter, approvalDelegateRouter, taxProfileRouter, paymentTypeRouter, customerGroupRouter } from './savedListRoutes';
import { workspaceUsage } from '../middleware/planCapacity';

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
 * Middleware helper for checking per-workspace user role: the lookup lives in a leaf module
 * (auth/workspaceRole.ts) so the command runner can use it without importing this router, and it is
 * re-exported here for the routes that already import it from this file.
 */
export { getWorkspaceUserRole } from '../auth/workspaceRole';
import { getWorkspaceUserRole as workspaceRoleOf } from '../auth/workspaceRole';
import { commandFailureResponse } from '../utils/commandResponses';

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
      const userRole = await workspaceRoleOf(db, String(workspaceId), authReq.user.uid);

      if (!allowedRoles.includes(userRole)) {
        return sendError(res, `Forbidden: requires one of roles [${allowedRoles.join(', ')}]`, 403);
      }

      (authReq as AuthenticatedRequest & { userRole?: string }).userRole = userRole;
      next();
    } catch (err) {
      if (isForbidden(errorMessage(err)) || /Unauthorized|not a member/i.test(errorMessage(err) || '')) return sendError(res, 'Forbidden', 403);
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
// Apply a chart-of-accounts template on the server (the `workspace.applytemplate` command, which owns
// the schema): owners and accountants manage the chart; the dashboard layout comes only from templates.
workspaceRouter.post('/:workspaceId/apply-template', requireWorkspaceRole(['owner', 'accountant']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceApplyTemplateCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid template request', details: outcome.error.issues } };
      if (outcome.error instanceof TemplateError) return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      return commandFailureResponse(outcome, 'Could not apply the template');
    },
  });
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
      return commandFailureResponse(outcome, 'Could not save the column layout');
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
workspaceRouter.use('/:workspaceId/branding-profiles', requireWorkspaceRole(['owner', 'accountant']), brandingProfilesRouter);
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
      return commandFailureResponse(outcome, 'The alerts could not be saved');
    },
  });
});

// Bulk import of customers, vendors, items or accounts from a spreadsheet (K-01; rules in
// src/lib/recordImport.ts): `workspace.importrecords` and `workspace.undoimport`, which own the schemas
// and check that a bookkeeper cannot change the chart of accounts.
const LEDGER_ADMIN_ROLES = ['owner', 'accountant'];

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
      return commandFailureResponse(outcome, 'Could not save the modules');
    },
  });
});

workspaceRouter.post('/:workspaceId/import-records', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceImportRecordsCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid import request', details: outcome.error.issues } };
      if (outcome.error instanceof ImportError) {
        const error = outcome.error;
        return { status: error.status, body: { status: 'error', message: errorMessage(error), ...(error.issues.length ? { details: error.issues } : {}) } };
      }
      return commandFailureResponse(outcome, 'Could not import the records');
    },
  });
});

workspaceRouter.post('/:workspaceId/import-records/:batchId/undo', requireWorkspaceRole(['owner', 'accountant', 'bookkeeper']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceUndoImportCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: { batchId: String((req.params as Record<string, string>).batchId) },
    formatResponse(outcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
      if (outcome.error instanceof ImportError) return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Unknown import', details: outcome.error.issues } };
      return commandFailureResponse(outcome, 'Could not undo the import');
    },
  });
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
      return commandFailureResponse(outcome, 'Failed to allocate next document number');
    },
  });
});

// Explicit 405 Method Not Allowed for GET/other methods on /:workspaceId/next-number
workspaceRouter.all('/:workspaceId/next-number', (req, res) => {
  res.setHeader('Allow', 'POST');
  return sendError(res, 'Method Not Allowed: allocate next document number must be called via POST.', 405);
});

// who owns a workspace lives in one place now, so the role-change command and this route agree
export { countWorkspaceOwners } from '../services/workspaceOwners';

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
    if (isForbidden(errorMessage(err))) return sendError(res, 'Forbidden', 403);
    sendError(res, 'Failed to fetch roles', 500, errorMessage(err));
  }
});

/**
 * Update workspace user role (Owner only) - Supports POST and PATCH /:workspaceId/roles/:uid
 */
// POST /:workspaceId/roles (the uid in the body) and PATCH /:workspaceId/roles/:uid (the uid in the
// path) are one write: the command owns the last-owner protection, the audit line and the notice, and
// this keeps the legacy answers. Both routes name the runner, so the conversion is visible in each.
const roleUpdateInvocation = (req: express.Request) => {
  const params = req.params as Record<string, string>;
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const targetUid = params.uid || body.targetUid;
  return {
    definition: workspaceUpdateRoleCommand,
    workspaceId: String(params.workspaceId),
    input: { role: body.role, targetUid: typeof targetUid === 'string' ? targetUid : '' },
    formatResponse(outcome: CommandExecutionOutcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid role payload or target user ID', details: outcome.error.issues } };
      if (outcome.code === 'LAST_OWNER_PROTECTION') {
        return { status: 400, body: { status: 'error', message: 'Cannot demote the person who created the workspace, or its last owner.' } };
      }
      if (outcome.status === 404) return { status: 404, body: { status: 'error', message: 'Workspace not found' } };
      return commandFailureResponse(outcome, 'Failed to update workspace role');
    },
  };
};

workspaceRouter.post('/:workspaceId/roles', requireWorkspaceRole(['owner']), async (req, res) => {
  await executeCommand(req, res, roleUpdateInvocation(req));
});

workspaceRouter.patch('/:workspaceId/roles/:uid', requireWorkspaceRole(['owner']), async (req, res) => {
  await executeCommand(req, res, roleUpdateInvocation(req));
});

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
  await executeCommand(req, res, {
    definition: workspaceInviteCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: req.body,
    formatResponse(outcome) {
      if (outcome.ok) return { status: outcome.status, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid invite payload', details: outcome.error.issues } };
      if (outcome.status === 402) return { status: 402, body: { status: 'error', message: outcome.message } };
      if (outcome.status === 404) return { status: 404, body: { status: 'error', message: 'Workspace not found' } };
      return commandFailureResponse(outcome, 'Failed to create workspace invite');
    },
  });
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
      return commandFailureResponse(outcome, 'Failed to revoke invite');
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
      if (outcome.code === 'PERIOD_LOCKED') {
        return { status: 409, body: { status: 'error', message: outcome.message } };
      }
      if (outcome.error instanceof SetupError) {
        return { status: outcome.error.status, body: { status: 'error', message: errorMessage(outcome.error) } };
      }
      return commandFailureResponse(outcome, 'Failed to record the opening balances');
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
      return commandFailureResponse(outcome, 'Failed to finish the setup');
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
      return commandFailureResponse(outcome, 'Failed to save retention settings');
    },
  });
});

/**
 * Task 4: Soft-delete workspace with a recovery window (30 days by default; retention settings) (Owner only)
 * Never hard-deletes financial records or auditLogs (Finding Section 13A).
 */
workspaceRouter.delete('/:workspaceId', requireWorkspaceRole(['owner']), async (req, res) => {
  await executeCommand(req, res, {
    definition: workspaceScheduleDeletionCommand,
    workspaceId: String((req.params as Record<string, string>).workspaceId),
    input: {},
    formatResponse(outcome) {
      if (outcome.ok) {
        const data = outcome.data as { scheduledPurgeAt: string; graceDays: number };
        return {
          status: outcome.status,
          body: {
            status: 'success',
            message: `Workspace marked as pending deletion with a ${data.graceDays}-day recovery window.`,
            scheduledPurgeAt: data.scheduledPurgeAt,
          },
        };
      }
      if (outcome.error instanceof z.ZodError) return { status: 400, body: { status: 'error', message: 'Invalid workspace deletion request', details: outcome.error.issues } };
      if (outcome.status === 404) return { status: 404, body: { status: 'error', message: 'Workspace not found' } };
      return commandFailureResponse(outcome, 'Failed to delete workspace');
    },
  });
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
      return commandFailureResponse(outcome, 'Failed to restore workspace');
    },
  });
});

// #656: the demo-seed route was removed: no screen called it, and it wrote demo entries into real books, even a closed
// month, past the validator, the period lock and the audit. Guest mode keeps the same demo data in memory only.
