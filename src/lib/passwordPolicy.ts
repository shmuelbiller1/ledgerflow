import { trimEndChars } from './textShape';
/**
 * Password rules (Y-31), checked before a password is set (sign-up, a new password after a reset
 * link): at least 10 characters, not one of the passwords people use most, not the name part of
 * your own email address, and not one character repeated. Supabase checks its own minimum too.
 */
export const MIN_PASSWORD_LENGTH = 10;

/** Lower-cased: the most used passwords and keyboard runs (each at least 10 characters is still refused). */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'qwerty', 'qwerty123', 'qwertyuiop',
  'qwerty1234', 'asdfghjkl', 'asdfghjkl;', 'zxcvbnm', '1q2w3e4r5t', '1qaz2wsx3edc', '123456', '1234567', '12345678', '123456789', '1234567890',
  '0123456789', '0987654321', '9876543210', '111111', '1111111111', '000000', '0000000000', 'abc123', 'abcdefghij', 'iloveyou', 'letmein',
  'letmein123', 'welcome', 'welcome1', 'welcome123', 'admin', 'admin123', 'administrator', 'monkey', 'dragon', 'football', 'baseball',
  'sunshine', 'princess', 'trustno1', 'superman', 'starwars', 'whatever', 'changeme', 'changeme123', 'ledgerflow', 'ledgerflow1', 'ledgerflow123',
]);

/**
 * Why a password is refused, as a code. The English sentence (and its Hebrew, AI12-N10-01) belongs
 * to the screen that shows it, so a refusal is not fixed to one language: `passwordProblem` keeps
 * returning the English sentence for every existing caller.
 */
export type PasswordProblemCode =
  | 'tooShort'
  | 'tooLong'
  | 'common'
  | 'repeated'
  | 'emailName';

export function passwordProblemCode(password: string, email = ''): PasswordProblemCode | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (password.length > 128) return 'tooLong';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(trimEndChars(lower, '!.?'))) return 'common';
  if (/^(.)\1+$/.test(password)) return 'repeated';
  const name = email.split('@')[0]?.toLowerCase() || '';
  if (name.length >= 4 && lower.includes(name)) return 'emailName';
  return null;
}

/** The English sentence for a refusal code (unchanged wording). */
export function passwordProblemSentence(code: PasswordProblemCode): string {
  switch (code) {
    case 'tooShort': return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
    case 'tooLong': return 'Use at most 128 characters';
    case 'common': return 'That password is one of the most used; choose another';
    case 'repeated': return 'Do not repeat one character';
    case 'emailName': return 'Do not use your email name in the password';
  }
}

export function passwordProblem(password: string, email = ''): string | null {
  const code = passwordProblemCode(password, email);
  return code ? passwordProblemSentence(code) : null;
}
