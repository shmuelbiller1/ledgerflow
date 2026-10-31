import { errorMessage, requestUser } from '../auth/requestUser';
import type { UserRequest } from '../auth/requestUser';
import express from 'express';
import { verifyIdToken } from '../auth/supabaseAuth';
import { z } from 'zod';
import { getDb } from '../db/firestore';
import { verifyInviteTokenSignature } from '../../lib/inviteManager';
import { notify } from '../services/notificationService';
import { writeServerAuditLog } from '../services/auditLogService';
import { planFor } from '../../lib/plans';

export const invitePublicRouter = express.Router();

const inviteTokenParamsSchema = z.object({
  token: z.string().min(10, 'Token too short').max(256, 'Token too long')
});

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

function sendError(res: express.Response, message: string, status: number = 500, details?: any) {
  res.status(status).json({
    status: 'error',
    message,
    ...(details && { details })
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
    const invite = doc.data() as any;

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
    const workspaceName = wsDoc.exists ? (wsDoc.data()?.name || 'LedgerFlow Workspace') : 'LedgerFlow Workspace';

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
  if (!parsedParams.success) {
    return sendError(res, 'Invalid invite token format', 400, parsedParams.error.issues);
  }
  const { token } = parsedParams.data;
  const user = requestUser(req);

  if (!user || !user.uid) {
    return sendError(res, 'Authentication required to accept invite', 401);
  }

  try {
    const db = getDb();
    const snap = await db.collection('invites').where('token', '==', token).limit(1).get();

    if (snap.empty) {
      return sendError(res, 'Invite not found or invalid token', 404);
    }

    const inviteDoc = snap.docs[0];
    const invite = inviteDoc.data() as any;

    if (invite.status !== 'pending') {
      return sendError(res, `Invite is no longer pending (currently ${invite.status})`, 400);
    }

    if (new Date() > new Date(invite.expiresAt)) {
      return sendError(res, 'Invite has expired', 400);
    }

    const isValidSig = verifyInviteTokenSignature(invite);
    if (!isValidSig) {
      return sendError(res, 'Invalid invite token signature', 400);
    }

    // Email binding verification
    const userEmail = (user.email || '').toLowerCase().trim();
    const inviteEmail = (invite.email || '').toLowerCase().trim();

    if (userEmail !== inviteEmail) {
      return sendError(
        res,
        `This invitation was issued to ${invite.email}, but you are currently signed in as ${user.email}. Please sign in with ${invite.email} to accept this invite.`,
        403
      );
    }

    const wsRef = db.collection('workspaces').doc(invite.workspaceId);
    
    await db.runTransaction(async (tx) => {
      const wsSnap = await tx.get(wsRef);
      if (!wsSnap.exists) throw new Error('WORKSPACE_NOT_FOUND');

      const wsData = wsSnap.data() || {};
      const members: string[] = Array.isArray(wsData.members) ? [...wsData.members] : [];
      // the plan's own seats when no explicit cap is set (Codex on #460: Pro is 25, not 5); never below the old 5
      const maxSeats = wsData.maxSeats || Math.max(5, planFor(String(wsData.plan || 'free')).limits.seats);

      if (wsData.bypassBilling !== true && !members.includes(user.uid) && members.length + 1 >= maxSeats) {
        throw new Error('SEAT_LIMIT_EXCEEDED');
      }

      if (!members.includes(user.uid)) {
        members.push(user.uid);
      }

      const roles = { ...(wsData.roles || {}) };
      roles[user.uid] = invite.role;

      tx.update(wsRef, {
        members,
        roles,
        updatedAt: new Date().toISOString()
      });

      tx.update(inviteDoc.ref, {
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        acceptedByUid: user.uid,
        updatedAt: new Date().toISOString()
      });

      // Audit log entry
      await writeServerAuditLog({
        workspaceId: invite.workspaceId,
        uid: user.uid,
        email: user.email || '',
        action: 'INVITE_ACCEPTED',
        entityType: 'workspace',
        entityId: invite.workspaceId,
        details: {
          email: invite.email,
          role: invite.role,
          inviteId: inviteDoc.id,
          description: `User ${user.email} accepted workspace invitation as ${invite.role}`
        }
      }, { db, tx });
    });

    await notify(db, {
      workspaceId: invite.workspaceId, kind: 'member.joined',
      title: `${user.email || invite.email} joined the workspace`,
      message: `They accepted the invitation as ${invite.role}.`,
      eventKey: `member.joined:${inviteDoc.id}`, actorUid: user.uid,
    });
    res.json({
      status: 'success',
      workspaceId: invite.workspaceId,
      role: invite.role,
      message: 'Successfully joined workspace'
    });
  } catch (err) {
    if (errorMessage(err) === 'WORKSPACE_NOT_FOUND') return sendError(res, 'Workspace not found', 404);
    if (errorMessage(err) === 'SEAT_LIMIT_EXCEEDED') {
      return sendError(res, 'Payment Required: Workspace seat limit reached. The workspace owner must upgrade the plan.', 402);
    }
    sendError(res, 'Failed to accept invite', 500, errorMessage(err));
  }
});
