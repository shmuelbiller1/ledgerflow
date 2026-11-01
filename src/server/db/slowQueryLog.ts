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

/** A query's text with every literal replaced by `?` and whitespace collapsed, so it carries no data. */
export function queryShape(sql: string): string {
  const shape = sql
    .replace(/'(?:[^']|'')*'/g, '?')        // string literals
    .replace(/\$\$[\s\S]*?\$\$/g, '?')      // dollar-quoted bodies
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')     // numbers
    .replace(/\s+/g, ' ')
    .trim();
  return shape.length > MAX_SHAPE ? `${shape.slice(0, MAX_SHAPE)}…` : shape;
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

/** Times the pool's own queries and those of every client it hands out (transactions). */
export function timePoolQueries(pool: Queryable & { on: (event: 'connect', listener: (client: Queryable) => void) => unknown }, thresholdMs = slowQueryThresholdMs()): void {
  timeQueries(pool, thresholdMs);
  pool.on('connect', client => timeQueries(client, thresholdMs));
}
