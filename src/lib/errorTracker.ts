import { useAuthStore } from '../stores/useAuthStore';
import { ErrorLogRecord } from '../types';
import { isOptionalTelemetryAllowed } from './cookieConsent';
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
let scopeGeneration = 0;

// Support can attach the newest diagnostic even if automatic reporting is off.
// Never carry that buffer (or its groups) into another account or book.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.uid !== previous.user?.uid || state.currentWorkspaceId !== previous.currentWorkspaceId || state.isGuest !== previous.isGuest) {
    scopeGeneration += 1;
    recentErrors.length = 0;
    errorGroups.clear();
  }
});

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

/** Redacts public-link paths, including when they occur inside an error or stack trace. */
export function sanitizeTelemetryUrl(input: string): string {
  return input.replace(/(\/(?:c|e|i|invite)\/)[^/?#\s"'()<>]+/g, '$1[REDACTED]');
}

function sanitizeText(input: string): string {
  // Error and stack text can also contain URLs. Do not keep their query or fragment.
  const withoutUrlDetails = input.replace(/(?:https?:\/\/|\/(?:c|e|i|invite)\/)[^\s"'()<>]*/gi, url => url.split(/[?#]/, 1)[0]);
  return redactForLogs(sanitizeTelemetryUrl(withoutUrlDetails)).slice(0, 5000);
}

function localErrorSource(filename: unknown): string | undefined {
  if (typeof filename !== 'string' || !filename || typeof window === 'undefined') return undefined;
  try {
    const url = new URL(filename, window.location.origin);
    if (url.origin === window.location.origin) return sanitizeText(url.pathname).slice(0, 1000);
  } catch {
    // Optional source location may not be a valid same-origin URL.
  }
  return undefined;
}

function diagnosticMetadata(metadata: Record<string, unknown> | undefined) {
  const { view, filename, lineno, colno, unhandledRejection } = metadata ?? {};
  return {
    ...(typeof view === 'string' ? { view: sanitizeText(view).slice(0, 160) } : {}),
    filename: localErrorSource(filename),
    lineno: Number.isSafeInteger(lineno) ? lineno : undefined,
    colno: Number.isSafeInteger(colno) ? colno : undefined,
    unhandledRejection: unhandledRejection === true ? true : undefined,
  };
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
  
  const { user, currentWorkspaceId } = useAuthStore.getState();
  const workspaceId = currentWorkspaceId || 'unassigned';
  const generation = scopeGeneration;
  const maySend = () => generation === scopeGeneration && Boolean(extra?.ticketId || isOptionalTelemetryAllowed());
  // Keep the existing reference shape for diagnostics and grouping. If Web Crypto
  // is unavailable, let the telemetry server allocate the id rather than invent
  // a weak client reference. The server fallback has its own separate review.
  const randomId = secureId('');
  let errorId = randomId ? `err_${Date.now()}_${randomId.replace(/-/g, '')}` : '';
  const stableMessage = sanitizeText(message);
  const url = typeof window !== 'undefined' ? sanitizeText(window.location.pathname).slice(0, 1000) : '';
  const safeMetadata = diagnosticMetadata(extra?.metadata);
  const screen = safeMetadata.view || url || 'app';
  const release = 'ledgerflow-prod-v1';
  const fingerprint = errorFingerprint(screen, stableMessage, release);
  const createdAt = new Date().toISOString();
  const group = recordGroup(fingerprint, screen, stableMessage.slice(0, 300), release, errorId, createdAt);

  const record: ErrorLogRecord = {
    id: errorId,
    workspaceId,
    message: stableMessage.slice(0, 2000),
    stack: stack ? sanitizeText(stack).slice(0, 4000) : undefined,
    componentStack: extra?.componentStack ? sanitizeText(extra.componentStack).slice(0, 2000) : undefined,
    url,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : '',
    appVersion: '0.1.0',
    release,
    source: 'frontend',
    severity: extra?.severity || 'error',
    metadata: { ...safeMetadata, fingerprint, screen, repeatCount: group.count },
    ticketId: extra?.ticketId,
    createdAt
  };

  // Add to in-memory ring buffer
  recentErrors.unshift(record);
  if (recentErrors.length > RECENT_ERRORS_MAX) {
    recentErrors.pop();
  }

  // Automatic reports need a current opt-in; a diagnostic deliberately submitted
  // with a support ticket (`ticketId` set) is not an automatic report.
  if (!maySend()) return errorId;

  // A token lookup can cross a consent or workspace change; re-check before sending.
  try {
    const token = await user?.getIdToken?.();
    if (!maySend()) return errorId;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/v1/telemetry/errors', {
      method: 'POST',
      headers,
      // Same-origin requests would otherwise carry the full page URL as a Referer.
      referrerPolicy: 'origin',
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
    }).catch((reportErr) => { console.warn('[ErrorTracker] Recursive report suppressed:', reportErr); });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError(reason instanceof Error ? reason : String(reason), {
      severity: 'error',
      metadata: { unhandledRejection: true }
    }).catch((reportErr) => { console.warn('[ErrorTracker] Recursive rejection report suppressed:', reportErr); });
  });
}
