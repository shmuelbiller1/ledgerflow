/**
 * EU-G1: the Purchases screen's text goes through purchasesText, and every key has Hebrew.
 * Scope so far: JSX text and aria-labels. Its title/label/placeholder props and markup strings are
 * the next Purchases step; widen `visibleProps` and `checkMarkupStrings` here when they are done.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkTranslatedScreen } from './helpers/translationGuard';
import { translateScreenString } from '../lib/i18n/screenTranslations';

const report = checkTranslatedScreen(fileURLToPath(new URL('../components/purchases/Purchases.tsx', import.meta.url)), 'purchases', 'purchasesText', new Set(['aria-label']), false);

test('Purchases: no untranslated JSX text or English-only aria-label', () => {
  assert.deepEqual(report.untranslated, [], 'Wrap new visible Purchases text with purchasesText and add its EN/HE entry.');
});

test('Purchases: every purchasesText key has its English fallback and Hebrew in the table', () => {
  assert.deepEqual(report.badKeys, []);
  assert.equal(report.calls, 35);
  assert.equal(translateScreenString('purchases', 'col.dueDate', 'he', 'Due Date'), 'תאריך פירעון');
  // a button's accessible name follows its visible label: the Hebrew name contains the Hebrew text
  assert.ok(translateScreenString('purchases', 'aria.spread', 'he', '').includes(translateScreenString('purchases', 'action.spread', 'he', '')));
  assert.ok(translateScreenString('purchases', 'aria.undoSpread', 'he', '').includes(translateScreenString('purchases', 'action.undoSpread', 'he', '')));
});
