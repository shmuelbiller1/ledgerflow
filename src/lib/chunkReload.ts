/**
 * After a new version is deployed, a tab that is already open still asks for the previous version's
 * screen files (e.g. /assets/Sales-<oldhash>.js), which no longer exist. The fix is a page reload, which
 * loads the new version. Done automatically, at most once per 60 seconds, so a file that is truly
 * broken shows the error instead of reloading in a loop.
 */
const KEY = 'ledgerflow_chunk_reload_at';
const WINDOW_MS = 60_000;

export function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module|Unable to preload CSS/i.test(message);
}

/** Reloads the page to pick up the new version; false (no reload) when one was just done. */
export function reloadOnceForNewVersion(now: number = Date.now(), storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(), reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(storage?.getItem(KEY) || 0);
    if (last && now - last < WINDOW_MS) return false;
    storage?.setItem(KEY, String(now));
  } catch { /* storage blocked: still reload once */ }
  reload();
  return true;
}

function safeSession(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}
