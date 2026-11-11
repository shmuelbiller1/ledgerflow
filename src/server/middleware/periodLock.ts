import { requestUser } from '../auth/requestUser';
import { Request, Response, NextFunction } from 'express';
import { getDb, type Firestore } from '../db/firestore';
import { lockMessage, postingLock } from '../../lib/periodLock';

export function requireOpenPeriod(collectionOrDb?: unknown, dbOverride?: unknown) {
  const collectionName = typeof collectionOrDb === 'string' ? collectionOrDb : undefined;
  const explicitDb = (typeof collectionOrDb === 'object' && collectionOrDb !== null ? collectionOrDb : dbOverride) as Firestore | undefined;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let workspaceId =
        (req.params?.workspaceId as string) ||
        (req.body?.workspaceId as string) ||
        (req.body?.transaction?.workspaceId as string) ||
        (req.body?.invoice?.workspaceId as string) ||
        (req.body?.bill?.workspaceId as string) ||
        (req.body?.payment?.workspaceId as string) ||
        (req.body?.creditNote?.workspaceId as string) ||
        (req.query?.workspaceId as string) ||
        requestUser(req)?.developerWorkspaceId;

      let date =
        req.body?.date ||
        req.body?.transaction?.date ||
        req.body?.invoice?.date ||
        req.body?.bill?.date ||
        req.body?.payment?.date ||
        req.body?.creditNote?.date;

      const db = explicitDb || getDb();
      const docId = (req.params?.id as string) || (req.params?.transactionId as string) || (req.params?.invoiceId as string) || (req.params?.billId as string);

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
