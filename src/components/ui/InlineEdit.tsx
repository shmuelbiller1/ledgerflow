import React, { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { inlineEditText, parseInlineValue, sameInlineValue, type InlineKind } from '../../lib/inlineEdit';

export interface InlineEditProps {
  /** The stored value (money in cents). */
  value: unknown;
  /** Field/context for the accessible name; the displayed value is added automatically. */
  label: string;
  /** Saves the new value (money: integer cents; number: number; else text). Throw to refuse. */
  onSave: (next: string | number) => Promise<unknown> | unknown;
  kind?: InlineKind;
  options?: Array<{ value: string; label: string }>;
  /** I-23: values offered while typing (see suggestionsFrom). */
  suggestions?: string[];
  /** Shown when empty, e.g. "Add email". */
  placeholder?: string;
  /** False: plain text (viewers). */
  canEdit?: boolean;
  /** How the value is shown when not editing. */
  display?: React.ReactNode;
  /** Return a message to refuse a value before saving. */
  validate?: (next: string | number) => string | null;
  className?: string;
  inputClassName?: string;
  /** False when the caller shows its own retry after a failed save (the box then just closes). */
  reopenOnFailure?: boolean;
}

/**
 * Edit in place (I-22, owner's rule): the value is shown as text; click it (or Tab to it and press
 * Enter) and type. Enter or leaving the field saves, Esc cancels; Ctrl/⌘+Enter saves a long text.
 * Suggestions from the workspace's own data appear while typing (I-23).
 */
export default function InlineEdit({
  value, label, onSave, kind = 'text', options, suggestions, placeholder, canEdit = true, display, validate, className, inputClassName, reopenOnFailure = true,
}: InlineEditProps) {
  const listId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const done = useRef(false);

  const shown = display ?? (value === null || value === undefined || value === '' ? null : String(value));
  if (!canEdit) return <span className={className}>{shown ?? <span className="text-[var(--faint)]">—</span>}</span>;

  const start = () => {
    if (saving) return; // the last value is still being saved
    done.current = false;
    setDraft(inlineEditText(kind, value));
    setError('');
    setEditing(true);
  };

  const finish = async (save: boolean) => {
    if (done.current) return;
    if (!save) { done.current = true; setEditing(false); return; }
    const parsed = parseInlineValue(kind, draft);
    if (parsed === null) { setError(kind === 'email' ? 'Enter an email address' : kind === 'date' ? 'Enter a date' : 'Enter a number'); return; }
    if (sameInlineValue(kind, value, parsed, draft)) { done.current = true; setEditing(false); return; }
    const refused = validate?.(parsed);
    if (refused) { setError(refused); return; }
    done.current = true;
    setSaving(true);
    setEditing(false);
    let failure: string | null = null;
    try {
      await onSave(parsed);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      setSaving(false);
    }
    if (failure !== null) {
      toast.error(`${label} not saved`, { description: failure });
      if (!reopenOnFailure) return;
      // what was typed isn't lost: the box opens again with it and the reason (Esc gives up)
      done.current = false;
      setError(failure);
      setEditing(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void finish(false); }
    else if (e.key === 'Enter' && (kind !== 'textarea' || e.metaKey || e.ctrlKey)) { e.preventDefault(); void finish(true); }
  };

  if (editing) {
    const common = {
      'aria-label': label,
      'aria-invalid': error ? true : undefined,
      autoFocus: true,
      value: draft,
      onKeyDown,
      onBlur: () => { void finish(true); },
      // clicks in the box stay here (rows that open the record on click don't react)
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      className: cn('w-full min-w-[6rem] px-2 py-1 text-sm bg-[var(--ink)] border border-[var(--brass-line)] rounded-md text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--brass)]', inputClassName),
    };
    return (
      <span className={cn('inline-flex flex-col gap-0.5 w-full', className)}>
        {kind === 'textarea' ? (
          <textarea {...common} rows={3} onChange={e => { setDraft(e.target.value); setError(''); }} />
        ) : kind === 'select' ? (
          <select {...common} onChange={e => { setDraft(e.target.value); setError(''); }}>
            {(options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input {...common} type={kind === 'money' ? 'text' : kind === 'number' ? 'text' : kind} inputMode={kind === 'money' || kind === 'number' ? 'decimal' : undefined}
            list={suggestions?.length ? listId : undefined} onFocus={e => e.currentTarget.select()}
            onChange={e => { setDraft(e.target.value); setError(''); }} />
        )}
        {suggestions?.length ? <datalist id={listId}>{suggestions.map(s => <option key={s} value={s} />)}</datalist> : null}
        {error && <span role="alert" className="text-[11px] text-[var(--neg)]">{error}</span>}
      </span>
    );
  }

  return (
    <>
    <span id={`${listId}-edit-label`} hidden>Edit {label}:</span>
    <button type="button" onClick={e => { e.stopPropagation(); start(); }} aria-labelledby={`${listId}-edit-label ${listId}-edit-value`} data-inline-edit="" title={`Click to edit ${label.toLowerCase()}`}
      disabled={saving} aria-busy={saving || undefined}
      className={cn('group text-left max-w-full rounded px-0.5 -mx-0.5 border border-transparent hover:border-dashed hover:border-[var(--line)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)] cursor-text', saving && 'opacity-60', className)}>
      <span id={`${listId}-edit-value`} className="contents">{shown ?? <span className="text-[var(--faint)] italic">{placeholder || 'Add'}</span>}</span>
      {saving && <Loader2 aria-hidden="true" className="inline w-3 h-3 ml-1 animate-spin" />}
    </button>
    </>
  );
}
