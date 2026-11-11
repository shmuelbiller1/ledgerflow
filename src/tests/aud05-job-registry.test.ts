/**
 * AUD-05: every background job is listed once (src/server/jobs/jobRegistry.ts), and Vercel and a
 * standalone server run that one list the same way.
 *
 * Hand-worked inventory, as found before the change (main, 22 Oct):
 *
 *   job                 | Vercel: GET /api/cron/daily, "10 6 * * *" | standalone (`npm start`, serveApp.ts)
 *   --------------------+--------------------------------------------+------------------------------------
 *   maintenance         | daily 06:10 UTC                            | setInterval 24 h from boot
 *   recurring           | daily 06:10 UTC                            | once at boot only
 *   errorDigest         | daily 06:10 UTC                            | setInterval 24 h from listen
 *   notifications       | daily 06:10 UTC                            | never
 *   reminders           | daily 06:10 UTC                            | never
 *   statements          | daily 06:10 UTC                            | never
 *   scheduledReports    | daily 06:10 UTC                            | never
 *   ledgerHealth        | daily 06:10 UTC                            | never
 *   bookAlerts          | daily 06:10 UTC                            | never
 *   assetReminders      | daily 06:10 UTC                            | never
 *   watches             | daily 06:10 UTC                            | never
 *   notificationDigest  | daily 06:10 UTC                            | never
 *   retention           | daily 06:10 UTC                            | never
 *
 *   The standalone timers wrote no jobRuns/daily_latest record either, so Settings → Schedule and the
 *   status page said nothing ran. By hand, on both: POST /api/v1/system/recurring/process (recurring)
 *   and POST /api/v1/system/telemetry/errors/digest (errorDigest), admin or CRON_SECRET.
 *
 * After: all 13, in that order, daily at 06:10 UTC through runCron('daily') on both — Vercel Cron
 * calling /api/cron/daily, the standalone timer (jobs/standaloneScheduler.ts) calling it directly
 * after claiming the run in the database. The one difference left is deliberate and recorded in the
 * registry: a standalone server also makes recurring drafts once at start-up. The two by-hand admin
 * routes stay.
 */
import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { BACKGROUND_JOBS, CRON_SCHEDULES, jobsFor, runCron, type BackgroundJob } from '../server/jobs/jobRegistry';
import { claimRun, nextRunAfter, startStandaloneScheduler } from '../server/jobs/standaloneScheduler';
import { isJobScheduleConfigured, isStandaloneSchedulerRunning, markStandaloneScheduler } from '../server/jobs/schedulerState';
import { cronRouter, CRON_MOUNT } from '../server/routes/cronRoutes';
import type { Firestore } from '../server/db/firestore';

const root = path.resolve(import.meta.dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** the inventory above, as data: id, schedule, and where it is triggered */
const HAND_WORKED = [
  'maintenance', 'recurring', 'errorDigest', 'notifications', 'reminders', 'statements', 'scheduledReports',
  'ledgerHealth', 'bookAlerts', 'assetReminders', 'watches', 'notificationDigest', 'retention',
].map(id => ({ id, cron: 'daily', path: `/api/cron/daily`, schedule: '10 6 * * *', standaloneBoot: id === 'recurring' }));

/** every server-side source file: server.ts, api/, src/server/ (no tests) */
function serverFiles(): string[] {
  const out: string[] = ['server.ts'];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|mjs|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(rel);
    }
  };
  walk('api');
  walk('src/server');
  return out;
}

describe('the registry is the list', () => {
  test('every job, its schedule and where it is triggered, as worked out by hand', () => {
    const rows = BACKGROUND_JOBS.map(job => {
      const cron = CRON_SCHEDULES.find(c => c.id === job.cron);
      assert.ok(cron, `${job.id}: runs on a schedule that exists (${job.cron})`);
      return { id: job.id, cron: job.cron, path: cron!.path, schedule: cron!.schedule, standaloneBoot: Boolean(job.standaloneBootReason) };
    });
    assert.deepEqual(rows, HAND_WORKED);
    assert.equal(new Set(BACKGROUND_JOBS.map(j => j.id)).size, BACKGROUND_JOBS.length, 'each job is listed once');
  });

  test('a job that runs at standalone start-up says why', () => {
    for (const job of BACKGROUND_JOBS.filter(j => j.standaloneBootReason)) {
      assert.ok(job.standaloneBootReason!.length > 40, `${job.id}: a reason a reader can check`);
    }
  });

  test('vercel.json schedules exactly the registry: same paths, same times', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons?: { path: string; schedule: string }[] };
    const sorted = (list: { path: string; schedule: string }[]) => list.map(c => `${c.path} ${c.schedule}`).sort();
    assert.deepEqual(sorted(vercel.crons || []), sorted(CRON_SCHEDULES.map(c => ({ path: c.path, schedule: c.schedule }))));
  });

  test('the cron route serves exactly the registry paths, and refuses without CRON_SECRET', async () => {
    const routes = (cronRouter.stack as { route?: { path: string; methods: Record<string, boolean> } }[])
      .filter(l => l.route).map(l => `${Object.keys(l.route!.methods).join(',')} ${CRON_MOUNT}${l.route!.path}`);
    assert.deepEqual(routes.sort(), CRON_SCHEDULES.map(c => `get ${c.path}`).sort());

    const app = express();
    app.use(CRON_MOUNT, cronRouter);
    const server = app.listen(0);
    const saved = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const cron of CRON_SCHEDULES) {
        const res = await fetch(`${base}${cron.path}`, { headers: { authorization: 'Bearer ' } });
        assert.equal(res.status, 401, `${cron.path}: no secret set, nothing runs from outside`);
      }
      assert.equal(isJobScheduleConfigured({}), isStandaloneSchedulerRunning(), 'without the secret only a running timer counts as set up');
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
      server.close();
    }
  });
});

describe('no job is started from anywhere else', () => {
  const files = serverFiles();
  const sources = new Map(files.map(f => [f, read(f)]));
  /** the by-hand admin routes; they call the job function directly, on purpose */
  const MANUAL = new Map([['src/server/routes/adminRoutes.ts', ['processAllRecurring', 'processErrorDigest']]]);

  test('every handler-shaped export in the services is a registered job', () => {
    const registered = new Set(BACKGROUND_JOBS.map(j => j.run.name));
    const found: string[] = [];
    for (const [file, src] of sources) {
      if (!file.startsWith('src/server/services/')) continue;
      for (const m of src.matchAll(/export\s+async\s+function\s+(runDaily\w*|processAll\w*|run\w*Jobs|process\w*Digest)\s*\(/g)) found.push(m[1]);
    }
    assert.ok(found.length >= BACKGROUND_JOBS.length, `the services were read (${found.length})`);
    assert.deepEqual(found.filter(name => !registered.has(name)), [], 'a job function that is not in jobRegistry.ts');
    assert.deepEqual([...registered].sort(), [...new Set(found)].sort(), 'each registered run is an exported service function');
  });

  test('a job function is named only by its service, the registry and the by-hand admin routes', () => {
    const misplaced: string[] = [];
    for (const job of BACKGROUND_JOBS) {
      const name = job.run.name;
      for (const [file, src] of sources) {
        if (file === 'src/server/jobs/jobRegistry.ts' || MANUAL.get(file)?.includes(name)) continue;
        if (src.includes(`function ${name}(`)) continue; // its own service
        if (new RegExp(`\\b${name}\\b`).test(src)) misplaced.push(`${name} in ${file}`);
      }
    }
    assert.deepEqual(misplaced, []);
  });

  test('no repeating timer, and only the scheduler and the cron route run the registry', () => {
    const calls = (re: RegExp) => [...sources].filter(([, src]) => re.test(src)).map(([f]) => f).sort();
    assert.deepEqual(calls(/\bsetInterval\s*\(/), [], 'a repeating timer outside the registry');
    assert.deepEqual(calls(/\brunCron\s*\(/), ['src/server/jobs/jobRegistry.ts', 'src/server/jobs/standaloneScheduler.ts', 'src/server/routes/cronRoutes.ts']);
    assert.deepEqual(calls(/\bstartStandaloneScheduler\s*\(/), ['src/server/http/serveApp.ts', 'src/server/jobs/standaloneScheduler.ts']);
    // one-off timeouts, each for its own reason; a new one is a question for the registry first
    assert.deepEqual(calls(/\bsetTimeout\s*\(/), [
      'src/server/db/pgFirestore.ts', // retry back-off
      'src/server/http/serveApp.ts', // port retry and shutdown deadline
      'src/server/jobs/standaloneScheduler.ts', // the registry's timer
      'src/server/routes/metricsAuditRoutes.ts', // simulated wait
      'src/server/services/FxService.ts', // #629: one-shot deadline for stalled rate service, not a recurring job
      'src/server/utils/safeFetch.ts', // request time-out
    ]);
  });
});

describe('the standalone timer', () => {
  after(() => markStandaloneScheduler(false));

  const fakeClock = (start: string) => {
    let now = new Date(start);
    const timers: { fn: () => void; at: number }[] = [];
    return {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => { timers.push({ fn, at: now.getTime() + ms }); },
      timers,
      /** moves the clock to the earliest timer and fires it */
      fireNext: async () => {
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift()!;
        now = new Date(next.at);
        next.fn();
        for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
      },
    };
  };

  test('the next run: today if the time has not come, otherwise tomorrow; anything but daily is refused', () => {
    assert.equal(nextRunAfter('10 6 * * *', new Date('2026-10-22T03:00:00Z')).toISOString(), '2026-10-22T06:10:00.000Z');
    assert.equal(nextRunAfter('10 6 * * *', new Date('2026-10-22T06:10:00Z')).toISOString(), '2026-10-23T06:10:00.000Z');
    assert.equal(nextRunAfter('10 6 * * *', new Date('2026-12-31T23:00:00Z')).toISOString(), '2027-01-01T06:10:00.000Z');
    assert.throws(() => nextRunAfter('*/5 * * * *', new Date()), /only daily/);
    assert.throws(() => nextRunAfter('0 6 * * 1', new Date()), /only daily/);
  });

  test('schedules exactly the registry entries, and a day later every promised job has run once', async () => {
    const clock = fakeClock('2026-10-22T09:00:00Z');
    const ran: string[] = [];
    const booted: string[] = [];
    const claims: string[] = [];
    const written: Record<string, unknown>[] = [];
    const db = { collection: () => ({ doc: () => ({ set: async (row: Record<string, unknown>) => { written.push(row); } }) }) } as unknown as Firestore;
    const stub = (cronId: string): BackgroundJob[] => jobsFor(cronId).map(j => ({ ...j, run: async () => { ran.push(j.id); } }));

    const scheduled = startStandaloneScheduler({
      now: clock.now, setTimer: clock.setTimer,
      claim: async (id, dueAt) => { claims.push(`${id} ${dueAt.toISOString()}`); return true; },
      run: id => runCron(id, { db, jobs: stub(id) }),
      runAtBoot: async id => { booted.push(id); },
    }, {});
    assert.deepEqual(scheduled.map(s => `${s.id} ${s.path} ${s.schedule}`), CRON_SCHEDULES.map(c => `${c.id} ${c.path} ${c.schedule}`));
    assert.deepEqual(scheduled.map(s => s.nextRunAt), ['2026-10-23T06:10:00.000Z']);
    assert.equal(clock.timers.length, CRON_SCHEDULES.length, 'one timer per schedule');
    assert.deepEqual(booted, BACKGROUND_JOBS.filter(j => j.standaloneBootReason).map(j => j.id), 'the start-up pass is the registry\'s');
    assert.ok(isStandaloneSchedulerRunning() && isJobScheduleConfigured({}), 'the status page counts the timer as set up');

    await clock.fireNext();
    assert.deepEqual(claims, ['daily 2026-10-23T06:10:00.000Z']);
    assert.deepEqual(ran, BACKGROUND_JOBS.map(j => j.id), 'every promised job, in order, once');
    assert.equal(written.length, 1, 'the run left its record for Settings → Schedule');
    assert.deepEqual(written[0].results, Object.fromEntries(BACKGROUND_JOBS.map(j => [j.id, 'ok'])));
    assert.equal(clock.timers.length, 1, 'and it armed itself again');
    assert.equal(new Date(clock.timers[0].at).toISOString(), '2026-10-24T06:10:00.000Z', 'for the next day');
  });

  test('a run another server claimed is skipped, and the timer still goes on', async () => {
    const clock = fakeClock('2026-10-22T09:00:00Z');
    let runs = 0;
    startStandaloneScheduler({ now: clock.now, setTimer: clock.setTimer, claim: async () => false, run: async () => { runs++; }, runAtBoot: async () => undefined }, {});
    await clock.fireNext();
    assert.equal(runs, 0);
    assert.equal(clock.timers.length, 1);
  });

  test('LF_STANDALONE_JOBS=off: nothing is scheduled, and the status page is not told otherwise', () => {
    const clock = fakeClock('2026-10-22T09:00:00Z');
    const scheduled = startStandaloneScheduler({ now: clock.now, setTimer: clock.setTimer, runAtBoot: async () => assert.fail('no start-up pass') }, { LF_STANDALONE_JOBS: 'off' });
    assert.deepEqual(scheduled, []);
    assert.equal(clock.timers.length, 0);
    assert.equal(isJobScheduleConfigured({}), false);
    assert.equal(isJobScheduleConfigured({ CRON_SECRET: 'x' }), true);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('the claim (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  let db: Firestore | undefined;
  const cronId = `test_${crypto.randomBytes(4).toString('hex')}`;
  const dueAt = new Date('2099-01-01T06:10:00Z');

  after(async () => {
    if (!db) return;
    await db.collection('jobRuns').doc(`claim_${cronId}_${dueAt.toISOString()}`).delete();
    await db.terminate();
  });

  test('two servers claiming the same run at once: exactly one gets it', async () => {
    process.env.DATABASE_URL = url;
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    const answers = await Promise.all([claimRun(cronId, dueAt), claimRun(cronId, dueAt), claimRun(cronId, dueAt)]);
    assert.deepEqual(answers.filter(Boolean).length, 1, `one claim wins (${answers.join(', ')})`);
    assert.equal(await claimRun(cronId, dueAt), false, 'and a later one does not');
  });
});
