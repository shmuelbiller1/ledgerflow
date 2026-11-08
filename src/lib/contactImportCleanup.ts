/**
 * E-37: conservative cleanup suggestions for contact email and phone text.
 * Suggestions are shown but never applied unless the user explicitly accepts them. Email validation
 * and all-or-nothing import remain in recordImport.ts/the server; phone values that cannot be parsed
 * as a valid E.164 number are kept as entered.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js';
import type { ImportKind, ImportRow } from './recordImport';
import { getIsoCountry } from './isoCountryReference';
import { isEmailShape } from './textShape';

export interface ContactImportCleanupWarning {
  readonly row: number;
  readonly field: 'Email' | 'Phone';
  readonly original: string;
  readonly normalized?: string;
  readonly message: string;
}

export interface ContactImportCleanupResult {
  /** Import rows, unchanged by default; accepted suggestions are applied only for this call. */
  readonly rows: ImportRow[];
  readonly warnings: ContactImportCleanupWarning[];
  /** Number of accepted email suggestions actually applied. */
  readonly normalizedEmails: number;
  /** Number of accepted phone suggestions actually applied. */
  readonly normalizedPhones: number;
}

export interface ContactImportCleanupOptions {
  /** Apply safe email trim/lowercase suggestions after the user explicitly opts in. */
  acceptEmailSuggestions?: boolean;
  /** Apply safe E.164 phone suggestions after the user explicitly opts in. */
  acceptPhoneSuggestions?: boolean;
}

const PHONE_TEXT = /^\+?[0-9\s().-]+(?:\s*(?:ext(?:ension)?\.?|x|#)\s*\d+)?$/i;
const PHONE_EXTENSION = /(?:\bext(?:ension)?\.?|x|#)\s*\d+\s*$/i;
const E164 = /^\+[1-9]\d{1,14}$/;

/**
 * Generate contact cleanup suggestions without changing source rows unless accepted in `options`.
 * `defaultCountry` is an explicit user choice used only for national-format numbers; no region is
 * inferred from the workspace.
 */
export function cleanupContactImportRows(
  kind: ImportKind,
  rows: readonly ImportRow[],
  defaultCountry?: string | null,
  options: ContactImportCleanupOptions = {},
): ContactImportCleanupResult {
  if (kind !== 'customers' && kind !== 'vendors') {
    return { rows: rows.map(row => ({ ...row })), warnings: [], normalizedEmails: 0, normalizedPhones: 0 };
  }
  const country = getIsoCountry(defaultCountry)?.alpha2 as CountryCode | undefined;
  const warnings: ContactImportCleanupWarning[] = [];
  let normalizedEmails = 0;
  let normalizedPhones = 0;
  const cleaned = rows.map((row, index) => {
    const next = { ...row };
    const email = String(row.email ?? '');
    if (email.trim()) {
      const candidate = email.trim().toLowerCase();
      if (isEmailShape(email.trim()) && email.trim().length <= 200) {
        if (candidate !== email) {
          if (options.acceptEmailSuggestions) {
            next.email = candidate;
            normalizedEmails += 1;
          }
          warnings.push({
            row: index + 2,
            field: 'Email',
            original: email,
            normalized: candidate,
            message: 'Suggested trim and lowercase; email ownership is not verified. This change is only used if you accept it.',
          });
        }
      } else {
        warnings.push({
          row: index + 2,
          field: 'Email',
          original: email,
          message: 'No safe cleanup suggestion. The existing import validator still requires a valid email address.',
        });
      }
    }

    const phone = String(row.phone ?? '');
    const trimmedPhone = phone.trim();
    if (trimmedPhone) {
      if (!PHONE_TEXT.test(trimmedPhone)) {
        warnings.push({ row: index + 2, field: 'Phone', original: phone, message: 'Could not parse this as one phone number; it will be kept as entered.' });
      } else if (PHONE_EXTENSION.test(trimmedPhone)) {
        warnings.push({ row: index + 2, field: 'Phone', original: phone, message: 'An extension is present; it will be kept as entered to avoid dropping it.' });
      } else if (!trimmedPhone.startsWith('+') && !country) {
        warnings.push({ row: index + 2, field: 'Phone', original: phone, message: 'Choose a country to parse this local number; it will be kept as entered for now.' });
      } else {
        try {
          const parsed = parsePhoneNumberFromString(trimmedPhone, country);
          const normalized = parsed?.number;
          if (parsed?.isValid() && normalized && E164.test(normalized)) {
            if (normalized !== phone) {
              if (options.acceptPhoneSuggestions) {
                next.phone = normalized;
                normalizedPhones += 1;
              }
              warnings.push({
                row: index + 2,
                field: 'Phone',
                original: phone,
                normalized,
                message: 'Suggested E.164 format; this does not verify that the number is assigned or reachable. This change is only used if you accept it.',
              });
            }
          } else {
            warnings.push({ row: index + 2, field: 'Phone', original: phone, message: 'Could not validate a safe E.164 format; it will be kept as entered.' });
          }
        } catch {
          warnings.push({ row: index + 2, field: 'Phone', original: phone, message: 'Could not parse this number; it will be kept as entered.' });
        }
      }
    }
    return next;
  });
  return { rows: cleaned, warnings, normalizedEmails, normalizedPhones };
}
