import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

test('fixture renderer can use a pinned ImageMagick directory instead of an untrusted PATH', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-convert-'));
  try {
    const trusted = path.join(dir, 'trusted');
    const untrusted = path.join(dir, 'untrusted');
    fs.mkdirSync(trusted);
    fs.mkdirSync(untrusted);
    const goodMarker = path.join(dir, 'good');
    const badMarker = path.join(dir, 'bad');
    fs.writeFileSync(path.join(trusted, 'convert'), `#!${process.execPath}\nconst fs = require('node:fs'); fs.appendFileSync(process.env.GOOD_MARKER, 'x'); fs.writeFileSync(process.argv.at(-1).replace(/^PNG8:/, ''), 'fake image');\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(untrusted, 'convert'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.BAD_MARKER, 'ran'); process.exit(99);\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: untrusted, RECEIPT_FIXTURE_CONVERT_DIR: trusted, RECEIPT_FIXTURE_FONT_HE: 'fake-he', RECEIPT_FIXTURE_FONT_LATIN: 'fake-latin', GOOD_MARKER: goodMarker, BAD_MARKER: badMarker };
    const script = fileURLToPath(new URL('./receipt-fixtures.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--check'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr); // the fake image intentionally differs from committed PNGs
    assert.match(result.stdout, /DRIFT/);
    assert.equal(fs.readFileSync(goodMarker, 'utf8').length, 20);
    assert.equal(fs.existsSync(badMarker), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
