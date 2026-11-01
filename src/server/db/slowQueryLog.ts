import { logger } from '../utils/logger';

/**
 * D-22 / BN-02: database queries slower than a threshold (500 ms, or SLOW_QUERY_MS) are logged with their
 * shape only: literals become `?`, parameter values are never written (just how many there were), and the
 * text is cut short. The request context (id, route, workspace) comes with the log line from the logger.
 */
const DEFAULT_SLOW_QUERY_MS = 500;
const MAX_SHAPE = 300;
const INSTRUMENTED = Symbol('slowQueryLog');

/** The threshold in milliseconds: SLOW_QUERY_MS when it is a positive number, else 500. */
export function slowQueryThresholdMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.SLOW_QUERY_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SLOW_QUERY_MS;
}

const WORD_CHAR = /[A-Za-z0-9_]/;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Index just past a quoted literal that opens at `i`, honouring doubled quotes and (for E'') backslash escapes. */
function endOfQuoted(sql: string, i: number, quote: string, backslash: boolean): number {
  let j = i + 1;
  while (j < sql.length) {
    const ch = sql[j];
    if (backslash && ch === '\\') { j += 2; continue; }
    if (ch === quote) {
      if (sql[j + 1] === quote) { j += 2; continue; }
      return j + 1;
    }
    j++;
  }
  return sql.length;
}

/** Index just past a block comment that opens at `i`; PostgreSQL nests them, so count depth to the outermost close. */
function endOfBlockComment(sql: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < sql.length) {
    if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue; }
    if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; if (depth === 0) return j; continue; }
    j++;
  }
  return sql.length;
}

/**
 * A query's text with every literal replaced by `?`, comments removed and whitespace collapsed, so it carries no
 * data. One pass over the text, so literal forms cannot hide inside each other: '…' (with ''), E'…' (with \\'),
 * $$…$$ and $tag$…$tag$, numbers, -- and /* *\/ comments. "Quoted identifiers" and $1 placeholders stay.
 */
export function queryShape(sql: string): string {
  let out = '';
  let i = 0;
  // stop once the shape is well past what is kept, so a huge statement costs no more than a short one
  while (i < sql.length && out.length <= MAX_SHAPE * 2) {
    const ch = sql[i];
    const rest = sql.slice(i, i + 256);
    const prevWord = WORD_CHAR.test(out.charAt(out.length - 1));
    if (ch === '-' && sql[i + 1] === '-') { const nl = sql.indexOf('\n', i); i = nl < 0 ? sql.length : nl; out += ' '; continue; }
    if (ch === '/' && sql[i + 1] === '*') { i = endOfBlockComment(sql, i); out += ' '; continue; }
    if ((ch === 'E' || ch === 'e') && sql[i + 1] === "'" && !prevWord) { i = endOfQuoted(sql, i + 1, "'", true); out += '?'; continue; }
    if (ch === "'") { i = endOfQuoted(sql, i, "'", false); out += '?'; continue; }
    if (ch === '"') { const j = endOfQuoted(sql, i, '"', false); out += sql.slice(i, j); i = j; continue; }
    if (ch === '$') {
      const tag = DOLLAR_TAG.exec(rest);
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close < 0 ? sql.length : close + tag[0].length;
        out += '?';
        continue;
      }
      const param = /^\$\d+/.exec(rest);
      if (param) { out += '$?'; i += param[0].length; continue; }
    }
    if (/[0-9]/.test(ch) && !prevWord) {
      const num = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest)!;
      out += '?';
      i += num[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  const shape = out.replace(/\s+/g, ' ').trim();
  return shape.length > MAX_SHAPE || i < sql.length ? `${shape.slice(0, MAX_SHAPE)}…` : shape;
}

type Queryable = { query: (...args: unknown[]) => unknown; [INSTRUMENTED]?: true };
type SlowLog = (msg: string, fields: Record<string, unknown>) => void;

function textOf(first: unknown): string {
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof (first as { text?: unknown }).text === 'string') return (first as { text: string }).text;
  return '';
}

function paramCount(args: unknown[]): number {
  const fromArgs = Array.isArray(args[1]) ? args[1].length : 0;
  const values = (args[0] as { values?: unknown } | undefined)?.values;
  return Array.isArray(values) ? values.length : fromArgs;
}

/**
 * Wraps `target.query` (a pg Pool or Client) so a promise-style call that takes longer than the threshold writes
 * one warning. Callback-style calls pass through untouched. Wrapping twice is a no-op.
 */
export function timeQueries(target: Queryable, thresholdMs = slowQueryThresholdMs(), log: SlowLog = (msg, fields) => logger.warn(msg, fields)): void {
  if (target[INSTRUMENTED]) return;
  target[INSTRUMENTED] = true;
  const original = target.query.bind(target);
  target.query = (...args: unknown[]) => {
    if (typeof args[args.length - 1] === 'function') return original(...args);
    const start = process.hrtime.bigint();
    const result = original(...args);
    if (!result || typeof (result as Promise<unknown>).then !== 'function') return result;
    const report = (failed: boolean) => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (ms < thresholdMs) return;
      log('slow query', { ms: Math.round(ms), thresholdMs, query: queryShape(textOf(args[0])), params: paramCount(args), ...(failed ? { failed: true } : {}) });
    };
    return (result as Promise<unknown>).then(
      value => { report(false); return value; },
      error => { report(true); throw error; },
    );
  };
}

/**
 * Times the pool's own queries and those of every client it hands out (transactions). `acquire` fires on every
 * checkout, so a client the pool opened before this ran is covered too (`connect` fires only for new ones).
 */
export function timePoolQueries(pool: Queryable & { on: (event: 'acquire', listener: (client: Queryable) => void) => unknown }, thresholdMs = slowQueryThresholdMs()): void {
  timeQueries(pool, thresholdMs);
  pool.on('acquire', client => timeQueries(client, thresholdMs));
}
