import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** A custom next action when the surrounding screen already owns the control. */
  action?: ReactNode;
}

/** A compact, report-specific empty state that leaves the period controls and totals in place. */
export default function ReportEmptyState({ title, description, actionLabel, onAction, action }: Props) {
  return (
    <div data-report-empty-state role="status" className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface)] px-5 py-4">
      <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
      {description && <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>}
      {action ?? (onAction && actionLabel && (
        <button type="button" onClick={onAction} className="mt-3 min-h-11 rounded border px-3 text-sm font-semibold">
          {actionLabel}
        </button>
      ))}
    </div>
  );
}
