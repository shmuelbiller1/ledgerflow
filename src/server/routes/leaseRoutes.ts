import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { z } from 'zod';
import { getDb, validateWorkspaceMember } from '../db/firestore';
import { leaseCapitalizeCommand } from '../commands/verticalAccounting';
import { executeCommand, withLegacyInputIdempotencyHash } from '../utils/commandExecutor';
import { journalDocumentAnswer } from '../utils/journalDocumentAnswer';
import { mayPostEntries } from '../http/ledgerWriter';
import { computePropertyRentRoll, reconcileSecurityDepositTrust } from '../../lib/verticalAccounting';
import type { Invoice } from '../../types';

const CapitalizeLeaseSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  leaseName: z.string().optional(),
  pvAmountCents: z.number().int().positive('pvAmountCents must be a positive integer'),
  rouAssetAccountId: z.string().min(1, 'rouAssetAccountId is required'),
  leaseLiabilityAccountId: z.string().min(1, 'leaseLiabilityAccountId is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional()
});

export const leaseRouter = express.Router();

// ASC 842: capitalising a lease puts the present value on the balance sheet — an asset against a
// liability. The steps are the shared document-journal service's; this route names the entry and,
// since the screen still calls this address, keeps the answer the address has always given
// ({ status: 'ok', message, transactionId }, and { error } when it is refused). `lease.capitalize`
// runs the same service through the command runner.
leaseRouter.post('/capitalize', async (req, res) => {
  const parsed = CapitalizeLeaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: 'error', error: 'Validation failed', details: parsed.error.issues });
    return;
  }
  // The legacy route did not enforce the plan-capacity gate. The command API keeps it; the
  // compatibility invocation preserves this address's established refusal behaviour.
  await executeCommand(req, res, {
    definition: withLegacyInputIdempotencyHash({ ...leaseCapitalizeCommand, capacity: undefined }),
    workspaceId: parsed.data.workspaceId, input: parsed.data, formatResponse: journalDocumentAnswer,
  });
});

/**
 * The workspace a vertical read names in its body, once the caller is a member who may post entries:
 * answers the 400/403 itself and returns undefined when the request is refused. Both reconciliation
 * routes below need exactly this, and the sentence a refusal carries names what the caller tried.
 */
async function postingWorkspace(
  req: express.Request,
  res: express.Response,
  refusalMessage: string,
): Promise<{ workspaceId: string; db: ReturnType<typeof getDb> } | undefined> {
  const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return undefined;
  }
  const user = requestUser(req);
  const db = getDb();
  let wsData: Record<string, unknown> | undefined;
  try {
    ({ data: wsData } = await validateWorkspaceMember(db, workspaceId, user));
  } catch {
    res.status(403).json({ error: 'Not a member' });
    return undefined;
  }
  if (!mayPostEntries(wsData, user)) {
    res.status(403).json({ error: refusalMessage });
    return undefined;
  }
  return { workspaceId, db };
}

const TrustReconciliationSchema = z.object({
  workspaceId: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankStatementTrustCents: z.number().int(),
  outstandingDepositsCents: z.number().int().optional(),
  outstandingChecksCents: z.number().int().optional(),
  trustCashBookBalanceCents: z.number().int(),
  trustLiabilityAccountBalanceCents: z.number().int(),
  tenantSubledgers: z.array(
    z.object({
      unitId: z.string().min(1),
      tenantName: z.string().min(1),
      heldCents: z.number().int(),
    }),
  ),
});

leaseRouter.post('/trust-reconciliation', async (req, res) => {
  try {
    const workspace = await postingWorkspace(req, res, 'Only owners, accountants and bookkeepers run trust reconciliations');
    if (!workspace) return;

    const parsed = TrustReconciliationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const result = reconcileSecurityDepositTrust(parsed.data);
    return res.json({ status: 'ok', reconciliation: result });
  } catch (e) {
    return res.status(400).json({ error: errorMessage(e) });
  }
});

const RentRollRequestSchema = z.object({
  workspaceId: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  units: z.array(
    z.object({
      unitId: z.string().min(1),
      propertyId: z.string().min(1),
      propertyName: z.string().min(1),
      unitLabel: z.string().min(1),
      tenantId: z.string().nullable().optional(),
      tenantName: z.string().nullable().optional(),
      monthlyRentCents: z.number().int().nonnegative(),
      leaseStart: z.string().nullable().optional(),
      leaseEnd: z.string().nullable().optional(),
      securityDepositHeldCents: z.number().int().nonnegative(),
    }),
  ),
});

leaseRouter.post('/rent-roll', async (req, res) => {
  try {
    const workspace = await postingWorkspace(req, res, 'Only owners, accountants and bookkeepers compute rent rolls');
    if (!workspace) return;

    const parsed = RentRollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const invSnap = await workspace.db.collection('invoices').where('workspaceId', '==', workspace.workspaceId).get();
    const invoices = invSnap.docs.map(d => ({ ...(d.data() as Invoice), id: d.id }));
    const rentRoll = computePropertyRentRoll(parsed.data.units, invoices, parsed.data.asOfDate);
    return res.json({ status: 'ok', rentRoll });
  } catch (e) {
    return res.status(400).json({ error: errorMessage(e) });
  }
});
