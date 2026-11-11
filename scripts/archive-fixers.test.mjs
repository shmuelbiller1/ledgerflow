import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const archive = fileURLToPath(new URL('../docs/archive/one-off-fixers/', import.meta.url));
function tempFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archived-fixers-'));
  const write = (file, contents) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    return target;
  };
  try { fn({ dir, write }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function run(dir, script, env = process.env) {
  return spawnSync(process.execPath, [path.join(archive, script)], { cwd: dir, env, encoding: 'utf8' });
}

test('archived TSX fixers enumerate real files without following symlinks or executing find', () => {
  for (const [script, original, expected] of [
    ['fix_aria.cjs', '<button className="x"><Trash2 /></button>', 'aria-label="Delete"'],
    ['fix_aria2.cjs', '<button><Trash2 /></button>', 'aria-label="Delete"'],
    ['fix_div_onclick.cjs', '<div onClick={go}>click</div>', 'role="button"'],
    ['fix_form_buttons.cjs', '<form><button>ok</button></form>', 'type="button"'],
  ]) tempFixture(({ dir, write }) => {
    const target = write('src/nested/file with spaces.tsx', original);
    const outside = write('outside.tsx', original);
    fs.symlinkSync(outside, path.join(dir, 'src/link.tsx'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'find'), '#!/bin/sh\ntouch "$MARKER"\nexit 99\n', { mode: 0o755 });
    const marker = path.join(dir, 'marker');
    const result = run(dir, script, { ...process.env, PATH: bin, MARKER: marker });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    assert.ok(fs.readFileSync(target, 'utf8').includes(expected), script);
    assert.equal(fs.readFileSync(outside, 'utf8'), original);
    assert.equal(fs.existsSync(marker), false);
  });
});

test('archived import fixer searches text locally, skips binary and does not execute grep', () => tempFixture(({ dir, write }) => {
  const source = write('src/nested/fixture.ts', 'const x = formatDecimal(10);\n');
  const binary = write('src/binary.dat', Buffer.from('\0formatDecimal(10)'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'grep'), '#!/bin/sh\ntouch "$MARKER"\nexit 99\n', { mode: 0o755 });
  const marker = path.join(dir, 'marker');
  const result = run(dir, 'fix_imports2.cjs', { ...process.env, PATH: bin, MARKER: marker });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(source, 'utf8'), /import \{ formatDecimal \}/);
  assert.deepEqual(fs.readFileSync(binary), Buffer.from('\0formatDecimal(10)'));
  assert.equal(fs.existsSync(marker), false);
}));

test('archived ESLint fixer requires and runs only the checkout-local executable', () => tempFixture(({ dir, write }) => {
  const blueprint = write('src/components/platform/settings/BlueprintSettings.tsx', 'setMappings(currentWorkspace.defaultAccountMappings || {});');
  write('src/components/sales/PublicInvoicePage.tsx', "setError('Invalid invoice link');");
  write('src/hooks/useAuditTelemetry.ts', 'const u = 1 - Math.random();\nconst v = 1 - Math.random();');
  const missing = run(dir, 'fix_eslint.cjs', { ...process.env, PATH: '' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Install the locked dependencies/);
  assert.equal(fs.readFileSync(blueprint, 'utf8'), 'setMappings(currentWorkspace.defaultAccountMappings || {});');
  write('node_modules/eslint/bin/eslint.js', "require('node:fs').writeFileSync('local-eslint-ran', process.argv.slice(2).join(' ')); process.exit(2);");
  const result = run(dir, 'fix_eslint.cjs', { ...process.env, PATH: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'local-eslint-ran'), 'utf8'), 'src/ --fix');
  assert.match(fs.readFileSync(blueprint, 'utf8'), /setTimeout/);
}));

test('file discovery preserves deterministic code-unit ordering across mixed file names', () => tempFixture(({ dir, write }) => {
  write('src/2.tsx', '');
  write('src/10.tsx', '');
  write('src/a.tsx', '');
  write('src/Z.tsx', '');
  write('src/é.tsx', '');
  const discovery = path.join(archive, 'file-discovery.cjs');
  const result = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(discovery)}).regularFiles('src')))`], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['src/10.tsx', 'src/2.tsx', 'src/Z.tsx', 'src/a.tsx', 'src/é.tsx']);
}));
