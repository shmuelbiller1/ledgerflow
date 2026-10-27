/**
 * A live collection that fails to load (useLedgerData → subscribeLedgerCollection) used to stay
 * unsubscribed until someone pressed "Try again", even after the network or the tab came back
 * (issue #96). This module decides, without React or timers, whether a failure is worth trying
 * again on its own and when: connection trouble is retried a bounded number of times with growing
 * delays and immediately when the browser reports it is online or the tab becomes visible again;
 * a permission refusal is never retried (it would only repeat), so the person still gets the
 * status bar's "Try again".
 */

export type FailureKind = 'auth' | 'transient';

export interface RetryTrouble {
  kind: FailureKind;
  /** Failures seen since the collection last loaded (automatic and after a manual "Try again" reset). */
  attempts: number;
  /** When the next automatic attempt is due; null = only a person can retry. */
  nextRetryAt: number | null;
}

/** Failures tried automatically; after this the status bar's "Try again" is the way back. */
export const AUTO_RETRY_LIMIT = 4;
export const RETRY_BASE_DELAY_MS = 4_000;
export const RETRY_MAX_DELAY_MS = 120_000;

const AUTH_MESSAGE = /permission denied|row[- ]level security|insufficient privilege|not authori[sz]ed|unauthori[sz]ed|forbidden|jwt (?:expired|invalid)|invalid api key|not authenticated|no api key/i;
const TRANSIENT_MESSAGE = /network|net::|failed to fetch|fetch failed|load failed|timed? ?out|timeout|offline|connection|connect econn|econnrefused|econnreset|eai_again|socket|websocket|disconnect|temporar|unavailable|abort|too many requests|rate limit|\b(?:429|500|502|503|504)\b/i;

function textOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; code?: unknown; status?: unknown; details?: unknown };
    return [record.message, record.details, record.code, record.status]
      .filter(part => part !== undefined && part !== null)
      .map(part => String(part))
      .join(' ');
  }
  return '';
}

/** Connection trouble → 'transient'; a refusal that will not change by itself → 'auth'. */
export function classifyFailure(error: unknown): FailureKind {
  if (error && typeof error === 'object') {
    const record = error as { status?: unknown; code?: unknown };
    const status = Number(record.status);
    if (status === 401 || status === 403) return 'auth';
    const code = String(record.code ?? '');
    if (code === '42501' || code === 'PGRST301' || code === 'PGRST302') return 'auth';
  }
  const text = textOf(error);
  // A refusal wins over a connection word: "permission denied for table" is not worth retrying.
  if (AUTH_MESSAGE.test(text)) return 'auth';
  if (TRANSIENT_MESSAGE.test(text)) return 'transient';
  // Unknown failures are treated as trouble worth a bounded number of attempts, not as a refusal.
  return 'transient';
}

/** 4 s, 8 s, 16 s, 32 s … capped at two minutes; attempt 1 is the first delay. */
export function retryDelayMs(attempt: number): number {
  const step = Math.max(1, Math.trunc(attempt));
  const delay = RETRY_BASE_DELAY_MS * 2 ** (step - 1);
  return Math.min(RETRY_MAX_DELAY_MS, delay);
}

/** The record kept for a failed collection after this failure landed at `now`. */
export function planRetry(error: unknown, previousAttempts: number, now: number): RetryTrouble {
  const kind = classifyFailure(error);
  const attempts = Math.max(0, Math.trunc(previousAttempts)) + 1;
  const nextRetryAt = kind === 'transient' && attempts < AUTO_RETRY_LIMIT ? now + retryDelayMs(attempts) : null;
  return { kind, attempts, nextRetryAt };
}

/**
 * The automatic attempt due at `now` (a timer fired, or the browser came back online / the tab
 * became visible). `immediate` ignores the scheduled time — connectivity returning is a good reason
 * to try at once — but never passes the attempt limit or retries a refusal.
 */
export function canRetryNow(trouble: RetryTrouble | undefined, now: number, immediate = false): boolean {
  if (!trouble) return false;
  if (trouble.kind !== 'transient') return false;
  // null = nothing is scheduled any more (the attempt limit was reached)
  if (trouble.nextRetryAt === null) return false;
  if (trouble.attempts >= AUTO_RETRY_LIMIT) return false;
  return immediate || trouble.nextRetryAt <= now;
}
