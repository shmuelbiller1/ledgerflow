import type { Firestore, Transaction } from '../pgFirestore';
import { runCommandStage, type StageOptions, type StageState } from './commandStage';
import { enterSandbox } from './sandbox';
import type { Runner } from './sql';

/** Not a command handler capability. Only the sandbox coordinator receives this symbol-backed batch. */
export const sandboxBatch = Symbol('sandboxBatch');

type TransactionFactory = (db: Firestore, state: StageState) => Transaction;
export type SandboxBatch = ReturnType<typeof createSandboxBatch>;

export function createSandboxBatch(live: Firestore, runner: Runner, transaction: TransactionFactory,
  connectDraft: (db: Firestore, active: boolean) => void) {
  const stage = <R>(db: Firestore, options: StageOptions, work: (tx: Transaction) => Promise<R>) => {
    const state = { failure: undefined };
    return runCommandStage(db, runner, transaction(db, state), state, options, work);
  };
  return {
    runner,
    live: <R>(options: StageOptions, work: (db: Firestore, tx: Transaction) => Promise<R>) =>
      stage(live, options, tx => work(live, tx)),
    async draft<R>(id: string, work: (phase: DraftPhase) => Promise<R>): Promise<R> {
      const db = live.forSandbox(id);
      await enterSandbox(runner, id);
      connectDraft(db, true);
      try {
        const result = await work({ runner, stage: (options, call) => stage(db, options, tx => call(db, tx)) });
        await runner.query('set local role none');
        await runner.query("select set_config('lf.sandbox_id', '', true)");
        return result;
      } finally {
        // A failed role-scoped query must escape to the outer transaction's rollback.
        connectDraft(db, false);
      }
    },
  };
}

export interface DraftPhase {
  runner: Runner;
  stage<R>(options: StageOptions, work: (db: Firestore, tx: Transaction) => Promise<R>): ReturnType<typeof runCommandStage<R>>;
}
