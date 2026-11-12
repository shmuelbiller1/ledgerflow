import './helpers/dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUiLanguage } from '../lib/i18n/uiLanguage';
import { auditScreenTranslations, SCREEN_TRANSLATION_TABLE, translateScreenString } from '../lib/i18n/screenTranslations';
import { useUIStore } from '../stores/useUIStore';

test('UI language updates document language and direction for Hebrew and English', () => {
  const root = { dir: 'ltr', lang: 'en' };
  applyUiLanguage('he', root);
  assert.deepEqual(root, { dir: 'rtl', lang: 'he' });
  applyUiLanguage('en', root);
  assert.deepEqual(root, { dir: 'ltr', lang: 'en' });
});

test('Sales primary screen translations have no blank Hebrew entries', () => {
  const sales = SCREEN_TRANSLATION_TABLE.find(bundle => bundle.screenId === 'sales');
  assert.ok(sales);
  assert.ok(sales.strings.length >= 13);
  assert.ok(sales.strings.every(entry => entry.en.trim() && entry.he.trim()));
  assert.equal(auditScreenTranslations([sales])[0].coveragePercent, 100);
  assert.equal(translateScreenString('sales', 'tab.invoices', 'he'), 'חשבוניות');
  assert.equal(translateScreenString('sales', 'tab.invoices', 'en'), 'Invoices');
});

test('language choice persists as a display preference and can be changed back', () => {
  useUIStore.getState().setLanguage('he');
  assert.equal(useUIStore.getState().language, 'he');
  assert.equal(localStorage.getItem('lf_language'), 'he');
  useUIStore.getState().setLanguage('en');
  assert.equal(useUIStore.getState().language, 'en');
  assert.equal(localStorage.getItem('lf_language'), 'en');
});
