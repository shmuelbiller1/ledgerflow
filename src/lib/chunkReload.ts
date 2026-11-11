/**
 * After a deploy, an open tab still holds the old index.html and its chunk URLs; opening a lazy screen
 * then fails because that hashed .js file is gone. Reload once so the browser gets the new index,
 * remember in sessionStorage so a genuinely broken file cannot loop, and never auto-reload over an
 * open dialog or dirty form (`hasUnsavedDocumentWork`).
 */
import { hasUnsavedDocumentWork } from './pwaUpdateManager';

const KEY = 'lf_chunk_reload_at';
const COOLDOWN_MS = 60_000;

export function isChunkLoadFailure(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed/i.test(msg);
}

export function reloadOnceForNewVersion(
  now = Date.now(),
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof sessionStorage === 'undefined' ? null : sessionStorage,
  reload: () => void = () => window.location.reload(),
  hasUnsaved: () => boolean = () => hasUnsavedDocumentWork(),
): boolean {
  if (hasUnsaved()) return false;
  try {
    const last = Number(storage?.getItem(KEY) || 0);
    if (last && now - last < COOLDOWN_MS) return false;
    storage?.setItem(KEY, String(now));
  } catch { /* private mode without sessionStorage: still reload once */ }
  reload();
  return true;
}
