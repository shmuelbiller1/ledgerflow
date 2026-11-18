import type { RequestUser } from '../auth/requestUser';
import { FirestoreError } from '../db/firestore';
import { refKey } from '../db/pg/commandStage';
import type { DraftPhase } from '../db/pg/sandboxBatch';
import { clearDraft, saveStep, type StoredStep } from '../db/pg/sandboxReviewStore';
import { isRetryable } from '../db/pg/sql';
import { CommandRefusal, errorOutcome } from '../utils/commandExecutor';
import { requestPayloadHash } from '../utils/idempotency';
import { overlayCollections, prepareDraftStep, stepCommand } from './sandboxStepCommands';

export interface ReviewActor { user: RequestUser; workspaceId: string; sandboxId: string; workspace: Record<string, unknown> }
export type StepIntent = Pick<StoredStep, 'id' | 'position' | 'command' | 'input'>;

export function parentsOf(step: StoredStep, earlier: readonly StoredStep[]): string[] {
  const paths = new Set(step.dependencies.map(refKey));
  return earlier.filter(candidate => candidate.position < step.position && candidate.dependencies.some(dep => dep.written && paths.has(refKey(dep))))
    .map(candidate => candidate.id);
}

/** Known readers cannot be moved before, or left without, the steps that supplied their records. */
export function assertDraftOrder(prior: readonly StoredStep[], next: readonly StoredStep[]): void {
  const positions = new Map(next.map((row, index) => [row.id, index]));
  for (const step of next) {
    for (const parent of parentsOf(step, prior)) {
      if ((positions.get(parent) ?? Infinity) >= positions.get(step.id)!) {
        throw new CommandRefusal('Keep the required earlier step before its dependent step', 409, 'SANDBOX_DEPENDENCY_REQUIRED', { stepId: step.id, requires: parent });
      }
    }
  }
}

export function stepFailure(err: unknown, step: StepIntent): CommandRefusal {
  if (isRetryable(err)) throw err;
  if (err instanceof FirestoreError && err.code === 6) {
    return new CommandRefusal('A record for this step already exists', 409, 'DUPLICATE_RECORD', { stepId: step.id });
  }
  if (err instanceof FirestoreError && err.code === 5) {
    return new CommandRefusal('A required record could not be found', 409, 'NOT_FOUND', { stepId: step.id });
  }
  const refusal = errorOutcome(err, step.command);
  if (!refusal.ok && refusal.status < 500) return new CommandRefusal(refusal.message, refusal.status, refusal.code, { stepId: step.id });
  throw err;
}

export async function saveDraftStep(phase: DraftPhase, actor: ReviewActor, intent: StepIntent, ids: Map<string, string>): Promise<StoredStep> {
  const { command, writable } = stepCommand(intent.command);
  const { value, dependencies, allocatedIds } = await phase.stage({ ids, writable }, (db, tx) => prepareDraftStep(actor, db, tx, command, intent.input));
  return { ...intent, input: value.input, preview: { ...value.preview, allocatedIds }, dependencies,
    recordIds: dependencies.filter(ref => ref.written && !ref.fromOverlay && ref.baseVersion === null).map(({ collectionId, id }) => ({ collectionId, id })),
    state: 'pending', inverse: null, failureReason: null };
}

const basis = (step: StoredStep) => requestPayloadHash([step.input, step.dependencies, step.preview]);

async function retryDraftStep(phase: DraftPhase, actor: ReviewActor, step: StoredStep, strict: boolean, blocked: boolean): Promise<StoredStep> {
  if (blocked) return { ...step, state: 'failed', failureReason: 'An earlier required step could not be rebuilt' };
  await phase.runner.query('savepoint draft_replay_step');
  try {
    const rebuilt = await saveDraftStep(phase, actor, step, new Map(Object.entries(step.preview.allocatedIds)));
    // A newly initialized numbering series is shared state, not a permanent new-record reservation.
    const created = new Set(step.recordIds.filter(ref => ref.collectionId !== 'numberingSeries').map(refKey));
    if (rebuilt.dependencies.some(ref => ref.written && (ref.fromOverlay || ref.baseVersion !== null) && created.has(refKey(ref)))) {
      throw new CommandRefusal('A record for this step already exists', 409, 'DUPLICATE_RECORD');
    }
    if (step.preview.entityId && rebuilt.preview.entityId !== step.preview.entityId) {
      throw new CommandRefusal('Editing a step cannot change its record id', 409, 'SANDBOX_STEP_ID_CHANGED');
    }
    await phase.runner.query('release savepoint draft_replay_step');
    return rebuilt;
  } catch (err) {
    const failure = stepFailure(err, step);
    if (strict) throw failure;
    await phase.runner.query('rollback to savepoint draft_replay_step');
    await phase.runner.query('release savepoint draft_replay_step');
    return { ...step, state: 'failed', failureReason: failure.message };
  }
}

/** Re-run commands, never copy overlay rows, even for a human edit or a version recheck. */
export async function rebuildDraft(phase: DraftPhase, actor: ReviewActor, steps: readonly StoredStep[], strict: boolean, edited = new Set<string>()) {
  await clearDraft(phase.runner, overlayCollections);
  const changed = new Set<string>();
  const failed = new Set<string>();
  const rows: StoredStep[] = [];
  for (const step of steps) {
    const parents = parentsOf(step, steps);
    const fresh = await retryDraftStep(phase, actor, step, strict, parents.some(id => failed.has(id)));
    const stale = edited.has(step.id) || basis(step) !== basis(fresh) || parents.some(id => changed.has(id)) || (step.state === 'failed' && fresh.state !== 'failed');
    if (fresh.state === 'failed') failed.add(step.id);
    if (stale || (step.state !== fresh.state && fresh.state === 'failed')) changed.add(step.id);
    if (fresh.state !== 'failed' && (stale || step.state === 'needs-recheck')) fresh.state = 'needs-recheck';
    await saveStep(phase.runner, actor.sandboxId, fresh);
    rows.push(fresh);
  }
  return { rows, changed };
}
