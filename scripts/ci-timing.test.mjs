import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeJobs, formatTiming } from './ci-timing.mjs';

const job = (name, start, end, conclusion = 'success') => ({
  name, status: 'completed', conclusion, created_at: '2026-11-09T16:00:00Z', started_at: start, completed_at: end,
});

test('separates runner wait from execution and orders longest waits first', () => {
  const report = analyzeJobs({ jobs: [
    job('fast', '2026-11-09T16:01:00Z', '2026-11-09T16:05:00Z'),
    job('slow queue', '2026-11-09T16:09:00Z', '2026-11-09T16:11:00Z', 'failure'),
    { name: 'queued', status: 'queued', created_at: '2026-11-09T16:00:00Z', started_at: '2026-11-09T16:00:00Z' },
    job('cancelled', '2026-11-09T16:00:00Z', '2026-11-09T16:20:00Z', 'cancelled'),
  ] });
  assert.deepEqual(report.statuses, { success: 1, failure: 1, queued: 1, cancelled: 1 });
  assert.equal(report.waitP50Seconds, 60);
  assert.equal(report.waitP90Seconds, 540);
  assert.equal(report.measured[0].name, 'slow queue');
  assert.equal(report.measured[0].runSeconds, 120);
  assert.match(formatTiming(report), /slow queue: waited 9\.0m, ran 2\.0m/);
});

test('refuses invalid responses and does not invent durations for malformed times', () => {
  assert.throws(() => analyzeJobs({}), /jobs array/);
  const result = analyzeJobs({ jobs: [job('bad', 'bad date', '2026-11-09T16:02:00Z')] });
  assert.deepEqual(result.measured, []);
  assert.equal(result.waitP50Seconds, null);
  assert.match(formatTiming(result), /median n\/a/);
});

test('CLI reads GitHub job data from stdin and refuses file path arguments', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = new URL('./ci-timing.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script], { input: JSON.stringify({ jobs: [] }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Jobs: 0/);
  const refused = spawnSync(process.execPath, [script, '../../private.json'], { input: '{}', encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Usage:/);
});
