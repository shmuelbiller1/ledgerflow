/**
 * The shape every "Settings → Backup & Export" card has, in one place.
 *
 * There are three (workspace archive, year-end archive, QuickBooks IIF list) and each had its own copy of the
 * same forty lines: an owner check, a `busy` flag, a `pending` lock so a double-click cannot start two
 * downloads, an `AbortController` aborted when the card unmounts or the workspace changes, a `scopeValid()`
 * re-check after every `await`, and a catch that only shows its message if the person is still looking at the
 * same workspace. Three copies is three places for that to be subtly wrong — and the year-end card already had
 * one: it read its controller inside a closure that ran before the controller was assigned.
 *
 * What this does *not* do is build a file. Each card passes `run`, which does its own work and attaches the
 * blob itself. The guarantee is narrow and honest: **while `run` works the scope is unchanged, and nothing is
 * reported to a person who has left.**
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { runCommand, type CommandBody } from '../lib/runCommand';

export interface ExportRun {
  /** The workspace chosen when the person clicked; every `await` below must still be inside it. */
  workspaceId: string;
  uid: string;
  /** Aborted when the card unmounts or a new download takes over. */
  signal: AbortSignal;
  /** False once the workspace, the user or the card itself has changed. Check after every `await`. */
  stillHere: () => boolean;
}

interface UseServerExportOptions {
  /** Only an owner may read the verified backup. Said on screen, not discovered after the click. */
  allowed: boolean;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  /** The card's own sentence for a failure, naming the file that was *not* written. */
  failure: string;
  run: (context: ExportRun) => Promise<void>;
}

/** Runs one card's export under the guard: one at a time, scoped, aborted on unmount. */
export function useServerExport({ allowed, setBusy, setError, failure, run }: UseServerExportOptions) {
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  // `run` changes identity most renders; keeping it next to `start` in a ref set from an effect means the
  // button's onClick is stable while the work it starts is always the current closure (refs cannot be
  // written during render, which the repo's lint enforces)
  const runRef = useRef(run);
  const failureRef = useRef(failure);
  useEffect(() => { runRef.current = run; failureRef.current = failure; }, [run, failure]);

  useEffect(() => () => { alive.current = false; abortRef.current?.abort(); }, []);

  const start = useCallback(async () => {
    if (pending.current || !allowed) return;
    const store = useAuthStore.getState();
    const workspaceId = store.currentWorkspaceId;
    const uid = store.user?.uid;
    if (!workspaceId || !uid) return;

    pending.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const stillHere = () => alive.current
      && !controller.signal.aborted
      && useAuthStore.getState().currentWorkspaceId === workspaceId
      && useAuthStore.getState().user?.uid === uid;
    try {
      await runRef.current({ workspaceId, uid, signal: controller.signal, stillHere });
    } catch (error) {
      // Aborting is not a failure to report: the person closed the card or moved workspace on purpose.
      if (stillHere() && !controller.signal.aborted) {
        setError(error instanceof Error && error.message ? error.message : failureRef.current);
      }
    } finally {
      pending.current = false;
      if (stillHere()) setBusy(false);
    }
  }, [allowed, setBusy, setError]);

  /** Aborts what is in flight and clears the busy flag. For a card with a visible Cancel button. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    pending.current = false;
    setBusy(false);
  }, [setBusy]);

  return { start, cancel };
}

/**
 * Reads the verified server backup, or throws the card's sentence saying no partial file was written.
 *
 * Every card builds from this one payload, never from the browser cache, which may be short a record.
 */
export async function readVerifiedBackup(workspaceId: string, signal: AbortSignal, failure: string): Promise<CommandBody> {
  try {
    return await runCommand<CommandBody>({
      path: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/export`,
      signal,
    });
  } catch (error) {
    throw new Error(failure, { cause: error });
  }
}

/** Hands a blob to the browser as a download, and always cleans the link up. */
export function saveBlob(blob: Blob, filename: string, revokeAfterMs = 0): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}
