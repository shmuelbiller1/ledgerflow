/** EU-F2: the menu uses plain names (English and Hebrew), and the app title is the brand tagline, not "ERP & Financial Engine". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DICTIONARY } from '../locales/i18n';
import { BRAND } from '../config/brand';

const registry = readFileSync('src/config/registry.tsx', 'utf8');

test('EU-F2: no jargon names in the menu', () => {
  for (const old of ['BQL Query Builder', 'Forensic Anomaly Detection', "'Forensic Audit'", "en: 'Intelligence'", 'AI Co-pilot']) {
    assert.ok(!registry.includes(old), `"${old}" is gone from the registry`);
  }
  for (const plain of ["en: 'Advanced search'", "en: 'Unusual entries'", "en: 'Audit checks'", "en: 'Insights'", "en: 'Ask your books'"]) {
    assert.ok(registry.includes(plain), `"${plain}" is in the registry`);
  }
});

test('EU-F2: the app title is the brand and its tagline, in English and Hebrew', () => {
  assert.equal(DICTIONARY.en['app.title'], `${BRAND.name} — ${BRAND.tagline}`);
  assert.equal(DICTIONARY.he['app.title'], `${BRAND.nameHe} — ${BRAND.taglineHe}`);
  for (const lang of Object.values(DICTIONARY)) assert.ok(!/ERP|Engine|Moteur|Motor/.test(lang['app.title']), lang['app.title']);
});
