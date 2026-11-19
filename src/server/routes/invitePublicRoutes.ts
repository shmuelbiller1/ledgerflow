import { errorMessage } from '../auth/requestUser';
import type { UserRequest } from '../auth/requestUser';
import express from 'express';
import { verifyIdToken } from '../auth/supabaseAuth';
import { getDb } from '../db/firestore';
import { verifyInviteTokenSignature } from '../../lib/inviteManager';
import { inviteAcceptCommand, inviteTokenParamsSchema } from '../commands/invites';
import { executeCommand } from '../utils/commandExecutor';

import { BRAND_NAME } from '../../config/brand';
export const invitePublicRouter = express.Router();

const populateUserAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = await verifyIdToken(token);
      (req as UserRequest).user = decoded;
    } catch {
      // Ignore token decoding failure for public GET lookup
    }
  }
  next();
};

invitePublicRouter.use(populateUserAuth);

function sendError(res: express.Response, message: string, status: number = 500, details?: unknown) {
  res.status(status).json({
    status: 'error',
    message,
    ...(details ? { details } : {})
  });
}

/**
 * Public route to lookup an invite by token signature and check validity
 */
invitePublicRouter.get('/:token', async (req, res) => {
  const parsedParams = inviteTokenParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendError(res, 'Invalid invite token format', 400, parsedParams.error.issues);
  }
  const { token } = parsedParams.data;

  try {
    const db = getDb();
    const snap = await db.collection('invites').where('token', '==', token).limit(1).get();

    if (snap.empty) {
      return sendError(res, 'Invite not found or invalid token', 404);
    }

    const doc = snap.docs[0];
    const invite = doc.data() as Parameters<typeof verifyInviteTokenSignature>[0] & { status?: string };

    if (invite.status !== 'pending') {
      return sendError(res, `Invite has already been ${invite.status}`, 400);
    }

    if (new Date() > new Date(invite.expiresAt)) {
      return sendError(res, 'Invite has expired', 400);
    }

    const isValidSig = verifyInviteTokenSignature(invite);
    if (!isValidSig) {
      return sendError(res, 'Invalid invite token signature', 400);
    }

    // Get workspace name for display
    const wsDoc = await db.collection('workspaces').doc(invite.workspaceId).get();
    const workspaceName = wsDoc.exists ? (wsDoc.data()?.name || `${BRAND_NAME} Workspace`) : `${BRAND_NAME} Workspace`;

    res.json({
      status: 'success',
      invite: {
        id: doc.id,
        workspaceId: invite.workspaceId,
        workspaceName,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        status: invite.status
      }
    });
  } catch (err) {
    sendError(res, 'Failed to lookup invite', 500, errorMessage(err));
  }
});

/**
 * Authenticated endpoint to accept an invite
 */
invitePublicRouter.post('/:token/accept', async (req, res) => {
  const parsedParams = inviteTokenParamsSchema.safeParse(req.params);
  if (!parsedParams.success) return sendError(res, 'Invalid invite token format', 400, parsedParams.error.issues);
  return executeCommand(req, res, {
    definition: inviteAcceptCommand, workspaceId: '', input: parsedParams.data,
    legacyRoute: true, legacyOperationId: 'ignore',
    formatResponse: result => {
      if (result.ok) return { status: 200, body: { status: 'success', ...(result.data as Record<string, unknown>), message: 'Successfully joined workspace' } };
      if (result.status >= 500) return { status: 500, body: { status: 'error', message: 'Failed to accept invite', details: errorMessage(result.error) } };
      const message = result.code === 'UNAUTHENTICATED' ? 'Authentication required to accept invite' : result.message;
      return { status: result.status, body: { status: 'error', message } };
    },
  });
});
