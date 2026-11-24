/**
 * Settings → Schedule (BB-06), the tab itself: it asks once, shows what the last run did job by job,
 * says when the next one is due, and reads like the sentences the rules produce rather than like a
 * status code. The payload is built by `describeSchedule` itself, so what the screen shows is what the
 * rules say — a screen that quietly re-worded them would fail here.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ScheduleSettings from '../components/platform/settings/ScheduleSettings';
import { DAILY_JOBS, describeSchedule } from '../lib/jobSchedule';
import { stubFetchWithBodies } from './helpers/dom';
import { setComponentWorkspace } from './helpers/componentFixtures';

const results = Object.fromEntries(DAILY_JOBS.map(j => [j.id, 'ok']));
const okRun = { finishedAt: '2026-10-05T06:11:00Z', status: 'ok', failedJobs: [] as string[], results };

/** the answer the route would give, from the same rules */
const payload = (run: unknown, cronConfigured = true, now = '2026-10-05T07:30:00Z') =>
  ({ status: 'ok', schedule: describeSchedule({ run: run as never, cronConfigured, now: new Date(now) }) });

/** the little word each job's row carries next to its name */
const chips = () => Array.from(document.querySelectorAll('li span')).map(spot => spot.textContent || '');

describe('the schedule tab', () => {
  beforeEach(() => { setComponentWorkspace('owner'); });
  afterEach(() => { cleanup(); });

  test('the last run, job by job, and when the next one is due', async () => {
    const calls = stubFetchWithBodies(200, payload(okRun));
    render(<ScheduleSettings />);
    assert.ok(screen.getByRole('status').textContent?.includes('Reading'), 'it says it is reading, rather than showing an empty panel');
    await waitFor(() => assert.ok(calls.some(c => c.url === '/api/v1/schedule' && c.method === 'GET'), 'asked once, through the API'));
    assert.equal(calls.length, 1, 'one question, no polling');
    assert.match(document.body.textContent || '', /The daily run is doing its work/);
    assert.match(document.body.textContent || '', /Last ran 1 hour ago \(2026-10-05 at 06:11\)/);
    assert.match(document.body.textContent || '', /Next run due 2026-10-06 at 06:10 UTC/, 'it is past today\'s minute, so the next one is tomorrow');
    for (const job of DAILY_JOBS) {
      assert.ok(document.body.textContent?.includes(job.what), `${job.id}: what it is for is on the screen`);
    }
    assert.equal(document.body.querySelectorAll('li').length, DAILY_JOBS.length, 'every job is listed');
    assert.deepEqual(chips(), DAILY_JOBS.map(() => 'ran'), 'each one answers for itself, and nothing is blamed');
  });

  test('a job that went wrong is named, with the words it said', async () => {
    stubFetchWithBodies(200, payload({
      ...okRun, status: 'failed', failedJobs: ['reminders'],
      results: { ...results, reminders: 'failed: the mail service refused every address' },
    }));
    render(<ScheduleSettings />);
    await waitFor(() => assert.ok(document.body.textContent?.includes('had problems')));
    assert.match(document.body.textContent || '', /had problems: Invoice reminders\./);
    assert.ok(document.body.textContent?.includes('the mail service refused every address'), 'the reason is shown, not only the fact');
    assert.deepEqual(chips().filter(c => c === 'went wrong').length, 1, 'one row says it went wrong');
    assert.equal(chips().filter(c => c === 'ran').length, DAILY_JOBS.length - 1, 'and its neighbours are not blamed for it');
  });

  test('nothing set up to run it: the screen says what is missing and where it is set', async () => {
    stubFetchWithBodies(200, payload(null, false));
    render(<ScheduleSettings />);
    await waitFor(() => assert.ok(document.body.textContent?.includes('Nothing runs on its own yet')));
    assert.ok(document.body.textContent?.includes('vercel.json'), 'whoever runs the installation is told where');
    assert.ok(document.body.textContent?.includes('No run recorded yet'));
  });

  test('a run that did not say what it did is not read as all clear', async () => {
    stubFetchWithBodies(200, payload({ finishedAt: '2026-10-05T06:11:00Z', status: 'ok', failedJobs: [] }));
    render(<ScheduleSettings />);
    await waitFor(() => assert.ok(document.body.textContent?.includes('not reported')));
    assert.ok(document.body.textContent?.includes('This run did not say what it did'));
  });

  test('malformed success responses are reported as unreadable, not rendered as a healthy schedule', async () => {
    const valid = payload(okRun).schedule;
    for (const schedule of [null, {}, { ...valid, nextRunAt: null }, { ...valid, jobs: null },
      { ...valid, jobs: [{ ...valid.jobs[0], outcome: 'unexpected' }] },
      { ...valid, jobs: [{ ...valid.jobs[0], name: {} }] },
      { ...valid, jobs: [valid.jobs[0], valid.jobs[0]] }]) {
      stubFetchWithBodies(200, { status: 'ok', schedule });
      render(<ScheduleSettings />);
      await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /could not be read/i));
      assert.equal(document.querySelectorAll('li').length, 0);
      cleanup();
    }
  });

  test('a schedule that cannot be read is said plainly, and the jobs are not called a failure', async () => {
    stubFetchWithBodies(500, { status: 'error', message: 'The schedule could not be read. The jobs may still have run — the record of them is what is missing.' });
    render(<ScheduleSettings />);
    await waitFor(() => assert.ok(screen.getByRole('alert')));
    const alert = screen.getByRole('alert').textContent || '';
    assert.match(alert, /record of them is what is missing/i);
    assert.ok(!document.body.textContent?.includes('did its work'), 'no reassurance is invented');
  });
});
