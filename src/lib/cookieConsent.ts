/**
 * S-35 — browser cookie & telemetry consent preference.
 *
 * LedgerFlow loads no third-party advertising or analytics trackers. The single
 * stored choice (`essential` vs `all`) governs whether automatic background
 * client crash reports are sent to `/api/v1/telemetry/errors`; user-initiated
 * support tickets with attached error diagnostics always proceed because the
 * person asked to send them.
 */

export const COOKIE_CONSENT_KEY = 'ledgerflow-cookie-consent';
// Previous notices did not disclose automatic crash reports. Keep their banner
// dismissal, but require a fresh opt-in from the current notice or settings.
const NOTICE_VERSION = 2;
const CONSENT_CHANGED = 'ledgerflow:consent-changed';
let writeFailed = false;

export type CookieConsentChoice = 'all' | 'essential';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getCookieConsent(): CookieConsentChoice | null {
  // If storage refused a preference change, never fall back to an older opt-in.
  if (writeFailed) return 'essential';
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(COOKIE_CONSENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === 'essential' || trimmed === 'accepted' || trimmed === 'all') return 'essential';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { choice?: unknown; version?: unknown; timestamp?: unknown; analytics?: unknown };
      if (record.choice === 'all' && record.version === NOTICE_VERSION && record.analytics !== false &&
        typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp))) return 'all';
      if (record.choice === 'essential' || record.choice === 'all' || typeof record.analytics === 'boolean') return 'essential';
    }
  } catch {
    // Malformed entry falls back to null so the banner can re-prompt cleanly.
  }
  return null;
}

/** Returns whether the browser remembered the choice across reloads. */
export function setCookieConsent(choice: CookieConsentChoice): boolean {
  const storage = getStorage();
  let saved = false;
  if (storage) {
    try {
      storage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ choice, version: NOTICE_VERSION, timestamp: new Date().toISOString() }));
      saved = true;
    } catch {
      // Quota/private-mode refusal leaves automatic reporting off in this tab.
      // Try to discard any old opt-in when the browser only refuses writes.
      try { storage.removeItem(COOKIE_CONSENT_KEY); } catch { /* Storage is unavailable. */ }
    }
  }
  writeFailed = !saved;
  if (typeof window !== 'undefined') window.dispatchEvent(new window.Event(CONSENT_CHANGED));
  return saved;
}

export function subscribeCookieConsent(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === COOKIE_CONSENT_KEY || event.key === null) notify();
  };
  window.addEventListener(CONSENT_CHANGED, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CONSENT_CHANGED, notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** Missing, unreadable, or obsolete choices never enable automatic crash reports. */
export function isOptionalTelemetryAllowed(): boolean {
  return getCookieConsent() === 'all';
}
