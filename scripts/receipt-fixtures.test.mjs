import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globOne, resolveFonts } from './receipt-fixtures.mjs';

test('font lookup finds nested matches without invoking a shell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-fonts-'));
  try {
    fs.mkdirSync(path.join(dir, 'nested'));
    fs.writeFileSync(path.join(dir, 'nested', 'Hebrew.ttf'), 'font');
    assert.equal(globOne(`${dir}/**/*Hebrew*.ttf`), path.join(dir, 'nested', 'Hebrew.ttf'));
    assert.equal(globOne(`${dir}/**/*Missing*.ttf`), null);
    assert.deepEqual(resolveFonts({ RECEIPT_FIXTURE_FONT_LATIN: 'latin', RECEIPT_FIXTURE_FONT_HE: 'he', RECEIPT_FIXTURE_FONT_MONO: 'mono' }), { latin: 'latin', he: 'he', mono: 'mono' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
