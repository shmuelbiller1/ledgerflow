import { AsyncLocalStorage } from 'node:async_hooks';
import type { Firestore } from '../db/firestore';
import { assertOutsideCommandStage, refuseCommandStage } from '../db/pg/commandStage';
import type { NotificationType } from '../../lib/notifications';

export type EffectIntent = (
  | { kind: 'notification'; action: NotificationType }
  | { kind: 'email'; action: 'send' | 'invoice' | 'statement' | 'payment-receipt' | 'remittance' }
  | { kind: 'exchange-rate'; action: 'fetch' }
  | { kind: 'bank'; action: 'sync' | 'verify-webhook' | 'register-webhook' }
  | { kind: 'storage'; action: 'delete-prefix' }
) & { target?: string };

type Scope = Pick<Firestore, 'sandboxId'>;
const captures = new AsyncLocalStorage<{ db: Scope; active: boolean; intents: EffectIntent[]; failure?: SandboxEffectRefusal }>();

export class SandboxEffectRefusal extends Error {
  readonly status = 409;
  readonly code = 'SANDBOX_OUTSIDE_EFFECT';
}

/** Keep only data safe to show in a review. Never retain provider arguments or callbacks. */
export async function captureEffects<T>(db: Scope, work: () => Promise<T>) {
  if (captures.getStore()) refuseSandboxEffect('Expected one scoped effect capture');
  const capture = { db, active: true, intents: [] as EffectIntent[], failure: undefined as SandboxEffectRefusal | undefined };
  try {
    const value = await captures.run(capture, work);
    if (capture.failure) throw capture.failure;
    return { value, intents: [...capture.intents] };
  } finally {
    capture.active = false;
  }
}

export function refuseSandboxEffect(message: string): never {
  const error = new SandboxEffectRefusal(message);
  const capture = captures.getStore();
  if (capture?.active) capture.failure ??= error;
  return refuseCommandStage(error);
}

function record(intents: readonly EffectIntent[], db?: Scope): boolean {
  const capture = captures.getStore();
  if (!capture && !db?.sandboxId) return false;
  if (!capture?.active || (db && capture.db !== db)) refuseSandboxEffect('Outside effect needs the active sandbox handle');
  for (const { kind, action, target } of intents) {
    capture.intents.push({ kind, action, ...(target ? { target: target.slice(0, 254) } : {}) } as EffectIntent);
  }
  return true;
}

export function deferEffects<T>(db: Scope, intents: readonly EffectIntent[], afterCommit: (job: () => T) => void, send: () => T): void {
  record(intents, db);
  if (!db.sandboxId) afterCommit(send);
}

/** If a command needs the provider's result, refuse instead of inventing one. */
export function guardEffect(intent: EffectIntent, db?: Scope): void {
  if (record([intent], db)) refuseSandboxEffect(`Cannot ${intent.action} (${intent.kind}) from a sandbox`);
  assertOutsideCommandStage('Outside effects must run after the command has committed');
}

export function previewEffect(intent: EffectIntent, db?: Scope): boolean {
  if (record([intent], db)) {
    if (db?.sandboxId) return true;
    refuseSandboxEffect('Outside effects must run after the command has committed');
  }
  assertOutsideCommandStage('Outside effects must run after the command has committed');
  return false;
}
