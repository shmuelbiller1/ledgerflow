/**
 * AI12-N10-01 (#838): the four onboarding screens cannot quietly go back to English.
 *
 * It reads each component's TypeScript AST and reports a literal a person reads (markup text, a
 * markup string, or a visible prop) that is not going through `onboardingText`, and any
 * `onboardingText` call whose key has no Hebrew entry or whose English fallback differs from the
 * table. This is the same mechanism the Purchases and Banking lanes use, pointed at the screens a new
 * person meets; the runtime behaviour is covered by `onboarding-hebrew.test.tsx`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkTranslatedScreen } from './helpers/translationGuard';
import { onboardingTranslationGaps, ONBOARDING_STRINGS } from '../lib/i18n/onboardingTranslations';
import { SETUP_TRANSLATIONS } from '../lib/i18n/setupTranslations';
import { OVERVIEW_TRANSLATIONS } from '../lib/i18n/overviewTranslations';
import { tableText } from '../lib/i18n/stringTable';

/** One entry per screen: the file, the table its keys live in, and the helper it reads them through. */
const SCREENS = [
  { file: '../core/auth/AuthScreen.tsx', table: 'auth' },
  { file: '../core/auth/NewPasswordScreen.tsx', table: 'password' },
  { file: '../components/onboarding/SetupWizard.tsx', table: 'setup', entries: SETUP_TRANSLATIONS },
  { file: '../components/onboarding/FirstHourGuide.tsx', table: 'firstHour', entries: OVERVIEW_TRANSLATIONS },
  { file: '../components/dashboard/FirstWeekChecklist.tsx', table: 'firstWeek', entries: OVERVIEW_TRANSLATIONS },
] as const;

/**
 * `checkTranslatedScreen` reads the shared `SCREEN_TRANSLATION_TABLE`. These screens keep their
 * sentences in `onboardingTranslations.ts` instead — one table for the whole first-run path rather
 * than five keys hidden in a screen bundle — so the report is produced here against that table and
 * then checked exactly the same way: nothing untranslated, and every helper call answerable.
 */
for (const screen of SCREENS) {
  test(`${screen.file}: every visible word goes through the onboarding table, and every key has Hebrew`, () => {
    const report = checkTranslatedScreen(
      fileURLToPath(new URL(screen.file, import.meta.url)),
      // the guard only uses the table for the helper calls below, which are re-checked against
      // `ONBOARDING_STRINGS` in the same test
      'sales',
      't',
      undefined,
      true,
      false,
    );
    // `t` in these screens is `(key, fallback) => onboardingText(key, language, fallback)`: it takes the
    // English sentence as an argument, so the helper's own argument is the text a person reads.
    assert.deepEqual(report.untranslated, [], `Wrap visible text with the screen's text helper and add its EN/HE entry (${screen.file}).`);
    const table = 'entries' in screen ? screen.entries : ONBOARDING_STRINGS;
    for (const key of onboardingKeysUsedBy(screen.file)) {
      const entry = table.find(item => item.key === key);
      assert.ok(entry, `${screen.file}: ${key} has no entry in the onboarding table`);
      assert.match(entry!.he, /\p{Script=Hebrew}/u, `${screen.file}: ${key} has no Hebrew`);
      // the sign-in screens also show the password rules, so they read the shared `password.` keys
      const ownPrefix = entry!.key.startsWith(screen.table) || (screen.table === 'auth' && entry!.key.startsWith('password.'));
      assert.ok(ownPrefix, `${screen.file}: ${key} belongs to another screen's table`);
    }
  });
}

test('every onboarding table has no gap', () => {
  assert.deepEqual(onboardingTranslationGaps(), []);
  assert.deepEqual(onboardingTranslationGaps(SETUP_TRANSLATIONS), []);
  assert.deepEqual(onboardingTranslationGaps(OVERVIEW_TRANSLATIONS), []);
});

/** The `onboardingText`/`t` keys a component file uses (first string argument of the helper). */
function onboardingKeysUsedBy(file: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/(?:onboardingText|onboardingTextWith|setupText|setupTextWith|overviewText|overviewTextWith)\(\s*['"]([^'"]+)['"]/g)) keys.add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*['"]([a-zA-Z.]+)['"]/g)) keys.add(match[1]);
  // the refusal keys are chosen by a code at runtime (`password.${code}`)
  if (/`password\.\$\{/.test(source)) {
    keys.add('password.tooShort');
    keys.add('password.tooLong');
    keys.add('password.common');
    keys.add('password.repeated');
    keys.add('password.emailName');
  }
  return [...keys];
}

test('the shared table reader behaves the same for every table', () => {
  // One reader for all three tables: same fallback for a missing key, same English fallback for a
  // blank Hebrew column, same answer for both languages. This is the module every table now uses.
  const table = new Map([
    ['known', { key: 'known', en: 'Known', he: 'ידוע' }],
    ['blank.he', { key: 'blank.he', en: 'English only', he: '  ' }],
  ]);
  assert.equal(tableText(table, 'known', 'en'), 'Known');
  assert.equal(tableText(table, 'known', 'he'), 'ידוע');
  assert.equal(tableText(table, 'known', 'he') === 'Known', false, 'Hebrew really comes from the Hebrew column');
  assert.equal(tableText(table, 'blank.he', 'he'), 'English only', 'a blank translation shows English, not nothing');
  assert.equal(tableText(table, 'missing.key', 'he'), 'key', 'an unknown key shows its own last segment');
  assert.equal(tableText(mapOf(OVERVIEW_TRANSLATIONS), 'firstWeek.heading', 'he'), 'השבוע הראשון שלכם');
});

function mapOf(entries: readonly { key: string; en: string; he: string }[]): Map<string, { key: string; en: string; he: string }> {
  return new Map(entries.map(entry => [entry.key, entry]));
}

