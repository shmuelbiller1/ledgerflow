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

test('AF6-20261120-02: robots.txt keeps the token prefixes and the API out of a crawl', () => {
  const robots = fs.readFileSync(path.join(process.cwd(), 'public', 'robots.txt'), 'utf8');
  for (const prefix of [...TOKEN_PAGE_PREFIXES, '/api/']) {
    assert.equal(robots.includes(`Disallow: ${prefix}`), true, `robots.txt disallows ${prefix}`);
  }
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m, 'the site itself stays crawlable');
  assert.doesNotMatch(robots, /^Disallow: \/$/m, 'nothing disallows the whole site');
});
