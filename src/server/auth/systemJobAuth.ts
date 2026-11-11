import crypto from 'crypto';
import type express from 'express';
import { verifyIdToken, type DecodedIdToken } from './supabaseAuth';

export function isSystemJobAuthorized(
  decodedToken?: Record<string, unknown> | null,
  providedSecret?: string,
  cronSecret?: string
): boolean {
  if (cronSecret && providedSecret) {
    const a = Buffer.from(cronSecret);
    const b = Buffer.from(providedSecret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  if (decodedToken && (decodedToken.admin === true || decodedToken.role === 'admin')) {
    return true;
  }
  return false;
}

/**
 * Shared route middleware for scheduled/system endpoints that accept either
 * X-Cron-Secret (CRON_SECRET) or a platform-admin Bearer token.
 */
export async function requireSystemJobOrAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] as string | undefined;
  const authHeader = req.headers.authorization;

  let decodedToken: DecodedIdToken | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      decodedToken = await verifyIdToken(token);
    } catch {
      decodedToken = null;
    }
  }

  if (!isSystemJobAuthorized(decodedToken as unknown as Record<string, unknown> | null, providedSecret, cronSecret)) {
    res.status(403).json({
      status: 'error',
      message: 'Forbidden: Requires admin authorization or valid cron secret.',
    });
    return;
  }

  if (decodedToken) {
    (req as express.Request & { user?: DecodedIdToken }).user = decodedToken;
  }
  next();
}
