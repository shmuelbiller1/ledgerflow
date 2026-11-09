import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../archive/test-llama-wait.sh', import.meta.url));

test('historical llama probe neither installs nor writes when dependency is missing', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'llama-probe-'));
  try {
    const result = spawnSync('sh', [script], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /locally installed llamaindex/);
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('historical llama probe inspects a locally installed reader', () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'llama-probe-'));
  try {
    const pkg = path.join(cwd, 'node_modules', 'llamaindex');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'llamaindex', main: 'index.cjs' }));
    writeFileSync(path.join(pkg, 'index.cjs'), 'exports.LlamaParseReader = class LlamaParseReader { read() {} };');
    const result = spawnSync('sh', [script], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LlamaParseReader/);
    assert.match(result.stdout, /read/);
    assert.deepEqual(readdirSync(cwd), ['node_modules']);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
