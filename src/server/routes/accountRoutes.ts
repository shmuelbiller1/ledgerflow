/**
 * The signed-in person's own account: GET /api/v1/account/my-data (L-10), and recovery codes for
 * two-step login (L-85): GET /recovery-codes (how many are left), POST /recovery-codes (ten new ones,
 * shown once), POST /recovery-codes/use (a password-only session may call it: apiAuthenticate).
 * GET /two-step (Y-30): whether a workspace the person belongs to requires two-step login that this
 * session has not passed, and which (a password-only session may call it, to be told why).
 * Groups of books (DA-01): GET/POST /groups, PUT/DELETE /groups/:id (workspaceGroupService.ts).
 */
import express from 'express';
import { getDb } from '../db/firestore';
import { collectPersonalData } from '../services/personalDataService';
import type { AuthenticatedRequest } from './workspaceRoutes';
import { makeRecoveryCodes, recoveryStatus, RecoveryError, useRecoveryCode } from '../services/recoveryCodeService';
import { workspacesRequiringTwoStep } from '../auth/supabaseAuth';
import { getNotificationEmail, setNotificationEmail } from '../services/notificationEmailService';
import { EMAIL_MODES, type NotificationEmailMode } from '../../lib/notificationEmail';
import { createGroup, deleteGroup, keepRates, listGroups, setLineMerges, shareGroup, unshareGroup, updateGroup, WorkspaceGroupError } from '../services/workspaceGroupService';
import { authAdmin } from '../auth/supabaseAuth';
import { practiceRows } from '../services/practiceService';
import { getDateInTimezoneISO } from '../../lib/calendarDate';

export const accountRouter = express.Router();

accountRouter.get('/my-data', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  if (!user?.uid) return res.status(401).json({ error: 'Sign in required' });
  try {
    const data = await collectPersonalData(getDb(), { uid: user.uid, email: user.email });
    res.setHeader('Content-Disposition', 'attachment; filename="ledgerflow-my-data.json"');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not collect your data' });
  }
});

const recoveryFail = (res: express.Response, err: unknown) => {
  if (err instanceof RecoveryError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'Recovery codes are not available right now', details: err instanceof Error ? err.message : String(err) });
};

accountRouter.get('/recovery-codes', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try { res.json({ status: 'success', ...(await recoveryStatus(getDb(), user.uid)) }); } catch (err) { recoveryFail(res, err); }
});

accountRouter.post('/recovery-codes', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try {
    const codes = await makeRecoveryCodes(getDb(), user.uid);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'success', codes });
  } catch (err) { recoveryFail(res, err); }
});

accountRouter.post('/recovery-codes/use', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 40) : '';
  if (!code) return res.status(400).json({ status: 'error', message: 'Enter a recovery code' });
  try { res.json({ status: 'success', ...(await useRecoveryCode(getDb(), user.uid, code)) }); } catch (err) { recoveryFail(res, err); }
});

accountRouter.get('/two-step', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user as AuthenticatedRequest['user'] & { aal?: string; is_anonymous?: boolean };
  try {
    const workspaces = user.is_anonymous ? [] : await workspacesRequiringTwoStep(user.uid);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'success', setupRequired: user.aal !== 'aal2' && workspaces.length > 0, workspaces });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Could not check two-step login', details: err instanceof Error ? err.message : String(err) });
  }
});

// S-18: whether notices also come by email (off, each as it happens, one a day)
accountRouter.get('/notification-email', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try { res.json({ status: 'success', mode: await getNotificationEmail(getDb(), user.uid) }); }
  catch (err) { res.status(500).json({ status: 'error', message: 'Could not read the email choice', details: err instanceof Error ? err.message : String(err) }); }
});

accountRouter.put('/notification-email', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  const mode = req.body?.mode as NotificationEmailMode;
  if (!EMAIL_MODES.includes(mode)) return res.status(400).json({ status: 'error', message: 'Choose off, immediate or daily' });
  try { res.json({ status: 'success', mode: await setNotificationEmail(getDb(), user.uid, mode) }); }
  catch (err) { res.status(500).json({ status: 'error', message: 'Could not save the email choice', details: err instanceof Error ? err.message : String(err) }); }
});

// DA-01: the person's own groups of books; only workspaces they can open are added or shown
const groupFail = (res: express.Response, err: unknown) => {
  if (err instanceof WorkspaceGroupError) return res.status(err.status).json({ status: 'error', message: err.message });
  res.status(500).json({ status: 'error', message: 'Groups are not available right now', details: err instanceof Error ? err.message : String(err) });
};
const stringList = (value: unknown) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new WorkspaceGroupError(400, 'Choose the workspaces of the group');
  return value.map(v => String(v));
};

// Z-16: the parent company (a member id, or null for none), the share it owns of each other member and
// the parent's account holding its investment in each;
// anything else is passed on as it came, so the service refuses it with a reason
const structure = (body: Record<string, unknown> | undefined) => ({
  ...(body?.parentId !== undefined ? { parentId: body.parentId as string | null } : {}),
  ...(body?.ownership !== undefined ? { ownership: body.ownership as Record<string, number> } : {}),
  ...(body?.investments !== undefined ? { investments: body.investments as Record<string, string> } : {}),
  ...(body?.acquired !== undefined ? { acquired: body.acquired as Record<string, string> } : {}),
});

accountRouter.get('/groups', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try { res.json({ status: 'success', groups: await listGroups(getDb(), user.uid) }); } catch (err) { groupFail(res, err); }
});

accountRouter.post('/groups', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try {
    const group = await createGroup(getDb(), { uid: user.uid, name: typeof req.body?.name === 'string' ? req.body.name : '', workspaceIds: stringList(req.body?.workspaceIds) || [], ...structure(req.body) });
    res.status(201).json({ status: 'success', group });
  } catch (err) { groupFail(res, err); }
});

accountRouter.put('/groups/:id', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try {
    const name = req.body?.name === undefined ? undefined : String(req.body.name);
    res.json({ status: 'success', group: await updateGroup(getDb(), { uid: user.uid, groupId: String(req.params.id), name, workspaceIds: stringList(req.body?.workspaceIds), ...structure(req.body) }) });
  } catch (err) { groupFail(res, err); }
});

// Z-20: the group's own chart mapping (lines combined in the account-by-account view)
accountRouter.put('/groups/:id/lines', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try { res.json({ status: 'success', merges: await setLineMerges(getDb(), { uid: user.uid, groupId: String(req.params.id), merges: req.body?.merges }) }); } catch (err) { groupFail(res, err); }
});

// Z-17: keep the translation rates used for a reporting currency and period
accountRouter.put('/groups/:id/rates', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try {
    const b = req.body || {};
    res.json({ status: 'success', group: await keepRates(getDb(), { uid: user.uid, groupId: String(req.params.id), reportCurrency: b.reportCurrency, startDate: b.startDate, endDate: b.endDate, rates: b.rates }) });
  } catch (err) { groupFail(res, err); }
});

// BD-01: the Practice view: each workspace the person can open, with what is waiting there
accountRouter.get('/practice', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try {
    const today = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : getDateInTimezoneISO();
    res.json({ status: 'success', rows: await practiceRows(getDb(), user.uid, today) });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'The practice view is not available right now', details: err instanceof Error ? err.message : String(err) });
  }
});

// DA-01: share a group with someone by their sign-in email; stop sharing, or leave one shared with you
accountRouter.post('/groups/:id/share', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return res.status(400).json({ status: 'error', message: 'Enter the email they sign in with' });
  try {
    let withUid = '';
    try { withUid = (await authAdmin.getUserByEmail(email)).uid; } catch { /* answered below */ }
    if (!withUid) return res.status(404).json({ status: 'error', message: 'No one signs in to LedgerFlow with that email yet: ask them to sign up first' });
    res.json({ status: 'success', group: await shareGroup(getDb(), { uid: user.uid, email: user.email, groupId: String(req.params.id), withUid, withEmail: email }) });
  } catch (err) { groupFail(res, err); }
});

accountRouter.delete('/groups/:id/share/:uid', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try { await unshareGroup(getDb(), { uid: user.uid, groupId: String(req.params.id), withUid: String(req.params.uid) }); res.json({ status: 'success' }); } catch (err) { groupFail(res, err); }
});

accountRouter.delete('/groups/:id', async (req, res) => {
  const user = (req as unknown as AuthenticatedRequest).user;
  try { await deleteGroup(getDb(), { uid: user.uid, groupId: String(req.params.id) }); res.json({ status: 'success' }); } catch (err) { groupFail(res, err); }
});
