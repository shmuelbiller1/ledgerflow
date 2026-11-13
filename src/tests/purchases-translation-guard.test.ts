/** EU-G1: the Purchases screen has no untranslated literal JSX text, and every key it uses has Hebrew. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SCREEN_TRANSLATION_TABLE, translateScreenString } from '../lib/i18n/screenTranslations';

const path = fileURLToPath(new URL('../components/purchases/Purchases.tsx', import.meta.url));
const sourceText = fs.readFileSync(path, 'utf8');

test('Purchases has no English-only aria-label text', () => {
  assert.deepEqual([...sourceText.matchAll(/aria-label=("[^"]*[A-Za-z][^"]*"|\{`[^`]*`)/g)].map(m => m[1]), [], 'route aria-labels through purchasesText');
});

test('Purchases screen has no untranslated literal JSX text nodes', () => {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const untranslated: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const visible = node.getText(source).replace(/\s+/g, ' ').trim();
      if (/[\p{L}\p{N}]/u.test(visible)) untranslated.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${visible}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.deepEqual(untranslated, [], 'Wrap new visible Purchases text with purchasesText and add its EN/HE dictionary entry.');
});

test('every purchasesText key has an English and a Hebrew entry', () => {
  const bundle = SCREEN_TRANSLATION_TABLE.find(b => b.screenId === 'purchases')!;
  const keys = [...sourceText.matchAll(/purchasesText\('([^']+)', '([^']+)'\)/g)];
  assert.ok(keys.length >= 25);
  for (const [, key, english] of keys) {
    const entry = bundle.strings.find(s => s.key === key);
    assert.ok(entry, `missing dictionary entry ${key}`);
    assert.equal(entry!.en, english, `${key}: the fallback matches the English entry`);
    assert.match(entry!.he, /[֐-׿]/, `${key} has Hebrew`);
  }
  assert.equal(translateScreenString('purchases', 'col.dueDate', 'he', 'Due Date'), 'תאריך פירעון');
  // a button's accessible name follows its visible label: the Hebrew name contains the Hebrew text
  assert.ok(translateScreenString('purchases', 'aria.spread', 'he', '').includes(translateScreenString('purchases', 'action.spread', 'he', '')));
  assert.ok(translateScreenString('purchases', 'aria.undoSpread', 'he', '').includes(translateScreenString('purchases', 'action.undoSpread', 'he', '')));
  assert.equal(translateScreenString('purchases', 'col.dueDate', 'en', 'Due Date'), 'Due Date');
});
