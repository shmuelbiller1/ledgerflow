import { errorMessage, requestUser } from '../auth/requestUser';
import { Request, Response } from 'express';
import type { Transaction as FirestoreTransaction } from '../db/firestore';
import { getDb } from '../db/firestore';
import { 
  requestPayloadHash,
  executeIdempotent, 
  extractCanonicalOperationId, 
  deriveScopedOperationKey 
} from './idempotency';
import { logSafe } from './logSafe';

export interface CommandContext {
  actor: string;
  workspaceId: string;
  operationType: string;
  operationId?: string;
}

/**
 * Standardizes command execution with idempotency across all workspace operations.
 * Extracts canonical OperationId from headers ('x-operation-id', 'idempotency-key') or body.
 * Always guarantees ONE unified Firestore transaction context passed to the action.
 */
export async function executeCommand<T>(
  req: Request,
  res: Response,
  workspaceId: string,
  operationType: string,
  action: (ctx: CommandContext, t: FirestoreTransaction) => Promise<T>,
  /** EG-4: fields added to a successful answer beside `data` (e.g. budgetWarnings), read after the action ran */
  extra: () => Record<string, unknown> = () => ({})
) {
  if (!workspaceId || typeof workspaceId !== 'string' || !workspaceId.trim()) {
    return res.status(400).json({
      status: 'error',
      message: 'Workspace ID is required for command execution'
    });
  }

  const user = requestUser(req);
  const rawOperationId = extractCanonicalOperationId(req);
  
  const ctx: CommandContext = {
    actor: user?.uid || 'anonymous',
    workspaceId: workspaceId.trim(),
    operationType,
    operationId: rawOperationId
  };

  const db = getDb();

  if (!rawOperationId) {
    // No operation ID provided: execute within a single Firestore transaction
    try {
      const result = await db.runTransaction(async (t) => {
        return await action(ctx, t);
      });
      return res.json({ status: 'success', data: result, ...extra() });
    } catch (error) {
      const status = (error as { status?: number }).status || 500;
      if (status >= 500) {
        const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        console.error('[CommandExecutor:%s] %s failed:', correlationId, operationType, error);
        return res.status(status).json({
          status: 'error',
          message: 'An internal server error occurred.',
          correlationId
        });
      }
      console.error('[CommandExecutor] Operation %s failed:', operationType, error);
      return res.status(status).json({ 
        status: 'error', 
        message: errorMessage(error), 
        details: (error as { details?: unknown }).details 
      });
    }
  }

  // Canonical namespaced key: workspaceId:operationType:operationId
  const scopedKey = deriveScopedOperationKey(ctx.workspaceId, operationType, rawOperationId);

  try {
    const result = await executeIdempotent(scopedKey, { ...ctx, payloadHash: requestPayloadHash(req.body) }, async (t) => {
      return await action(ctx, t);
    });
    return res.json({ status: 'success', data: result, ...extra() });
  } catch (error) {
    if ((error as { status?: number }).status === 409 || errorMessage(error).includes('already in progress')) {
      return res.status(409).json({ status: 'error', message: errorMessage(error) });
    }
    const status = (error as { status?: number }).status || 500;
    if (status >= 500) {
      const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      console.error('[CommandExecutor:%s] Idempotent operation %s failed:', correlationId, logSafe(scopedKey), error);
      return res.status(status).json({
        status: 'error',
        message: 'An internal server error occurred.',
        correlationId
      });
    }
    console.error('[CommandExecutor] Idempotent operation %s failed:', logSafe(scopedKey), error);
    return res.status(status).json({ 
      status: 'error', 
      message: errorMessage(error), 
      details: (error as { details?: unknown }).details 
    });
  }
}
