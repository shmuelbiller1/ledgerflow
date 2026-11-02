import express from 'express';
import { getDb } from '../db/firestore';
import { AllocationRuleError, setAllocationRules } from '../services/allocationRuleService';
import { PriceListError, setPriceLists } from '../services/priceListService';
import { SalesRepError, setSalesReps } from '../services/salesRepService';
import { setTaxProfiles, TaxProfileError } from '../services/taxProfileService';
import { RoleDashboardError, setRoleDashboard } from '../services/roleDashboardService';
import { DelegateError, setApprovalDelegate } from '../services/approvalDelegateService';
import { changePaymentTypes, PaymentTypeError } from '../services/paymentTypeService';
import { changeCustomerGroups, CustomerGroupError } from '../services/customerGroupService';

/**
 * A workspace's saved lists that only the server writes, each replaced whole with PUT: the split
 * rules (Q-05, mounted at /api/v1/workspaces/:workspaceId/allocation-rules) and the price lists
 * (M-11, at .../price-lists) and the sales reps (P-13, at .../sales-reps); and one role's starting
 * dashboard (BC-02, PUT .../role-dashboards {role, layout}, owners only, checked by the service). All mounted by workspaceRoutes.ts for owners and accountants.
 */
type AuthedRequest = express.Request & { user: { uid: string; email?: string } };

const fail = (res: express.Response, err: unknown, known: (e: unknown) => e is { status: number; message: string }, what: string) => {
  if (known(err)) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: `Could not save the ${what}`, details: err instanceof Error ? err.message : String(err) });
};

export const allocationRuleRouter = express.Router({ mergeParams: true });
allocationRuleRouter.put('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await setAllocationRules(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, rules: req.body?.rules })) });
  } catch (err) { fail(res, err, (e): e is AllocationRuleError => e instanceof AllocationRuleError, 'split rules'); }
});

export const priceListRouter = express.Router({ mergeParams: true });
priceListRouter.put('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await setPriceLists(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, lists: req.body?.lists })) });
  } catch (err) { fail(res, err, (e): e is PriceListError => e instanceof PriceListError, 'price lists'); }
});

export const salesRepRouter = express.Router({ mergeParams: true });
salesRepRouter.put('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await setSalesReps(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, reps: req.body?.reps })) });
  } catch (err) { fail(res, err, (e): e is SalesRepError => e instanceof SalesRepError, 'sales reps'); }
});

// PLAN §6: the tax profiles of the books and of label values, PUT .../tax-profiles {profiles}
export const taxProfileRouter = express.Router({ mergeParams: true });
taxProfileRouter.put('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await setTaxProfiles(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, profiles: req.body?.profiles })) });
  } catch (err) { fail(res, err, (e): e is TaxProfileError => e instanceof TaxProfileError, 'tax profiles'); }
});

export const roleDashboardRouter = express.Router({ mergeParams: true });
roleDashboardRouter.put('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await setRoleDashboard(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, role: req.body?.role, layout: req.body?.layout ?? null })) });
  } catch (err) { fail(res, err, (e): e is RoleDashboardError => e instanceof RoleDashboardError, 'dashboard'); }
});

// BG-07: hand one's invoice approvals to someone until a date, PUT .../approval-delegate {to, until} or {clear: true}
export const approvalDelegateRouter = express.Router({ mergeParams: true });
approvalDelegateRouter.put('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await setApprovalDelegate(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, to: req.body?.to, until: req.body?.until, clear: req.body?.clear === true })) });
  } catch (err) { fail(res, err, (e): e is DelegateError => e instanceof DelegateError, 'hand-over'); }
});

// CC-09: the workspace's payment types, one change at a time: POST .../payment-types {op: 'add', name, method} | {op: 'rename', id, name} | {op: 'remove', id}
export const paymentTypeRouter = express.Router({ mergeParams: true });
paymentTypeRouter.post('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await changePaymentTypes(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, change: req.body })) });
  } catch (err) { fail(res, err, (e): e is PaymentTypeError => e instanceof PaymentTypeError, 'payment types'); }
});

// CC-11: the workspace's customer groups, one change at a time: POST .../customer-groups {op: 'add', name, paymentTerms?} | {op: 'rename', id, name} | {op: 'setTerms', id, paymentTerms} | {op: 'remove', id}
export const customerGroupRouter = express.Router({ mergeParams: true });
customerGroupRouter.post('/', async (req, res) => {
  const user = (req as AuthedRequest).user;
  try {
    res.json({ status: 'success', ...(await changeCustomerGroups(getDb(), { workspaceId: String((req.params as Record<string, string>).workspaceId), uid: user.uid, email: user.email, change: req.body })) });
  } catch (err) { fail(res, err, (e): e is CustomerGroupError => e instanceof CustomerGroupError, 'customer groups'); }
});
