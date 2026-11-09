import React from 'react';
import { Database, Plus } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** the one control that fills the screen, when it is not a plain button (for example "Connect a bank") */
  action?: React.ReactNode;
}

/** "Nothing here yet" with the one action that fills the screen. Use LoadingState while loading. */
export function EmptyState({ title, description, actionLabel, onAction, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-[var(--line)] rounded-[32px] bg-[var(--ink)]">
      <div className="w-16 h-16 bg-[var(--surface)] border border-[var(--line)] rounded-2xl flex items-center justify-center text-[var(--muted)] mb-6 shadow-sm">
        <Database size={32} aria-hidden="true" />
      </div>
      <h2 className="text-xl font-black text-[var(--text)] tracking-tight mb-2">{title}</h2>
      <p className="text-sm font-semibold text-[var(--muted)] max-w-md mb-8">{description}</p>
      {action ?? (onAction && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="flex items-center gap-2 px-6 py-3 bg-[var(--text)] text-[var(--surface)] rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity shadow-md"
        >
          <Plus size={16} aria-hidden="true" />
          {actionLabel}
        </button>
      ))}
    </div>
  );
}
