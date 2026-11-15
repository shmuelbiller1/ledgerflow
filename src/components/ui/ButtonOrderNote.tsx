import { RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ButtonOrderNoteProps {
  /** What the list is called, for the reset button's name ("Reset order of daily tools"). */
  listName: string;
  /** Has the person rearranged this list? Nothing visible is rendered until they have. */
  isCustom: boolean;
  onReset: () => void;
  /** The last move, read out by screen readers (from `useDragReorder`). */
  status: string;
  /** The change could not be saved in this browser. */
  storageError?: boolean;
  /** Hide the visible part (a collapsed sidebar has no room for it); the live region stays. */
  compact?: boolean;
  className?: string;
}

/**
 * The small print under a list of buttons that can be rearranged (`useButtonOrder` +
 * `useDragReorder`): the live region that reads each move out, and — only once the person has
 * changed the order — a way back to the order the product ships with. A list nobody has touched
 * looks exactly as it did before rearranging existed.
 */
export default function ButtonOrderNote({ listName, isCustom, onReset, status, storageError = false, compact = false, className }: ButtonOrderNoteProps) {
  return (
    <>
      {/* aria-live without role="status": screens and their tests already own "the" status of a list */}
      <p aria-live="polite" aria-atomic="true" className="sr-only" data-testid="button-order-status">{status}</p>
      {isCustom && !compact && (
        <div className={cn('px-2 text-xs text-[var(--muted)]', className)}>
          <button
            type="button"
            onClick={onReset}
            aria-label={`Reset order of ${listName}`}
            title={`Put ${listName} back in the standard order`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-[var(--muted)] underline underline-offset-2 hover:text-[var(--text)]"
          >
            <RotateCcw aria-hidden="true" size={12} className="shrink-0" />
            <span>Reset order</span>
          </button>
          {storageError && <p role="alert" className="break-words pb-1">This browser could not save the new order. It lasts until this page reloads.</p>}
        </div>
      )}
    </>
  );
}
