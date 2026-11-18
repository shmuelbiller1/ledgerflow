import { commandStageReader, recordCommandReads } from '../db/pg/commandStage';
import type { Firestore, Transaction } from '../db/firestore';
import type { RequestUser } from '../auth/requestUser';
import type { StepPreview } from '../db/pg/sandboxReviewStore';
import type { EffectIntent } from '../services/sandboxEffects';
import { captureEffects, refuseSandboxEffect } from '../services/sandboxEffects';
import { assertCommandCommitAccess, CommandRefusal, handlePreparedCommand, parseCommandInput, resolveCommandDate, type CommandAfterCommit } from '../utils/commandExecutor';
import { customerCreateCommand } from './customers';
import { invoiceCreateCommand } from './documents';
import { paymentReceiveCommand } from './payments';
import { requestPayloadHash } from '../utils/idempotency';
import { taskCreateCommand } from './tasks';
import type { AnyCommandDefinition, CommandAuditSummary } from './types';

// This is an authorization boundary, not the public command registry. Stock moves, raw SQL,
// live jobs, metered resources and two-step/high-risk writes need their own review before admission.
const reviewed: ReadonlyArray<readonly [AnyCommandDefinition, readonly string[]]> = [
  [customerCreateCommand, ['customers']],
  [invoiceCreateCommand, ['invoices', 'transactions']],
  [paymentReceiveCommand, ['bills', 'invoices', 'payments', 'transactions', 'paymentAllocations', 'numberingSeries']],
  [taskCreateCommand, ['documents']],
];
const commands = new Map(reviewed.map(([command, collections]) => [String(command.name), { command, writable: new Set(collections) }]));
export const overlayCollections = [...new Set(reviewed.flatMap(([, collections]) => collections))].sort();

export function stepCommand(name: string) {
  const entry = commands.get(name);
  if (!entry || entry.command.scope === 'person' || entry.command.risk !== 'normal' || entry.command.capacity || entry.command.defaultOperationId) {
    throw new CommandRefusal('This command is not available as a sandbox step', 409, 'SANDBOX_COMMAND_UNAVAILABLE');
  }
  return entry;
}

interface StepActor { user: RequestUser; workspaceId: string; workspace: Record<string, unknown> }

/** The same accepted handler, input parser, commit access, date rule and audit path as direct CMD-1. */
async function executeStep(actor: StepActor, db: Firestore, tx: Transaction, command: AnyCommandDefinition,
  proposed: unknown, afterCommit: (callback: CommandAfterCommit) => void) {
  const { user, workspaceId, workspace } = actor;
  recordCommandReads(db, 'workspaces', [workspaceId]);
  const role = assertCommandCommitAccess(command, workspace, user, workspaceId);
  const input = parseCommandInput(command, proposed, workspaceId);
  await checkExplicitLinks(command.name, input, db, tx, workspaceId);
  const base = { actor: user.uid, email: user.email, user, workspaceId, db, role, workspace };
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
  const { value, intents } = await captureEffects(db, () => executeStep(actor, db, tx, command, input, callback => { callbacks.push(callback); }));
  return { preview: describeStep(command.name, value.result, value.summary, intents, value.date, false), inverse: value.inverse };
}
