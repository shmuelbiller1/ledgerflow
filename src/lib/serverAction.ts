/**
 * The three fixes for the bug families in docs/BUG_PATTERNS.md (scripts/bug-patterns.ts), so
 * each finding is a few lines to repair:
 *
 *  - `ActionResult` + `ok()/failed()`: an action reports failure instead of swallowing it
 *    (swallowing-action, success-after-call). Show success only when `result.ok`.
 *  - `runOnce`: one click → one request with one idempotency key; a second click while the
 *    first is pending is ignored (double submits, #105, #97).
 *  - `workspaceScope`: capture the workspace before an await; after it, `isCurrent()` says
 *    whether the user is still in the same books (stale-async, #99, #100, #102, #107).
 *  - `allSettledWrites`: when several rows must be written from the client, write all, then
 *    report exactly which failed — never "done" for a partial batch (write-in-loop). A real
 *    all-or-nothing change belongs in one server route.
 */

export type ActionResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): ActionResult<T> => ({ ok: true, value });
export const failed = (error: unknown): ActionResult<never> => ({
  ok: false,
  error: error instanceof Error ? error.message : typeof error === 'string' ? error : 'The change was not saved',
});

/** Turns a throwing write into an ActionResult (never throws itself). */
export async function attempt<T>(write: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await write());
  } catch (err) {
    return failed(err);
  }
}

const pending = new Map<string, Promise<unknown>>();

/** Runs `write` once per `key` at a time; a repeat while it runs gets the same promise. */
export function runOnce<T>(key: string, write: (idempotencyKey: string) => Promise<T>): Promise<T> {
  const running = pending.get(key) as Promise<T> | undefined;
  if (running) return running;
  const idempotencyKey = `${key}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  const p = write(idempotencyKey).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

export const isRunning = (key: string) => pending.has(key);

/** Captures the workspace now; after an await, `isCurrent()` is false if the user switched books. */
export function workspaceScope(getWorkspaceId: () => string | null | undefined) {
  const at = getWorkspaceId() ?? null;
  return { workspaceId: at, isCurrent: () => (getWorkspaceId() ?? null) === at };
}

/** Writes every item, then says exactly which ones failed (no partial "done"). */
export async function allSettledWrites<I, T>(items: I[], write: (item: I) => Promise<T>) {
  const results = await Promise.allSettled(items.map(write));
  const done: { item: I; value: T }[] = [];
  const failures: { item: I; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') done.push({ item: items[i], value: r.value });
    else failures.push({ item: items[i], error: failed(r.reason).ok === false ? (failed(r.reason) as { error: string }).error : 'failed' });
  });
  return { done, failures, allOk: failures.length === 0 };
}
