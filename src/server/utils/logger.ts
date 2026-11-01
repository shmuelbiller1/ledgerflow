import { AsyncLocalStorage } from 'node:async_hooks';
import { logSafe, logSafeDetail } from './logSafe';

/**
 * D-21 / BN-01: one JSON logger for the server. Every line carries the request it belongs to
 * (request id, method, route, workspace) when it is written while a request is being handled,
 * and never personal data: fields named like an email, password, token, phone or bank detail are
 * replaced with "[redacted]", and string values go through logSafe so they cannot forge lines.
 */
export interface LogContext {
  requestId: string;
  method?: string;
  route?: string;
  workspaceId?: string;
}

export const logContext = new AsyncLocalStorage<LogContext>();

// matched at the end of a name, so userEmail, clientSecret, accessToken, bankAccountNumber are caught too
const PERSONAL_KEY = /(^pass$|e-?mail|password|passwd|secret|token|authorization|cookie|phone|mobile|ssn|tax_?id|iban|account_?number|card_?number|api_?key)$/i;
const MAX_DEPTH = 3;

/** One field value made safe to log: errors and strings through logSafe, bigints as text, objects scrubbed up to MAX_DEPTH. */
function scrubValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) return logSafeDetail(value);
  if (typeof value === 'string') return logSafe(value, 1000);
  if (typeof value === 'bigint') return value.toString(); // JSON.stringify would throw
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 50).map(v => scrubValue(v, depth + 1));
  return scrubFields(value as Record<string, unknown>, depth + 1);
}

/** The fields of a log line with personal data removed (exported for tests). */
export function scrubFields(fields: Record<string, unknown> | undefined, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = PERSONAL_KEY.test(key) ? '[redacted]' : scrubValue(value, depth);
  }
  return out;
}

type Level = 'info' | 'warn' | 'error';

/** One log line as an object (exported for tests); the request context comes first so a field cannot hide it. */
export function logLine(level: Level, msg: string, fields?: Record<string, unknown>, context: LogContext | undefined = logContext.getStore()): Record<string, unknown> {
  // only context values that are set win: a cron request has no workspace, and must not wipe the one a job logs itself
  const known = Object.fromEntries(Object.entries(context || {}).filter(([, v]) => v !== undefined));
  return { ...scrubFields(fields), level, time: new Date().toISOString(), msg: logSafe(msg, 1000), ...known };
}

/** Writes one JSON line: info to stdout, warnings and errors to stderr. */
function write(level: Level, msg: string, fields?: Record<string, unknown>, context?: LogContext) {
  const line = JSON.stringify(logLine(level, msg, fields, context ?? logContext.getStore())) + '\n';
  (level === 'info' ? process.stdout : process.stderr).write(line);
}

export const logger = {
  info(msg: string, fields?: Record<string, unknown>, context?: LogContext) { write('info', msg, fields, context); },
  warn(msg: string, fields?: Record<string, unknown>, context?: LogContext) { write('warn', msg, fields, context); },
  error(msg: string, fields?: Record<string, unknown>, context?: LogContext) { write('error', msg, fields, context); },
};
