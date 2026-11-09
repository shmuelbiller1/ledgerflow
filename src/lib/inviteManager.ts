import { createHmac, timingSafeEqual } from 'node:crypto';
import { WorkspaceInvite } from '../types';

export function getInviteSecret(): string {
  const secret = process.env.INVITE_SECRET || process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? (process.env.SYSTEM_SALT || 'dev-invite-secret-key-12345') : undefined);
  if (!secret) {
    throw new Error('INVITE_SECRET or JWT_SECRET environment variable is required for signing and verifying workspace invites.');
  }
  return secret;
}

export function generateInviteToken(
  workspaceId: string,
  email: string,
  role: 'owner' | 'accountant' | 'bookkeeper' | 'viewer' = 'viewer',
  secretKey = getInviteSecret()
): WorkspaceInvite {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const inviteId = `inv_${Math.random().toString(36).substring(2, 11)}`;
  const cleanEmail = email.toLowerCase().trim();

  const token = createHmac('sha256', secretKey)
    .update(`${workspaceId}:${cleanEmail}:${role}:${expiresAt}:${inviteId}`)
    .digest('hex');

  return {
    id: inviteId,
    inviteId,
    workspaceId,
    email: cleanEmail,
    role,
    expiresAt,
    token,
    signature: token,
    status: 'pending'
  };
}

export function verifyInviteTokenSignature(
  invite: { workspaceId: string; email: string; role?: string; expiresAt: string; inviteId?: string; id?: string; token: string; signature?: string },
  secretKey = getInviteSecret()
): boolean {
  const inviteId = invite.inviteId || invite.id || '';
  const cleanEmail = invite.email.toLowerCase().trim();
  const role = invite.role || 'viewer';
  const expectedToken = createHmac('sha256', secretKey)
    .update(`${invite.workspaceId}:${cleanEmail}:${role}:${invite.expiresAt}:${inviteId}`)
    .digest('hex');

  const providedToken = invite.token || invite.signature || '';
  const bufA = Buffer.from(providedToken, 'hex');
  const bufB = Buffer.from(expectedToken, 'hex');

  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

