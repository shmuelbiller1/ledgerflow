import { useAuthStore } from '../stores/useAuthStore';
import { ErrorLogRecord } from '../types';
import { redactForLogs } from './logRedaction';
import { secureId } from './secureId';

const RECENT_ERRORS_MAX = 5;
const recentErrors: ErrorLogRecord[] = [];

/**
 * F-21: the same crash on the same screen at the same release is one problem, not one line per
 * reload. The group keeps the count and the first/last time so the diagnostics attachment and the
 * telemetry route can show how often it happens without carrying any more personal data than the
 * redacted record already does.
 */
export interface ErrorGroup {
  fingerprint: string;
  screen: string;
  message: string;
  release: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  errorId: string;
}

const ERROR_GROUPS_MAX = 50;
const errorGroups = new Map<string, ErrorGroup>();

/** A stable identity: the screen, the message without request-unique ids or times, and the release. */
export function errorFingerprint(screen: string, message: string, release: string): string {
  const stable = message
    .replace(/err_\d+_[a-z0-9]+/gi, 'err')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'id')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, 'time')
    .slice(0, 400)
    .trim();
  return `${screen || 'app'} :: ${stable || 'unknown'} :: ${release || 'unknown'}`;
}

function recordGroup(fingerprint: string, screen: string, message: string, release: string, errorId: string, at: string): ErrorGroup {
  const existing = errorGroups.get(fingerprint);
  if (existing) {
    existing.count += 1;
    existing.lastSeenAt = at;
    existing.errorId = errorId;
    return existing;
  }
  const group: ErrorGroup = { fingerprint, screen, message, release, count: 1, firstSeenAt: at, lastSeenAt: at, errorId };
  errorGroups.set(fingerprint, group);
  if (errorGroups.size > ERROR_GROUPS_MAX) {
    // drop the group seen longest ago; the recent list still holds the newest records
    const oldest = [...errorGroups.values()].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0];
    errorGroups.delete(oldest.fingerprint);
  }
  return group;
}

/** The grouped crashes, newest first (F-21); one row per screen + message + release. */
export function getErrorGroups(): ErrorGroup[] {
  return [...errorGroups.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/** Test helper: forget the groups between cases. */
export function clearErrorGroups(): void {
  errorGroups.clear();
}

/**
 * Strips potential sensitive data (keys, passwords, tokens, bearer tokens) from strings
 */
function sanitizeText(input: string): string {
  if (!input) return '';
  // F-35: one redaction rule (credentials, e-mail addresses, card numbers) lives in
  // src/lib/logRedaction.ts, so nothing personal leaves the browser in a crash report.
  return redactForLogs(input).slice(0, 5000);
}

/**
 * Redacts public capability tokens (/c/<token>, /e/<token>, /i/<token>, /invite/<token>)
 * before persisting or transmitting telemetry URLs.
 */
export function sanitizeTelemetryUrl(input: string): string {
  if (!input) return '';
  return input.replace(/(\/(?:c|e|i|invite)\/)[^/?#]+/g, '$1[REDACTED]');
}

/**
 * Reports an error to the backend telemetry error logger and stores in recent buffer
 */
export async function reportClientError(
  err: Error | string,
  extra?: {
    severity?: 'error' | 'warning' | 'fatal';
    componentStack?: string;
    metadata?: Record<string, unknown>;
    ticketId?: string;
  }
): Promise<string> {
  const message = typeof err === 'string' ? err : (err.message || 'Unknown error');
  if (
    !message ||
    message.includes('ResizeObserver loop') ||
    message.includes('failed to connect to websocket') ||
    message.includes('WebSocket') ||
    message.includes('[vite]') ||
    message === 'Script error.'
  ) {
    return '';
  }
  const stack = typeof err === 'object' && err.stack ? err.stack : undefined;
  
  const authState = useAuthStore.getState();

  const user = authState.user;
  const workspaceId = authState.currentWorkspaceId || authState.getCurrentWorkspace()?.id || 'unassigned';
  // Keep the existing reference shape for diagnostics and grouping. If Web Crypto
  // is unavailable, let the telemetry server allocate the id rather than invent
  // a weak client reference. The server fallback has its own separate review.
  const randomId = secureId('');
  let errorId = randomId ? `err_${Date.now()}_${randomId.replace(/-/g, '')}` : '';
  const stableMessage = sanitizeText(message);
  const screen = typeof extra?.metadata?.view === 'string'
    ? extra.metadata.view
    : (typeof window !== 'undefined' ? window.location.pathname : 'server');
  const release = 'ledgerflow-prod-v1';
  const fingerprint = errorFingerprint(screen, stableMessage, release);
  const createdAt = new Date().toISOString();
  const group = recordGroup(fingerprint, screen, stableMessage.slice(0, 300), release, errorId, createdAt);

  const record: ErrorLogRecord = {
    id: errorId,
    workspaceId,
    userId: user?.uid,
    userEmail: user?.email || undefined,
    message: stableMessage.slice(0, 2000),
    stack: stack ? sanitizeText(stack).slice(0, 4000) : undefined,
    componentStack: extra?.componentStack ? sanitizeText(extra.componentStack).slice(0, 2000) : undefined,
    url: typeof window !== 'undefined' ? sanitizeTelemetryUrl(window.location.pathname + window.location.search) : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appVersion: '0.1.0',
    release,
    source: 'frontend',
    severity: extra?.severity || 'error',
    metadata: { ...(extra?.metadata || {}), fingerprint, screen, repeatCount: group.count },
    ticketId: extra?.ticketId,
    createdAt
  };

  // Add to in-memory ring buffer
  recentErrors.unshift(record);
  if (recentErrors.length > RECENT_ERRORS_MAX) {
    recentErrors.pop();
  }

  // Send to backend telemetry API
  try {
    const token = await user?.getIdToken?.();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/v1/telemetry/errors', {
      method: 'POST',
      headers,
      body: JSON.stringify(record)
    });
    if (!errorId && response.ok) {
      const result: unknown = await response.json();
      const serverId = result && typeof result === 'object' && 'errorId' in result ? result.errorId : null;
      if (typeof serverId === 'string' && /^err_[a-zA-Z0-9_-]{1,124}$/.test(serverId)) {
        errorId = serverId;
        record.id = serverId;
        // Only update the group if this is still its latest retained record.
        if (recentErrors.find(item => item.metadata?.fingerprint === fingerprint) === record) group.errorId = serverId;
      }
    }
  } catch (networkErr) {
    console.warn('[ErrorTracker] Failed to ship telemetry to server:', networkErr);
  }

  return errorId;
}

/**
 * Returns the most recent captured client errors
 */
export function getRecentErrors(): ErrorLogRecord[] {
  return [...recentErrors];
}

/**
 * Returns the latest error formatted for diagnostics attachment
 */
export function getLatestErrorDiagnostic(): {
  errorLogId: string;
  diagnostics: {
    message: string;
    stack?: string;
    url: string;
    release: string;
  };
} | null {
  if (recentErrors.length === 0) return null;
  const latest = recentErrors[0];
  return {
    errorLogId: latest.id,
    diagnostics: {
      message: latest.message,
      stack: latest.stack?.slice(0, 1000),
      url: latest.url,
      release: latest.release || '0.1.0'
    }
  };
}

/**
 * Initialize global uncaught exception listeners
 */
export function initGlobalErrorTracking() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    reportClientError(event.error || event.message, {
      severity: 'error',
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    }).catch(() => {});
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError(reason instanceof Error ? reason : String(reason), {
      severity: 'error',
      metadata: { unhandledRejection: true }
    }).catch(() => {});
  });
}
