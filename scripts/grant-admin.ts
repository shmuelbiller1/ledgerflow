/**
 * Makes a user a platform admin: sets app_metadata { admin: true, role: 'admin' } (the token
 * claim the server checks) and marks the users/{uid} profile and admins/{uid} documents.
 *
 * Usage: DATABASE_URL=<Supabase Postgres connection string> npm run grant-admin -- <user id or email>
 */
import { getDb } from '../src/server/db/firestore';
import { authAdmin } from '../src/server/auth/supabaseAuth';
import { writeServerAuditLog } from '../src/server/services/auditLogService';

async function grantAdmin(target: string) {
  const user = target.includes('@') ? await authAdmin.getUserByEmail(target) : await authAdmin.getUser(target);
  await authAdmin.setCustomUserClaims(user.uid, { admin: true, role: 'admin' });

  const db = getDb();
  const now = new Date().toISOString();
  const email = user.email || '';
  await db.collection('users').doc(user.uid).set({ uid: user.uid, email, role: 'admin', updatedAt: now }, { merge: true });
  await db.collection('admins').doc(user.uid).set({ uid: user.uid, email, isAdmin: true, createdAt: now }, { merge: true });
  // #943: a grant from the command line leaves the same audit row as one made in the app
  await writeServerAuditLog({ workspaceId: 'system', uid: 'system:grant-admin-script', email: '', action: 'ADMIN_USER_UPDATED', entityType: 'system',
    entityId: user.uid, details: { description: `Made ${email || user.uid} a platform admin (grant-admin script)`, before: null, after: { role: 'admin' } } }, { db });
  await db.terminate();

  console.log(`${email || user.uid} is now a platform admin. It takes effect at their next sign-in (or within an hour).`);
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run grant-admin -- <USER_UID_OR_EMAIL>');
  process.exit(1);
}
grantAdmin(target).catch(err => {
  console.error('Failed to grant admin:', err instanceof Error ? err.message : err);
  process.exit(1);
});
