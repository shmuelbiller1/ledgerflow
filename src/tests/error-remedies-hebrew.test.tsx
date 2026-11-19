/**
 * AI12-N3: the refusals people actually meet say what happened and what to do, in English and Hebrew.
 *
 * The English sentences are the ones that already shipped (BO-07); this file adds the Hebrew and locks
 * both. The server strings quoted here are copied from `src/server` (the route that returns them), so a
 * refusal renamed in the server shows up as a test that no longer matches anything it claims.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from '@testing-library/react';
import {
  classifyError, describeError, errorMessage, errorRemedyRules, type ErrorRemedyRule,
} from '../lib/errorRemedies';
import { ONBOARDING_STRINGS, onboardingTranslationGaps } from '../lib/i18n/onboardingTranslations';
import { uiLanguageNow } from '../lib/i18n/uiLanguageNow';
import { useUIStore } from '../stores/useUIStore';

const HEBREW = /\p{Script=Hebrew}/u;

/**
 * A refusal per rule, in the server's own words (from `src/server/routes` and `src/server/services`).
 * `where` says who returns it, so the next reader can check the wording at its source.
 */
const REFUSALS: ReadonlyArray<{ rule: ErrorRemedyRule; message: string; where: string }> = [
  { rule: 'sessionEnded', message: 'Sign in required', where: 'the authenticated routes (401)' },
  // "Unauthorized" here is a membership refusal, not an expired session: it is answered with the
  // permission remedy (ask an owner), which is the rule this string has always matched.
  { rule: 'permission', message: 'Unauthorized: You are not a member of this workspace.', where: 'workspaceRoutes' },
  { rule: 'permission', message: 'Forbidden: changing the books requires the owner, accountant or bookkeeper role', where: 'roleGuard' },
  { rule: 'permission', message: 'new row violates row-level security policy for table "invoices"', where: 'Postgres RLS (42501)' },
  { rule: 'lockedPeriod', message: 'This period is locked', where: 'the period lock in the posting services' },
  { rule: 'alreadyExists', message: 'duplicate key value violates unique constraint "invoices_number_key"', where: 'Postgres (23505)' },
  { rule: 'gone', message: 'Transaction not found', where: 'the transaction routes' },
  { rule: 'otherWorkspace', message: 'This record is not in the selected workspace.', where: 'the workspace-scoped routes' },
  { rule: 'otherWorkspace', message: 'Workspace mismatch: transaction belongs to a different workspace', where: 'the transaction routes' },
  { rule: 'unbalanced', message: 'Transaction is unbalanced', where: 'the posting services' },
  { rule: 'invalid', message: 'Amount must be greater than zero', where: 'the document validation' },
  { rule: 'invalid', message: 'Invalid payload', where: 'the command routes' },
  { rule: 'fieldNotAllowed', message: 'Field "totalCents" is not allowed on invoices', where: 'the row-level write guard' },
  { rule: 'unreachable', message: 'Failed to fetch', where: 'the browser when offline' },
];

beforeEach(() => { useUIStore.setState({ language: 'en' }); });
afterEach(() => { cleanup(); useUIStore.setState({ language: 'en' }); });

describe('N-3 an English reader is told what happened and what to do', () => {
  test('every known refusal is recognised, and none of them is left as a raw server string', () => {
    for (const refusal of REFUSALS) {
      assert.equal(classifyError(new Error(refusal.message)), refusal.rule, refusal.message);
      const described = describeError(new Error(refusal.message), 'update');
      assert.ok(described.title.length > 0 && described.remedy.length > 0, refusal.message);
      // the title says what happened in words, never the server's own code
      assert.equal(/\b(401|403|404|42501|23505|zod)\b/.test(described.title), false, refusal.message);
      // the remedy says what to do: an instruction word, not only a restatement
      assert.match(described.remedy, /try again|Use a|Sign in again|Ask an owner|Check your|Refresh|Make the|Correct|report|open the existing|Switch to that workspace/i, refusal.message);
      assert.equal(HEBREW.test(described.title + described.remedy), false, 'English mode must stay English');
    }
  });

  test('the sentences that already shipped are unchanged, word for word', () => {
    assert.deepEqual(describeError(new Error('This period is locked')), {
      title: 'That date is in a closed period',
      remedy: 'Use a date after the lock date, or ask an owner to reopen the period (Month-End Close).',
    });
    assert.deepEqual(describeError(new Error('Failed to fetch')), {
      title: "Can't reach the server",
      remedy: 'Check your internet connection, then try again.',
    });
    assert.deepEqual(describeError(new Error('Sign in required')), {
      title: 'Your session ended',
      remedy: 'Sign in again. What you were doing on this screen was not saved.',
    });
    // an unknown failure names the thing that failed, and still offers the next step
    assert.deepEqual(describeError(new Error('kaboom'), 'delete'), {
      title: 'Something went wrong while deleting',
      remedy: 'Try again. If it keeps happening, report it (Help → Support).',
    });
    assert.deepEqual(describeError(new Error('kaboom')), {
      title: 'Something went wrong',
      remedy: 'Try again. If it keeps happening, report it (Help → Support).',
    });
  });

  test('an invalid detail is quoted as the server wrote it, then the next step is given', () => {
    const described = describeError({ message: 'Amount must be greater than zero' });
    assert.match(described.remedy, /^Amount must be greater than zero\. /);
  });
});

describe('N-3 a Hebrew reader gets the same explanation in Hebrew', () => {
  test('every known refusal has a Hebrew title and remedy, and no English is left in them', () => {
    for (const refusal of REFUSALS) {
      const described = describeError(new Error(refusal.message), 'update', 'he');
      assert.match(described.title, HEBREW, refusal.message);
      assert.match(described.remedy, HEBREW, refusal.message);
      // the English instruction words must not survive in the Hebrew remedy
      assert.equal(/\b(try again|sign in|ask an owner|check your|refresh|use a|make the)\b/i.test(described.remedy + described.title), false, refusal.message);
    }
  });

  test('the Hebrew title of every rule is distinct, so two different refusals are not confused', () => {
    const titles = errorRemedyRules().map(rule => {
      const sample = REFUSALS.find(refusal => refusal.rule === rule)!;
      return describeError(new Error(sample.message), 'update', 'he').title;
    });
    assert.equal(new Set(titles).size, titles.length, titles.join(' | '));
  });

  test('a server-written detail keeps its own characters inside the Hebrew sentence', () => {
    const described = describeError(new Error('Amount must be greater than zero'), 'update', 'he');
    assert.match(described.remedy, HEBREW);
    assert.match(described.remedy, /Amount must be greater than zero/);
    // the detail is direction-isolated (U+2068 … U+2069) so the Latin sentence does not mix into the Hebrew
    assert.match(described.remedy, /\u2068Amount must be greater than zero\u2069/);
  });

  test('the default stays English, so a caller that has no language keeps its message', () => {
    assert.equal(describeError(new Error('This period is locked')).title, 'That date is in a closed period');
  });
});

describe('N-3 the message a person sees follows the language they chose', () => {
  test('the toast the shared error reporter raises is in Hebrew when Hebrew is selected', async () => {
    const toasts: Array<{ title: string; description?: string }> = [];
    const { toast } = await import('sonner');
    const original = toast.error;
    (toast as unknown as { error: unknown }).error = (title: string, options?: { description?: string }) => { toasts.push({ title, description: options?.description }); };
    try {
      const { reportError, OperationType } = await import('../lib/utils');
      useUIStore.setState({ language: 'he' });
      reportError(new Error('This period is locked'), OperationType.UPDATE);
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].title, 'התאריך נמצא בתקופה סגורה');
      assert.match(toasts[0].description || '', HEBREW);

      useUIStore.setState({ language: 'en' });
      reportError(new Error('This period is locked'), OperationType.UPDATE);
      assert.equal(toasts[1].title, 'That date is in a closed period');
    } finally {
      (toast as unknown as { error: unknown }).error = original;
    }
  });

  test('the language is read at the moment the message is shown, not when the screen loaded', () => {
    useUIStore.setState({ language: 'en' });
    assert.equal(uiLanguageNow(), 'en');
    assert.match(describeError(new Error('Sign in required'), 'list', uiLanguageNow()).title, /session ended/);
    useUIStore.setState({ language: 'he' });
    assert.equal(uiLanguageNow(), 'he');
    assert.match(describeError(new Error('Sign in required'), 'list', uiLanguageNow()).title, HEBREW);
  });
});

describe('N-3 the four replies the app writes itself are in the reader\'s language', () => {
  test('a session end and a role refusal are Hebrew in Hebrew mode, and the exact English otherwise', async () => {
    const { commandErrorMessage, ServerCommandError } = await import('../lib/runCommand');
    assert.equal(commandErrorMessage(new ServerCommandError(401, 'nope'), 'en'), 'Your session has ended. Sign in again and retry.');
    assert.equal(commandErrorMessage(new ServerCommandError(401, 'nope'), 'he'), 'פג תוקף החיבור. יש להתחבר שוב ולנסות שוב.');
    assert.equal(commandErrorMessage(new ServerCommandError(403, 'nope'), 'en'), 'Your role cannot do that. Ask an owner or admin.');
    assert.equal(commandErrorMessage(new ServerCommandError(403, 'nope'), 'he'), 'התפקיד שלכם לא מאפשר את הפעולה הזו. אפשר לבקש מבעל העסק או ממנהל.');
    // a specific 403 (verify your email, two-step login) keeps the server's own instruction in both languages
    assert.equal(commandErrorMessage(new ServerCommandError(403, 'Set up two-step login to continue'), 'he'), 'Set up two-step login to continue');
    assert.equal(commandErrorMessage(new Error(''), 'he'), 'הפעולה לא הצליחה');
    // written with no language, it still answers in English: every existing caller keeps its message
    assert.equal(commandErrorMessage(new ServerCommandError(403, 'nope')), 'Your role cannot do that. Ask an owner or admin.');
  });

  test('a server refusal that is not one of the four is quoted as written, in both languages', async () => {
    const { commandErrorMessage, ServerCommandError } = await import('../lib/runCommand');
    assert.equal(commandErrorMessage(new ServerCommandError(409, 'Duplicate request processing: Transaction ID already exists'), 'he'),
      'Duplicate request processing: Transaction ID already exists');
  });
});

describe('N-3 guard: a new refusal cannot ship without its Hebrew', () => {
  test('the remedy table covers every rule the classifier can return, with Hebrew', () => {
    // every rule is reachable from a real refusal, and each one answers in Hebrew
    const seen = new Set(REFUSALS.map(refusal => refusal.rule));
    assert.deepEqual([...seen].sort(), [...errorRemedyRules()].sort(), 'a rule with no sample refusal cannot be checked');
    for (const rule of errorRemedyRules()) {
      const sample = REFUSALS.find(refusal => refusal.rule === rule)!;
      const described = describeError(new Error(sample.message), 'update', 'he');
      assert.match(described.title, HEBREW, rule);
      assert.match(described.remedy, HEBREW, rule);
    }
    // and the onboarding table's shared password sentences still have no gap
    assert.deepEqual(onboardingTranslationGaps(), []);
    assert.ok(ONBOARDING_STRINGS.length > 0);
  });

  test('an unrecognised refusal is still explained in both languages', () => {
    const unknown = new Error('quantum flux inverted');
    assert.equal(classifyError(unknown), null);
    assert.match(describeError(unknown, 'update', 'en').title, /went wrong/);
    assert.match(describeError(unknown, 'update', 'he').title, HEBREW);
    assert.equal(errorMessage({ message: 42 }), '42');
  });
});
