import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import LiveReporter from './playwright-live-reporter.mjs';
import { longRunningAnnotations, readLive } from './watch-hung-tests.mjs';

const root = process.cwd();
function fixture() {
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  return fs.mkdtempSync(path.join(root, 'test-results', 'live-reporter-test-'));
}

const blobDirectory = dir => path.join(dir, 'playwright-reports', 'blob-report');
const readBlobDiagnostics = dir => spawnSync(process.execPath, [path.join(root, 'scripts', 'unfinished-suites.mjs')], {
  cwd: dir, encoding: 'utf8', timeout: 30_000,
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(dir, 'unexpected-merge-output.json') },
});

function runBlobFixture(dir, reporter, extraEnv = {}) {
  const env = {
    ...process.env, ...extraEnv,
    PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDirectory(dir),
    PLAYWRIGHT_BLOB_OUTPUT_NAME: 'fixture.zip',
    PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(dir, 'final.json'),
  };
  delete env.PLAYWRIGHT_BLOB_OUTPUT_FILE;
  const result = spawnSync(process.execPath, [
    'node_modules/playwright/cli.js', 'test', '--config', path.join(dir, 'playwright.config.js'), '--reporter', reporter,
  ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
  assert.ok(fs.existsSync(path.join(blobDirectory(dir), 'fixture.zip')), `Playwright did not create the fixture blob:\n${result.stdout}\n${result.stderr}`);
  return result;
}

test('live reporter records a running test and clears it at completion', () => {
  const dir = fixture(), old = process.env.WATCH_REPORT;
  process.env.WATCH_REPORT = path.join(dir, 'live.json');
  try {
    const reporter = new LiveReporter();
    const item = { id: 'id-1', titlePath: () => ['suite', 'case'], location: { file: '/repo/e2e/test.spec.ts' } };
    reporter.onBegin();
    assert.deepEqual(readLive(process.env.WATCH_REPORT).active, []);
    reporter.onTestBegin(item);
    const active = readLive(process.env.WATCH_REPORT).active;
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'id-1');
    assert.equal(active[0].title, 'suite › case');
    assert.equal(typeof active[0].startedAt, 'number');
    reporter.onTestEnd(item);
    assert.deepEqual(readLive(process.env.WATCH_REPORT).active, []);
  } finally {
    if (old === undefined) delete process.env.WATCH_REPORT; else process.env.WATCH_REPORT = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('watcher reports each long attempt once, escapes annotation text, and rejects external paths', () => {
  const announced = new Set();
  const report = { active: [{ id: '1', title: 'bad\n::error::% text', file: '/repo/e2e/a,b.spec.ts', startedAt: 0 }] };
  assert.deepEqual(longRunningAnnotations(report, 479_000, 480_000, announced, '/repo'), []);
  const expected = ['::error file=e2e/a%2Cb.spec.ts,title=Long-running browser test::bad%0A::error::%25 text has been running for 8 minutes'];
  assert.deepEqual(longRunningAnnotations(report, 480_000, 480_000, announced, '/repo'), expected);
  assert.deepEqual(longRunningAnnotations(report, 600_000, 480_000, announced, '/repo'), []);
  report.active[0].startedAt = 1;
  report.active[0].file = '/outside/file';
  assert.match(longRunningAnnotations(report, 480_001, 480_000, announced, '/repo')[0], /^::error title=/);
});

test('watcher stays alive and prints a live annotation until explicitly stopped', async () => {
  const dir = fixture(), file = path.join(dir, 'live.json');
  fs.writeFileSync(file, JSON.stringify({ active: [{ id: '1', title: 'live test', file: 'e2e/example.spec.ts', startedAt: Date.now() - 120_000 }] }));
  const child = spawn(process.execPath, ['scripts/watch-hung-tests.mjs'], {
    cwd: root, env: { ...process.env, WATCH_REPORT: file, WATCH_INTERVAL_MS: '20', WATCH_LIMIT_MINUTES: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('watcher did not emit an annotation')), 5000);
      child.stdout.once('data', data => { clearTimeout(timer); resolve(String(data)); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`watcher exited early: ${code}`)); });
    });
    assert.match(message, /live test has been running/);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Playwright loads the reporter and exposes the current test before onEnd', () => {
  const dir = fixture(), report = path.join(dir, 'live.json');
  try {
    fs.writeFileSync(path.join(dir, 'playwright.config.js'), `export default { testDir: ${JSON.stringify(dir)}, outputDir: ${JSON.stringify(path.join(dir, 'output'))}, workers: 1 };`);
    fs.writeFileSync(path.join(dir, 'live.spec.js'), `import { test, expect } from '@playwright/test';\nimport fs from 'node:fs';\ntest('sees live state', async () => { await expect.poll(() => { try { const report = JSON.parse(fs.readFileSync(process.env.WATCH_REPORT, 'utf8')); return report.active.map(x => x.title).join(' '); } catch { return ''; } }, { timeout: 5000 }).toContain('sees live state'); });`);
    const result = runBlobFixture(dir, 'list,json,blob,./scripts/playwright-live-reporter.mjs', { WATCH_REPORT: report });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(readLive(report).active, []);
    assert.equal(readLive(path.join(dir, 'final.json')).suites.length, 1);
    const diagnostics = readBlobDiagnostics(dir);
    assert.equal(diagnostics.status, 0, diagnostics.stderr);
    assert.match(diagnostics.stdout, /No unfinished tests recorded in 1 reported spec file/);
    assert.doesNotMatch(diagnostics.stdout, /::(?:error|warning)::/);
    assert.equal(fs.existsSync(path.join(dir, 'unexpected-merge-output.json')), false);
    assert.deepEqual(fs.readdirSync(blobDirectory(dir)).filter(name => name.startsWith('.diagnostic-')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('blob diagnostics distinguish a finished failure from a spec with no recorded completion', () => {
  const dir = fixture();
  try {
    const config = path.join(dir, 'playwright.config.js');
    fs.writeFileSync(config, `export default { testDir: ${JSON.stringify(dir)}, outputDir: ${JSON.stringify(path.join(dir, 'output'))}, workers: 1, maxFailures: 1 };`);
    fs.writeFileSync(path.join(dir, 'a-finished.spec.js'), `import {test, expect} from '@playwright/test';
      test('fails', () => expect(2).toBe(1));`);
    fs.writeFileSync(path.join(dir, 'b-unstarted.spec.js'), `import {test} from '@playwright/test';
      test('not reached', () => { throw new Error('should not run after maxFailures'); });`);
    fs.writeFileSync(path.join(dir, 'c-expected-skip.spec.js'), `import {test} from '@playwright/test';
      test.skip('intentionally skipped', () => {});`);
    const result = runBlobFixture(dir, 'blob');
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const diagnostics = readBlobDiagnostics(dir);
    assert.equal(diagnostics.status, 0, diagnostics.stderr);
    assert.match(diagnostics.stdout, /completion not recorded::b-unstarted\.spec\.js/);
    assert.doesNotMatch(diagnostics.stdout, /a-finished\.spec\.js|c-expected-skip\.spec\.js/);
    assert.match(diagnostics.stdout, /tests in a shard with no report are unknown/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing or corrupt browser artifacts report unknown without failing the diagnostic job', () => {
  const dir = fixture();
  try {
    const missing = readBlobDiagnostics(dir);
    const blob = blobDirectory(dir);
    fs.mkdirSync(blob, { recursive: true });
    fs.writeFileSync(path.join(blob, 'report.zip'), 'This is not a Playwright blob, even if it mentions e2e/guess.spec.ts');
    for (const diagnostics of [missing, readBlobDiagnostics(dir)]) {
      assert.equal(diagnostics.status, 0, diagnostics.stderr);
      assert.match(diagnostics.stdout, /unfinished tests are unknown/);
      assert.doesNotMatch(diagnostics.stdout, /guess\.spec\.ts|No unfinished tests recorded/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
