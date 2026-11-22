/**
 * S-23: the tightened Content-Security-Policy, report-only first.
 *
 * What this proves:
 * - the enforced policy does not change while the tightened one is only being reported, so no page
 *   can break by deploying this;
 * - the tightened policy really is tighter (no `'unsafe-inline'` script) and still names every
 *   source the app needs, including the inline script index.html ships with, by hash;
 * - each directive appears exactly once — a second `script-src` would be ignored by the browser and
 *   the report-only evidence would be a lie;
 * - the report endpoint takes a browser's report without a sign-in, keeps nothing a report could
 *   use to grow memory or to smuggle a token into the summary, and is not readable without admin.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { applySecurityMiddleware } from '../server/http/securityMiddleware';
import { registerCspReportRoutes } from '../server/routes/cspReportRoutes';
import {
  APP_INLINE_SCRIPT_HASHES, CSP_REPORT_PATH, REPORT_ONLY_HEADER, clientSupabaseUrl, cspRollout,
  helmetDirectives, inlineScriptHashes, staticCspHeaderValue, staticCspRollout,
  staticTightenedCspHeaderValue, tightenedCspDirectives, tightenedCspHeaderValue, vercelCspValue,
  withVercelCsp,
} from '../server/http/contentSecurityPolicy';
import {
  MAX_VIOLATION_GROUPS, blockedSource, cspViolationSummary, documentPath, parseCspReport,
  recordCspViolation, resetCspViolations,
} from '../server/http/cspViolations';

const SUPABASE = ['https://projectref.supabase.co', 'wss://projectref.supabase.co'];
const TIGHTENED = { supabaseSources: SUPABASE, inlineScriptHashes: APP_INLINE_SCRIPT_HASHES };

/** `script-src 'self' …` → ["'self'", …]. */
function directive(policy: string, name: string): string[] | undefined {
  const found = policy.split(';').map(d => d.trim()).filter(d => d === name || d.startsWith(`${name} `));
  assert.ok(found.length <= 1, `${name} appears ${found.length} times in: ${policy}`);
  return found[0]?.split(/\s+/).slice(1);
}

/**
 * Whole-source membership. A CSP source is matched exactly, never as a substring of the directive:
 * "the policy text contains https://cdn.plaid.com" is also true of `https://cdn.plaid.com.evil.test`.
 */
function allows(sources: string[] | undefined, source: string): boolean {
  return (sources ?? []).some(listed => listed === source);
}

/** The env the server reads, restored afterwards. */
async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const keys = [...new Set([...Object.keys(env), 'NODE_ENV', 'CSP_TIGHTEN', 'SUPABASE_URL', 'VITE_SUPABASE_URL'])];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    return await run();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** An app with the real security middleware and the real report routes, on a loopback port. */
async function withServer<T>(run: (origin: string) => Promise<T>): Promise<T> {
  const app = express();
  applySecurityMiddleware(app, () => true);
  registerCspReportRoutes(app);
  app.get('/page', (_req, res) => { res.send('ok'); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** Posts one report body the way a browser does. */
async function postReport(origin: string, body: unknown, contentType = 'application/csp-report'): Promise<number> {
  const res = await fetch(`${origin}${CSP_REPORT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return res.status;
}

const violationBody = (overrides: Record<string, unknown> = {}) => ({
  'csp-report': {
    'document-uri': 'https://ledgerflow.app/invoices',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'blocked-uri': 'https://analytics.example.com/tag.js',
    ...overrides,
  },
});

describe('S-23 the inline scripts the page ships with are named by hash', () => {
  test('APP_INLINE_SCRIPT_HASHES is what index.html actually contains', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
    assert.deepEqual(inlineScriptHashes(html), APP_INLINE_SCRIPT_HASHES,
      'index.html\'s inline script changed: update APP_INLINE_SCRIPT_HASHES in contentSecurityPolicy.ts');
  });

  test('a script with a src has no body to hash, and the same body is listed once', () => {
    const html = '<script src="/a.js"></script><script>x()</script><script >x()</script><script defer src="/b.js"></script>';
    assert.equal(inlineScriptHashes(html).length, 1);
  });

  test('a closing tag with whitespace or attributes still ends the script', () => {
    const plain = inlineScriptHashes('<script>x()</script>');
    assert.equal(plain.length, 1);
    for (const html of ['<script>x()</script >', '<script>x()</script\n foo>', '<script>x()</script\tbar>']) {
      assert.deepEqual(inlineScriptHashes(html), plain, `${JSON.stringify(html)} must hash the same body`);
    }
  });

  test('a different inline script gives a different hash', () => {
    assert.notDeepEqual(inlineScriptHashes('<script>a()</script>'), inlineScriptHashes('<script>b()</script>'));
  });
});

describe('S-23 which stage the rollout is at', () => {
  test('production reports the tightened policy; development leaves it off', () => {
    assert.equal(cspRollout({ NODE_ENV: 'production' }), 'report-only');
    assert.equal(cspRollout({ NODE_ENV: 'development' }), 'off');
    assert.equal(cspRollout({}), 'off');
  });

  test('CSP_TIGHTEN chooses the stage, and anything else is ignored', () => {
    assert.equal(cspRollout({ NODE_ENV: 'development', CSP_TIGHTEN: 'report-only' }), 'report-only');
    assert.equal(cspRollout({ NODE_ENV: 'production', CSP_TIGHTEN: 'ENFORCE' }), 'enforce');
    assert.equal(cspRollout({ NODE_ENV: 'production', CSP_TIGHTEN: 'off' }), 'off');
    assert.equal(cspRollout({ NODE_ENV: 'production', CSP_TIGHTEN: 'yes please' }), 'report-only');
  });
});

describe('S-23 the tightened policy', () => {
  test('script-src drops unsafe-inline and allows the page\'s own inline script by hash', () => {
    const scriptSrc = directive(tightenedCspHeaderValue(TIGHTENED), 'script-src');
    assert.ok(scriptSrc, 'script-src is present');
    assert.ok(!allows(scriptSrc, "'unsafe-inline'"), `unsafe-inline is still allowed: ${scriptSrc.join(' ')}`);
    for (const hash of APP_INLINE_SCRIPT_HASHES) assert.ok(allows(scriptSrc, hash), `${hash} missing`);
    assert.ok(allows(scriptSrc, 'https://cdn.plaid.com'), 'Plaid Link still loads');
  });

  test('style-src keeps unsafe-inline, because React writes style attributes on render', () => {
    assert.ok(allows(directive(tightenedCspHeaderValue(TIGHTENED), 'style-src'), "'unsafe-inline'"));
  });

  test('a posted form cannot be aimed off-site, and plugins and <base> stay shut', () => {
    const policy = tightenedCspHeaderValue(TIGHTENED);
    assert.deepEqual(directive(policy, 'form-action'), ["'self'"]);
    assert.deepEqual(directive(policy, 'object-src'), ["'none'"]);
    assert.deepEqual(directive(policy, 'base-uri'), ["'self'"]);
    assert.deepEqual(directive(policy, 'manifest-src'), ["'self'"]);
  });

  test('connect-src is the configured project only — no wildcard supabase host', () => {
    const connect = directive(tightenedCspHeaderValue(TIGHTENED), 'connect-src') ?? [];
    for (const source of SUPABASE) assert.ok(allows(connect, source), `${source} missing from ${connect.join(' ')}`);
    assert.ok(allows(connect, "'self'") && allows(connect, 'https://*.plaid.com'));
    assert.ok(!connect.some(s => /supabase\.co$/.test(s) && s.includes('*')), 'no wildcard project');
  });

  test('every directive is written once, so the browser cannot ignore a later copy', () => {
    const names = tightenedCspDirectives({ ...TIGHTENED, reportUri: CSP_REPORT_PATH }).map(([name]) => name);
    assert.deepEqual([...new Set(names)], names, `a directive is repeated: ${names.join(', ')}`);
  });

  test('report-uri is added only when there is somewhere to report to', () => {
    assert.equal(directive(tightenedCspHeaderValue(TIGHTENED), 'report-uri'), undefined);
    assert.deepEqual(directive(tightenedCspHeaderValue({ ...TIGHTENED, reportUri: CSP_REPORT_PATH }), 'report-uri'),
      [CSP_REPORT_PATH]);
  });

  test('frame-ancestors follows the caller (the AI Studio proxy embeds the app)', () => {
    assert.deepEqual(directive(tightenedCspHeaderValue({ ...TIGHTENED, frameAncestors: ['*'] }), 'frame-ancestors'), ['*']);
    assert.deepEqual(directive(tightenedCspHeaderValue(TIGHTENED), 'frame-ancestors'), ["'self'"]);
  });

  test('helmet gets the same directives under the names it knows', () => {
    const directives = helmetDirectives(tightenedCspDirectives(TIGHTENED));
    assert.deepEqual(directives.scriptSrc, directive(tightenedCspHeaderValue(TIGHTENED), 'script-src'));
    assert.deepEqual(directives.frameAncestors, ["'self'"]);
    assert.equal(directives['script-src'], undefined);
  });
});

describe('S-23 the policy the statically hosted pages get (vercel.json)', () => {
  const vercel = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as unknown;
  const reportOnlyOf = (config: unknown) => vercelCspValue(config, REPORT_ONLY_HEADER.toLowerCase());

  test('the stage of the static file does not depend on NODE_ENV, or the build would fail its own check', () => {
    assert.equal(staticCspRollout({}), 'report-only');
    assert.equal(staticCspRollout({ NODE_ENV: 'development' }), 'report-only');
    assert.equal(staticCspRollout({ NODE_ENV: 'production' }), 'report-only');
    assert.equal(staticCspRollout({ CSP_TIGHTEN: 'enforce' }), 'enforce');
    assert.equal(staticCspRollout({ CSP_TIGHTEN: 'off' }), 'off');
  });

  test('the committed vercel.json reports the tightened policy — Vercel serves the pages, not Express', () => {
    const reported = reportOnlyOf(vercel());
    assert.ok(reported, `vercel.json has no ${REPORT_ONLY_HEADER}: run npm run csp:vercel`);
    assert.equal(reported, staticTightenedCspHeaderValue(clientSupabaseUrl({})));
    assert.ok(!allows(directive(reported, 'script-src'), "'unsafe-inline'"));
    assert.deepEqual(directive(reported, 'report-uri'), [CSP_REPORT_PATH]);
  });

  test('the enforced header is untouched while the tightened one is only being measured', () => {
    assert.equal(vercelCspValue(vercel()), staticCspHeaderValue(clientSupabaseUrl({})));
  });

  test('enforcing moves the tightened policy into the enforced header and stops the duplicate', () => {
    const enforced = withVercelCsp(vercel(), 'https://projectref.supabase.co', 'enforce');
    assert.equal(vercelCspValue(enforced), staticTightenedCspHeaderValue('https://projectref.supabase.co'));
    assert.equal(reportOnlyOf(enforced), undefined, 'one policy, reported once');
  });

  test('turning the rollout off leaves exactly what was there before S-23', () => {
    const off = withVercelCsp(vercel(), clientSupabaseUrl({}), 'off');
    assert.equal(vercelCspValue(off), staticCspHeaderValue(clientSupabaseUrl({})));
    assert.equal(reportOnlyOf(off), undefined);
  });

  test('regenerating is stable: the same stage twice gives the same file', () => {
    const once = withVercelCsp(vercel(), clientSupabaseUrl({}), 'report-only');
    assert.deepEqual(withVercelCsp(once, clientSupabaseUrl({}), 'report-only'), once);
    assert.deepEqual(once, vercel(), 'run `npm run csp:vercel` and commit vercel.json');
  });
});

describe('S-23 the headers the server sends', () => {
  test('in production the enforced policy is unchanged and the tightened one is only reported', async () => {
    await withEnv({ NODE_ENV: 'production', SUPABASE_URL: 'https://projectref.supabase.co' }, () => withServer(async origin => {
      const res = await fetch(`${origin}/page`);
      const enforced = res.headers.get('content-security-policy') || '';
      const reported = res.headers.get('content-security-policy-report-only') || '';

      assert.ok(allows(directive(enforced, 'script-src'), "'unsafe-inline'"),
        'the enforced policy must not change while the tightened one is being measured');
      assert.ok(!allows(directive(reported, 'script-src'), "'unsafe-inline'"), 'the reported policy is the tight one');
      assert.deepEqual(directive(reported, 'report-uri'), [CSP_REPORT_PATH]);
      assert.ok(allows(directive(reported, 'connect-src'), 'wss://projectref.supabase.co'), 'live updates still allowed');
    }));
  });

  test('CSP_TIGHTEN=enforce promotes it: the browser obeys the tight policy and stops reporting', async () => {
    await withEnv({ NODE_ENV: 'production', CSP_TIGHTEN: 'enforce', SUPABASE_URL: 'https://projectref.supabase.co' },
      () => withServer(async origin => {
        const res = await fetch(`${origin}/page`);
        const enforced = res.headers.get('content-security-policy') || '';
        assert.ok(!allows(directive(enforced, 'script-src'), "'unsafe-inline'"), 'enforced policy is the tight one');
        // AF6-20261120-03 (Agent #6): index.html no longer ships an inline script, so the tight
        // policy names none. If one is ever added back, the enforced policy must allow it by hash —
        // this asserts that for whatever the page has, including nothing.
        assert.deepEqual(
          APP_INLINE_SCRIPT_HASHES.filter(hash => !allows(directive(enforced, 'script-src'), hash)),
          [],
          'every inline script the page ships is allowed by the enforced policy',
        );
        assert.deepEqual(directive(enforced, 'form-action'), ["'self'"]);
        assert.deepEqual(directive(enforced, 'report-uri'), [CSP_REPORT_PATH], 'still reports after enforcing');
        assert.equal(res.headers.get('content-security-policy-report-only'), null);
      }));
  });

  test('development sends neither, exactly as before', async () => {
    await withEnv({ NODE_ENV: 'development' }, () => withServer(async origin => {
      const res = await fetch(`${origin}/page`);
      assert.equal(res.headers.get('content-security-policy'), null);
      assert.equal(res.headers.get('content-security-policy-report-only'), null);
    }));
  });
});

describe('S-23 reading one posted report', () => {
  test('both the classic and the Reporting API shapes are understood', () => {
    assert.deepEqual(parseCspReport(violationBody()), {
      directive: 'script-src-elem',
      blockedSource: 'https://analytics.example.com',
      documentPath: '/invoices',
    });
    assert.deepEqual(parseCspReport({
      type: 'csp-violation',
      body: { effectiveDirective: 'img-src', blockedURL: 'http://tracker.test:8080/p.gif', documentURL: 'https://ledgerflow.app/' },
    }), { directive: 'img-src', blockedSource: 'http://tracker.test:8080', documentPath: '/' });
  });

  test('anything that is not a report is refused rather than counted', () => {
    for (const body of [null, 'csp', [], {}, { 'csp-report': 'x' }, { 'csp-report': {} },
      { 'csp-report': { 'violated-directive': '<img src=x>' } },
      { 'csp-report': { 'violated-directive': 'a'.repeat(100) } }]) {
      assert.equal(parseCspReport(body), null, `${JSON.stringify(body)} is not a CSP report`);
    }
  });

  test('a look-alike host is grouped as itself, never as the host it imitates', () => {
    assert.equal(blockedSource('https://cdn.plaid.com.evil.test/x.js'), 'https://cdn.plaid.com.evil.test');
    assert.equal(blockedSource('https://evil.test/?u=https://cdn.plaid.com'), 'https://evil.test');
    assert.equal(blockedSource('https://cdn.plaid.com/link.js'), 'https://cdn.plaid.com');
  });

  test('the keywords a browser sends instead of a URL are kept as they are', () => {
    assert.equal(blockedSource('inline'), 'inline');
    assert.equal(blockedSource('eval'), 'eval');
    assert.equal(blockedSource('data'), 'data');
    assert.equal(blockedSource(''), 'unknown');
    assert.equal(blockedSource('not a url'), 'unknown');
    assert.equal(blockedSource(42), 'unknown');
  });

  test('only the path of the reporting page is kept: a query string can carry an invite token', () => {
    assert.equal(documentPath('https://ledgerflow.app/invite?token=secret-123'), '/invite');
    assert.equal(documentPath('/invite?token=secret-123#x'), '/invite');
    assert.equal(documentPath(undefined), '/');
  });

  test('a report cannot push control characters or a long string into the summary', () => {
    const noisy = `/invoices\n\u0007${'a'.repeat(500)}`;
    const parsed = parseCspReport(violationBody({
      'blocked-uri': `https://x.test/${'a'.repeat(500)}`,
      'document-uri': noisy,
    }));
    assert.equal(parsed?.blockedSource, 'https://x.test');
    assert.ok(parsed!.documentPath.length <= 120, 'the kept path is bounded');
    assert.ok([...parsed!.documentPath].every(c => c >= ' ' && c <= '~'), `printable only: ${parsed!.documentPath}`);
  });
});

describe('S-23 what the collector keeps', () => {
  beforeEach(() => { resetCspViolations(); });

  test('the same violation counts up instead of being stored again', () => {
    const violation = { directive: 'script-src', blockedSource: 'inline', documentPath: '/' };
    recordCspViolation(violation, new Date('2026-10-25T10:00:00Z'));
    recordCspViolation(violation, new Date('2026-10-25T10:05:00Z'));
    const summary = cspViolationSummary();
    assert.equal(summary.total, 2);
    assert.equal(summary.groups.length, 1);
    assert.equal(summary.groups[0].count, 2);
    assert.equal(summary.groups[0].firstSeen, '2026-10-25T10:00:00.000Z');
    assert.equal(summary.groups[0].lastSeen, '2026-10-25T10:05:00.000Z');
  });

  test('busiest first, so the directive that blocks most is the one read first', () => {
    recordCspViolation({ directive: 'img-src', blockedSource: 'https://a.test', documentPath: '/' });
    for (let i = 0; i < 3; i++) {
      recordCspViolation({ directive: 'script-src', blockedSource: 'https://b.test', documentPath: '/' });
    }
    assert.deepEqual(cspViolationSummary().groups.map(g => g.count), [3, 1]);
  });

  test('an endless stream of new combinations cannot grow the memory it uses', () => {
    for (let i = 0; i < MAX_VIOLATION_GROUPS + 50; i++) {
      recordCspViolation({ directive: 'img-src', blockedSource: `https://h${i}.test`, documentPath: '/' });
    }
    const summary = cspViolationSummary();
    assert.equal(summary.groups.length, MAX_VIOLATION_GROUPS);
    assert.equal(summary.dropped, 50);
    assert.equal(summary.total, MAX_VIOLATION_GROUPS + 50);
  });

  test('clearing it starts the measurement again', () => {
    recordCspViolation({ directive: 'img-src', blockedSource: 'https://a.test', documentPath: '/' });
    resetCspViolations();
    assert.deepEqual(cspViolationSummary(), { total: 0, dropped: 0, groups: [] });
  });
});

describe('S-23 the report endpoint', () => {
  beforeEach(() => { resetCspViolations(); });

  test('a browser report needs no sign-in and no CSRF token, and is counted', async () => {
    await withEnv({ NODE_ENV: 'production', CSP_TIGHTEN: 'report-only' }, () => withServer(async origin => {
      assert.equal(await postReport(origin, violationBody()), 204);
      const summary = cspViolationSummary();
      assert.equal(summary.total, 1);
      assert.deepEqual(summary.groups[0].blockedSource, 'https://analytics.example.com');
    }));
  });

  test('a Reporting API batch is counted entry by entry', async () => {
    await withEnv({ NODE_ENV: 'production', CSP_TIGHTEN: 'report-only' }, () => withServer(async origin => {
      const batch = [
        { type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'inline', documentURL: 'https://ledgerflow.app/a' } },
        { type: 'deprecation', body: { id: 'x' } },
        { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://img.test/a.png', documentURL: 'https://ledgerflow.app/a' } },
      ];
      assert.equal(await postReport(origin, batch, 'application/reports+json'), 204);
      assert.equal(cspViolationSummary().total, 2);
    }));
  });

  test('junk, an unparsable body and an oversized body all answer 204 and record nothing', async () => {
    await withEnv({ NODE_ENV: 'production', CSP_TIGHTEN: 'report-only' }, () => withServer(async origin => {
      assert.equal(await postReport(origin, { hello: 'world' }), 204);
      assert.equal(await postReport(origin, '{not json'), 204);
      assert.equal(await postReport(origin, { 'csp-report': { 'blocked-uri': 'x'.repeat(40_000) } }), 204);
      assert.equal(cspViolationSummary().total, 0);
    }));
  });

  test('nothing is collected while the rollout is off', async () => {
    await withEnv({ NODE_ENV: 'production', CSP_TIGHTEN: 'off' }, () => withServer(async origin => {
      assert.equal(await postReport(origin, violationBody()), 204);
      assert.equal(cspViolationSummary().total, 0);
    }));
  });

  test('the summary is not readable without a signed-in platform admin', async () => {
    await withEnv({ NODE_ENV: 'production' }, () => withServer(async origin => {
      for (const method of ['GET', 'DELETE']) {
        const res = await fetch(`${origin}${CSP_REPORT_PATH}/summary`, { method });
        assert.equal(res.status, 401, `${method} /summary must refuse an unauthenticated caller`);
      }
    }));
  });
});
