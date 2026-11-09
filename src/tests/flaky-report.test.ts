/** F-32 — a flaky-test detector reports; it never hides a failure. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns, flakyReportText, fromPlaywrightJson, type RunResult } from '../lib/flakyReport';

const run = (...results: Array<[string, RunResult['status']]>): RunResult[] =>
  results.map(([title, status]) => ({ title, status }));

describe('F-32 flaky test detector', () => {
  test('a test that passed twice and failed once is flaky, and says which run', () => {
    const report = compareRuns([
      run(['invoice posts', 'passed'], ['bill posts', 'passed']),
      run(['invoice posts', 'passed'], ['bill posts', 'failed']),
      run(['invoice posts', 'passed'], ['bill posts', 'passed']),
    ]);
    assert.deepEqual(report.flaky, [{ title: 'bill posts', outcomes: ['passed', 'failed', 'passed'] }]);
    assert.deepEqual(report.broken, []);
    assert.equal(report.consistent, 1);
    assert.equal(report.clean, false);
  });

  test('a test that failed every run is broken, not flaky', () => {
    const report = compareRuns([run(['close month', 'failed']), run(['close month', 'timedOut']), run(['close month', 'failed'])]);
    assert.deepEqual(report.flaky, []);
    assert.deepEqual(report.broken, [{ title: 'close month', outcomes: ['failed', 'timedOut', 'failed'] }]);
    assert.equal(report.clean, false);
  });

  test('a test missing from a run did not pass there: it counts as interrupted', () => {
    const report = compareRuns([run(['a', 'passed'], ['b', 'passed']), run(['b', 'passed'])]);
    assert.deepEqual(report.flaky, [{ title: 'a', outcomes: ['passed', 'interrupted'] }]);
  });

  test('three identical runs are clean, and one run cannot be called flaky', () => {
    const same = [run(['a', 'passed'], ['b', 'passed']), run(['a', 'passed'], ['b', 'passed']), run(['a', 'passed'], ['b', 'passed'])];
    assert.equal(compareRuns(same).clean, true);
    assert.equal(compareRuns(same).consistent, 2);
    assert.equal(compareRuns([run(['a', 'failed'])]).broken.length, 1);
  });

  test('the screenshot baseline is not confused with a flaky test', () => {
    // a skipped run stays skipped; it is not reported as failing
    const report = compareRuns([run(['visual: overview', 'skipped']), run(['visual: overview', 'skipped'])]);
    assert.equal(report.clean, true);
    assert.equal(report.consistent, 1);
  });

  test('a Playwright JSON report reduces to one result per test with its file and suite', () => {
    const json = {
      suites: [{
        title: 'journeys.spec.ts', file: 'e2e/journeys.spec.ts', suites: [{
          title: 'W2', specs: [{
            title: 'invoice → payment → statement',
            tests: [{ results: [{ status: 'passed' }] }],
          }, {
            title: 'retry test',
            tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }],
          }],
        }],
      }],
    };
    const results = fromPlaywrightJson(json);
    assert.deepEqual(results, [
      { title: 'journeys.spec.ts › W2 › invoice → payment → statement', status: 'passed' },
      { title: 'journeys.spec.ts › W2 › retry test', status: 'failed' },
    ]);
  });

  test('the text report says plainly what a person must look at', () => {
    const text = flakyReportText(compareRuns([run(['a', 'passed'], ['b', 'passed']), run(['a', 'failed'], ['b', 'failed'])]));
    assert.match(text, /2 flaky, 0 broken, 0 consistent/);
    assert.match(text, /Flaky \(differed between runs\):/);
    assert.match(text, /- a \[passed \/ failed\]/);
    assert.equal(flakyReportText(compareRuns([run(['a', 'passed']), run(['a', 'passed'])])).includes('Nothing flaky or broken'), true);
  });
});
