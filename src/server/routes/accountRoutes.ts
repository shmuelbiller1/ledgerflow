/**
 * The signed-in person's own account: GET /api/v1/account/my-data (L-10), and recovery codes for
 * two-step login (L-85): GET /recovery-codes (how many are left), POST /recovery-codes (ten new ones,
 * shown once), POST /recovery-codes/use (a password-only session may call it: apiAuthenticate).
 * GET /two-step (Y-30): whether a workspace the person belongs to requires two-step login that this
 * session has not passed, and which (a password-only session may call it, to be told why).
 * Groups of books (DA-01): GET/POST /groups, PUT/DELETE /groups/:id (workspaceGroupService.ts).
 *
 * Every write here is a registered person-scoped command (src/server/commands/account.ts for
 * recovery codes and the notice-email choice, src/server/commands/groups.ts for groups of books);
 * the handlers below only adapt the established request and response shapes to the command runner.
 */
import express from 'express';
import { getDb } from '../db/firestore';
import { collectPersonalData } from '../services/personalDataService';
import type { AuthenticatedRequest } from './workspaceRoutes';
import { recoveryStatus, RecoveryError } from '../services/recoveryCodeService';
import { workspacesRequiringTwoStep } from '../auth/supabaseAuth';
import { getNotificationEmail } from '../services/notificationEmailService';
import { EMAIL_MODES, type NotificationEmailMode } from '../../lib/notificationEmail';
import { listGroups, WorkspaceGroupError } from '../services/workspaceGroupService';
import { practiceRows } from '../services/practiceService';
import { getDateInTimezoneISO } from '../../lib/calendarDate';
import { isEmailShape } from '../../lib/textShape';
import { ZodError } from 'zod';
import { HttpError } from '../auth/requestUser';
import type { CommandExecutionOutcome } from '../commands/types';
import type { CommandRunnerDependencies } from '../utils/commandExecutor';
import {
  accountMakeRecoveryCodesCommand,
  accountSetNotificationEmailCommand,
  accountUseRecoveryCodeCommand,
} from '../commands/account';
import {
  groupCreateCommand,
  groupDeleteCommand,
  groupKeepRatesCommand,
  groupSetLineMergesCommand,
  groupShareCommand,
  groupUnshareCommand,
  groupUpdateCommand,
} from '../commands/groups';

import { BRAND } from '../../config/brand';

/** A retried "make new codes" shows nothing: the codes were shown once, on the first answer. */
const ALREADY_SHOWN = 'These codes were already shown when the request was first made: make new ones if you did not keep them';

/** Recovery codes: the pre-command route answered { status, message } with the RecoveryError's status. */
function recoveryCommandResponse(codesField: 'codes' | 'left') {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) {
      const data = outcome.data as Record<string, unknown>;
      // A replayed "make new codes" has no codes to show (they are kept out of the idempotency
      // record on purpose), and answering "success" with none would look like ten new codes that
      // cannot be read. Say what happened instead; the person can make a fresh set.
      if (codesField === 'codes' && outcome.replayed) {
        return { status: 409, body: { status: 'error', message: ALREADY_SHOWN } };
      }
      return { status: 200, body: { status: 'success', [codesField]: data[codesField] } };
    }
    const err = outcome.error;
    if (err instanceof RecoveryError) return { status: err.status, body: { status: 'error', message: err.message } };
    if (err instanceof ZodError) return { status: 400, body: { status: 'error', message: err.issues[0]?.message || 'Invalid request' } };
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    return {
      status: outcome.status,
      body: { status: 'error', message: 'Recovery codes are not available right now', details: err instanceof Error ? err.message : String(err ?? outcome.message) },
    };
  };
}

/** Groups of books: WorkspaceGroupError and HttpError keep their status and message; anything else is a 500. */
function groupCommandResponse(okStatus: number, buildBody: (data: unknown) => unknown) {
  return (outcome: CommandExecutionOutcome): { status: number; body: unknown } => {
    if (outcome.ok) return { status: okStatus, body: buildBody(outcome.data) };
    const err = outcome.error;
    if (err instanceof WorkspaceGroupError || err instanceof HttpError) return { status: err.status, body: { status: 'error', message: err.message } };
    if (err instanceof ZodError) return { status: 400, body: { status: 'error', message: err.issues[0]?.message || 'Invalid request' } };
    if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
    return {
      status: outcome.status,
      body: { status: 'error', message: 'Groups are not available right now', details: err instanceof Error ? err.message : String(err ?? outcome.message) },
    };
  };
}

const groupBody = (data: unknown) => ({ status: 'success', group: (data as { group: unknown }).group });
const emptyBody = () => ({ status: 'success' });

/** The share route's pre-runner refusals keep their exact pre-command wording. */
const badEmail = (res: express.Response) => res.status(400).json({ status: 'error', message: 'Enter the email they sign in with' });

// Import lazily to avoid the executor's existing workspaceRoutes role-helper cycle during router setup.
// Each write handler calls the returned executeCommand itself so the commands-baseline ratchet sees
// the route as command-run (scripts/commands-baseline.ts).
function personExecutor() {
  return import('../utils/commandExecutor');
}

/** Factory allows the registered routes to be tested with an isolated command runner database. */
export function createAccountRouter(dependencies: CommandRunnerDependencies = {}): express.Router {
  const router = express.Router();

  router.get('/my-data', async (req, res) => {
    const user = (req as unknown as AuthenticatedRequest).user;
    if (!user?.uid) return res.status(401).json({ error: 'Sign in required' });
    try {
      const data = await collectPersonalData(getDb(), { uid: user.uid, email: user.email });
      res.setHeader('Content-Disposition', `attachment; filename="${BRAND.fileSlug}-my-data.json"`);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Could not collect your data' });
    }
  });

  const recoveryFail = (res: express.Response, err: unknown) => {
    if (err instanceof RecoveryError) return res.status(err.status).json({ status: 'error', message: err.message });
    res.status(500).json({ status: 'error', message: 'Recovery codes are not available right now', details: err instanceof Error ? err.message : String(err) });
  };

  router.get('/recovery-codes', async (req, res) => {
    const user = (req as unknown as AuthenticatedRequest).user;
    try { res.json({ status: 'success', ...(await recoveryStatus(getDb(), user.uid)) }); } catch (err) { recoveryFail(res, err); }
  });

  router.post('/recovery-codes', async (req, res) => {
    // The codes are shown once; never let a cache keep the answer (set on errors too — a refusal caches nothing).
    res.setHeader('Cache-Control', 'no-store');
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(accountMakeRecoveryCodesCommand),
      workspaceId: '',
      input: {},
      formatResponse: recoveryCommandResponse('codes'),
    }, dependencies);
  });

  router.post('/recovery-codes/use', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 40) : '';
    if (!code) return res.status(400).json({ status: 'error', message: 'Enter a recovery code' });
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(accountUseRecoveryCodeCommand),
      workspaceId: '',
      input: { code },
      formatResponse: recoveryCommandResponse('left'),
    }, dependencies);
  });

  router.get('/two-step', async (req, res) => {
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
  router.get('/notification-email', async (req, res) => {
    const user = (req as unknown as AuthenticatedRequest).user;
    try { res.json({ status: 'success', mode: await getNotificationEmail(getDb(), user.uid) }); }
    catch (err) { res.status(500).json({ status: 'error', message: 'Could not read the email choice', details: err instanceof Error ? err.message : String(err) }); }
  });

  router.put('/notification-email', async (req, res) => {
    const mode = req.body?.mode as NotificationEmailMode;
    if (!EMAIL_MODES.includes(mode)) return res.status(400).json({ status: 'error', message: 'Choose off, immediate or daily' });
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(accountSetNotificationEmailCommand),
      workspaceId: '',
      input: { mode },
      formatResponse: (outcome) => {
        if (outcome.ok) return { status: 200, body: { status: 'success', mode: (outcome.data as { mode: NotificationEmailMode }).mode } };
        const err = outcome.error;
        if (outcome.status < 500) return { status: outcome.status, body: { status: 'error', message: outcome.message } };
        return { status: outcome.status, body: { status: 'error', message: 'Could not save the email choice', details: err instanceof Error ? err.message : String(err ?? outcome.message) } };
      },
    }, dependencies);
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

  router.get('/groups', async (req, res) => {
    const user = (req as unknown as AuthenticatedRequest).user;
    try { res.json({ status: 'success', groups: await listGroups(getDb(), user.uid) }); } catch (err) { groupFail(res, err); }
  });

  router.post('/groups', async (req, res) => {
    let workspaceIds: string[];
    try {
      workspaceIds = stringList(req.body?.workspaceIds) || [];
    } catch (err) { return groupFail(res, err); }
    const input = {
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      workspaceIds,
      ...structure(req.body),
    };
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupCreateCommand),
      workspaceId: '',
      input,
      formatResponse: groupCommandResponse(201, groupBody),
    }, dependencies);
  });

  router.put('/groups/:id', async (req, res) => {
    let workspaceIds: string[] | undefined;
    try {
      workspaceIds = stringList(req.body?.workspaceIds);
    } catch (err) { return groupFail(res, err); }
    const input = {
      groupId: String(req.params.id),
      name: req.body?.name === undefined ? undefined : String(req.body.name),
      workspaceIds,
      ...structure(req.body),
    };
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupUpdateCommand),
      workspaceId: '',
      input,
      formatResponse: groupCommandResponse(200, groupBody),
    }, dependencies);
  });

  // Z-20: the group's own chart mapping (lines combined in the account-by-account view)
  router.put('/groups/:id/lines', async (req, res) => {
    const input = { groupId: String(req.params.id), merges: req.body?.merges };
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupSetLineMergesCommand),
      workspaceId: '',
      input,
      formatResponse: groupCommandResponse(200, data => ({ status: 'success', merges: (data as { merges: unknown }).merges })),
    }, dependencies);
  });

  // Z-17: keep the translation rates used for a reporting currency and period
  router.put('/groups/:id/rates', async (req, res) => {
    const b = req.body || {};
    const input = { groupId: String(req.params.id), reportCurrency: b.reportCurrency, startDate: b.startDate, endDate: b.endDate, rates: b.rates };
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupKeepRatesCommand),
      workspaceId: '',
      input,
      formatResponse: groupCommandResponse(200, groupBody),
    }, dependencies);
  });

  // BD-01: the Practice view: each workspace the person can open, with what is waiting there
  router.get('/practice', async (req, res) => {
    const user = (req as unknown as AuthenticatedRequest).user;
    try {
      const today = typeof req.query.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) ? req.query.today : getDateInTimezoneISO();
      res.json({ status: 'success', rows: await practiceRows(getDb(), user.uid, today) });
    } catch (err) {
      res.status(500).json({ status: 'error', message: 'The practice view is not available right now', details: err instanceof Error ? err.message : String(err) });
    }
  });

  // DA-01: share a group with someone by their sign-in email; stop sharing, or leave one shared with you
  router.post('/groups/:id/share', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!isEmailShape(email) || email.length > 254) return badEmail(res);
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupShareCommand),
      workspaceId: '',
      input: { groupId: String(req.params.id), email },
      formatResponse: groupCommandResponse(200, groupBody),
    }, dependencies);
  });

  router.delete('/groups/:id/share/:uid', async (req, res) => {
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupUnshareCommand),
      workspaceId: '',
      input: { groupId: String(req.params.id), withUid: String(req.params.uid) },
      formatResponse: groupCommandResponse(200, emptyBody),
    }, dependencies);
  });

  router.delete('/groups/:id', async (req, res) => {
    const { executeCommand, withLegacyInputIdempotencyHash } = await personExecutor();
    await executeCommand(req, res, {
      definition: withLegacyInputIdempotencyHash(groupDeleteCommand),
      workspaceId: '',
      input: { groupId: String(req.params.id) },
      formatResponse: groupCommandResponse(200, emptyBody),
    }, dependencies);
  });

  return router;
}

export const accountRouter = createAccountRouter();
