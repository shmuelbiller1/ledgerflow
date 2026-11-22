import { randomUUID } from 'node:crypto';
import { recordOutcome } from '../services/rememberedDecisions';
import type { Request } from 'express';
import { assistantClaims } from '../auth/assistantToken';
import { requestUser, type RequestUser } from '../auth/requestUser';
import { getDb, isWorkspaceMemberData, type Firestore } from '../db/firestore';
import { validateSandboxId } from '../db/pg/sandbox';
import { sandboxBatch, type SandboxBatch } from '../db/pg/sandboxBatch';
import { boundWorkspace, clearDraft, createBinding, draftBytes, isUnresolved, lockBinding, MAX_PENDING_STEPS, overlayTables, saveStep, stepsOf, updateBinding, type StoredStep } from '../db/pg/sandboxReviewStore';
import { LEDGER_WRITER_ROLES, roleInWorkspace } from '../middleware/requireLedgerWriter';
import { assertWorkspaceActiveForCommand, CommandRefusal, runCommandAfterCommit, runRegisteredCommand, type CommandAfterCommit } from '../utils/commandExecutor';
import { commandRegistry } from './defaultRegistry';
import type { CommandExecutionOutcome } from './types';
import { requestPayloadHash } from '../utils/idempotency';
import { assertDraftOrder, parentsOf, rebuildDraft, saveDraftStep, stepFailure, type ReviewActor } from './sandboxRebuild';
import { replayReviewedStep, stepCommand } from './sandboxStepCommands';
import type { CommandRisk } from './types';

export interface SandboxReview {
  id: string;
  revision: string;
  steps: StoredStep[];
  accepted: string[];
  skipped: string[];
  outcome: 'review' | 'review-changed' | 'accepted' | 'closed';
}

type Revision = { revision: string };
export type SandboxReviewIntent =
  | { kind: 'add'; command: string; input: unknown }
  | { kind: 'review' }
  | ({ kind: 'edit'; stepId: string; input: unknown } & Revision)
  | ({ kind: 'reorder'; stepIds: readonly string[] } & Revision)
  | ({ kind: 'reject'; stepIds?: readonly string[] } & Revision)
  | ({ kind: 'accept'; stepIds?: readonly string[]; confirmRechecked?: readonly string[]; confirmHighRisk?: string } & Revision);

/**
 * SBX-1 requirement 5: a high-risk step is accepted on its own, in two steps.
 *
 * "Accept all" skips it; a selection naming it must name it alone, and must name it a second time as
 * `confirmHighRisk` — the first call answers 409 SANDBOX_HIGH_RISK_CONFIRM with the step's preview, the
 * screen shows the preview and asks again, and only the second call applies. The high-risk flag is the
 * command's own (`risk: 'high'`, the same one the command router asks a second factor for), so admitting
 * such a command as a step later does not need a second rule here. Pure, so it is tested on its own.
 */
export function highRiskGate(selected: readonly StoredStep[], intent: Extract<SandboxReviewIntent, { kind: 'accept' }>,
  riskOf: (command: string) => CommandRisk): StoredStep[] {
  const highRisk = selected.filter(step => riskOf(step.command) === 'high');
  if (highRisk.length === 0) return [...selected];
  if (!intent.stepIds) return selected.filter(step => riskOf(step.command) !== 'high');
  const [step] = highRisk;
  if (highRisk.length > 1 || selected.length > 1) {
    throw new CommandRefusal('Accept a high-risk step on its own', 409, 'SANDBOX_HIGH_RISK_ALONE', { stepId: step.id });
  }
  if (intent.confirmHighRisk !== step.id) {
    throw new CommandRefusal(`Confirm "${step.preview.title}" to apply it`, 409, 'SANDBOX_HIGH_RISK_CONFIRM', { stepId: step.id, preview: step.preview });
  }
  return [step];
}

type Scope = { workspaceId: string; sandboxId: string };

function person(req: Request): RequestUser {
  const user = requestUser(req);
  if (!user?.uid) throw new CommandRefusal('Sign in required', 401, 'UNAUTHENTICATED');
  if (user.usedApiKeyId || user.developerWorkspaceId) throw new CommandRefusal('Only a signed-in person can manage a sandbox', 403, 'PERSON_ONLY');
  return { ...user, admin: false };
}

/** The intents an assistant token may send: drafting only. Nothing here reaches the real books. */
const ASSISTANT_INTENTS: ReadonlySet<SandboxReviewIntent['kind']> = new Set(['add', 'review', 'edit', 'reorder', 'reject']);

/**
 * An assistant principal (auth/assistantToken.ts) acts for the person inside the one sandbox its
 * token names. It may draft; it may not accept, undo, reject the whole sandbox or open another one.
 */
function assertAssistantMayDo(user: RequestUser, sandboxId: string, intent: SandboxReviewIntent): void {
  if (!user.assistantSandboxId) return;
  if (user.assistantSandboxId !== sandboxId) throw new CommandRefusal('This assistant token belongs to another sandbox', 403, 'ASSISTANT_SANDBOX_MISMATCH');
  if (!ASSISTANT_INTENTS.has(intent.kind) || (intent.kind === 'reject' && intent.stepIds === undefined)) {
    throw new CommandRefusal('Only the person can accept, undo or close a sandbox', 403, 'ASSISTANT_CANNOT_COMMIT');
  }
}

async function requireLiveAccess(batch: SandboxBatch, user: RequestUser, workspaceId: string): Promise<Record<string, unknown>> {
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new CommandRefusal('Workspace ID is required', 400, 'WORKSPACE_REQUIRED');
  const workspace = await boundWorkspace(batch.runner, workspaceId);
  if (!workspace || !isWorkspaceMemberData(workspace, user, workspaceId) || !LEDGER_WRITER_ROLES.includes(roleInWorkspace(workspace, user.uid))) {
    throw new CommandRefusal('You do not have write access to these books', 403, 'ROLE_REQUIRED');
  }
  if (workspace.requireTwoStep === true && user.aal !== 'aal2') {
    throw new CommandRefusal('Sign in with two-step verification for these books', 403, 'TWO_STEP_REQUIRED');
  }
  assertWorkspaceActiveForCommand(workspace, 'sandbox.review');
  return workspace;
}

function response(id: string, steps: StoredStep[], outcome: SandboxReview['outcome'] = 'review', accepted: string[] = [], skipped: string[] = []): SandboxReview {
  const revision = requestPayloadHash([id, steps]);
  return { id, revision, steps, outcome, accepted, skipped };
}

/** Internal person-only entry points. No public header, token or route can opt in. */
export async function openSandbox(req: Request, workspaceId: string, db: Firestore = getDb()): Promise<SandboxReview> {
  const user = person(req);
  if (user.assistantSandboxId) throw new CommandRefusal('Only the person can open a sandbox', 403, 'ASSISTANT_CANNOT_COMMIT');
  const binding = { id: randomUUID(), personId: user.uid, workspaceId };
  return db[sandboxBatch](async batch => {
    await requireLiveAccess(batch, user, workspaceId);
    const created = await createBinding(batch.runner, binding);
    if (created === 'person-limit') throw new CommandRefusal('You already have three open sandboxes', 409, 'SANDBOX_LIMIT');
    if (created === 'workspace-limit') throw new CommandRefusal('This workspace is at its 50 MB sandbox storage limit', 409, 'SANDBOX_STORAGE_LIMIT');
    return response(binding.id, []);
  });
}

function stepIds(ids: readonly string[], steps: readonly StoredStep[]): Set<string> {
  const found = new Set(ids);
  if (found.size !== ids.length || found.size === 0 || ids.some(id => !steps.some(step => step.id === id))) {
    throw new CommandRefusal('Choose existing, distinct draft steps', 400, 'SANDBOX_SELECTION');
  }
  return found;
}

function acceptanceList(active: StoredStep[], intent: Extract<SandboxReviewIntent, { kind: 'accept' }>): StoredStep[] {
  const explicit = intent.stepIds ? stepIds(intent.stepIds, active) : null;
  const confirmed = new Set(intent.confirmRechecked ?? []);
  const permitted = (step: StoredStep) => step.state === 'pending' || (step.state === 'needs-recheck' && explicit && confirmed.has(step.id));
  const chosen = new Set<string>();
  const riskOf = (name: string): CommandRisk => commandRegistry.get(name)?.risk ?? 'high';
  for (const step of active) {
    if (explicit ? !explicit.has(step.id) : !permitted(step)) continue;
    const closure = new Set([step.id]);
    for (const predecessor of active.toReversed()) {
      if (closure.has(predecessor.id)) for (const parent of parentsOf(predecessor, active)) closure.add(parent);
    }
    const refused = active.find(row => closure.has(row.id) && !permitted(row));
    if (refused) {
      if (!explicit) continue;
      throw new CommandRefusal(refused.failureReason || 'Open and confirm the rechecked step before accepting', 409, 'SANDBOX_RECHECK_REQUIRED', { stepId: refused.id });
    }
    for (const id of closure) chosen.add(id);
  }
  // a high-risk step's dependants are gated with it: "all" skips them, a selection must name them later
  const gated = highRiskGate(active.filter(step => chosen.has(step.id)), intent, riskOf);
  const kept = new Set(gated.map(step => step.id));
  return active.filter(step => kept.has(step.id) && parentsOf(step, active).every(parent => kept.has(parent)));
}

async function rebuild(batch: SandboxBatch, actor: ReviewActor, steps: StoredStep[], strict: boolean) {
  return batch.draft(actor.sandboxId, phase => rebuildDraft(phase, actor, steps, strict));
}

async function applySelection(batch: SandboxBatch, actor: ReviewActor, active: StoredStep[],
  intent: Extract<SandboxReviewIntent, { kind: 'accept' }>, callbacks: CommandAfterCommit[]): Promise<SandboxReview> {
  const id = actor.sandboxId;
  const selected = acceptanceList(active, intent);
  const { rows, changed } = await rebuild(batch, actor, active, false);
  if (selected.some(step => changed.has(step.id))) {
    return response(id, await stepsOf(batch.runner, id), 'review-changed', [], selected.map(step => step.id));
  }
  const accepted = new Set(selected.map(step => step.id));
  for (const step of rows.filter(row => accepted.has(row.id))) {
    const command = stepCommand(step.command);
    // exactly the tables the reviewed draft wrote; `expectedLive` then holds the replay to the same records
    const writable = new Set([...step.dependencies.filter(ref => ref.written).map(ref => ref.collectionId), 'auditLogs']);
    try {
      const { value } = await batch.live({ ids: new Map(Object.entries(step.preview.allocatedIds)), writable,
        expectedLive: { workspaceId: actor.workspaceId, writes: step.dependencies.filter(ref => ref.written), creates: step.recordIds } },
      async (db, tx) => {
        const replay = await replayReviewedStep(actor, db, tx, command, step.input, callbacks);
        const basis = (preview: typeof replay.preview) => requestPayloadHash([preview.entityId, preview.effectiveDate, preview.ledgerHash, preview.effects]);
        if (basis(step.preview) !== basis(replay.preview)) {
          throw new CommandRefusal('The real step differs from the reviewed posting or delivery', 409, 'SANDBOX_POSTING_CHANGED');
        }
        return replay;
      });
      await saveStep(batch.runner, id, { ...step, ...value, preview: { ...value.preview, allocatedIds: step.preview.allocatedIds }, state: 'accepted' });
    } catch (err) {
      throw stepFailure(err, step);
    }
  }
  // SBX-2 Part 3: the accepted choices join this workspace's remembered decisions, in the same transaction.
  await recordOutcome(batch.runner, actor.workspaceId, rows.filter(row => accepted.has(row.id)), 'accepted');
  if (accepted.size) await rebuild(batch, actor, rows.filter(row => !accepted.has(row.id)), false);
  const skipped = intent.stepIds ? [] : rows.filter(row => !accepted.has(row.id)).map(row => row.id);
  const final = await stepsOf(batch.runner, id);
  return response(id, final, accepted.size ? 'accepted' : 'review', [...accepted], skipped);
}

async function editDraft(batch: SandboxBatch, actor: ReviewActor, all: StoredStep[], active: StoredStep[],
  intent: Extract<SandboxReviewIntent, { kind: 'edit' | 'reorder' | 'reject' }>, byAssistant = false): Promise<SandboxReview> {
  const id = actor.sandboxId;
  if (intent.kind === 'reject' && intent.stepIds === undefined) {
    await batch.draft(id, async phase => clearDraft(phase.runner, await overlayTables(phase.runner)));
    for (const step of active) await saveStep(batch.runner, id, { ...step, state: 'rejected' });
    // the assistant removing its own draft is not the person's rejection
    if (!byAssistant) await recordOutcome(batch.runner, actor.workspaceId, active, 'rejected');
    return response(id, await stepsOf(batch.runner, id), 'closed');
  }
  if (intent.kind === 'edit') {
    stepIds([intent.stepId], active);
    const edited = active.map(step => step.id === intent.stepId ? { ...step, input: intent.input } : step);
    await batch.draft(id, phase => rebuildDraft(phase, actor, edited, true, new Set([intent.stepId])));
  } else {
    const ids = stepIds(intent.stepIds ?? [], active);
    const removed = intent.kind === 'reject' ? active.filter(row => ids.has(row.id)) : [];
    if (intent.kind === 'reorder' && ids.size !== active.length) throw new CommandRefusal('Provide the full draft order', 400, 'SANDBOX_ORDER');
    const next = intent.kind === 'reorder' ? intent.stepIds.map(id => active.find(step => step.id === id)!) : active.filter(row => !ids.has(row.id));
    assertDraftOrder(active, next);
    const last = all.at(-1)?.position ?? 0;
    for (const step of removed) await saveStep(batch.runner, id, { ...step, state: 'rejected' });
    // the assistant removing its own draft is not the person's rejection
    if (!byAssistant) await recordOutcome(batch.runner, actor.workspaceId, removed, 'rejected');
    await rebuild(batch, actor, next.map((step, index) => ({ ...step, position: last + index + 1 })), true);
  }
  return response(id, await stepsOf(batch.runner, id));
}

/** One serializable transaction owns the selection, all accepted ledger writes, and the remaining
 * overlay. A failed selection queues no delivery. Only the winning attempt can run callbacks. */
export async function reviewSandbox(req: Request, scope: Scope, intent: SandboxReviewIntent, db: Firestore = getDb()): Promise<SandboxReview> {
  const user = person(req);
  let id: string;
  try { id = validateSandboxId(scope.sandboxId); }
  catch { throw new CommandRefusal('Expected a sandbox id', 400, 'INVALID_SANDBOX_ID'); }
  assertAssistantMayDo(user, id, intent);
  const binding = { id, workspaceId: scope.workspaceId, personId: user.uid };
  const addId = randomUUID();
  const ids = new Map<string, string>();
  const { result, callbacks } = await db[sandboxBatch](async batch => {
    const started = Date.now();
    const workspace = await requireLiveAccess(batch, user, binding.workspaceId);
    const actor = { user, workspace, workspaceId: binding.workspaceId, sandboxId: id };
    if (!await lockBinding(batch.runner, binding)) throw new CommandRefusal('No open sandbox belongs to you in this workspace', 404, 'SANDBOX_NOT_FOUND');
    const all = await stepsOf(batch.runner, id);
    const current = response(id, all);
    const callbacks: CommandAfterCommit[] = [];
    if (intent.kind !== 'add' && intent.kind !== 'review' && intent.revision !== current.revision) return { result: { ...current, outcome: 'review-changed' } as SandboxReview, callbacks };
    const active = all.filter(isUnresolved);
    const issuedRole = assistantClaims(req)?.role;
    const draftOf = intent.kind === 'add' ? intent.command : intent.kind === 'edit' ? active.find(step => step.id === intent.stepId)?.command : undefined;
    if (issuedRole !== undefined && draftOf && !stepCommand(draftOf).roles.some(role => role === issuedRole)) {
      throw new CommandRefusal('This command is outside the role granted to this assistant token', 403, 'ROLE_REQUIRED');
    }
    let result: SandboxReview;
    if (intent.kind === 'add') {
      if (active.length >= MAX_PENDING_STEPS) throw new CommandRefusal(`This sandbox has ${MAX_PENDING_STEPS} unresolved steps`, 409, 'SANDBOX_STEP_LIMIT');
      await batch.draft(id, async phase => {
        const step = { id: addId, position: (all.at(-1)?.position ?? 0) + 1, command: intent.command, input: intent.input };
        try { await saveStep(phase.runner, id, await saveDraftStep(phase, actor, step, ids)); }
        catch (err) { throw stepFailure(err, step); }
      });
      result = response(id, await stepsOf(batch.runner, id));
    } else if (intent.kind === 'review') {
      await rebuild(batch, actor, active, false);
      result = response(id, await stepsOf(batch.runner, id));
    } else if (intent.kind === 'accept') {
      result = await applySelection(batch, actor, active, intent, callbacks);
    } else {
      result = await editDraft(batch, actor, all, active, intent, issuedRole !== undefined || assistantClaims(req) !== undefined);
    }
    const closed = result.outcome === 'closed';
    const bytes = closed ? 0 : await batch.draft(id, async phase => draftBytes(phase.runner, await overlayTables(phase.runner)));
    if (!await updateBinding(batch.runner, binding, bytes, Date.now() - started, closed)) {
      throw new CommandRefusal('This workspace would exceed its 50 MB sandbox storage limit', 409, 'SANDBOX_STORAGE_LIMIT');
    }
    return { result, callbacks };
  });
  await runCommandAfterCommit(callbacks);
  return result;
}

/**
 * Undo after accepting (CMD-1 part 3): claim the step under the sandbox lock, then run its recorded
 * inverse as the person through the central command runner. Restore `accepted` if the inverse fails.
 * Nothing here reads or writes the overlay; an assistant token is refused.
 */
export async function undoSandboxStep(req: Request, scope: Scope, stepId: string, db: Firestore = getDb()): Promise<{ step: StoredStep; outcome: CommandExecutionOutcome }> {
  const user = person(req);
  if (user.assistantSandboxId) throw new CommandRefusal('Only the person can undo an accepted step', 403, 'ASSISTANT_CANNOT_COMMIT');
  let id: string;
  try { id = validateSandboxId(scope.sandboxId); }
  catch { throw new CommandRefusal('Expected a sandbox id', 400, 'INVALID_SANDBOX_ID'); }
  const binding = { id, workspaceId: scope.workspaceId, personId: user.uid };
  const { step, inverse, definition } = await db[sandboxBatch](async batch => {
    await requireLiveAccess(batch, user, binding.workspaceId);
    if (!await lockBinding(batch.runner, binding)) throw new CommandRefusal('No open sandbox belongs to you in this workspace', 404, 'SANDBOX_NOT_FOUND');
    const found = (await stepsOf(batch.runner, id)).find(row => row.id === stepId);
    if (!found) throw new CommandRefusal('Choose an existing step', 404, 'SANDBOX_STEP_NOT_FOUND');
    if (found.state !== 'accepted') throw new CommandRefusal('Only an accepted step can be undone', 409, 'SANDBOX_STEP_NOT_ACCEPTED', { state: found.state });
    if (!found.inverse) throw new CommandRefusal('This step recorded no inverse; undo it by hand', 409, 'SANDBOX_NO_INVERSE');
    const inverse = found.inverse;
    const definition = commandRegistry.get(inverse.command);
    if (!definition) throw new CommandRefusal(`Unknown command: ${inverse.command}`, 409, 'COMMAND_NOT_FOUND');
    await saveStep(batch.runner, id, { ...found, state: 'undone', failureReason: null });
    return { step: found, inverse, definition };
  });
  const restoreAccepted = async () => db[sandboxBatch](async batch => {
    if (!await lockBinding(batch.runner, binding)) throw new CommandRefusal('No open sandbox belongs to you in this workspace', 404, 'SANDBOX_NOT_FOUND');
    const current = (await stepsOf(batch.runner, id)).find(row => row.id === stepId);
    if (current?.state === 'undone') await saveStep(batch.runner, id, { ...step, state: 'accepted', failureReason: null });
  });
  let outcome: CommandExecutionOutcome;
  try {
    outcome = await runRegisteredCommand(req, { definition, workspaceId: binding.workspaceId, input: inverse.input }, { getDb: () => db });
  } catch (err) {
    await restoreAccepted().catch(restoreErr => console.error('[sandbox] undo restore failed', restoreErr));
    throw err;
  }
  if (!outcome.ok) {
    await restoreAccepted().catch(restoreErr => console.error('[sandbox] undo restore failed', restoreErr));
    return { step, outcome };
  }
  const undone: StoredStep = { ...step, state: 'undone', failureReason: null };
  return { step: undone, outcome };
}
