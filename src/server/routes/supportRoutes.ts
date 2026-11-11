import { errorMessage, requestUser } from '../auth/requestUser';
import express from 'express';
import { z } from 'zod';
import { getDb, isWorkspaceMemberData } from '../db/firestore';
import { SupportMessage, SupportTicket } from '../../types';
import { sendSupportNotification } from '../services/emailService';
import { writeServerAuditLog } from '../services/auditLogService';

const AddSupportMessageSchema = z.object({
  body: z.string().min(1, 'Message body is required').max(5000, 'Message body must be under 5000 characters'),
  authorRole: z.enum(['user', 'admin'])
});

const UpdateSupportStatusSchema = z.object({
  status: z.enum(['open', 'pending_user', 'pending_support', 'resolved', 'closed'])
});

export const supportRouter = express.Router();

/**
 * POST /api/v1/support/tickets/:id/messages
 * Adds a message to a support ticket and updates the ticket status/unread flags.
 */
supportRouter.post('/tickets/:id/messages', async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const parseResult = AddSupportMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        error: 'Validation failed',
        details: parseResult.error.issues
      });
    }

    const { body, authorRole } = parseResult.data;
    const user = requestUser(req);

    const db = getDb();
    const ticketRef = db.collection('supportTickets').doc(ticketId);
    
    const result = await db.runTransaction(async (t) => {
      const ticketDoc = await t.get(ticketRef);
      if (!ticketDoc.exists) {
        throw new Error('Ticket not found');
      }

      const ticketData = ticketDoc.data() as SupportTicket;

      // Authorization Check
      const isAdminUser = Boolean(user.admin || user.role === 'admin');
      if (authorRole === 'admin') {
        if (!isAdminUser) {
          throw new Error('Forbidden: Admin role required');
        }
      } else {
        // User must be a member of the workspace or ticket owner or platform admin
        const wsDoc = await t.get(db.collection('workspaces').doc(ticketData.workspaceId));
        const isOwner = ticketData.uid === user.uid;
        const isMember = wsDoc.exists && isWorkspaceMemberData(wsDoc.data(), user, ticketData.workspaceId);
        if (!isAdminUser && !isOwner && !isMember) {
          throw new Error('Forbidden: Access denied to this workspace');
        }
      }

      const messageId = db.collection('supportMessages').doc().id;
      const createdAt = new Date().toISOString();

      const newMessage: SupportMessage = {
        id: messageId,
        ticketId,
        workspaceId: ticketData.workspaceId,
        authorUid: user.uid,
        authorRole: authorRole as 'user' | 'admin',
        body,
        createdAt
      };

      const messageRef = db.collection('supportMessages').doc(messageId);
      t.set(messageRef, newMessage);

      // Update ticket
      const ticketUpdates: Partial<SupportTicket> = {
        lastMessageAt: createdAt,
        lastMessageBy: user.uid,
        updatedAt: createdAt,
        unreadForUser: authorRole === 'admin',
        unreadForAdmin: authorRole === 'user',
      };

      if (authorRole === 'admin') {
        ticketUpdates.status = 'pending_user';
      } else {
        ticketUpdates.status = 'pending_support';
      }

      t.update(ticketRef, ticketUpdates);

      // Audit Log for admin actions
      if (authorRole === 'admin') {
        await writeServerAuditLog({
          workspaceId: ticketData.workspaceId || 'system',
          uid: user.uid,
          email: user.email || '',
          action: 'SUPPORT_ADMIN_REPLY',
          entityType: 'supportTicket',
          entityId: ticketId,
          details: {
            description: `Admin replied to support ticket ${ticketId}`,
            body: body.substring(0, 100)
          }
        }, { db, tx: t });
      }

      return { newMessage, ticketData };
    });

    // If admin reply, send email notification
    if (authorRole === 'admin') {
      try {
        const openerDoc = await db.collection('users').doc(result.ticketData.uid).get();
        const openerData = openerDoc.data();
        if (openerData?.email) {
          await sendSupportNotification({
            toEmail: openerData.email,
            subject: `Support Update: ${result.ticketData.subject}`,
            ticketSubject: result.ticketData.subject,
            messageBody: body
          });
        }
      } catch (emailErr) {
        console.error('Failed to send support notification email:', emailErr);
        // Don't fail the request if email fails
      }
    }

    res.status(200).json({ status: 'ok', data: result.newMessage });
  } catch (e) {
    console.error('Support message error:', e);
    res.status(errorMessage(e).includes('Forbidden') ? 403 : 400).json({ error: errorMessage(e) });
  }
});

/**
 * PATCH /api/v1/support/tickets/:id/status
 * Admin-only status update for tickets.
 */
supportRouter.patch('/tickets/:id/status', async (req, res) => {
  try {
    const { id: ticketId } = req.params;
    const parseResult = UpdateSupportStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        status: 'error',
        error: 'Validation failed',
        details: parseResult.error.issues
      });
    }

    const { status } = parseResult.data;
    const user = requestUser(req);

    const isAdminUser = Boolean(user?.admin || user?.role === 'admin');
    if (!isAdminUser) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const db = getDb();
    const ticketRef = db.collection('supportTickets').doc(ticketId);

    await db.runTransaction(async (t) => {
      const ticketDoc = await t.get(ticketRef);
      if (!ticketDoc.exists) {
        throw new Error('Ticket not found');
      }

      t.update(ticketRef, { 
        status, 
        updatedAt: new Date().toISOString() 
      });

      await writeServerAuditLog({
        workspaceId: ticketDoc.data()?.workspaceId || 'system',
        uid: user.uid,
        email: user.email || '',
        action: 'SUPPORT_TICKET_STATUS_CHANGE',
        entityType: 'supportTicket',
        entityId: ticketId,
        details: {
          description: `Support ticket ${ticketId} status changed to ${status}`,
          newStatus: status
        }
      }, { db, tx: t });
    });

    res.status(200).json({ status: 'ok' });
  } catch (e) {
    res.status(400).json({ error: errorMessage(e) });
  }
});
