import { errorMessage, HttpError, requestUser } from '../auth/requestUser';
import { Request, Response } from 'express';
import type { Firestore, Transaction as CommandTransaction } from '../db/firestore';
import { isWorkspaceMemberData } from '../db/firestore';
import { roleInWorkspace } from '../middleware/requireLedgerWriter';
import { requirePlanCapacity } from '../middleware/planCapacity';
import { lockMessage, postingLock } from '../../lib/periodLock';
import { writeServerAuditLog } from '../services/auditLogService';
import type { CommandDefinition, CommandExecutionOutcome, CommandInvocation, CommandPreviewOutcome, CommandRole } from '../commands/types';
import type { Transaction as FirestoreTransaction } from '../db/firestore';
import { getDb } from '../db/firestore';
import {
  requestPayloadHash,
  executeIdempotent,
  extractCanonicalOperationId,
  deriveScopedOperationKey,
  assertSameRequest,
} from './idempotency';
import { logSafe, logSafeDetail } from './logSafe';
import { ZodError, type ZodType } from 'zod';

export interface CommandContext {
  actor: string;
  workspaceId: string;
  operationType: string;
  operationId?: string;
}

/**
 * Legacy routes can assemble command input from both the request body and URL parameters. Hash the
 * validated input so reusing an operation ID for another path target is rejected instead of replayed.
 */
export function withLegacyInputIdempotencyHash<Schema extends ZodType, Result, Prepared>(
  definition: CommandDefinition<Schema, Result, Prepared>,
): CommandDefinition<Schema, Result, Prepared> {
  const customHash = definition.idempotencyHash;
  return {
    ...definition,
    idempotencyHash(ctx, input, prepared, req) {
      const commandSpecificHash = customHash?.(ctx, input, prepared, req);
      return commandSpecificHash === undefined
        ? requestPayloadHash(input)
        : requestPayloadHash({ input, commandSpecificHash });
    },
  };
}

/**
 * Standardizes command execution with idempotency across legacy callers. New routes pass a
 * CommandInvocation and use the registered-command pipeline below; the string overload remains
 * only while old routes are converted in small batches.
 */
async function executeLegacyCommand<T>(
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
      console.error('[CommandExecutor:%s] Idempotent operation %s failed:', correlationId, logSafe(scopedKey), logSafeDetail(error));
      return res.status(status).json({
        status: 'error',
        message: 'An internal server error occurred.',
        correlationId
      });
    }
    console.error('[CommandExecutor] Idempotent operation %s failed:', logSafe(scopedKey), logSafeDetail(error));
    return res.status(status).json({
      status: 'error',
      message: errorMessage(error),
      details: (error as { details?: unknown }).details
    });
  }
}

export interface CommandRunnerDependencies {
  getDb?(): Firestore;
  auditWriter?: typeof writeServerAuditLog;
  checkCapacity?(req: Request, workspaceId: string, resource: Parameters<typeof requirePlanCapacity>[0], db: Firestore, input: unknown): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

class CommandRefusal extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'CommandRefusal';
  }
}

async function enforcePlanCapacity(
  req: Request,
  workspaceId: string,
  resource: Parameters<typeof requirePlanCapacity>[0],
  db: Firestore,
  input: unknown,
): Promise<void> {
  const capacityReq = Object.create(req) as Request;
  capacityReq.params = { ...req.params, workspaceId };
  capacityReq.body = { ...(isRecord(req.body) ? req.body : {}), ...(isRecord(input) ? input : {}), workspaceId };
  let completed = false;
  let refusal: { status: number; body: unknown } | undefined;
  await new Promise<void>((resolve, reject) => {
    const response = {
      status(code: number) {
        refusal = { status: code, body: undefined };
        return this;
      },
      json(body: unknown) {
        if (refusal) refusal.body = body;
        completed = true;
        resolve();
        return this;
      },
    } as unknown as Response;
    void requirePlanCapacity(resource, db)(capacityReq, response, error => {
      if (error) reject(error);
      else {
        completed = true;
        resolve();
      }
    });
  });
  if (!completed) return;
  if (refusal) {
    const body = isRecord(refusal.body) ? refusal.body : {};
    throw new CommandRefusal(String(body.message || body.error || 'Plan capacity check refused this command'), refusal.status, typeof body.code === 'string' ? body.code : 'PLAN_CAPACITY_EXCEEDED', body);
  }
}

function defaultResponse(outcome: CommandExecutionOutcome): { status: number; body: unknown } {
  if (outcome.ok) {
    return { status: outcome.status, body: { status: 'success', command: outcome.command, data: outcome.data, replayed: outcome.replayed } };
  }
  return {
    status: outcome.status,
    body: {
      status: 'error',
      command: outcome.command,
      message: outcome.message,
      ...(outcome.code ? { code: outcome.code } : {}),
      ...(outcome.details !== undefined ? { details: outcome.details } : {}),
    },
  };
}

function errorOutcome(error: unknown, command: string): CommandExecutionOutcome {
  if (error instanceof ZodError) {
    return { ok: false, status: 400, command, message: 'Invalid command input', code: 'INVALID_INPUT', details: error.issues, error };
  }
  const status = Number((error as { status?: unknown } | null)?.status) || 500;
  const body = (error as { body?: unknown } | null)?.body;
  const code = typeof (error as { code?: unknown } | null)?.code === 'string'
    ? String((error as { code: string }).code)
    : status === 409 ? 'CONFLICT' : status === 403 ? 'FORBIDDEN' : undefined;
  const message = status >= 500 ? 'An internal server error occurred.' : errorMessage(error);
  return {
    ok: false,
    status,
    command,
    message,
    ...(code ? { code } : {}),
    ...((error as { details?: unknown } | null)?.details !== undefined ? { details: (error as { details?: unknown }).details } : {}),
    ...(body !== undefined ? { details: body } : {}),
    error,
  };
}

function previewErrorOutcome(error: unknown, command: string): Exclude<CommandPreviewOutcome, { ok: true }> {
  const outcome = errorOutcome(error, command);
  return outcome.ok
    ? { ok: false, status: 500, command, message: 'Command preview failed', code: 'PREVIEW_FAILED' }
    : outcome;
}

/**
 * Commands a workspace scheduled for deletion still accepts: cancelling the deletion, and retention
 * (a legal hold or a longer grace period), which must stay possible until the purge runs.
 */
const PENDING_DELETION_ALLOWED = new Set(['workspace.canceldeletion', 'workspace.retention']);

function assertWorkspaceActiveForCommand(workspace: Record<string, unknown>, commandName: string): void {
  if (workspace.concurrentUserLimit === 0) {
    throw new CommandRefusal('Forbidden: This workspace is administratively suspended/frozen by Systems Administration.', 403, 'WORKSPACE_FROZEN');
  }
  if (workspace.status === 'pending_deletion' && !PENDING_DELETION_ALLOWED.has(commandName)) {
    throw new CommandRefusal('This workspace is scheduled for deletion and cannot accept changes. Restore it first.', 409, 'WORKSPACE_PENDING_DELETION');
  }
}

/** The idempotency and audit scope of a person-scoped command (no workspace gates it). */
export function personCommandScope(uid: string): string {
  return `person:${uid}`;
}

type CommandAccessRefusal = Extract<CommandExecutionOutcome, { ok: false }>;

interface CommandAccess {
  user: NonNullable<ReturnType<typeof requestUser>>;
  personScope: boolean;
  workspaceId: string;
  db: ReturnType<typeof getDb>;
  workspace: Record<string, unknown>;
  role: CommandRole;
}

/**
 * The gates every command call passes before its own input is read: a signed-in person, a workspace
 * the caller may see (and, for a person-scoped command, their own scope), a role the command allows,
 * and — when the caller asks — a workspace that is still open for changes. Execution and preview ask
 * the same questions here, so a preview can never answer for a command the runner would refuse.
 */
async function commandAccess(
  req: Request,
  invocation: CommandInvocation,
  dependencies: CommandRunnerDependencies,
  options: { assertActive: boolean },
): Promise<CommandAccess | { refusal: CommandAccessRefusal } | { refused: unknown }> {
  const command = invocation.definition;
  const user = requestUser(req);
  if (!user?.uid) return { refusal: { ok: false, status: 401, command: command.name, message: 'Sign in required', code: 'UNAUTHENTICATED' } };
  const personScope = command.scope === 'person';
  const workspaceId = personScope
    ? personCommandScope(user.uid)
    : (typeof invocation.workspaceId === 'string' ? invocation.workspaceId.trim() : '');
  if (!workspaceId) return { refusal: { ok: false, status: 400, command: command.name, message: 'Workspace ID is required', code: 'WORKSPACE_REQUIRED' } };
  if (!personScope && user.developerWorkspaceId && user.developerWorkspaceId !== workspaceId) {
    return { refusal: { ok: false, status: 403, command: command.name, message: `Forbidden: API key is scoped strictly to workspace ${user.developerWorkspaceId}`, code: 'WORKSPACE_SCOPE' } };
  }
  // A command that mints or revokes access is a person's to run: an API key holding a broad scope
  // must not be able to grant itself another key, or a wider one, by calling the command router.
  if (command.peopleOnly && user.usedApiKeyId) {
    return { refusal: { ok: false, status: 403, command: command.name, message: 'Forbidden: this command is for a signed-in person, not an API key', code: 'PERSON_ONLY' } };
  }

  const db = (dependencies.getDb || getDb)();
  let workspace: Record<string, unknown> = {};
  let role: CommandRole = 'owner';
  if (!personScope) {
    try {
      const snapshot = await db.collection('workspaces').doc(workspaceId).get();
      if (!snapshot.exists) throw new CommandRefusal('Workspace not found', 404, 'WORKSPACE_NOT_FOUND');
      const data = snapshot.data() || {};
      if (!isWorkspaceMemberData(data, user, workspaceId)) throw new CommandRefusal('Not a member of this workspace', 403, 'NOT_A_MEMBER');
      const workspaceRole = roleInWorkspace(data, user.uid) as CommandRole;
      const platformAdminOverride = command.allowPlatformAdmin === true && user.admin === true && !user.developerWorkspaceId;
      if (!command.roles.includes(workspaceRole) && !platformAdminOverride) {
        throw new CommandRefusal(`Forbidden: command ${command.name} requires one of [${command.roles.join(', ')}]`, 403, 'ROLE_REQUIRED');
      }
      if (options.assertActive) assertWorkspaceActiveForCommand(data, command.name);
      role = workspaceRole;
      workspace = data;
    } catch (error) {
      return { refused: error };
    }
  }
  return { user, personScope, workspaceId, db, workspace, role };
}

/** The runner behind both the command router and the legacy wrappers (exported so a test can hold each to its gate). */
export async function runRegisteredCommand(
  req: Request,
  invocation: CommandInvocation,
  dependencies: CommandRunnerDependencies = {},
): Promise<CommandExecutionOutcome> {
  const command = invocation.definition;
  const access = await commandAccess(req, invocation, dependencies, { assertActive: true });
  if ('refusal' in access) return access.refusal;
  if ('refused' in access) return errorOutcome(access.refused, command.name);
  const { user, personScope, workspaceId, db, role, workspace } = access;

  if (command.risk === 'high' && !invocation.legacyRoute && (user.developerWorkspaceId || user.aal !== 'aal2')) {
    return { ok: false, status: 403, command: command.name, message: 'High-risk commands require a person signed in with two-step verification; API keys cannot confirm this step.', code: 'TWO_STEP_REQUIRED' };
  }

  const parsed = command.input.safeParse(invocation.input);
  if (!parsed.success) return errorOutcome(parsed.error, command.name);
  if (isRecord(parsed.data) && typeof parsed.data.workspaceId === 'string' && parsed.data.workspaceId !== workspaceId) {
    return { ok: false, status: 400, command: command.name, message: 'Input workspaceId must match the command workspace', code: 'WORKSPACE_MISMATCH' };
  }
  const input = parsed.data;
  const operationId = extractCanonicalOperationId(req) || command.defaultOperationId?.(input);
  if (operationId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(operationId)) {
    return { ok: false, status: 400, command: command.name, message: 'Invalid operation ID', code: 'INVALID_OPERATION_ID' };
  }

  const operationType = command.operationType || command.name;
  const initialContext = {
    actor: user.uid,
    email: user.email,
    workspaceId,
    role,
    user,
    db,
    workspace,
    ...(operationId ? { operationId } : {}),
  };
  const datedValue = command.dated ? valueAtPath(input, command.dated) : undefined;
  let date: string | undefined;
  try {
    date = (typeof datedValue === 'string' ? datedValue : undefined) || command.resolveDate?.(initialContext, input);
  } catch (error) {
    return errorOutcome(error, command.name);
  }
  const hashContext = { ...initialContext, ...(date ? { effectiveDate: date } : {}) };
  let payloadHash: string;
  try {
    payloadHash = command.idempotencyHash?.(hashContext, input, undefined, req) ?? requestPayloadHash(req.body);
  } catch (error) {
    return errorOutcome(error, command.name);
  }
  if (operationId) {
    try {
      const scopedKey = deriveScopedOperationKey(workspaceId, operationType, operationId);
      const previous = await db.collection('idempotencyKeys').doc(scopedKey).get();
      const record = previous.data();
      if (record?.status === 'success') {
        assertSameRequest(record, user.uid, payloadHash);
        return { ok: true, status: 200, command: command.name, data: record.result, replayed: true };
      }
    } catch (error) {
      return errorOutcome(error, command.name);
    }
  }

  const baseContext = { ...initialContext, ...(date ? { effectiveDate: date } : {}) };
  if (date) {
    const lock = postingLock(date, workspace, user.uid);
    if (lock) return { ok: false, status: 400, command: command.name, message: lockMessage(date, lock), code: 'PERIOD_LOCKED', details: { lockDate: lock.through } };
  }
  if (command.capacity) {
    try {
      await (dependencies.checkCapacity || enforcePlanCapacity)(req, workspaceId, command.capacity, db, input);
    } catch (error) {
      return errorOutcome(error, command.name);
    }
  }

  const afterCommitCallbacks: Array<() => Promise<Record<string, unknown> | void> | Record<string, unknown> | void> = [];
  let prepared: unknown;
  if (command.prepare) {
    try {
      prepared = await command.prepare(baseContext, input);
    } catch (error) {
      return errorOutcome(error, command.name);
    }
  }
  const context = {
    ...baseContext,
    prepared,
    afterCommit(callback: () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void) { afterCommitCallbacks.push(callback); },
  };
  let didRunHandler = false;

  const handlerInTransaction = async (tx: CommandTransaction) => {
    // Idempotency may invoke this callback more than once on a serializable retry. Only side effects
    // registered by the final successful attempt are run after commit.
    afterCommitCallbacks.length = 0;
    didRunHandler = false;
    if (!personScope) {
      const latest = await tx.get(db.collection('workspaces').doc(workspaceId));
      if (!latest.exists || !isWorkspaceMemberData(latest.data(), user, workspaceId)) {
        throw new CommandRefusal('Workspace membership changed before the command committed', 403, 'NOT_A_MEMBER');
      }
      const latestWorkspace = latest.data() || {};
      const latestRole = roleInWorkspace(latestWorkspace, user.uid);
      const platformAdminOverride = command.allowPlatformAdmin === true && user.admin === true && !user.developerWorkspaceId;
      if (!command.roles.includes(latestRole as CommandRole) && !platformAdminOverride) {
        throw new CommandRefusal('Your workspace role changed before the command committed', 403, 'ROLE_REQUIRED');
      }
      assertWorkspaceActiveForCommand(latestWorkspace, command.name);
      if (date) {
        const lock = postingLock(date, latestWorkspace, user.uid);
        if (lock) throw new CommandRefusal(lockMessage(date, lock), 400, 'PERIOD_LOCKED', { lockDate: lock.through });
      }
      context.role = latestRole as CommandRole;
      context.workspace = latestWorkspace;
    }
    const result = await command.handler(context, tx, input);
    const summary = command.audit(input, result);
    if (summary) {
      await (dependencies.auditWriter || writeServerAuditLog)({
        workspaceId,
        uid: user.uid,
        email: user.email,
        action: summary.action,
        entityType: summary.entityType,
        entityId: summary.entityId,
        details: { description: summary.description, ...(summary.details || {}) },
      }, { db, tx });
    }
    didRunHandler = true;
    return result;
  };

  try {
    let result: unknown;
    if (operationId) {
      const scopedKey = deriveScopedOperationKey(workspaceId, operationType, operationId);
      result = await executeIdempotent(scopedKey, {
        actor: user.uid,
        workspaceId,
        operationType,
        payloadHash,
        db,
        ...(command.legacyKey ? { legacyKey: command.legacyKey(workspaceId, operationId) } : {}),
      }, handlerInTransaction, () => {
        afterCommitCallbacks.length = 0;
        didRunHandler = false;
      });
    } else {
      result = await db.runTransaction(handlerInTransaction);
    }
    if (didRunHandler) {
      const responseFields: Record<string, unknown> = {};
      for (const callback of afterCommitCallbacks) {
        try {
          const fields = await callback();
          if (isRecord(fields)) Object.assign(responseFields, fields);
        } catch (error) {
          console.error('[CommandExecutor] Post-commit callback failed:', logSafeDetail(error));
        }
      }
      if (Object.keys(responseFields).length > 0 && isRecord(result)) result = { ...result, ...responseFields };
    }
    return { ok: true, status: 200, command: command.name, data: result, replayed: Boolean(operationId && !didRunHandler) };
  } catch (error) {
    return errorOutcome(error, command.name);
  }
}

/** Run the definition's preview hook after the same authentication and authorization gates as execution. */
export async function previewCommand(
  req: Request,
  invocation: CommandInvocation,
  dependencies: CommandRunnerDependencies = {},
): Promise<CommandPreviewOutcome> {
  const command = invocation.definition;
  const access = await commandAccess(req, invocation, dependencies, { assertActive: false });
  if ('refusal' in access) return access.refusal;
  if ('refused' in access) return previewErrorOutcome(access.refused, command.name);
  const { user, workspaceId, db, role, workspace } = access;

  if (command.risk === 'high' && !invocation.legacyRoute && (user.developerWorkspaceId || user.aal !== 'aal2')) {
    return { ok: false, status: 403, command: command.name, message: 'High-risk commands require a person signed in with two-step verification; API keys cannot confirm this step.', code: 'TWO_STEP_REQUIRED' };
  }

  const parsed = command.input.safeParse(invocation.input);
  if (!parsed.success) return previewErrorOutcome(parsed.error, command.name);
  if (isRecord(parsed.data) && typeof parsed.data.workspaceId === 'string' && parsed.data.workspaceId !== workspaceId) {
    return { ok: false, status: 400, command: command.name, message: 'Input workspaceId must match the command workspace', code: 'WORKSPACE_MISMATCH' };
  }
  const input = parsed.data;
  const initialContext = {
    actor: user.uid,
    email: user.email,
    workspaceId,
    role,
    user,
    db,
    workspace,
  };
  const datedValue = command.dated ? valueAtPath(input, command.dated) : undefined;
  let date: string | undefined;
  try {
    date = (typeof datedValue === 'string' ? datedValue : undefined) || command.resolveDate?.(initialContext, input);
  } catch (error) {
    return previewErrorOutcome(error, command.name);
  }
  const context = { ...initialContext, ...(date ? { effectiveDate: date } : {}) };
  if (date) {
    const lock = postingLock(date, workspace, user.uid);
    if (lock) return previewErrorOutcome(new CommandRefusal(lockMessage(date, lock), 400, 'PERIOD_LOCKED', { lockDate: lock.through }), command.name);
  }
  if (command.capacity) {
    try {
      await (dependencies.checkCapacity || enforcePlanCapacity)(req, workspaceId, command.capacity, db, input);
    } catch (error) {
      return previewErrorOutcome(error, command.name);
    }
  }
  try {
    return { ok: true, status: 200, command: command.name, preview: await command.preview(context, input) };
  } catch (error) {
    return previewErrorOutcome(error, command.name);
  }
}

export function executeCommand(req: Request, res: Response, invocation: CommandInvocation, dependencies?: CommandRunnerDependencies): Promise<CommandExecutionOutcome>;
export function executeCommand<T>(
  req: Request,
  res: Response,
  workspaceId: string,
  operationType: string,
  action: (ctx: CommandContext, t: FirestoreTransaction) => Promise<T>,
  extra?: () => Record<string, unknown>,
): Promise<unknown>;
export async function executeCommand<T>(
  req: Request,
  res: Response,
  invocationOrWorkspaceId: CommandInvocation | string,
  operationTypeOrDependencies?: string | CommandRunnerDependencies,
  action?: (ctx: CommandContext, t: FirestoreTransaction) => Promise<T>,
  extra?: () => Record<string, unknown>,
): Promise<unknown> {
  if (typeof invocationOrWorkspaceId === 'string') {
    return executeLegacyCommand(req, res, invocationOrWorkspaceId, String(operationTypeOrDependencies || ''), action || (async () => {
      throw new HttpError('A legacy command action is required', 500);
    }), extra);
  }

  const dependencies = typeof operationTypeOrDependencies === 'object' ? operationTypeOrDependencies : undefined;
  const outcome = await runRegisteredCommand(req, invocationOrWorkspaceId, dependencies);
  const response = invocationOrWorkspaceId.formatResponse?.(outcome) || defaultResponse(outcome);
  res.status(response.status).json(response.body);
  return outcome;
}
