import { useAuthStore } from '../stores/useAuthStore';
import { ErrorLogRecord } from '../types';

const RECENT_ERRORS_MAX = 5;
const recentErrors: ErrorLogRecord[] = [];

/**
 * Strips potential sensitive data (keys, passwords, tokens, bearer tokens) from strings
 */
function sanitizeText(input: string): string {
  if (!input) return '';
  return input
    .replace(/(bearer\s+)[a-zA-Z0-9_.-]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[a-zA-Z0-9_.-]+/gi, '$1[REDACTED]')
    .replace(/(password["']?\s*[:=]\s*["']?)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(secret["']?\s*[:=]\s*["']?)[^\s"']+/gi, '$1[REDACTED]')
    .slice(0, 5000);
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
  const errorId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const record: ErrorLogRecord = {
    id: errorId,
    workspaceId,
    userId: user?.uid,
    userEmail: user?.email || undefined,
    message: sanitizeText(message).slice(0, 2000),
    stack: stack ? sanitizeText(stack).slice(0, 4000) : undefined,
    componentStack: extra?.componentStack ? sanitizeText(extra.componentStack).slice(0, 2000) : undefined,
    url: typeof window !== 'undefined' ? sanitizeTelemetryUrl(window.location.pathname + window.location.search) : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appVersion: '0.1.0',
    release: 'ledgerflow-prod-v1',
    source: 'frontend',
    severity: extra?.severity || 'error',
    metadata: extra?.metadata,
    ticketId: extra?.ticketId,
    createdAt: new Date().toISOString()
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

    await fetch('/api/v1/telemetry/errors', {
      method: 'POST',
      headers,
      body: JSON.stringify(record)
    });
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
