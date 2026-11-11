import { guestSession, assertGuestSession, writeGuestBatch, SAMPLE_WORKSPACE_ID, type GuestOperation } from './db/guestDatabase';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';

/**
 * Run the UNCHANGED entry builders with their existing capture-only context in the sample.
 * No browser posting host/server transport is called. One batch saves the document and its
 * captured entries together. The originating demo session is checked again after every await.
 * Real sessions use exactly the existing posting path, with no context override.
 */
export async function withSamplePosting<T>(workspaceId: string, expected: object | null, run: (context?: LedgerPostContext) => Promise<T>): Promise<T> {
  if (!expected && !guestSession()) {
    if (workspaceId === SAMPLE_WORKSPACE_ID) throw new Error('The sample company is closed.');
    return run();
  }
  assertGuestSession(expected);
  if (workspaceId !== SAMPLE_WORKSPACE_ID) throw new Error('Only the sample company can be changed in the demo.');
  const capture: NonNullable<LedgerPostContext['capture']> = [];
  const result = await run({ capture });
  assertGuestSession(expected);
  const operations: GuestOperation[] = [];
  for (const posting of capture) {
    for (const transaction of posting.txs) {
      const id = transaction.id || crypto.randomUUID();
      operations.push({ op: 'set', table: 'transactions', id, data: { ...transaction, id } });
    }
    const mutation = posting.entityMutation;
    if (mutation) operations.push({ op: mutation.action === 'delete' ? 'delete' : 'set', table: mutation.collection, id: mutation.docId, data: mutation.data, merge: mutation.action === 'update' });
  }
  writeGuestBatch(operations, expected!);
  return result;
}
