import React, { useEffect, useRef } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface RecordStep {
  id: string;
  label: string;
  done: boolean;
  current: boolean;
}

export interface RecordMetric {
  id: string;
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'positive' | 'warning' | 'danger';
  hint?: string;
}

export interface RecordNextAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

export interface RecordPageProps {
  backLabel: string;
  onBack: () => void;
  focusKey?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  lang?: string;
  title: string;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  steps?: RecordStep[];
  nextStepAction?: RecordNextAction;
  secondaryActions?: React.ReactNode;
  banner?: React.ReactNode;
  metrics?: RecordMetric[];
  details?: React.ReactNode;
  children?: React.ReactNode;
  related?: React.ReactNode;
  attachments?: React.ReactNode;
  notes?: React.ReactNode;
  history?: React.ReactNode;
}

const METRIC_TONE: Record<NonNullable<RecordMetric['tone']>, string> = {
  default: 'text-[var(--text)]',
  positive: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-600 dark:text-rose-400',
};

/**
 * Shared single-record page layout (UI-2 Part 2): back navigation, header, U-9 step path
 * with a single primary next-step CTA, inline-editable fields, related records, files, notes,
 * and audit history.
 */
export function RecordPage({
  backLabel,
  onBack,
  focusKey,
  dir,
  lang,
  title,
  subtitle,
  badge,
  steps,
  nextStepAction,
  secondaryActions,
  banner,
  metrics,
  details,
  children,
  related,
  attachments,
  notes,
  history,
}: RecordPageProps) {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backRef.current?.focus();
  }, [focusKey]);

  const handleEscape = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
    const target = event.target;
    // An inline editor, popup or portaled control gets its own Escape. Only the record's
    // ordinary controls can go Back; the rest of the app retains its keyboard behavior.
    if (!(target instanceof Element) || !event.currentTarget.contains(target) ||
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], dialog[open]')) return;
    event.preventDefault();
    event.stopPropagation();
    onBack();
  };

  return (
    <div dir={dir} lang={lang} onKeyDown={handleEscape} className="w-full max-w-6xl mx-auto space-y-6 p-4 sm:p-6 lg:p-8 text-[var(--text)]">
      <div>
        <button
          ref={backRef}
          type="button"
          aria-keyshortcuts="Escape"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:underline mb-3"
        >
          <ArrowLeft aria-hidden="true" size={16} />
          <span>{backLabel}</span>
        </button>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]"><bdi>{title}</bdi></h1>
              {badge}
            </div>
            {subtitle && (
              <div className="text-sm text-[var(--muted)]">{subtitle}</div>
            )}
          </div>

          {(nextStepAction || secondaryActions) && (
            <div data-print-hide className="flex flex-wrap items-center gap-2 shrink-0">
              {secondaryActions}
              {nextStepAction && (
                <button
                  type="button"
                  onClick={nextStepAction.onClick}
                  disabled={nextStepAction.disabled}
                  title={nextStepAction.title}
                  className="inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-xl bg-[var(--text)] text-[var(--surface)] text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm cursor-pointer"
                >
                  {nextStepAction.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {steps && steps.length > 0 && (
        <nav aria-label="Record progress" className="p-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)]">
          <ol className="flex flex-wrap items-center gap-2 sm:gap-4">
            {steps.map((step, index) => (
              <li key={step.id} className="flex items-center gap-2" aria-current={step.current ? 'step' : undefined}>
                <span
                  className={cn(
                    'w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold border',
                    step.done && 'bg-emerald-600 text-white border-emerald-600',
                    !step.done && step.current && 'bg-indigo-600 text-white border-indigo-600',
                    !step.done && !step.current && 'bg-[var(--surface)] text-[var(--muted)] border-[var(--line)]',
                  )}
                >
                  {step.done ? <Check aria-hidden="true" size={13} /> : index + 1}
                </span>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    step.current || step.done ? 'text-[var(--text)]' : 'text-[var(--muted)]',
                  )}
                >
                  {step.label}
                </span>
                {index < steps.length - 1 && (
                  <span aria-hidden="true" className="text-[var(--muted)] px-1">→</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {banner}

      {metrics && metrics.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map(metric => (
            <div key={metric.id} className="p-4 rounded-2xl border border-[var(--line)] bg-[var(--panel)]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{metric.label}</p>
              <div className={cn('mt-1.5 text-xl font-mono font-bold tabular-nums', METRIC_TONE[metric.tone || 'default'])}>
                {metric.value}
              </div>
              {metric.hint && <p className="mt-1 text-xs text-[var(--muted)]">{metric.hint}</p>}
            </div>
          ))}
        </div>
      )}

      {details && (
        <section aria-label="Record details" className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          {details}
        </section>
      )}

      {children}

      {related && (
        <section aria-label="Related records" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {related}
        </section>
      )}

      {(attachments || notes) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {attachments && (
            <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
              {attachments}
            </div>
          )}
          {notes && (
            <div className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
              {notes}
            </div>
          )}
        </div>
      )}

      {history && (
        <section aria-label="Record history" className="p-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
          {history}
        </section>
      )}
    </div>
  );
}
