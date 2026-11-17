/**
 * The route that posts one journal entry for a document-flavoured command (ASC 842 lease
 * capitalisation, ASC 606 revenue recognition) and there is nothing else to it: both routes walked
 * through the same steps in the same order, so the order — and the refusals — now live here once.
 *
 * The steps, in order, and why the order matters:
 *   1. the body is validated (a malformed body is a 400 before any read, AUD-09);
 *   2. the caller is a member of the workspace and may post entries;
 *   3. the posting date is today in the workspace's timezone unless one was sent, and the period
 *      that date falls in must be open;
 *   4. the journal is validated by the canonical validator (#102-R);
 *   5. the commit re-reads the workspace inside the transaction and checks membership, the posting
 *      role and the lock again — the first read only answers quickly, it does not authorise the write;
 *   6. the entry, the audit log and the idempotency record go in together (runOptionalIdempotent).
 */
import express from 'express';
import type { z, ZodType } from 'zod';
import { errorMessage, requestUser } from '../auth/requestUser';
import { assertPeriodOpen, FieldValue, getDb, isWorkspaceMemberData, validateWorkspaceMember } from '../db/firestore';
import type { Firestore, Transaction as FirestoreTransaction } from '../db/firestore';
import { TransactionValidator } from '../../kernel/validation/TransactionValidator';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { lockMessage, postingLock } from '../../lib/periodLock';
import { mayPostEntries } from './ledgerWriter';
import { ledgerCreate } from '../services/ledgerDoor';
import { writeServerAuditLog } from '../services/auditLogService';
import { extractCanonicalOperationId, runOptionalIdempotent } from '../utils/idempotency';

/** One line of the journal the route posts: an account and its signed amount. */
export interface JournalLine {
  accountId: string;
  amountCents: number;
  description: string;
}

export interface JournalDocumentSpec<Schema extends ZodType> {
  schema: Schema;
  /** the idempotency scope, e.g. `LEASE_CAPITALIZE` */
  operationType: string;
  /** the legacy key prefix the old route used: `${workspaceId}_${legacyPrefix}_${operationId}` */
  legacyPrefix: string;
  /** answered on success beside the transaction id */
  message: string;
  /** the description written on the journal transaction */
  description(input: z.infer<Schema>): string;
  totalAmountCents(input: z.infer<Schema>): number;
  lines(input: z.infer<Schema>): JournalLine[];
  /** the idempotency id derived from the input when the caller sent no `operationId` */
  operationId?(input: z.infer<Schema>): string | undefined;
  /** the audit entry: its action, and the details recorded with it */
  audit: {
    action: string;
    details(input: z.infer<Schema>, txDate: string): { description: string; [key: string]: unknown };
  };
}

const POST_REFUSAL = 'Only owners, accountants and bookkeepers post entries'; // AUD-09

export function postJournalDocumentRoute<Schema extends ZodType>(
  spec: JournalDocumentSpec<Schema>,
): express.RequestHandler {
  return async (req, res) => {
    try {
      const parseResult = spec.schema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          status: 'error',
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
        return;
      }

      const input = parseResult.data as z.infer<Schema>;
      const workspaceId = String((input as { workspaceId: string }).workspaceId);
      const user = requestUser(req);
      const db = getDb();

      // 1. Authorize workspace membership & API-key workspace scope FIRST before checking idempotency (#82)
      let wsData: Record<string, unknown> | undefined;
      try {
        ({ data: wsData } = await validateWorkspaceMember(db, workspaceId, user));
      } catch {
        res.status(403).json({ error: 'Not a member' });
        return;
      }
      if (!mayPostEntries(wsData, user)) {
        res.status(403).json({ error: POST_REFUSAL });
        return;
      }

      const explicitOpId = extractCanonicalOperationId(req);
      const rawOpId = explicitOpId || spec.operationId?.(input);

      const wsTimezone = typeof wsData?.timezone === 'string' ? wsData.timezone : undefined;
      const sentDate = (input as { date?: string }).date;
      const txDate = sentDate && /^\d{4}-\d{2}-\d{2}$/.test(sentDate) ? sentDate : getDateInTimezoneISO(new Date(), wsTimezone);

      // 2. Validate period lock
      await assertPeriodOpen(db, workspaceId, txDate, user.uid);

      const wsCurrency = typeof wsData?.currency === 'string' && wsData.currency ? wsData.currency : 'USD';
      const totalAmountCents = spec.totalAmountCents(input);
      const tx = {
        id: db.collection('transactions').doc().id,
        workspaceId,
        uid: user.uid,
        date: txDate,
        description: spec.description(input),
        totalAmountCents,
        currency: wsCurrency,
        type: 'journal' as const,
        status: 'approved' as const,
        isCleared: true,
        createdAt: new Date().toISOString(),
        lines: spec.lines(input).map((line, i) => ({ id: `line-${i + 1}`, ...line })),
      };

      // 3. Validate through canonical validator (#102-R)
      const validatedTx = await TransactionValidator.validateAndPrepare(tx, {
        workspaceId,
        user: { uid: user.uid, admin: user.admin },
        wsData,
      });

      const responsePayload = {
        status: 'ok' as const,
        message: spec.message,
        transactionId: validatedTx.id,
      };

      const performCommit = async (t: Parameters<Parameters<Firestore['runTransaction']>[0]>[0]): Promise<typeof responsePayload> => {
        const wsNow = (await t.get(db.collection('workspaces').doc(workspaceId))).data();
        if (!isWorkspaceMemberData(wsNow, user, workspaceId) || !mayPostEntries(wsNow, user)) {
          throw Object.assign(new Error(POST_REFUSAL), { status: 403 });
        }
        const lock = postingLock(txDate, wsNow as never, user.uid);
        if (lock) throw Object.assign(new Error(lockMessage(txDate, lock)), { status: 409 });
        const txRef = db.collection('transactions').doc(validatedTx.id);
        ledgerCreate(t as never, txRef, { ...validatedTx, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        await writeServerAuditLog({
          workspaceId,
          uid: user.uid,
          email: user.email,
          action: spec.audit.action,
          entityType: 'transaction',
          entityId: validatedTx.id,
          details: spec.audit.details(input, txDate),
        }, { db, tx: t as FirestoreTransaction });
        return responsePayload;
      };

      const resultResponse = await runOptionalIdempotent(
        {
          workspaceId,
          operationType: spec.operationType,
          rawOperationId: rawOpId,
          legacyPrefix: spec.legacyPrefix,
          actor: explicitOpId ? user.uid : '',
          payload: input,
        },
        performCommit,
      );

      res.json(resultResponse);
    } catch (e) {
      const explicitStatus = (e as { status?: number })?.status;
      const status = typeof explicitStatus === 'number'
        ? explicitStatus
        : (errorMessage(e).includes('Unauthorized') || errorMessage(e).includes('Forbidden') ? 403 : 400);
      res.status(status).json({ error: errorMessage(e) });
    }
  };
}
