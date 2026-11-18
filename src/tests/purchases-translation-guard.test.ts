/**
 * EU-G1: the Purchases screen's text goes through purchasesText, and every key has Hebrew.
 * Checks JSX text, markup strings and every visible prop (title, label, placeholder, description, …).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkTranslatedScreen } from './helpers/translationGuard';
import { translateScreenString } from '../lib/i18n/screenTranslations';

// The bill columns were extracted to keep the screen below the file-size ratchet. Both files
// are one visible screen and must keep the same translation coverage as before the split.
const files = ['Purchases.tsx', 'billColumns.tsx'] as const;
const reports = files.map(name => ({
  name,
  report: checkTranslatedScreen(fileURLToPath(new URL(`../components/purchases/${name}`, import.meta.url)), 'purchases', 'purchasesText'),
}));

test('Purchases: no visible English outside purchasesText (text, markup strings, visible props)', () => {
  for (const { name, report } of reports) {
    assert.deepEqual(report.untranslated, [], `Wrap visible ${name} text with purchasesText and add its EN/HE entry.`);
  }
});

test('Purchases: every purchasesText key has its English fallback and Hebrew in the table', () => {
  for (const { name, report } of reports) assert.deepEqual(report.badKeys, [], name);
  assert.equal(reports.reduce((sum, { report }) => sum + report.calls, 0), 78);
  assert.equal(translateScreenString('purchases', 'col.dueDate', 'he', 'Due Date'), 'תאריך פירעון');
  // a button's accessible name follows its visible label: the Hebrew name contains the Hebrew text
  assert.ok(translateScreenString('purchases', 'aria.spread', 'he', '').includes(translateScreenString('purchases', 'action.spread', 'he', '')));
  assert.ok(translateScreenString('purchases', 'aria.undoSpread', 'he', '').includes(translateScreenString('purchases', 'action.undoSpread', 'he', '')));
});
