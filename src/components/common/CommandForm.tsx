import React, { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Field } from './Field';
import { buildCommandInput, formForCommand, type SchemaField } from '../../lib/commandFormSchema';

/**
 * A form for one command, generated from the command's own input schema.
 *
 * The task's rule for part 4 is "forms from the schema", and the task's rule for part 6 is "short by
 * default". Those pull in the same direction here: `invoice.create` takes 43 fields and needs two, so
 * the form opens with the two and puts the rest behind one "More options" line. A person who knows what
 * they are doing can open it; a person who does not is not shown 41 boxes they will not fill in.
 *
 * It is the only form of its kind. A second one used to sit beside it — a `SchemaForm` that took a zod object
 * directly — and it had no callers: one screen imported it under an alias and never rendered it. Every form the
 * app needs is a command's form, so the fields come from the command's schema and there is nothing to keep in
 * step by hand.
 *
 * What this deliberately is not: a replacement for the hand-built invoice and bill forms. Those do
 * arithmetic, pick accounts from the chart, and show a running total — a schema form shows the fields a
 * command takes and nothing else. This is the form for the commands that never had one, and the shape
 * the hand-built ones move onto one piece at a time.
 */
export interface CommandFormProps {
  command: string;
  /** the result is the command input, ready to hand to `useCommand(name).run` */
  onSubmit: (input: Record<string, unknown>) => void | Promise<void>;
  submitLabel?: string;
  /** starts with "More options" open, for a screen that is only ever used by someone who knows the command */
  showAllFields?: boolean;
  disabled?: boolean;
}

function controlFor(field: SchemaField, id: string, value: string | boolean, onChange: (value: string | boolean) => void, disabled: boolean) {
  const className = 'w-full bg-[var(--bg-input,#ffffff)] border border-[var(--border,#d4d4d4)] text-[var(--text,#171717)] text-xs rounded-lg p-2.5 focus:ring-2 focus:ring-primary-500 disabled:opacity-50';
  if (field.kind === 'checkbox') {
    return <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={e => onChange(e.target.checked)} className="rounded-sm border-[var(--border,#d4d4d4)] text-primary-600 focus:ring-primary-500" />;
  }
  if (field.kind === 'choice') {
    return (
      <select id={id} value={String(value)} disabled={disabled} onChange={e => onChange(e.target.value)} className={className}>
        <option value="">-- Select --</option>
        {(field.options || []).map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (field.kind === 'textarea') {
    return <textarea id={id} rows={3} maxLength={field.maxLength} value={String(value)} disabled={disabled} onChange={e => onChange(e.target.value)} className={className} />;
  }
  if (field.kind === 'number') {
    return (
      // `step=1` (the browser default) makes a valid fractional value such as a 12.5% withholding rate
      // fail validation before it is ever sent, so the step is any value the schema's bounds allow.
      <input id={id} type="number" step="any" min={field.minimum} max={field.maximum} value={String(value)} disabled={disabled}
        onChange={e => onChange(e.target.value)} className={className} />
    );
  }
  return (
    <input id={id} type={field.kind === 'date' ? 'date' : 'text'} maxLength={field.maxLength} value={String(value)} disabled={disabled}
      onChange={e => onChange(e.target.value)} className={className} />
  );
}

export default function CommandForm({ command, onSubmit, submitLabel = 'Save', showAllFields = false, disabled = false }: CommandFormProps) {
  const formId = useId();
  const form = useMemo(() => formForCommand(command), [command]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [more, setMore] = useState(showAllFields);
  const [submitting, setSubmitting] = useState(false);

  const set = (path: string, value: string | boolean) => {
    setValues(previous => ({ ...previous, [path]: value }));
    if (problems[path]) setProblems(previous => { const next = { ...previous }; delete next[path]; return next; });
  };

  const draw = (field: SchemaField) => {
    const id = `${formId}-${field.path.replace(/\./g, '-')}`;
    return (
      <Field key={field.path} label={field.label} htmlFor={id} required={field.required} hint={field.hint} error={problems[field.path]}>
        {controlFor(field, id, values[field.path] ?? (field.kind === 'checkbox' ? false : ''), value => set(field.path, value), disabled || submitting)}
      </Field>
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const built = buildCommandInput(form, values);
    if (built.problems.length > 0) {
      setProblems(Object.fromEntries(built.problems.map(problem => [problem.path, problem.message])));
      // the first field with a problem is where the person needs to look, and it is not always the
      // first field on screen once "More options" is open
      const first = built.problems[0];
      document.getElementById(`${formId}-${first.path.replace(/\./g, '-')}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(built.input);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-describedby={`${formId}-sentence`}>
      {form.sentence && <p id={`${formId}-sentence`} className="text-xs text-[var(--muted)]">{form.sentence}</p>}
      {form.required.length === 0 && (
        <p className="text-xs text-[var(--muted)]">Nothing here has to be filled in; every field is optional.</p>
      )}
      {form.required.map(draw)}

      {form.optional.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setMore(open => !open)}
            aria-expanded={more}
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
          >
            {more ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
            {more ? 'Fewer options' : `More options (${form.optional.length})`}
          </button>
          {more && <div className="mt-3 space-y-4">{form.optional.map(draw)}</div>}
        </div>
      )}

      {more && form.notes.length > 0 && (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><Info aria-hidden="true" size={13} /> Not on this form</p>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-[var(--muted)]">
            {form.notes.map(note => <li key={note}>{note}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="submit" disabled={disabled || submitting}
          className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
