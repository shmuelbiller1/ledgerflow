import { AlertTriangle, RotateCw } from 'lucide-react';
import { collectionList, type LedgerKey } from '../../lib/ledgerCollections';

interface ScreenDataNoticeProps {
  /** the collections the screen needs that could not be loaded */
  failedKeys: readonly LedgerKey[];
  /** what the store recorded when the load failed, when it said why */
  message?: string;
  /** ask for the failed collections again */
  onRetry: () => void;
  /** what the screen calls its own data, e.g. "this report" — used in the sentence */
  what?: string;
}

/**
 * The one notice every screen shows when the data it needs could not be loaded (A-235): the same
 * words, the same "Try again", instead of a screen that quietly looks empty. It renders nothing
 * when nothing failed, so a screen can mount it above its content.
 *
 * It never claims the screen is fine: what is below may be empty or out of date, and the sentence
 * says so. A permission refusal is not retried by itself (src/lib/collectionRetry.ts); pressing
 * "Try again" is the reader's own decision.
 */
export function ScreenDataNotice({ failedKeys, message, onRetry, what }: ScreenDataNoticeProps) {
  if (!failedKeys.length) return null;
  const names = collectionList(failedKeys);
  return (
    <div
      role="alert"
      data-screen-data-notice
      className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 sm:flex-row sm:items-start"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--neg)]" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-[var(--text)]">
          Couldn't load {names}{what ? ` for ${what}` : ''}.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {message ? `${message} ` : ''}
          Anything below may be empty or out of date. Check your connection, then try again.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-xs font-bold text-[var(--text)] hover:bg-[var(--panel)]"
      >
        <RotateCw size={14} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
