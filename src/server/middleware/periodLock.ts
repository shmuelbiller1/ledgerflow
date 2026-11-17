import { requestUser } from '../auth/requestUser';
import { Request, Response, NextFunction } from 'express';
import { getDb, type Firestore } from '../db/firestore';
import { lockMessage, postingLock } from '../../lib/periodLock';

function isValidDocId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('/') && !value.includes('\0');
}

export function requireOpenPeriod(collectionOrDb?: unknown, dbOverride?: unknown) {
  const collectionName = typeof collectionOrDb === 'string' ? collectionOrDb : undefined;
  const explicitDb = (typeof collectionOrDb === 'object' && collectionOrDb !== null ? collectionOrDb : dbOverride) as Firestore | undefined;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceCandidates = [
        req.params?.workspaceId,
        req.body?.workspaceId,
        req.body?.transaction?.workspaceId,
        req.body?.invoice?.workspaceId,
        req.body?.bill?.workspaceId,
        req.body?.payment?.workspaceId,
        req.body?.creditNote?.workspaceId,
        req.query?.workspaceId,
      ];
      for (const candidate of workspaceCandidates) {
        if (candidate !== undefined && candidate !== null && candidate !== '' && !isValidDocId(candidate)) {
          return res.status(400).json({
            status: 'error',
            error: 'Invalid workspaceId.',
            message: 'Invalid workspaceId.',
          });
        }
      }

      let workspaceId =
        workspaceCandidates.find(isValidDocId) ||
        requestUser(req)?.developerWorkspaceId;

      const rawDate =
        req.body?.date ??
        req.body?.transaction?.date ??
        req.body?.invoice?.date ??
        req.body?.bill?.date ??
        req.body?.payment?.date ??
        req.body?.creditNote?.date;
      if (rawDate !== undefined && rawDate !== null && typeof rawDate !== 'string') {
        return res.status(400).json({
          status: 'error',
          error: 'Invalid date.',
          message: 'Invalid date.',
        });
      }
      let date: string | undefined = typeof rawDate === 'string' && rawDate ? rawDate : undefined;

      const db = explicitDb || getDb();
      const rawDocId = req.params?.id ?? req.params?.transactionId ?? req.params?.invoiceId ?? req.params?.billId;
      if (rawDocId !== undefined && rawDocId !== '' && !isValidDocId(rawDocId)) {
        return res.status(400).json({
          status: 'error',
          error: 'Invalid document identifier.',
          message: 'Invalid document identifier.',
        });
      }
      const docId = isValidDocId(rawDocId) ? rawDocId : undefined;

      // For DELETE, PUT, or requests missing date/workspaceId, look up existing document if collection is known
      if (collectionName && docId && (!date || !workspaceId || req.method === 'DELETE')) {
        const existingDoc = await db.collection(collectionName).doc(docId).get();
        if (existingDoc.exists) {
          const docData = existingDoc.data();
          workspaceId = workspaceId || docData?.workspaceId;
          date = date || docData?.date;

          // Hard-delete restriction (P1.2): Only draft documents can be hard-deleted
          if (req.method === 'DELETE' && docData?.status && docData.status !== 'draft') {
            return res.status(403).json({
              status: 'error',
              error: `Forbidden: Only draft documents can be deleted. Current status: ${docData.status}. Posted documents must be voided, never deleted.`,
              message: `Forbidden: Only draft documents can be deleted. Current status: ${docData.status}. Posted documents must be voided, never deleted.`,
              code: 'CANNOT_DELETE_POSTED'
            });
          }
        }
      }

      if (!workspaceId || !date) {
        return next();
      }

      const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
      if (!wsDoc.exists) {
        return next();
      }

      const uid = String((req as Request & { user?: { uid?: string } }).user?.uid || '');
      const lock = postingLock(date, wsDoc.data(), uid);
      if (lock) {
        const message = lockMessage(date, lock);
        return res.status(400).json({
          status: 'error',
          error: message,
          message,
          code: 'PERIOD_LOCKED',
          lockDate: lock.through
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
