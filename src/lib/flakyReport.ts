/**
 * F-32 — a flaky-test detector that reports, and never re-runs to hide a failure.
 *
 * The browser suite runs three times on a schedule. This module compares the runs by test
 * title and says plainly which tests differed — a test that passed twice and failed once is
 * flaky, a test that failed every time is broken. It does not delete a test, change an
 * assertion or call a flaky test "passed": the report is a list of names for a person.
 *
 * Input is the summary Playwright already writes (`--reporter=json`), reduced to
 * `{ title, status }` pairs by the caller or by `fromPlaywrightJson`.
 */

export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export interface RunResult {
  title: string;
  status: TestStatus;
}

export interface FlakyReport {
  /** tests whose outcome differed between runs, with each run's status */
  flaky: Array<{ title: string; outcomes: TestStatus[] }>;
  /** tests that failed in every run */
  broken: Array<{ title: string; outcomes: TestStatus[] }>;
  /** tests that passed (or were skipped) in every run */
  consistent: number;
  /** true only when there is nothing flaky and nothing broken */
  clean: boolean;
}

const OUTCOME_ORDER: Record<string, number> = { passed: 0, skipped: 1, interrupted: 2, timedOut: 3, failed: 4 };

function normalise(status: unknown): TestStatus {
  const value = String(status || '').toLowerCase();
  if (value === 'passed' || value === 'expected') return 'passed';
  if (value === 'skipped' || value === 'pending') return 'skipped';
  if (value === 'timedout' || value === 'timedout ') return 'timedOut';
  if (value === 'interrupted') return 'interrupted';
  return 'failed';
}

/** Compare the same tests across runs. One run cannot be flaky; it is reported as consistent. */
export function compareRuns(runs: RunResult[][]): FlakyReport {
  const titles = new Set<string>();
  for (const run of runs) for (const result of run) titles.add(result.title);

  const flaky: FlakyReport['flaky'] = [];
  const broken: FlakyReport['broken'] = [];
  let consistent = 0;

  for (const title of titles) {
    const outcomes = runs.map(run => {
      const found = run.find(result => result.title === title);
      // a test missing from a run did not finish: that is an interrupted outcome, not a pass
      return found ? normalise(found.status) : 'interrupted';
    });
    const distinct = new Set(outcomes);
    if (distinct.size === 1) {
      consistent += 1;
      if (outcomes[0] === 'failed' || outcomes[0] === 'timedOut') broken.push({ title, outcomes });
    } else if (outcomes.every(status => status === 'failed' || status === 'timedOut')) {
      broken.push({ title, outcomes });
    } else {
      flaky.push({ title, outcomes });
    }
  }

  const byWorst = (a: { title: string; outcomes: TestStatus[] }, b: { title: string; outcomes: TestStatus[] }) =>
    (OUTCOME_ORDER[b.outcomes[b.outcomes.length - 1]] ?? 0) - (OUTCOME_ORDER[a.outcomes[a.outcomes.length - 1]] ?? 0)
    || a.title.localeCompare(b.title);
  flaky.sort(byWorst);
  broken.sort(byWorst);

  return { flaky, broken, consistent, clean: flaky.length === 0 && broken.length === 0 };
}

/**
 * Reduce a Playwright JSON report (`--reporter=json`) to one result per test, using
 * "file › describe › title" so two tests with the same title in different files stay apart.
 */
export function fromPlaywrightJson(report: unknown): RunResult[] {
  const results: RunResult[] = [];
  type JsonNode = { title?: string; file?: string; specs?: JsonNode[]; tests?: Array<{ results?: Array<{ status?: string }> }>; suites?: JsonNode[]; status?: string };
  const walk = (node: JsonNode, trail: string[]) => {
    const title = node.title || '';
    const nextTrail = title ? [...trail, title] : trail;
    if (node.specs) for (const spec of node.specs) walk(spec, nextTrail);
    if (node.tests) {
      for (const test of node.tests) {
        const statuses = (test.results || []).map(result => result.status);
        const worst = statuses.sort((a, b) => (OUTCOME_ORDER[normalise(b)] ?? 0) - (OUTCOME_ORDER[normalise(a)] ?? 0))[0];
        results.push({ title: nextTrail.join(' › '), status: normalise(worst) });
      }
    }
    if (node.suites) for (const suite of node.suites) walk(suite, nextTrail);
  };
  for (const suite of (report as { suites?: JsonNode[] })?.suites || []) walk(suite, []);
  return results;
}

/** The report a person reads. */
export function flakyReportText(report: FlakyReport): string {
  const lines: string[] = [];
  lines.push(`Flaky-test report: ${report.flaky.length} flaky, ${report.broken.length} broken, ${report.consistent} consistent.`);
  if (report.flaky.length) {
    lines.push('', 'Flaky (differed between runs):');
    for (const test of report.flaky) lines.push(`- ${test.title} [${test.outcomes.join(' / ')}]`);
  }
  if (report.broken.length) {
    lines.push('', 'Broken (failed in every run):');
    for (const test of report.broken) lines.push(`- ${test.title} [${test.outcomes.join(' / ')}]`);
  }
  if (report.clean) lines.push('', 'Nothing flaky or broken in these runs.');
  return `${lines.join('\n')}\n`;
}
