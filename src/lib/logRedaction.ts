/**
 * F-35 — one redaction rule for anything written to a log or sent to telemetry.
 *
 * Logs and crash reports exist to find a fault, not to keep a copy of a customer's
 * identity or a credential. This helper removes the four things that must never
 * appear there: passwords/secrets, bearer tokens and API keys, e-mail addresses,
 * and payment-card numbers. It is deliberately conservative: a value that looks
 * like a card is masked whole, because a partial card number is still personal data.
 *
 * What it does not do: change the record it is given, decide whether to log, or
 * guarantee that a caller does not add a field of its own afterwards.
 */

const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const API_KEY = /\b(api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]+/gi;
const PASSWORD = /\b(password|passwd|pwd)["']?\s*[:=]\s*["']?[^\s"',;]+/gi;
const SECRET = /\b(secret|client[_-]?secret|token)["']?\s*[:=]\s*["']?[^\s"',;]+/gi;

/** Luhn check: only a value that is a plausible card number is masked as one. */
export function isCardNumber(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** The same text with credentials, addresses and card numbers replaced. */
export function redactForLogs(input: string): string {
  if (!input) return '';
  return input
    .replace(BEARER, '$1[REDACTED]')
    .replace(API_KEY, '$1[REDACTED]')
    .replace(PASSWORD, (_match, label: string) => `${label}=[REDACTED]`)
    .replace(SECRET, (_match, label: string) => `${label}=[REDACTED]`)
    .replace(EMAIL, '[EMAIL]')
    .replace(CARD, match => (isCardNumber(match.replace(/[ -]/g, '')) ? '[CARD]' : match));
}

/** Whether a line is safe to write: no card number and no e-mail address remain. */
export function isRedacted(line: string): boolean {
  return redactForLogs(line) === line;
}
