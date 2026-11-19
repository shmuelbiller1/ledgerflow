import { byCodeUnit } from '../../lib/codeUnitOrder';
import { commandStageReader, recordCommandReads } from '../db/pg/commandStage';
import type { Firestore, Transaction } from '../db/firestore';
import type { RequestUser } from '../auth/requestUser';
import type { StepPreview } from '../db/pg/sandboxReviewStore';
import type { EffectIntent } from '../services/sandboxEffects';
import { captureEffects, refuseSandboxEffect } from '../services/sandboxEffects';
import type { Request } from 'express';
import { assertCommandCommitAccess, CommandRefusal, enforcePlanCapacity, handlePreparedCommand, parseCommandInput, resolveCommandDate, type CommandAfterCommit } from '../utils/commandExecutor';
import { commandRegistry } from './defaultRegistry';
import { requestPayloadHash } from '../utils/idempotency';
import type { AnyCommandDefinition, CommandAuditSummary } from './types';

/**
 * The admission boundary for sandbox steps. It is not the public command registry: a command is a
 * step only when its area is one the assistant drafts in (the books, not the workspace's membership,
 * keys, periods, payroll, bank connections or support), it is workspace-scoped and not a legacy two-phase operation. A high-risk command is a step that the
 * acceptance gate takes alone, after confirmation; a plan-metered one is metered again at accept. Everything else answers
 * SANDBOX_COMMAND_UNAVAILABLE at the door.
 *
 * What a step may write is not a hand-kept list per command any more. The draft runs under the
 * `lf_sandbox` role, which can write only the overlay (every document table has one), so the draft
 * stage accepts any overlay table; the records it actually wrote are recorded on the step. At accept,
 * the live stage is allowed exactly those tables (plus the audit log), and `expectedLive` refuses a
 * replay whose write set differs from the reviewed draft at all. A command that needs a database
 * sequence (stock moves), a live job or a provider call cannot draft: the role has no sequence
 * privilege and the effect guards refuse, so the step is refused and nothing is kept.
 */
const STEP_AREAS: ReadonlySet<string> = new Set([
  'asset', 'autorule', 'bill', 'budget', 'chartaccount', 'contact', 'creditnote', 'customer', 'document', 'employee', 'entrylink',
  'estimate', 'inventory', 'inventoryitem', 'invoice', 'journal', 'journaltemplate', 'loan', 'payment', 'project', 'record',
  'rma', 'tag', 'tasks', 'time', 'vendor', 'vendorcredit', 'warranty', 'watches',
]);
/** Commands in an admitted area that still must not be drafted: they touch other people or outside systems directly. */
const STEP_DENIED: ReadonlySet<string> = new Set(['estimate.signlink', 'document.remove', 'record.delete']);

export function stepCommand(name: string) {
  const command = commandRegistry.get(name);
  const area = name.split('.')[0] ?? '';
  if (!command || !STEP_AREAS.has(area) || STEP_DENIED.has(name) || command.scope === 'person' || command.defaultOperationId) {
    throw new CommandRefusal('This command is not available as a sandbox step', 409, 'SANDBOX_COMMAND_UNAVAILABLE');
  }
  return command;
}

/** The commands the assistant may draft, for the tool list and the admission test. */
export function stepCommandNames(): string[] {
  return commandRegistry.list().map(command => String(command.name)).filter(name => { try { stepCommand(name); return true; } catch { return false; } }).sort(byCodeUnit);
}

interface StepActor { user: RequestUser; workspaceId: string; workspace: Record<string, unknown> }

/** The same accepted handler, input parser, commit access, date rule and audit path as direct CMD-1. */
async function executeStep(actor: StepActor, db: Firestore, tx: Transaction, command: AnyCommandDefinition,
  proposed: unknown, afterCommit: (callback: CommandAfterCommit) => void) {
  const { user, workspaceId, workspace } = actor;
  recordCommandReads(db, 'workspaces', [workspaceId]);
  const role = assertCommandCommitAccess(command, workspace, user, workspaceId);
  const input = parseCommandInput(command, proposed, workspaceId);
  const base = { actor: user.uid, email: user.email, user, workspaceId, db, role, workspace };
  // the router always runs the command's own input check (cross-workspace payloads, quotas); a drafted
  // step and its replay at accept run it too, or a step could commit what a direct call refuses (Gitar on #932)
  await command.authorizeInput?.(base, input);
  await checkExplicitLinks(command.name, input, db, tx, workspaceId);
  const date = resolveCommandDate(command, base, input);
  if (date) assertCommandCommitAccess(command, workspace, user, workspaceId, date);
  const ctx = { ...base, effectiveDate: date };
  const prepared = await command.prepare?.(ctx, input);
  const { result, summary } = await handlePreparedCommand(command, { ...ctx, prepared, afterCommit(callback) {
    commandStageReader(db, undefined, tx);
    afterCommit(callback);
  } }, tx, input,
    db.sandboxId ? false : undefined);
  return { result, summary, date, input, inverse: db.sandboxId ? null : command.inverse?.(input, result) ?? null };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

const taskLinks = new Map([['invoice', 'invoices'], ['bill', 'bills'], ['transaction', 'transactions'], ['account', 'chartAccounts'], ['item', 'inventory']]);

/** Some handlers store record links without opening them. Record those dependencies as well. */
async function checkExplicitLinks(command: string, input: unknown, db: Firestore, tx: Transaction, workspaceId: string) {
  const data = object(input);
  const taskRecord = object(object(data?.task)?.record);
  const taskTable = taskLinks.get(String(taskRecord?.type));
  const links: Array<readonly [string, unknown]> = [];
  if (command === 'tasks.create' && taskTable) links.push([taskTable, taskRecord?.id]);
  if (command === 'invoice.create') links.push(['customers', object(data?.invoice)?.customerId]);
  if (command === 'payment.receive') links.push(['customers', data?.customerId], ['vendors', data?.vendorId]);
  for (const [collection, id] of links) {
    if (typeof id !== 'string' || !id) continue;
    const linked = (await tx.get(db.collection(collection).doc(id))).data();
    if (linked?.workspaceId !== workspaceId) throw new CommandRefusal('A linked record is not in these books', 409, 'SANDBOX_LINK_NOT_FOUND');
  }
}

function describeStep(command: string, result: unknown, summary: CommandAuditSummary | null,
  effects: EffectIntent[], date: string | undefined, draft: boolean): Omit<StepPreview, 'allocatedIds'> {
  const saved = object(result);
  const number = command === 'payment.receive' ? object(saved?.payment)?.number : undefined;
  const provisionalNumber = draft && typeof number === 'string' && number ? number : undefined;
  const transactions = Array.isArray(saved?.transactions) ? saved.transactions : [saved?.ledgerTransaction];
  const ledger = transactions.map(object).filter(row => row !== undefined).map(row => ({
    id: row.id, date: row.date, currency: row.currency, exchangeRate: row.exchangeRate,
    // Keep all money fields (including home-currency and tax) without fingerprinting generated timestamps.
    lines: Array.isArray(row.lines) ? row.lines.map(item => {
      const line = object(item);
      return { accountId: line?.accountId, amountCents: line?.amountCents, baseAmountCents: line?.baseAmountCents,
        taxAmountCents: line?.taxAmountCents, taxBreakdown: line?.taxBreakdown, taxCodeId: line?.taxCodeId, taxTreatment: line?.taxTreatment, taxRate: line?.taxRate, exchangeRate: line?.exchangeRate };
    }) : [],
  }));
  const accounts = ledger.flatMap(row => row.lines.flatMap(({ accountId, amountCents }) =>
    typeof accountId === 'string' && typeof amountCents === 'number' ? [{ accountId, amountCents }] : []));
  return {
    title: summary?.description || command,
    lines: provisionalNumber ? [`Provisional number ${provisionalNumber}; the real series assigns the number when accepted.`] : [],
    effects,
    ...(summary?.entityId ? { entityId: summary.entityId } : {}),
    ...(ledger.length ? { ledgerHash: requestPayloadHash(ledger) } : {}),
    ...(date ? { effectiveDate: date } : {}),
    ...(provisionalNumber ? { provisionalNumber } : {}),
    ...(accounts.length ? { accounts } : {}),
  };
}

export async function prepareDraftStep(actor: StepActor, db: Firestore, tx: Transaction, command: AnyCommandDefinition, input: unknown) {
  const { value, intents } = await captureEffects(db, () => executeStep(actor, db, tx, command, input, () => {
    refuseSandboxEffect('Draft commands must describe effects rather than queue arbitrary callbacks');
  }));
  return { input: value.input, preview: describeStep(command.name, value.result, value.summary, intents, value.date, true) };
}

export async function replayReviewedStep(actor: StepActor, db: Firestore, tx: Transaction, command: AnyCommandDefinition,
  input: unknown, callbacks: CommandAfterCommit[]) {
  if (command.risk === 'high' && (actor.user.developerWorkspaceId || actor.user.aal !== 'aal2')) {
    // the same rule the command router applies; the acceptance gate has already taken this step alone
    throw new CommandRefusal('High-risk commands require a person signed in with two-step verification; API keys cannot confirm this step.', 403, 'TWO_STEP_REQUIRED');
  }
  if (command.capacity) {
    // the draft did not use the plan up; the live replay is metered like any other call of this command
    const request = { params: {}, body: {}, query: {}, user: actor.user } as unknown as Request;
    await enforcePlanCapacity(request, actor.workspaceId, command.capacity, db, input);
  }
  const { value, intents } = await captureEffects(db, () => executeStep(actor, db, tx, command, input, callback => { callbacks.push(callback); }));
  return { preview: describeStep(command.name, value.result, value.summary, intents, value.date, false), inverse: value.inverse };
}
