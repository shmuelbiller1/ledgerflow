/**
 * SBX-2 Part 3: remembered decisions. When a person accepts a proposed step the same way again and
 * again (same payee → same account, same tax code), the workspace remembers it and the assistant can
 * propose that choice first, marked "from your earlier choice" with the number of cases behind it.
 *
 * - Only offered at or above OFFER_RATE over at least OFFER_MIN_CASES cases. A rejected step counts as a
 *   case with no choice for each of its fields, so rejections lower the rate.
 * - Never auto-accepted: a remembered choice is only a suggestion the person still reviews.
 * - Always one workspace: every read and write is keyed by workspace id, never shared.
 * - A person can list and delete what is remembered.
 *
 * Only ids and short codes are kept (an account id, a tax code) against a normalised subject (the
 * payee/vendor/customer id or name); no amounts, memos or other book text.
 */
import { z } from 'zod';
import type { CommandDefinition } from '../commands/types';
import type { Runner } from '../db/pg/sql';

export const OFFER_RATE = 0.95;
export const OFFER_MIN_CASES = 5;

/** Who the step is about, in order of preference. */
const SUBJECT_KEYS = ['vendorId', 'customerId', 'contactId', 'payee', 'payeeName', 'vendorName', 'customerName', 'counterparty'] as const;
/** The choices a person makes for that subject. */
const DECISION_KEYS = ['accountId', 'cashAccountId', 'bankAccountId', 'expenseAccountId', 'incomeAccountId', 'categoryAccountId', 'taxCode', 'taxCodeId', 'taxRateId', 'classId'] as const;
const MAX_VALUE = 200;
/** Fields set once for the whole document, not per line. */
const DOCUMENT_FIELDS = new Set(['cashAccountId', 'bankAccountId']);

export interface Decision { subject: string; field: string; value: string }
export interface Observation { command: string; subject: string; field: string; value: string | null }
export interface RememberedRow { command: string; subject: string; field: string; cases: number; choices: Record<string, number> }
export interface Suggestion { command: string; subject: string; field: string; value: string; cases: number; rate: number; label: 'from your earlier choice' }

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() ? String(v).trim().slice(0, MAX_VALUE) : undefined;
/** Names compare without case or extra spaces; ids are kept as they are. */
const normalise = (key: string, v: string) => key.endsWith('Id') ? v : v.toLowerCase().replace(/\s+/g, ' ');

function subjectOf(obj: Record<string, unknown>, fallback?: string): string | undefined {
  for (const key of SUBJECT_KEYS) {
    const v = text(obj[key]);
    if (v) return `${key}:${normalise(key, v)}`;
  }
  return fallback;
}

/**
 * Command inputs wrap the document in an envelope (`{ bill: {...}, postingDay }`, `{ invoice: {...} }`).
 * When the outer object names no subject and has no lines, use the one nested object that does.
 */
function documentOf(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const outer = input as Record<string, unknown>;
  if (subjectOf(outer) || Array.isArray(outer.lines)) return outer;
  const inner = Object.values(outer).filter((v): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v) && (!!subjectOf(v as Record<string, unknown>) || Array.isArray((v as Record<string, unknown>).lines)));
  return inner.length === 1 ? inner[0] : outer;
}

/** The (subject, field, value) choices in one step's input: top level, then each line, which may name its own subject. */
export function decisionsIn(input: unknown): Decision[] {
  const root = documentOf(input);
  if (!root) return [];
  const rootSubject = subjectOf(root);
  const out = new Map<string, Decision>();
  const take = (obj: Record<string, unknown>, subject: string | undefined) => {
    if (!subject) return;
    for (const field of DECISION_KEYS) {
      const value = text(obj[field]);
      // two lines with the same subject and field but different values are two choices, not one
      if (value) out.set(`${subject}\u0000${field}\u0000${value}`, { subject, field, value });
    }
  };
  take(root, rootSubject);
  for (const line of Array.isArray(root.lines) ? root.lines : []) {
    if (line && typeof line === 'object' && !Array.isArray(line)) take(line as Record<string, unknown>, subjectOf(line as Record<string, unknown>, rootSubject));
  }
  return [...out.values()];
}

/** A resolved step becomes observations: accepted keeps its values, rejected records "no choice" per field. */
export function observe(command: string, input: unknown, outcome: 'accepted' | 'rejected'): Observation[] {
  return decisionsIn(input).map(d => ({ command, ...d, value: outcome === 'accepted' ? d.value : null }));
}

export function addObservation(row: RememberedRow | undefined, obs: Observation): RememberedRow {
  const choices = { ...(row?.choices ?? {}) };
  if (obs.value !== null) choices[obs.value] = (choices[obs.value] ?? 0) + 1;
  return { command: obs.command, subject: obs.subject, field: obs.field, cases: (row?.cases ?? 0) + 1, choices };
}

/** The remembered choice, only when it clears the rate over enough cases. */
export function suggestionFrom(row: RememberedRow): Suggestion | undefined {
  if (row.cases < OFFER_MIN_CASES) return undefined;
  let best: [string, number] | undefined;
  for (const entry of Object.entries(row.choices)) if (!best || entry[1] > best[1]) best = entry;
  if (!best) return undefined;
  const rate = best[1] / row.cases;
  if (rate < OFFER_RATE) return undefined;
  return { command: row.command, subject: row.subject, field: row.field, value: best[0], cases: row.cases, rate, label: 'from your earlier choice' };
}

/**
 * Proposes remembered choices for a draft step, never changing it: the caller shows them beside the
 * step for the person to take or ignore. Fields the draft already fills are left alone.
 */
export function suggestFor(command: string, input: unknown, rows: readonly RememberedRow[]): Suggestion[] {
  // the same walk as decisionsIn: the root and each line, each with its own subject (a line falls
  // back to the root's), and a field the object being checked already fills is left alone
  const root = documentOf(input) ?? {};
  const rootSubject = subjectOf(root);
  // the root and each line decide (a line without a subject uses the root's)
  const lines = Array.isArray(root.lines) ? root.lines : [];
  const targets: Array<[Record<string, unknown>, string | undefined]> = [[root, rootSubject]];
  for (const line of lines) {
    if (line && typeof line === 'object' && !Array.isArray(line)) targets.push([line as Record<string, unknown>, subjectOf(line as Record<string, unknown>, rootSubject)]);
  }
  const out = new Map<string, Suggestion>();
  for (const [obj, subject] of targets) {
    if (!subject) continue;
    for (const r of rows) {
      // filled on the line or on the document itself (a cash account is set once, on the root)
      if (r.command !== command || r.subject !== subject || text(obj[r.field]) || text(root[r.field])) continue;
      // on a draft with lines, the root offers only document-level fields (set once for the whole document)
      if (obj === root && lines.length && !DOCUMENT_FIELDS.has(r.field)) continue;
      const offered = suggestionFrom(r);
      if (offered) out.set(`${r.subject}\u0000${r.field}`, offered);
    }
  }
  return [...out.values()];
}

// ---- storage: assistant."rememberedDecisions", one row per (workspace, command, subject, field) ----

export async function recordOutcome(runner: Runner, workspaceId: string, steps: ReadonlyArray<{ command: string; input: unknown }>, outcome: 'accepted' | 'rejected'): Promise<void> {
  for (const step of steps) {
    for (const obs of observe(step.command, step.input, outcome)) {
      const { rows } = await runner.query<{ cases: number; choices: Record<string, number> }>(`select cases, choices from assistant."rememberedDecisions"
        where workspace_id = $1 and command_name = $2 and subject = $3 and field = $4 for update`, [workspaceId, obs.command, obs.subject, obs.field]);
      const next = addObservation(rows[0] ? { ...obs, cases: rows[0].cases, choices: rows[0].choices } : undefined, obs);
      await runner.query(`insert into assistant."rememberedDecisions" (workspace_id, command_name, subject, field, cases, choices)
        values ($1,$2,$3,$4,$5,$6) on conflict (workspace_id, command_name, subject, field)
        do update set cases = excluded.cases, choices = excluded.choices, updated_at = now()`,
      [workspaceId, obs.command, obs.subject, obs.field, next.cases, JSON.stringify(next.choices)]);
    }
  }
}

export async function listRemembered(runner: Runner, workspaceId: string): Promise<RememberedRow[]> {
  const { rows } = await runner.query<{ command: string; subject: string; field: string; cases: number; choices: Record<string, number> }>(
    `select command_name as command, subject, field, cases, choices from assistant."rememberedDecisions"
     where workspace_id = $1 order by command_name, subject, field`, [workspaceId]);
  return rows;
}

/** Forgets one remembered decision, or all of them for the workspace when no key is given. */
export async function forgetRemembered(runner: Runner, workspaceId: string, key?: { command: string; subject: string; field: string }): Promise<number> {
  const res = key
    ? await runner.query(`delete from assistant."rememberedDecisions" where workspace_id = $1 and command_name = $2 and subject = $3 and field = $4`,
      [workspaceId, key.command, key.subject, key.field])
    : await runner.query(`delete from assistant."rememberedDecisions" where workspace_id = $1`, [workspaceId]);
  return res.rowCount ?? 0;
}

// ---- the person's "forget" is a registered command (POST /api/v1/commands/assistant.forgetremembered) ----

export const forgetRememberedInput = z.object({
  command: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(260).optional(),
  field: z.string().min(1).max(60).optional(),
}).strict().refine(v => (v.command && v.subject && v.field) || (!v.command && !v.subject && !v.field), 'Give command, subject and field together, or none to forget everything');

export const forgetRememberedCommand: CommandDefinition<typeof forgetRememberedInput, { forgotten: number }> = {
  name: 'assistant.forgetremembered',
  // a person decides what the assistant remembers about their books; never an API key or the assistant
  peopleOnly: true,
  input: forgetRememberedInput,
  roles: ['owner', 'accountant', 'bookkeeper'],
  async handler(ctx, _tx, input) {
    const pool = (ctx.db as unknown as { pool?: Runner }).pool;
    if (!pool) return { forgotten: 0 };
    // the table lives outside the document store, so the delete runs once the command has committed
    let forgotten = 0;
    const key = input.command && input.subject && input.field ? { command: input.command, subject: input.subject, field: input.field } : undefined;
    ctx.afterCommit(async () => { forgotten = await forgetRemembered(pool, ctx.workspaceId, key); return { forgotten }; });
    return { forgotten };
  },
  async preview(_ctx, input) {
    return { title: 'Forget remembered choices', lines: [input.command ? `Forget ${input.field} for ${input.subject} (${input.command})` : 'Forget every remembered choice for these books'] };
  },
  audit(_input, _result) {
    return { action: 'assistant.remembered_forgotten', entityType: 'workspace', entityId: 'remembered-decisions', description: 'Remembered assistant choices were forgotten' };
  },
  inverse() { return null; },
  risk: 'normal',
  describe: {
    sentence: 'Forget a choice the assistant remembered for these books (one payee and field), or all of them; do not use it to change a posted record.',
    example: { command: 'bill.create', subject: 'payee:ocean supplies', field: 'accountId' },
    refusals: [
      { code: 'INVALID_INPUT', when: 'Only some of command, subject and field were given.', next: 'Give all three to forget one choice, or none to forget everything.' },
      { code: 'ROLE_REQUIRED', when: 'The caller cannot change these books.', next: 'Ask an owner, accountant or bookkeeper.' },
    ],
  },
};
