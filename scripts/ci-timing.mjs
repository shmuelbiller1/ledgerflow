#!/usr/bin/env node
/**
 * Diagnose a GitHub Actions run without conflating runner wait with execution time.
 *
 *   gh api 'repos/OWNER/REPO/actions/runs/RUN_ID/jobs?per_page=100' | node scripts/ci-timing.mjs
 *
 * This reads an API response from standard input; it does not change or cancel runs. Job creation can occur
 * after dependencies finish, so this measures job-created-to-start, not total workflow latency.
 * GitHub can populate started_at for jobs that never ran, so cancelled/skipped/queued jobs are
 * not included in the timing percentiles. All timestamps in the API are UTC.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const elapsed = (from, to) => {
  const a = Date.parse(from), b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 1000 : null;
};
const percentile = (numbers, fraction) => {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
};

export function analyzeJobs(response) {
  if (!response || !Array.isArray(response.jobs)) throw new Error('Expected a GitHub jobs response with a jobs array');
  const statuses = {};
  const measured = [];
  for (const job of response.jobs) {
    const status = job.status === 'completed' ? (job.conclusion || 'unknown') : (job.status || 'unknown');
    statuses[status] = (statuses[status] || 0) + 1;
    if (job.status !== 'completed' || ['cancelled', 'skipped'].includes(job.conclusion)) continue;
    const waitSeconds = elapsed(job.created_at, job.started_at);
    const runSeconds = elapsed(job.started_at, job.completed_at);
    if (waitSeconds === null || runSeconds === null) continue;
    measured.push({ name: String(job.name || '(unnamed)'), conclusion: job.conclusion || 'unknown', waitSeconds, runSeconds });
  }
  return {
    total: response.jobs.length, statuses,
    measured: measured.sort((a, b) => b.waitSeconds - a.waitSeconds || a.name.localeCompare(b.name)),
    waitP50Seconds: percentile(measured.map(job => job.waitSeconds), 0.5),
    waitP90Seconds: percentile(measured.map(job => job.waitSeconds), 0.9),
  };
}

const minutes = seconds => seconds === null ? 'n/a' : `${(seconds / 60).toFixed(1)}m`;
export function formatTiming(report) {
  const lines = [
    `Jobs: ${report.total}; ${Object.entries(report.statuses).map(([name, count]) => `${name}: ${count}`).join(', ') || 'none'}`,
    `Measured job queue wait: median ${minutes(report.waitP50Seconds)}, p90 ${minutes(report.waitP90Seconds)} (${report.measured.length} completed, non-cancelled jobs).`,
    'Times are job creation to start, then start to completion; dependencies before job creation are not included.',
    ...report.measured.map(job => `${job.name}: waited ${minutes(job.waitSeconds)}, ran ${minutes(job.runSeconds)} (${job.conclusion})`),
  ];
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: gh api ... | node scripts/ci-timing.mjs');
    console.log(formatTiming(analyzeJobs(JSON.parse(readFileSync(0, 'utf8')))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
