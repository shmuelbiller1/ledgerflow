import type { RequestUser } from '../auth/requestUser';
import type { Transaction } from '../db/firestore';
import type { Firestore } from '../db/firestore';
import type { MeteredResource } from '../middleware/planCapacity';
import type { z } from 'zod';

export const COMMAND_ROLES = ['owner', 'accountant', 'bookkeeper', 'viewer'] as const;
export type CommandRole = typeof COMMAND_ROLES[number];
export type CommandRisk = 'normal' | 'high';

export interface CommandPreview {
  title: string;
  lines: string[];
  /** Populated for commands that affect the ledger; amounts are whole cents. */
  accounts?: Array<{ accountId: string; accountName?: string; amountCents: number; description?: string }>;
}

export interface CommandAuditSummary {
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  details?: Record<string, unknown>;
}

export interface CommandDescription {
  /** One sentence: purpose, appropriate use, and a case where it should not be used. */
  sentence: string;
  example: unknown;
  refusals: Array<{ code: string; when: string; next: string }>;
  /**
   * What a person usually does next, named as commands rather than as buttons.
   *
   * This is the half of "one way to act" a refusal cannot carry: after an invoice is saved, the next
   * thing anyone does is send it or record a payment. The client looks each name up in this same
   * manifest, so an offered step is always a command that exists and that the person's role may run —
   * a screen cannot invent one, and a renamed command cannot leave a dead link behind.
   */
  next?: Array<{ command: string; label: string }>;
}

export interface CommandContext {
  actor: string;
  email?: string;
  workspaceId: string;
  role: CommandRole;
  operationId?: string;
  /** The effective civil date used by the runner for period-lock checks, including command defaults. */
  effectiveDate?: string;
  user: RequestUser;
  db: Firestore;
  workspace: Record<string, unknown>;
  /** Returned by the command's read-only prepare hook before the transaction opens. */
  prepared?: unknown;
  /** Schedule an external side effect after the transaction commits, never inside a retryable callback. Returned fields are added to this response only. */
  afterCommit(callback: () => Promise<Record<string, unknown> | void> | Record<string, unknown> | void): void;
}

export interface CommandDefinition<Schema extends z.ZodType = z.ZodType, Result = unknown, Prepared = unknown> {
  name: `${string}.${string}`;
  input: Schema;
  roles: readonly CommandRole[];
  /**
   * `person` commands act on the caller's own account (two-step recovery codes, notice emails,
   * groups of books): the runner asks only for a signed-in person, not for a workspace and one of
   * its roles, and none is granted one — `ctx.role` is 'owner' and `ctx.workspace` is empty. The
   * idempotency and audit scope becomes `person:<uid>`. A person command cannot declare `dated` or
   * `capacity` (both read workspace state), and its `roles` list is informational: every signed-in
   * person may run it on their own account. Defaults to `workspace`.
   */
  scope?: 'workspace' | 'person';
  /** Permit platform admins outside the workspace roles list; never grants this override to API keys. */
  allowPlatformAdmin?: boolean;
  /**
   * Refuse a request that arrived on an API key (`lf_...`), so only a signed-in person runs it. The
   * addresses these commands replaced were person-only (minting or revoking a key, saving an AI
   * provider key), and an API key that could mint keys would grant itself more than it was given.
   */
  peopleOnly?: boolean;
  /** Person-scoped workspace creation must not be performed (or replayed) by a workspace-scoped key. */
  denyWorkspaceApiKey?: boolean;
  /** Dot path into the validated input; the runner checks this date against the workspace period lock. */
  dated?: string;
  /** Resolve an effective date when the command's input omits one (for example, today's workspace-local date). */
  resolveDate?(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: z.output<Schema>): string | undefined;
  capacity?: MeteredResource;
  /** Read-only work needed to prepare the transaction (for example a ledger preview/build). */
  prepare?(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: z.output<Schema>): Promise<Prepared>;
  handler(ctx: CommandContext, tx: Transaction, input: z.output<Schema>): Promise<Result>;
  preview(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: z.output<Schema>): Promise<CommandPreview>;
  /** Return null for an idempotent no-op that made no change, so retries do not create misleading audit entries. */
  audit(input: z.output<Schema>, result: Result): CommandAuditSummary | null;
  inverse?(input: z.output<Schema>, result: Result): { command: string; input: unknown } | null;
  risk: CommandRisk;
  describe: CommandDescription;
  /** A temporary compatibility operation type used by an old route while its UI/API is switched over. */
  operationType?: string;
  /**
   * The idempotency id to use when the caller sends no `Idempotency-Key` (#824): a command whose input names
   * the thing it posts once (a contract and period, a lease) derives the same id the old route did, so a
   * repeated call replays instead of posting a second entry. Undefined: no key, as before.
   */
  defaultOperationId?(input: z.output<Schema>): string | undefined;
  /** The old idempotency record key, if this command adopts a pre-command operation. */
  legacyKey?(workspaceId: string, operationId: string): string;
  /** Preserve the old request fingerprint when a route is adopted; defaults to requestPayloadHash(req.body). */
  idempotencyHash?(ctx: Omit<CommandContext, 'prepared' | 'afterCommit'>, input: z.output<Schema>, prepared: Prepared | undefined, req: import('express').Request): string | undefined;
}

export type AnyCommandDefinition = CommandDefinition<z.ZodType, unknown, unknown>;

export interface CommandInvocation {
  definition: AnyCommandDefinition;
  workspaceId: string;
  input: unknown;
  /** Existing routes can preserve their established wire response while calling the same runner. */
  formatResponse?(outcome: CommandExecutionOutcome): { status: number; body: unknown };
  /**
   * The address had no two-step gate of its own before it called this command, so a command marked
   * high-risk for the command router keeps its established answer here. Only the legacy wrappers set
   * this, and only where the route's own role check was the whole gate (the security settings, the
   * account merge); the command router still requires a code-confirmed session.
   */
  legacyRoute?: boolean;
}

export type CommandExecutionOutcome =
  | { ok: true; status: 200; command: string; data: unknown; replayed: boolean }
  | { ok: false; status: number; command: string; message: string; code?: string; details?: unknown; error?: unknown };

export type CommandPreviewOutcome =
  | { ok: true; status: 200; command: string; preview: CommandPreview }
  | { ok: false; status: number; command: string; message: string; code?: string; details?: unknown; error?: unknown };
