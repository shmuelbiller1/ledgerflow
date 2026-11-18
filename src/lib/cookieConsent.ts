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

export type CookieConsentChoice = 'all' | 'essential';

export interface StoredCookieConsent {
  choice: CookieConsentChoice;
  timestamp: string;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getCookieConsent(): CookieConsentChoice | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(COOKIE_CONSENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'choice' in parsed) {
      const choice = (parsed as { choice?: unknown }).choice;
      if (choice === 'all' || choice === 'essential') return choice;
    }
  } catch {
    // Malformed entry falls back to null so the banner can re-prompt cleanly.
  }
  return null;
}

export function setCookieConsent(choice: CookieConsentChoice): StoredCookieConsent {
  const entry: StoredCookieConsent = {
    choice,
    timestamp: new Date().toISOString(),
  };
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(entry));
    } catch {
      // Storage quota/private-mode refusal: non-fatal.
    }
  }
  return entry;
}

/**
 * Whether automatic background client error telemetry may be transmitted.
 * Selecting "Essential Only" opts out of background telemetry while leaving
 * explicit user-submitted support diagnostics unaffected.
 */
export function isOptionalTelemetryAllowed(): boolean {
  return getCookieConsent() !== 'essential';
}
