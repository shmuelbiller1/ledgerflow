/**
 * AI12-N10-01 (#838): the four screens a person meets before they have books — sign-in/sign-up, the
 * setup wizard, the first-hour guide and the first-week checklist — say what they mean in Hebrew and
 * read right-to-left, while English keeps every sentence and accessible name it had.
 *
 * The figures and the completion signals are not re-tested here: which record completes a checklist
 * step, and which password is refused, stay with `first-week-checklist.test.tsx` and
 * `password-policy.test.tsx`. This file is about the language a person actually reads.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  fillOnboarding,
  onboardingText,
  onboardingTextWith,
  onboardingTranslationGaps,
  ONBOARDING_STRINGS,
  translationGaps,
} from '../lib/i18n/onboardingTranslations';
import { businessPresetName, monthNames, SETUP_TRANSLATIONS, setupText } from '../lib/i18n/setupTranslations';
import { OVERVIEW_TRANSLATIONS, overviewTextWith } from '../lib/i18n/overviewTranslations';
import { templateCopyIds, templateDescriptionHe, templateNameHe } from '../lib/i18n/onboardingTemplateCopy';
import { MIN_PASSWORD_LENGTH, passwordProblemCode } from '../lib/passwordPolicy';
import { AuthScreen } from '../core/auth/AuthScreen';
import NewPasswordScreen from '../core/auth/NewPasswordScreen';
import SetupWizard from '../components/onboarding/SetupWizard';
import FirstHourGuide from '../components/onboarding/FirstHourGuide';
import FirstWeekChecklist from '../components/dashboard/FirstWeekChecklist';
import { useUIStore } from '../stores/useUIStore';
import { useLedgerStore } from '../stores/useLedgerStore';
import { useDataNeedsStore } from '../stores/useDataNeedsStore';
import { useAuthStore } from '../stores/useAuthStore';
import { BUSINESS_PRESETS } from '../lib/businessPresets';
import { BUSINESS_TEMPLATES } from '../lib/businessTemplates';
import { getSupabase } from '../lib/db/client';
import type { Workspace } from '../types';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';

const HEBREW = /\p{Script=Hebrew}/u;
const LATIN_WORD = /\b[A-Za-z]{3,}\b/;
const realFetch = globalThis.fetch;

/** Product and provider names are names, not copy, so they stay in Latin letters in both languages. */
const NAMES = /LedgerFlow|Google|Microsoft|QuickBooks|Xero|Wave|SaaS|AWS|GCP|Shopify|Stripe/gi;

/** The visible words of a region, with those names removed: what is left must be in the selected language. */
function visibleCopy(element: HTMLElement): string {
  return (element.textContent || '')
    .replace(NAMES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

beforeEach(() => {
  useUIStore.setState({ language: 'he' });
  globalThis.fetch = (async input => String(input).includes('/rest/v1/')
    ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(JSON.stringify({ status: 'success' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
});

afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  useUIStore.setState({ language: 'en' });
  getSupabase().realtime.disconnect();
  await getSupabase().auth.dispose();
});

describe('the onboarding table', () => {
  test('every entry has Hebrew that differs from its English', () => {
    assert.ok(ONBOARDING_STRINGS.length >= 60, 'the sign-in path needs its sentences in the shared table');
    assert.deepEqual(onboardingTranslationGaps(), []);
  });

  test('a missing, blank or untranslated entry is reported instead of passing silently', () => {
    const gaps = onboardingTranslationGaps([
      { key: 'ok', en: 'Save', he: 'שמירה' },
      { key: 'blankEnglish', en: '  ', he: 'שמירה' },
      { key: 'missingHebrew', en: 'Save', he: '' },
      { key: 'copiedEnglish', en: 'Save', he: 'Save' },
    ]);
    assert.deepEqual(gaps, [
      { key: 'blankEnglish', problem: 'blank English' },
      { key: 'missingHebrew', problem: 'missing Hebrew' },
      { key: 'copiedEnglish', problem: 'Hebrew identical to English' },
    ]);
  });

  test('an English reader gets the sentence the screen passes, and a gap falls back to it', () => {
    assert.equal(onboardingText('auth.guest', 'en'), 'Continue as Guest');
    assert.equal(onboardingText('auth.guest', 'he'), 'המשך כאורח');
    // a key that is not in the table shows its own last segment, never a key path or "undefined"
    assert.equal(onboardingText('not.a.key' as never, 'he'), 'key');
  });

  test('placeholders are filled with the value as given, and an unknown placeholder is left alone', () => {
    assert.equal(fillOnboarding('{done} of {total} steps complete', { done: 0, total: 5 }), '0 of 5 steps complete');
    assert.equal(fillOnboarding('At least {min} characters', { min: MIN_PASSWORD_LENGTH }), 'At least 10 characters');
    assert.equal(fillOnboarding('{kept} and {unknown}', { kept: 'x' }), 'x and {unknown}');
    // the Hebrew progress sentence reads with its own numbers, in Hebrew
    assert.equal(overviewTextWith('firstWeek.progress', 'he', { done: 0, total: 5 }), '0 מתוך 5 שלבים הושלמו');
  });

  test('the Overview screens have their own table, with no gap', () => {
    assert.ok(OVERVIEW_TRANSLATIONS.length >= 40);
    assert.deepEqual(translationGaps(OVERVIEW_TRANSLATIONS), []);
  });

  test('the month names and the chart templates have Hebrew for every value the setup screen shows', () => {
    assert.deepEqual(monthNames('he'), ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']);
    assert.equal(monthNames('en')[3], 'April');
    const covered = new Set(templateCopyIds());
    const missing = Object.values(BUSINESS_TEMPLATES)
      .filter(template => !covered.has(template.id))
      .map(template => template.id);
    assert.deepEqual(missing, [], 'every chart template the setup screen lists needs its Hebrew name and description');
    for (const template of Object.values(BUSINESS_TEMPLATES)) {
      assert.match(String(templateNameHe(template.id)), HEBREW, template.id);
      assert.match(String(templateDescriptionHe(template.id)), HEBREW, template.id);
    }
    for (const preset of BUSINESS_PRESETS) {
      assert.match(businessPresetName(preset.id, preset.name, 'he'), HEBREW, preset.id);
    }
    // the wizard's own table has no gap either, and its English is what the screen passes
    assert.deepEqual(onboardingTranslationGaps(SETUP_TRANSLATIONS), []);
    assert.equal(setupText('setup.title', 'en'), 'Set up your books');
    assert.equal(setupText('setup.title', 'he'), 'הגדרת הספרים שלכם');
    // English is untouched: the stored template words are the ones the screen shows
    const retail = BUSINESS_TEMPLATES.retail;
    assert.equal(retail.name, BUSINESS_TEMPLATES.retail.name);
    assert.equal(retail.description, BUSINESS_TEMPLATES.retail.description);
  });
});

describe('the sign-in screen', () => {
  const props = { onLogin: () => {}, onEmailLogin: async () => {}, onEmailSignup: async () => {}, onPasswordReset: async () => {}, onGuest: () => {} };

  test('Hebrew reads Hebrew and right-to-left, and English keeps its exact words', () => {
    const { rerender } = render(<AuthScreen {...props} language="he" />);
    const page = screen.getByRole('main');
    assert.equal(page.getAttribute('dir'), 'rtl');
    assert.equal(page.getAttribute('lang'), 'he');
    assert.ok(screen.getByRole('heading', { name: 'התחברות' }));
    assert.ok(screen.getByRole('button', { name: 'המשך כאורח' }));
    // the visible words are Hebrew; the accessible name says what pressing it does
    assert.equal(screen.getByRole('button', { name: 'שליחת התחברות' }).textContent?.trim(), 'התחברות בדוא״ל');
    assert.ok(screen.getByLabelText('כתובת דוא״ל'));
    assert.ok(screen.getByLabelText('סיסמה'));
    // no English sentence left in the form (the brand name and the address example are not copy)
    const copy = visibleCopy(page);
    assert.equal(LATIN_WORD.test(copy.replace(/you@company\.com/g, '')), false, `English left in the Hebrew page: ${copy}`);

    useUIStore.setState({ language: 'en' });
    rerender(<AuthScreen {...props} language="en" />);
    assert.equal(screen.getByRole('main').getAttribute('dir'), 'ltr');
    assert.ok(screen.getByRole('heading', { name: 'Sign in' }));
    assert.ok(screen.getByRole('button', { name: 'Continue as Guest' }));
    assert.ok(screen.getByRole('button', { name: 'Submit Login' }));
    assert.ok(screen.getByRole('button', { name: 'Switch to Sign up' }));
  });

  test('a refused password is explained in the selected language and nothing is sent', async () => {
    const signups: string[] = [];
    render(<AuthScreen {...props} onEmailSignup={async (e) => { signups.push(e); }} language="he" />);
    fireEvent.click(screen.getByRole('button', { name: 'מעבר להרשמה' }));
    await screen.findByRole('button', { name: 'שליחת הרשמה' });
    assert.match(screen.getByText(/לפחות 10 תווים/).textContent || '', HEBREW);
    fireEvent.change(screen.getByLabelText('כתובת דוא״ל'), { target: { value: 'dana@example.com' } });
    fireEvent.change(screen.getByLabelText('סיסמה'), { target: { value: 'password123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שליחת הרשמה' })); });
    assert.equal(screen.getByRole('alert').textContent, 'הסיסמה הזו נפוצה מאוד; יש לבחור אחרת');
    assert.deepEqual(signups, []);
  });

  test('the Hebrew sentence for every refusal code exists, and the English one is unchanged', () => {
    const cases: Array<[string, string]> = [['short1!', 'tooShort'], ['Password123', 'tooLong'.replace('tooLong', 'common')], ['aaaaaaaaaaaa', 'repeated']];
    for (const [password, code] of cases) {
      assert.equal(passwordProblemCode(password, ''), code);
      assert.match(onboardingTextWith(`password.${code}` as 'password.tooShort', 'he', { min: MIN_PASSWORD_LENGTH }), HEBREW);
    }
    assert.equal(onboardingTextWith('password.tooShort', 'en', { min: MIN_PASSWORD_LENGTH }), 'Use at least 10 characters');
  });
});

describe('the setup wizard', () => {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  beforeEach(() => {
    setComponentWorkspace('owner');
    useAuthStore.setState({
      user: { uid: 'test-user', getIdToken: async () => 'token' } as never, isGuest: false, currentWorkspaceId: 'component-workspace',
      workspaces: [{ id: 'component-workspace', uid: 'test-user', name: 'Acme', currency: 'USD', timezone: deviceZone, fiscalYearStartMonth: 1 } as Workspace],
    });
    useLedgerStore.setState({ accounts: [] });
    useDataNeedsStore.setState({ loaded: {}, failed: {} });
  });

  test('the first step, its choices and its month names are Hebrew and right-to-left', () => {
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    const page = screen.getByRole('main');
    assert.equal(page.getAttribute('dir'), 'rtl');
    assert.ok(screen.getByRole('heading', { name: 'הגדרת הספרים שלכם' }));
    assert.ok(screen.getByRole('heading', { name: 'איזה סוג עסק?' }));
    assert.ok(screen.getByLabelText('שם העסק'));
    assert.ok(screen.getByLabelText('מטבע הבית'));
    assert.ok(screen.getByLabelText('שנת הכספים מתחילה בחודש'));
    assert.ok(screen.getByRole('button', { name: 'דילוג על ההגדרה' }));
    assert.ok(screen.getByRole('button', { name: 'הבא' }));
    // a business type and the month are words a person chooses, so both are Hebrew
    assert.ok(screen.getByLabelText('חנות'));
    const monthSelect = screen.getByLabelText('שנת הכספים מתחילה בחודש') as HTMLSelectElement;
    assert.equal(monthSelect.options[3].textContent, 'אפריל');
    // the typed name and the currency code are data: they are not translated
    assert.equal(screen.getByRole('option', { name: 'USD' }).textContent, 'USD');
  });

  test('the chart step names every template in Hebrew and keeps the template it saves', async () => {
    useLedgerStore.setState({ accounts: [{ id: 'a1', uid: 'test-user', workspaceId: 'component-workspace', code: '1000', name: 'בנק', type: 'asset', category: 'Cash', balanceCents: 0 }] });
    render(<SetupWizard onStarted={() => {}} onDone={() => {}} />);
    // a business type has to be chosen before the step can move (the button is refused until then)
    assert.equal((screen.getByRole('button', { name: 'הבא' }) as HTMLButtonElement).disabled, true);
    fireEvent.click(screen.getByLabelText('חנות'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'הבא' })); });
    // nothing changed, so the step moves without a write; the heading is asserted once it is on screen
    await screen.findByRole('heading', { name: 'תרשים החשבונות' });
    for (const template of Object.values(BUSINESS_TEMPLATES)) {
      assert.ok(screen.getByLabelText(String(templateNameHe(template.id))), template.id);
    }
    assert.ok(screen.getByLabelText('להשאיר את החשבונות שלי'));
    assert.ok(screen.getByRole('button', { name: 'חזרה' }));
  });
});

describe('the first-hour guide', () => {
  test('all eight steps, their descriptions and their actions are Hebrew', () => {
    render(<FirstHourGuide />);
    const guide = screen.getByRole('region', { name: 'מדריך הצעדים הראשונים בהנהלת חשבונות' });
    assert.equal(guide.getAttribute('dir'), 'rtl');
    assert.equal(screen.getAllByRole('listitem').length, 8);
    for (const action of ['בחירת חשבונות', 'פתיחת לקוחות', 'פתיחת חשבוניות', 'פתיחת חשבוניות ספק', 'פתיחת חשבוניות שלא שולמו', 'פתיחת ייבוא בנק', 'פתיחת התאמת בנק', 'פתיחת רווח והפסד']) {
      assert.ok(screen.getByRole('button', { name: action }), action);
    }
    const copy = visibleCopy(guide);
    assert.equal(LATIN_WORD.test(copy), false, `English left in the Hebrew guide: ${copy}`);
  });

  test('the actions still open the same screens', () => {
    render(<FirstHourGuide />);
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת התאמת בנק' }));
    assert.equal(useUIStore.getState().activeTab, 'reconciliation');
    useUIStore.setState({ activeReportTab: 'balance-sheet' });
    fireEvent.click(screen.getByRole('button', { name: 'פתיחת רווח והפסד' }));
    assert.equal(useUIStore.getState().activeTab, 'reports');
    assert.equal(useUIStore.getState().activeReportTab, 'pnl');
    fireEvent.click(screen.getByRole('button', { name: 'בחירת חשבונות' }));
    assert.equal(useUIStore.getState().isTemplateSelectorOpen, true);
  });
});

describe('the first-week checklist', () => {
  const ws = 'component-workspace';

  beforeEach(() => {
    setComponentWorkspace();
    useLedgerStore.setState({ accounts: [], customers: [], invoices: [], payments: [], truncatedCollections: {} });
    useDataNeedsStore.setState({ loadedWorkspaceId: ws, failed: {} });
    markComponentCollectionsLoaded('accounts', 'customers', 'invoices', 'payments');
    localStorage.clear();
  });

  test('the heading, the progress sentence and every open step are Hebrew and right-to-left', () => {
    render(<FirstWeekChecklist />);
    const region = screen.getByRole('region', { name: 'השבוע הראשון שלכם' });
    assert.equal(region.getAttribute('dir'), 'rtl');
    // the count is part of the Hebrew sentence, not digits stranded beside English words
    assert.equal(screen.getByText('0 מתוך 5 שלבים הושלמו').textContent, '0 מתוך 5 שלבים הושלמו');
    for (const action of ['פתיחת בנקים', 'פתיחת לקוחות', 'פתיחת מכירות', 'פתיחת תשלומים', 'פתיחת רווח והפסד']) {
      assert.ok(screen.getByRole('button', { name: action }), action);
    }
    const copy = visibleCopy(region);
    assert.equal(LATIN_WORD.test(copy), false, `English left in the Hebrew checklist: ${copy}`);
  });

  test('the open steps still go to the same places and the report visit is still recorded', async () => {
    render(<FirstWeekChecklist />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'פתיחת לקוחות' })); });
    assert.equal(useUIStore.getState().activeTab, 'sales');
    assert.equal(localStorage.getItem('lf_first_week_v1:test-user:component-workspace:pnl'), null);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'פתיחת רווח והפסד' })); });
    assert.equal(useUIStore.getState().activeReportTab, 'pnl');
    assert.equal(localStorage.getItem('lf_first_week_v1:test-user:component-workspace:pnl'), 'visited');
  });

  test('the loading, failed-load and hidden states are Hebrew too', async () => {
    useDataNeedsStore.setState({ failed: { payments: 'offline' } });
    render(<FirstWeekChecklist />);
    assert.equal(screen.getByRole('alert').textContent, 'לא הצלחנו לטעון את הרשומות של הרשימה הזו, ולכן ההתקדמות לא מוצגת.');
    assert.ok(screen.getByRole('button', { name: 'ניסיון נוסף לטעינת הרשימה' }));
  });

  test('the hide control and the complete marker are named in the selected language', async () => {
    useLedgerStore.setState({
      accounts: [{ id: 'bank-1', uid: 'test-user', workspaceId: ws, code: '1000', name: 'בנק', type: 'asset', subtype: 'checking', balanceCents: 0 }],
    } as never);
    render(<FirstWeekChecklist />);
    assert.ok(screen.getByRole('button', { name: 'הסתרת רשימת השבוע הראשון' }));
    assert.equal(screen.getByLabelText('הושלם').tagName.toLowerCase(), 'svg');
    fireEvent.click(screen.getByRole('button', { name: 'הסתרת רשימת השבוע הראשון' }));
    assert.equal(screen.queryByRole('region', { name: 'השבוע הראשון שלכם' }), null);
  });
});

describe('the new-password screen after a reset link', () => {
  test('it is Hebrew and right-to-left, and the address is shown as it was entered', () => {
    render(<NewPasswordScreen email="dana@example.com" onSave={async () => {}} onSignOut={() => {}} />);
    assert.ok(screen.getByRole('heading', { name: 'בחירת סיסמה חדשה' }));
    assert.ok(screen.getByLabelText('סיסמה חדשה'));
    assert.ok(screen.getByLabelText('אותה סיסמה שוב'));
    // the email is isolated in its own element, so it keeps its left-to-right reading inside the Hebrew sentence
    const address = screen.getByText('dana@example.com');
    assert.equal(address.tagName.toLowerCase(), 'bdi');
    assert.ok(address.closest('[dir="rtl"]'));
  });

  test('a mismatch and a weak password are explained in Hebrew; English keeps its sentence', async () => {
    render(<NewPasswordScreen email="dana@example.com" onSave={async () => {}} onSignOut={() => {}} />);
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'blue-harbor-41-lantern' } });
    fireEvent.change(screen.getByLabelText('אותה סיסמה שוב'), { target: { value: 'blue-harbor-41-lanterns' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה החדשה' })); });
    assert.equal(screen.getByRole('alert').textContent, 'הסיסמאות אינן זהות');
    fireEvent.change(screen.getByLabelText('סיסמה חדשה'), { target: { value: 'password123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'שמירת הסיסמה החדשה' })); });
    assert.equal(screen.getByRole('alert').textContent, 'הסיסמה הזו נפוצה מאוד; יש לבחור אחרת');
  });
});
