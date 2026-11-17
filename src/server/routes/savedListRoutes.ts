import express from 'express';
import {
  allocationRulesSaveCommand, approvalDelegateSaveCommand, customerGroupsChangeCommand, paymentTypesChangeCommand,
  priceListsSaveCommand, roleDashboardSaveCommand, salesRepsSaveCommand, taxProfilesSaveCommand,
} from '../commands/savedLists';
import type { AnyCommandDefinition, CommandExecutionOutcome } from '../commands/types';
import { executeCommand } from '../utils/commandExecutor';

/**
 * A workspace's saved lists that only the server writes, each replaced whole with PUT: the split
 * rules (Q-05, mounted at /api/v1/workspaces/:workspaceId/allocation-rules) and the price lists
 * (M-11, at .../price-lists) and the sales reps (P-13, at .../sales-reps); and one role's starting
 * dashboard (BC-02, PUT .../role-dashboards {role, layout}, owners only, checked by the service). All mounted by workspaceRoutes.ts for owners and accountants.
 */

/**
 * Every saved-list write is the same shape: the mounted URL names the workspace, the body carries the
 * list, and the answer is `{ status: 'success', ...result }` or `{ status: 'error', message }`. The
 * registered command runs the work; this keeps the legacy answer, including the generic 500 wording
 * (`Could not save the <what>`) that never leaked an internal message.
 */
function savedListInvocation(req: express.Request, definition: AnyCommandDefinition) {
  const workspaceId = String((req.params as Record<string, string>).workspaceId || '');
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  return { definition, workspaceId, input: { ...body, workspaceId } };
}

function savedListAnswer(what: string) {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) return { status: 200, body: { status: 'success', ...(outcome.data as Record<string, unknown>) } };
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error ?? outcome.message);
    return { status: 500, body: { status: 'error', message: `Could not save the ${what}`, details: cause } };
  };
}

export const allocationRuleRouter = express.Router({ mergeParams: true });
allocationRuleRouter.put('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, allocationRulesSaveCommand), formatResponse: savedListAnswer('split rules') });
});

export const priceListRouter = express.Router({ mergeParams: true });
priceListRouter.put('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, priceListsSaveCommand), formatResponse: savedListAnswer('price lists') });
});

export const salesRepRouter = express.Router({ mergeParams: true });
salesRepRouter.put('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, salesRepsSaveCommand), formatResponse: savedListAnswer('sales reps') });
});

// PLAN §6: the tax profiles of the books and of label values, PUT .../tax-profiles {profiles}
export const taxProfileRouter = express.Router({ mergeParams: true });
taxProfileRouter.put('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, taxProfilesSaveCommand), formatResponse: savedListAnswer('tax profiles') });
});

export const roleDashboardRouter = express.Router({ mergeParams: true });
roleDashboardRouter.put('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, roleDashboardSaveCommand), formatResponse: savedListAnswer('dashboard') });
});

// BG-07: hand one's invoice approvals to someone until a date, PUT .../approval-delegate {to, until} or {clear: true}
export const approvalDelegateRouter = express.Router({ mergeParams: true });
approvalDelegateRouter.put('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, approvalDelegateSaveCommand), formatResponse: savedListAnswer('hand-over') });
});

// CC-09: the workspace's payment types, one change at a time: POST .../payment-types {op: 'add', name, method} | {op: 'rename', id, name} | {op: 'remove', id}
export const paymentTypeRouter = express.Router({ mergeParams: true });
paymentTypeRouter.post('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, paymentTypesChangeCommand), formatResponse: savedListAnswer('payment types') });
});

// CC-11: the workspace's customer groups, one change at a time: POST .../customer-groups {op: 'add', name, paymentTerms?} | {op: 'rename', id, name} | {op: 'setTerms', id, paymentTerms} | {op: 'remove', id}
export const customerGroupRouter = express.Router({ mergeParams: true });
customerGroupRouter.post('/', async (req, res) => {
  await executeCommand(req, res, { ...savedListInvocation(req, customerGroupsChangeCommand), formatResponse: savedListAnswer('customer groups') });
});
