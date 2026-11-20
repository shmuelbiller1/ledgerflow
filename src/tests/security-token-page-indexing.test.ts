/**
 * Agent #6 (security lane) — AF6-20261120-02: token pages must not be crawled or indexed.
 *
 * `/i/<token>`, `/c/<token>`, `/e/<token>` and `/invite/<token>` are opened without a sign-in, and
 * the token in the path *is* the credential. They are served the same `index.html`, whose robots meta
 * said `index, follow, …`, and `public/robots.txt` allowed every path — so an invoice link forwarded
 * into a public place could be crawled, indexed and snippet-cached by a search engine.
 *
 * Evidence: docs/verification/ai6-2026-11-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PUBLIC_ROBOTS, TOKEN_PAGE_PREFIXES, TOKEN_PAGE_ROBOTS, applyRobotsDirective, isTokenPagePath, robotsForPath,
} from '../lib/privacyRobots';

test('AF6-20261120-02: every token page is recognised, and no other page is', () => {
  for (const prefix of TOKEN_PAGE_PREFIXES) {
    assert.equal(isTokenPagePath(`${prefix}abc123`), true, `${prefix}<token> is a token page`);
  }
  // The real URLs the app builds, as a customer receives them.
  for (const url of ['/i/inv_2f9c0a', '/c/portal_77', '/e/est_19', '/invite/ws_42']) {
    assert.equal(isTokenPagePath(url), true, `${url} is a token page`);
  }
  // Everything a search engine *should* see.
  for (const url of ['/', '/#sales', '/status', '/make-invoice', '/i', '/invoice/123', '/indexed', '', '/api/health']) {
    assert.equal(isTokenPagePath(url), false, `${JSON.stringify(url)} is an ordinary page`);
  }
  // The bare prefix is the same page with an empty token (it shows "Invalid invoice link"), so it is
  // treated the same way as the app's own routing does — App.tsx also tests startsWith('/i/').
  assert.equal(isTokenPagePath('/i/'), true);
  // Undefined (a test, an unusual host) is not a token page.
  assert.equal(isTokenPagePath(undefined), false);
  assert.equal(isTokenPagePath(null), false);
});

test('AF6-20261120-02: the directive is noindex for a token page and the site default otherwise', () => {
  assert.equal(robotsForPath('/i/token'), TOKEN_PAGE_ROBOTS);
  assert.equal(robotsForPath('/'), PUBLIC_ROBOTS);
  assert.match(TOKEN_PAGE_ROBOTS, /noindex/);
  assert.match(TOKEN_PAGE_ROBOTS, /nofollow/);
  assert.match(TOKEN_PAGE_ROBOTS, /noarchive/);
  assert.doesNotMatch(TOKEN_PAGE_ROBOTS, /(^|,)\s*index/, 'the token directive never grants index');
});

test('AF6-20261120-02: the page meta is rewritten in place, or created when it is missing', () => {
  const written: Array<{ selector: string; name: string; content?: string }> = [];
  const existing = {
    querySelector(selector: string) {
      written.push({ selector, name: 'existing' });
      return {
        setAttribute(name: string, value: string) {
          if (name === 'content') written[written.length - 1].content = value;
        },
      };
    },
    createElement: () => ({ setAttribute() {} }),
    head: { appendChild() {} },
  };
  assert.equal(applyRobotsDirective('/i/token', existing), TOKEN_PAGE_ROBOTS);
  assert.equal(written[0].selector, 'meta[name="robots"]');
  assert.equal(written[0].content, TOKEN_PAGE_ROBOTS, 'the existing index,follow meta is replaced, not added to');

  const appended: string[] = [];
  const fresh = {
    querySelector: () => null,
    createElement: (tag: string) => ({ setAttribute: (name: string, value: string) => appended.push(`${tag}:${name}=${value}`) }),
    head: { appendChild: () => appended.push('appended') },
  };
  assert.equal(applyRobotsDirective('/c/token', fresh), TOKEN_PAGE_ROBOTS);
  assert.deepEqual(appended, [`meta:name=robots`, `meta:content=${TOKEN_PAGE_ROBOTS}`, 'appended']);

  // A frozen or broken document must not stop the app from opening.
  const broken = { querySelector() { throw new Error('denied'); }, createElement() { throw new Error('denied'); }, head: null };
  assert.equal(applyRobotsDirective('/i/token', broken), TOKEN_PAGE_ROBOTS);
  // No document at all (a server-side import) answers the directive and touches nothing.
  assert.equal(applyRobotsDirective('/i/token', undefined), TOKEN_PAGE_ROBOTS);
});

test('AF6-20261120-02: a new token route cannot be added without being covered', () => {
  // The routes are decided in App.tsx by prefix. Anything it opens by prefix must be a token page
  // here too, or the new page ships indexable (and a customer's link becomes findable). A marketing
  // page that wants to be indexed uses an exact path, as /status and /make-invoice do.
  const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const prefixes = [...app.matchAll(/location\.pathname\.startsWith\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  assert.ok(prefixes.length >= 4, 'App.tsx still routes token pages by prefix');
  for (const prefix of new Set(prefixes)) {
    assert.equal(isTokenPagePath(`${prefix}token`), true, `App.tsx routes ${prefix}* — the token page rule must cover it`);
  }
});

test('AF6-20261120-02: robots.txt leaves token pages fetchable and blocks only the API', () => {
  // A crawler that is told not to fetch a page never reads its `noindex` — and a blocked URL can
  // still be listed when another page links to it, which is how a forwarded invoice link would leak.
  // So `noindex` has to be reachable: robots.txt must NOT disallow the token prefixes.
  const robots = fs.readFileSync(path.join(process.cwd(), 'public', 'robots.txt'), 'utf8');
  const rules = robots.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  for (const prefix of TOKEN_PAGE_PREFIXES) {
    assert.equal(rules.some(rule => rule.toLowerCase() === `disallow: ${prefix}`.toLowerCase()), false,
      `robots.txt must not disallow ${prefix}: the noindex can only be read if the page is fetched`);
  }
  assert.ok(rules.includes('Disallow: /api/'), 'the API stays out of a crawl');
  assert.ok(rules.includes('Allow: /'), 'the site itself stays crawlable');
  assert.equal(rules.some(rule => rule === 'Disallow: /'), false, 'nothing disallows the whole site');
});

test('AF6-20261120-02: the edge sends X-Robots-Tag on exactly the token paths, before any script runs', () => {
  // vercel.json is read before the build, so this header is the only one of the three directives a
  // crawler is guaranteed to see on the first response (the meta is applied after React starts).
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const blocks = config.headers || [];
  const robotsHeaders = blocks
    .map(block => ({ source: block.source, value: block.headers.find(h => h.key.toLowerCase() === 'x-robots-tag')?.value }))
    .filter(entry => entry.value !== undefined);

  for (const prefix of TOKEN_PAGE_PREFIXES) {
    const entry = robotsHeaders.find(e => new RegExp(`^${prefix.replace(/\//g, '\\/')}`).test(e.source));
    assert.ok(entry, `vercel.json sends X-Robots-Tag on ${prefix}*`);
    assert.match(entry!.value!, /noindex/);
    assert.match(entry!.value!, /nofollow/);
    assert.doesNotMatch(entry!.value!, /(^|,\s*)index/, `the ${prefix} header never grants index`);
  }
  // The marketing pages must stay indexable: a whole-site X-Robots-Tag would deindex the product.
  assert.equal(robotsHeaders.some(e => e.source === '/(.*)'), false,
    'no site-wide X-Robots-Tag');
});
