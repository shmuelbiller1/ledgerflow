import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../hooks/useDialog';
import type { ScreenDataHealth } from '../../hooks/useScreenDataHealth';
import { LoadingState } from '../ui/LoadingState';
import { ScreenDataNotice } from '../ui/ScreenDataNotice';

/** A transaction deep link keeps its detail surface open while the on-demand entries arrive.
 * A failed read is not an absent record; a capped list is not an authoritative "not found".
 */
export function TransactionRecordLoadDialog({ id, health, capped, onClose }: {
  id: string;
  health: ScreenDataHealth;
  capped: boolean;
  onClose: () => void;
}) {
  const { dialogProps, titleId } = useDialog(onClose);
  const closeRef = useRef<HTMLButtonElement>(null);
  const failed = health.failedKeys.includes('transactions');
  const loading = health.loadingKeys.includes('transactions');
  const title = failed ? 'Transaction unavailable' : loading ? 'Loading transaction' : capped ? 'Transaction not in loaded entries' : 'Transaction not found';

  return createPortal(
    <div {...dialogProps} className="fixed inset-0 z-[210] flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-zinc-950/70" />
      <div className="relative w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6 shadow-2xl space-y-4 text-[var(--text)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold">{title}</h2>
            <p className="mt-1 text-xs text-[var(--muted)] break-all">Entry ID: <bdi>{id}</bdi></p>
          </div>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="Close transaction details"
            className="min-h-11 min-w-11 rounded-lg border border-[var(--line)] text-sm hover:bg-[var(--panel)]">Close</button>
        </div>
        {failed ? <ScreenDataNotice failedKeys={health.failedKeys} message={health.message} what="this transaction"
          onRetry={() => { health.retry(); closeRef.current?.focus(); }} />
          : loading ? <LoadingState what="transaction" rows={2} />
            : <p className="text-sm text-[var(--muted)]">{capped
              ? 'Only part of the ledger is loaded. This entry may be outside the loaded range.'
              : 'This entry may have been deleted or belongs to another workspace.'}</p>}
      </div>
    </div>,
    document.body,
  );
}
