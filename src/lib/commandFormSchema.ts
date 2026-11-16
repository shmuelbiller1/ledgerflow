/**
 * Part 4: forms from the schema.
 *
 * Every command in the generated manifest already says what it takes — the server generates the JSON
 * Schema from the same zod object it validates with, so the two cannot drift. That means a form can be
 * written from the schema instead of by hand, and the field list cannot be out of date.
 *
 * Two rules shape what this produces, and both come from the task's "short by default":
 *
 * 1. **Required fields first, everything else behind "More options".** `customer.create` takes 25
 *    fields and needs one of them. A form that opens with 25 boxes is the reason people give up; a form
 *    that opens with the one box that matters is the reason they finish. Not a "simple mode" switch —
 *    the same form, ordered by what is needed.
 * 2. **Nothing is invented.** A field the schema does not describe is not rendered, and a field with no
 *    plain label falls back to its own name rather than a guess.
 *
 * The JSON Schema comes from zod through `z.toJSONSchema`, so the shapes here are the subset it emits:
 * strings (with enums, formats and lengths), numbers/integers with bounds, booleans, arrays, and nested
 * objects. A `$ref` is not followed — it means the schema is more complicated than a flat form can
 * honestly render, and the caller gets a single note instead of a broken field.
 */
import { COMMAND_MANIFEST } from './commands.generated';

export interface SchemaField {
  /** the key in the command's input object */
  name: string;
  /** dotted path for a field inside a nested object, e.g. "customer.name" */
  path: string;
  label: string;
  kind: 'text' | 'number' | 'checkbox' | 'choice' | 'date' | 'textarea';
  required: boolean;
  /** for 'choice' */
  options?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  /** the schema's own words, shown under the field when it constrains anything */
  hint?: string;
  /** the field's value lives at `path` inside the input object */
  nested: boolean;
}

export interface CommandForm {
  /** the command this form is for, e.g. "customer.create" */
  command: string;
  /** shown above the form: the command's own one-sentence description */
  sentence: string;
  /** filled in by default, so the form is not empty when it opens */
  required: SchemaField[];
  /** behind "More options" */
  optional: SchemaField[];
  /** why a field is missing, when the schema could not be turned into a field (never silently dropped) */
  notes: string[];
}

type JsonSchema = Record<string, unknown>;

interface ManifestEntry {
  name: string;
  inputSchema: JsonSchema;
  description?: { sentence?: string };
}

function manifestEntries(): ManifestEntry[] {
  const raw = COMMAND_MANIFEST as unknown;
  const list = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
  return list as ManifestEntry[];
}

/** `expectedRevenueCents` → "Expected revenue cents"; `vatNumber` → "Vat number". */
export function labelForCamelCase(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function kindOf(field: JsonSchema): SchemaField['kind'] | null {
  if (Array.isArray(field.enum)) return 'choice';
  switch (field.type) {
    case 'boolean': return 'checkbox';
    case 'integer':
    case 'number': return 'number';
    case 'array': return null; // a repeated row is not a flat field; the caller shows a note
    case 'object': return null; // nested objects are walked, not rendered as one field
    case 'string': {
      const format = String(field.format || '');
      if (format === 'date' || format === 'date-time') return 'date';
      if (field.maxLength !== undefined && Number(field.maxLength) > 200) return 'textarea';
      return 'text';
    }
    default: return null;
  }
}

function fieldFrom(name: string, path: string, field: JsonSchema, required: boolean, nested: boolean): SchemaField | null {
  if (typeof field.$ref === 'string') return null;
  const kind = kindOf(field);
  if (!kind) return null;
  const hints: string[] = [];
  if (field.minimum !== undefined) hints.push(`at least ${String(field.minimum)}`);
  if (field.maximum !== undefined) hints.push(`at most ${String(field.maximum)}`);
  if (field.maxLength !== undefined) hints.push(`up to ${String(field.maxLength)} characters`);
  if (Array.isArray(field.enum)) hints.push(`one of ${(field.enum as string[]).join(', ')}`);
  return {
    name,
    path,
    label: labelForCamelCase(name),
    kind,
    required,
    options: Array.isArray(field.enum) ? (field.enum as string[]) : undefined,
    minimum: field.minimum as number | undefined,
    maximum: field.maximum as number | undefined,
    maxLength: field.maxLength as number | undefined,
    hint: hints.length ? hints.join(', ') : undefined,
    nested,
  };
}

/**
 * The form for one command, required fields first.
 *
 * Nested objects are walked one level: the schema's shapes are `{ invoice: {…} }` or `{ transaction:
 * {…} }`, so a flat form with dotted paths is honest about what it takes. Anything deeper is noted.
 */
export function formForCommand(command: string): CommandForm {
  const entry = manifestEntries().find(candidate => candidate.name === command);
  if (!entry) throw new Error(`"${command}" is not a registered command.`);
  const required: SchemaField[] = [];
  const optional: SchemaField[] = [];
  const notes: string[] = [];
  const schema = entry.inputSchema;
  const properties = (schema.properties || {}) as Record<string, JsonSchema>;
  const rootRequired = new Set((schema.required as string[] | undefined) || []);

  for (const [name, field] of Object.entries(properties)) {
    const isRequired = rootRequired.has(name);
    if (field.type === 'object' && !field.$ref) {
      const inner = (field.properties || {}) as Record<string, JsonSchema>;
      const innerRequired = new Set((field.required as string[] | undefined) || []);
      if (Object.keys(inner).length === 0) {
        notes.push(`"${name}" is an object with no described fields, so the form leaves it out.`);
        continue;
      }
      for (const [innerName, innerField] of Object.entries(inner)) {
        // A field is only required when its parent is too. `creditLimitOverride` is optional, so its
        // `reason` cannot be required: demanding it would block every ordinary invoice.
        const built = fieldFrom(innerName, `${name}.${innerName}`, innerField, isRequired && innerRequired.has(innerName), true);
        if (!built) {
          if (innerField.type === 'object' || innerField.type === 'array' || innerField.$ref) {
            notes.push(`"${name}.${innerName}" is a list or a nested record; it is edited on its own screen.`);
          }
          continue;
        }
        (built.required ? required : optional).push(built);
      }
      continue;
    }
    const built = fieldFrom(name, name, field, isRequired, false);
    if (!built) {
      if (field.type === 'array') notes.push(`"${name}" is a list; it is edited on its own screen.`);
      else notes.push(`"${name}" is not a plain field, so the form leaves it out.`);
      continue;
    }
    (built.required ? required : optional).push(built);
  }

  return {
    command,
    sentence: entry.description?.sentence || '',
    required,
    optional,
    notes,
  };
}

/** Every command that can be put on a form this way, with how many fields each needs. */
export function formSummary(): { command: string; required: number; optional: number; notes: number }[] {
  return manifestEntries().map(entry => {
    const form = formForCommand(entry.name);
    return { command: entry.name, required: form.required.length, optional: form.optional.length, notes: form.notes.length };
  });
}

/**
 * The input object a form submits: only fields the person actually filled in.
 *
 * An untouched optional field must not be sent — `status: ''` is not "leave it alone", it is an
 * invalid value the server would refuse. Values are converted from the string a form control gives
 * back to the type the schema declares, and a number that cannot be read is reported, not coerced.
 */
export function buildCommandInput(
  form: CommandForm,
  values: Record<string, string | boolean>,
): { input: Record<string, unknown>; problems: { path: string; message: string }[] } {
  const input: Record<string, unknown> = {};
  const problems: { path: string; message: string }[] = [];
  for (const field of [...form.required, ...form.optional]) {
    const raw = values[field.path];
    const empty = raw === undefined || raw === '' || raw === null;
    if (empty) {
      if (field.required && field.kind !== 'checkbox') problems.push({ path: field.path, message: `${field.label} is needed.` });
      continue;
    }
    let value: unknown = raw;
    if (field.kind === 'number') {
      const number = typeof raw === 'string' ? Number(raw) : Number.NaN;
      if (!Number.isFinite(number)) {
        problems.push({ path: field.path, message: `${field.label} must be a number.` });
        continue;
      }
      if (field.minimum !== undefined && number < field.minimum) {
        problems.push({ path: field.path, message: `${field.label} must be at least ${field.minimum}.` });
        continue;
      }
      if (field.maximum !== undefined && number > field.maximum) {
        problems.push({ path: field.path, message: `${field.label} must be at most ${field.maximum}.` });
        continue;
      }
      value = number;
    }
    // dotted paths become the nested object the schema declares
    const keys = field.path.split('.');
    let target = input;
    for (const key of keys.slice(0, -1)) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = value;
  }
  return { input, problems };
}
