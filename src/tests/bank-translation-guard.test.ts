/** EU-G1: every visible string on the Bank screen goes through bankText, and every key has Hebrew. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkTranslatedScreen } from './helpers/translationGuard';
import { translateScreenString } from '../lib/i18n/screenTranslations';

const report = checkTranslatedScreen(fileURLToPath(new URL('../components/banking/Banking.tsx', import.meta.url)), 'banking', 'bankText');

test('Bank: no visible English outside bankText (text, markup strings, label/title/description props)', () => {
  assert.deepEqual(report.untranslated, [], 'Wrap new visible Bank text with bankText and add its EN/HE entry.');
});

test('Bank: every bankText key has its English fallback and Hebrew in the table', () => {
  assert.deepEqual(report.badKeys, []);
  assert.equal(report.calls, 23, 'counted from the syntax tree, so a fallback with an apostrophe is not skipped');
  assert.equal(translateScreenString('banking', 'error.loadTitle', 'he', ''), 'לא הצלחנו לטעון את חשבונות הבנק');
  assert.equal(translateScreenString('banking', 'action.syncFeed', 'en', 'Sync Feed'), 'Sync Feed');
});
