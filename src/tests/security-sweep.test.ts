/**
 * Security sweep: the whole surface, checked the way an attacker would try it, on every pull request.
 *
 * It needs no list of routes or tables to be kept by hand. It boots the real app, finds every route
 * that is registered, and calls each one as five kinds of caller; then it finds every table in the
 * database and tries to read and write each one as four kinds of browser session. What it sees is
 * compared with `security-baseline.json`, the approved list of what may be open.
 *
 *  - A route or table that is **more open than the baseline** fails the test. A new public route, a
 *    route a viewer can now write through, a table a browser can now write: each has to be added to
 *    the baseline on purpose, in the same pull request, where a reviewer sees it.
 *  - Some things are never allowed, whatever the baseline says: a forged, expired or unsigned token
 *    being accepted; a signed-in stranger reading, changing or deleting another business's row; a
 *    signed-out browser touching any table; an answer that leaks a stack trace or SQL text.
 *
 * Approve a deliberate change with `npm run security:baseline`, then read the diff of the JSON file.
 * What this is not: a penetration test. See docs/SECURITY_SWEEP.md for what it covers and what it cannot.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { SignJWT } from 'jose';
import pg from 'pg';

const url = process.env.LF_TEST_DATABASE_URL;
const BASELINE_PATH = path.join(process.cwd(), 'security-baseline.json');
const WRITE_BASELINE = process.env.LF_SECURITY_WRITE_BASELINE === '1';

interface Baseline {
  /** routes that answer without any sign-in */
  publicRoutes: string[];
  /** routes that answer a signed-in person who belongs to no workspace (their own account, their own lists) */
  selfRoutes: string[];
  /** write routes that answer a viewer of the workspace (their own preferences, not the books) */
  viewerWriteRoutes: string[];
  /** routes that answer 5xx to the sweep's requests, with why */
  serverErrors: Record<string, string>;
  /** per table: what each kind of browser session can do. r = read the row, i = insert, u = update, d = delete */
  tables: Record<string, Record<string, string>>;
  /** tables that are not document tables: the grants a browser role holds and whether row security is on */
  otherTables: Record<string, string>;
}

const emptyBaseline = (): Baseline => ({ publicRoutes: [], selfRoutes: [], viewerWriteRoutes: [], serverErrors: {}, tables: {}, otherTables: {} });
const readBaseline = (): Baseline => (fs.existsSync(BASELINE_PATH) ? { ...emptyBaseline(), ...JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) } : emptyBaseline());
const observed: Baseline = emptyBaseline();

/** What must never appear in an answer to a stranger: where the code lives, or what the database said. */
const LEAK = /(\n\s+at .+:\d+:\d+\)?|node_modules\/|syntax error at or near|relation "[^"]+" does not exist|column "[^"]+" does not exist|password authentication failed|ECONNREFUSED)/;

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
const howToApprove = 'If this is intended, run `npm run security:baseline` and commit security-baseline.json so a reviewer sees it.';

describe('Security sweep (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const ws = `sec_ws_${tag}`;
  const owner = crypto.randomUUID();
  const viewer = crypto.randomUUID();
  const outsider = crypto.randomUUID();
  /** one throwaway account per route that acts on the caller's own account (delete my account, sign me out everywhere) */
  const throwaway = new Map<string, string>();
  // A write under /auth or /account acts on whoever calls it. Sent as the stranger or the viewer it would delete
  // that account part-way through, and every later answer would be about a person who no longer exists.
  const actsOnCaller = (route: { method: string; path: string }) => route.method !== 'GET' && route.method !== 'HEAD' && /^\/api\/v1\/(auth|account)\//.test(route.path);
  const issuer = 'https://security-sweep.test.invalid';
  const secretText = `sweep-${crypto.randomBytes(24).toString('hex')}`;
  let server: Server;
  let base = '';
  let routes: Array<{ method: string; path: string }> = [];
  // About two thousand refused requests each make the server log a line. Written to this process's output, that
  // volume interleaves with the test runner's own report stream and can corrupt it, so the app is quiet here.
  const quiet = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const consoleBefore = Object.fromEntries(quiet.map(k => [k, console[k]])) as Record<typeof quiet[number], typeof console.log>;

  const mint = (sub: string, opts: { key?: string; expiresIn?: string | number } = {}) =>
    new SignJWT({ role: 'authenticated', aal: 'aal2', email: `${sub}@security-sweep.test.invalid` })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuer(`${issuer}/auth/v1`).setAudience('authenticated')
      .setIssuedAt(opts.expiresIn === 'past' ? Math.floor(Date.now() / 1000) - 7200 : undefined)
      .setExpirationTime(opts.expiresIn === 'past' ? Math.floor(Date.now() / 1000) - 3600 : (opts.expiresIn ?? '15m'))
      .sign(new TextEncoder().encode(opts.key ?? secretText));

  /** An unsigned token: header says "none", the classic way to ask a careless server to skip the check. */
  const unsigned = (sub: string) => {
    const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    return `${part({ alg: 'none', typ: 'JWT' })}.${part({ role: 'authenticated', aal: 'aal2', sub, iss: `${issuer}/auth/v1`, aud: 'authenticated', iat: now, exp: now + 900 })}.`;
  };

  before(async () => {
    for (const k of quiet) console[k] = () => undefined;
    process.env.DATABASE_URL = url;
    process.env.SUPABASE_URL = issuer;
    process.env.SUPABASE_JWT_SECRET = secretText;

    // Express 5 keeps only a matcher on a mounted router, so note each mount path as it is registered.
    const mounts = new Map<unknown, string[]>();
    const note = (args: unknown[]) => {
      const first = args[0];
      const paths = typeof first === 'string' ? [first] : Array.isArray(first) && first.every(x => typeof x === 'string') ? first as string[] : [''];
      for (const arg of args.flat()) {
        if (typeof arg === 'function' && Array.isArray((arg as { stack?: unknown }).stack)) mounts.set(arg, [...(mounts.get(arg) || []), ...paths]);
      }
    };
    const application = express.application as unknown as { use: (...a: unknown[]) => unknown };
    const routerProto = Object.getPrototypeOf(express.Router()) as { use: (...a: unknown[]) => unknown };
    const appUse = application.use;
    const routerUse = routerProto.use;
    application.use = function (this: unknown, ...args: unknown[]) { note(args); return appUse.apply(this, args); };
    routerProto.use = function (this: unknown, ...args: unknown[]) { note(args); return routerUse.apply(this, args); };
    let app: express.Express;
    try {
      app = await (await import('../../server')).createApp();
    } finally {
      application.use = appUse;
      routerProto.use = routerUse;
    }

    interface Layer { route?: { path: string | string[]; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } }
    const found: Array<{ method: string; path: string }> = [];
    const walk = (stack: Layer[], prefix: string, depth: number) => {
      if (depth > 8) return;
      for (const layer of stack) {
        if (layer.route) {
          for (const p of Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]) {
            if (typeof p !== 'string') continue;
            for (const m of Object.keys(layer.route.methods)) if (m !== '_all') found.push({ method: m.toUpperCase(), path: (prefix + p).replace(/\/+/g, '/') });
          }
        } else if (layer.handle?.stack) {
          for (const mount of mounts.get(layer.handle) || ['']) walk(layer.handle.stack, prefix + mount, depth + 1);
        }
      }
    };
    walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '', 0);
    routes = [...new Map(found.filter(r => r.path.startsWith('/api')).map(r => [`${r.method} ${r.path}`, r])).values()]
      .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));

    const db = (await import('../server/db/firestore')).getDb();
    // real, confirmed accounts: a route that refuses them is refusing a person, not a malformed test login
    for (const route of routes.filter(actsOnCaller)) throwaway.set(`${route.method} ${route.path}`, crypto.randomUUID());
    for (const id of [owner, viewer, outsider, ...throwaway.values()]) {
      await db.pool.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [id, `${id}@security-sweep.test.invalid`]);
    }
    await db.collection('workspaces').doc(ws).set({
      uid: owner, name: 'Security Sweep Co', currency: 'USD', members: [owner, viewer], roles: { [viewer]: 'viewer' },
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    for (const k of quiet) console[k] = consoleBefore[k];
    server?.close();
    if (url) {
      const db = (await import('../server/db/firestore')).getDb();
      await db.collection('workspaces').doc(ws).delete().catch(() => undefined);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, viewer, outsider, ...throwaway.values()]]).catch(() => undefined);
    }
  });

  // Some limits are counted in the database and outlive a run, so each run uses addresses nobody used before.
  const net = [11 + crypto.randomInt(200), crypto.randomInt(256)];
  /** One request. Each route gets its own client address, so the app's rate limit does not hide a route behind a 429. */
  const call = async (route: { method: string; path: string }, index: number, kind: number, token?: string) => {
    const target = route.path.replace(/:([A-Za-z0-9_]+)\??/g, ws).replace(/\*[A-Za-z0-9_]*/g, 'x');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-forwarded-for': `${net[0]}.${net[1]}.${index >> 3}.${((index & 7) << 3 | kind) + 1}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    const init: RequestInit = { method: route.method, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) };
    if (route.method !== 'GET' && route.method !== 'HEAD') init.body = JSON.stringify({ workspaceId: ws });
    try {
      const res = await fetch(`${base}${target}${route.method === 'GET' ? `?workspaceId=${ws}` : ''}`, init);
      return { status: res.status, body: (await res.text()).slice(0, 4000) };
    } catch (err) {
      return { status: 0, body: String(err) };
    }
  };

  test('every route: who gets an answer, and nothing leaks', async () => {
    assert.ok(routes.length > 100, `only ${routes.length} routes were found: the route walk is broken, so nothing was checked`);
    const tokens = {
      forged: await mint(outsider, { key: `not-${secretText}` }),
      expired: await mint(outsider, { expiresIn: 'past' }),
      unsigned: unsigned(outsider),
      outsider: await mint(outsider),
      viewer: await mint(viewer),
    };
    const throwawayTokens = new Map<string, string>();
    for (const [key, id] of throwaway) throwawayTokens.set(key, await mint(id));
    const ok = (s: number) => s >= 200 && s < 300;
    const publicRoutes = new Set<string>();
    const selfRoutes = new Set<string>();
    const viewerWrites = new Set<string>();
    const memberReads = new Set<string>();
    const badTokenAccepted: string[] = [];
    const leaks: string[] = [];
    const errors = new Map<string, string>();

    let next = 0;
    const worker = async () => {
      while (next < routes.length) {
        const index = next++;
        const route = routes[index];
        const key = `${route.method} ${route.path}`;
        const check = (label: string, r: { status: number; body: string }) => {
          if (r.status >= 500 || r.status === 0) errors.set(key, `${label}: ${r.status} ${r.body.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|sec_ws_[0-9a-f]+|\d{4}-\d\d-\d\dT[\d:.]+Z|\b\d{6,}\b/g, '…').replace(/\s+/g, ' ').slice(0, 140)}`);
          if (LEAK.test(r.body)) leaks.push(`${key} (${label}, ${r.status})`);
          return r;
        };
        const none = check('no sign-in', await call(route, index, 0));
        if (ok(none.status)) publicRoutes.add(key);
        for (const [kind, label] of [['forged', 'forged token'], ['expired', 'expired token'], ['unsigned', 'unsigned token']] as const) {
          const r = check(label, await call(route, index, 1, tokens[kind]));
          if (ok(r.status) && !ok(none.status)) badTokenAccepted.push(`${key} accepted a ${label} (${r.status})`);
        }
        const asOutsider = check('stranger', await call(route, index, 2, throwawayTokens.get(key) ?? tokens.outsider));
        if (ok(asOutsider.status) && !ok(none.status)) selfRoutes.add(key);
        if (actsOnCaller(route)) continue; // already tried once above, by the throwaway account
        const asViewer = check('viewer', await call(route, index, 3, tokens.viewer));
        if (ok(asViewer.status) && !ok(none.status) && !ok(asOutsider.status)) {
          if (route.method === 'GET' || route.method === 'HEAD') memberReads.add(key); else viewerWrites.add(key);
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    observed.publicRoutes = sorted(publicRoutes);
    observed.selfRoutes = sorted(selfRoutes);
    observed.viewerWriteRoutes = sorted(viewerWrites);
    observed.serverErrors = Object.fromEntries([...errors.entries()].sort(([a], [b]) => a.localeCompare(b)));

    // the control: a real member's token must open something, or every refusal above proves nothing
    assert.ok(memberReads.size > 0, 'a valid member token was refused everywhere: the sweep\'s tokens are not being accepted, so its refusals mean nothing');
    const [controlMethod, controlPath] = sorted(memberReads)[0].split(' ');
    const stillMember = await call({ method: controlMethod, path: controlPath }, routes.length + 1, 3, tokens.viewer);
    assert.ok(ok(stillMember.status), `the viewer could read ${controlPath} during the sweep and cannot now (${stillMember.status}): a call in the sweep removed their access, so later answers were about a non-member`);

    // never allowed, whatever the baseline says
    assert.deepEqual(badTokenAccepted, [], `A token that is forged, expired or unsigned was accepted:\n  ${badTokenAccepted.join('\n  ')}`);
    assert.deepEqual(sorted(leaks), [], `An answer leaked a stack trace or database text:\n  ${sorted(leaks).join('\n  ')}`);

    if (WRITE_BASELINE) return;
    const baseline = readBaseline();
    const extra = (seen: string[], approved: string[]) => seen.filter(x => !approved.includes(x));
    const newlyPublic = extra(observed.publicRoutes, baseline.publicRoutes);
    assert.deepEqual(newlyPublic, [], `These routes answer with no sign-in and are not approved as public:\n  ${newlyPublic.join('\n  ')}\n${howToApprove}`);
    const newlySelf = extra(observed.selfRoutes, baseline.selfRoutes);
    assert.deepEqual(newlySelf, [], `These routes answer a signed-in stranger who belongs to no workspace:\n  ${newlySelf.join('\n  ')}\n${howToApprove}`);
    const newlyViewer = extra(observed.viewerWriteRoutes, baseline.viewerWriteRoutes);
    assert.deepEqual(newlyViewer, [], `A viewer can now write through these routes:\n  ${newlyViewer.join('\n  ')}\n${howToApprove}`);
    const newErrors = Object.keys(observed.serverErrors).filter(k => !(k in baseline.serverErrors));
    assert.deepEqual(newErrors, [], `These routes answered a server error to a stranger's request (a crash an attacker can trigger):\n  ${newErrors.map(k => `${k} — ${observed.serverErrors[k]}`).join('\n  ')}`);
  });

  test('a flood from one address is slowed down', async () => {
    const target = routes.find(r => r.method === 'GET' && r.path.startsWith('/api/v1/')) || routes[0];
    const statuses: number[] = [];
    for (let batch = 0; batch < 6 && !statuses.includes(429); batch++) {
      statuses.push(...await Promise.all(Array.from({ length: 40 }, async () => {
        const res = await fetch(`${base}${target.path.replace(/:([A-Za-z0-9_]+)\??/g, ws)}`, { headers: { 'x-forwarded-for': `${net[0]}.${net[1]}.250.250` }, signal: AbortSignal.timeout(15000) });
        await res.arrayBuffer();
        return res.status;
      })));
    }
    assert.ok(statuses.includes(429), `${statuses.length} requests from one address to ${target.path} and none was refused with 429: the rate limit is not in front of the API`);
  });

  test('answers carry the protective headers and do not trust another site', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { origin: 'https://attacker.example', 'x-forwarded-for': `${net[0]}.${net[1]}.251.1` } });
    await res.arrayBuffer();
    assert.equal(res.headers.get('x-powered-by'), null, 'the server announces what it is built with (x-powered-by)');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const allowed = res.headers.get('access-control-allow-origin');
    assert.ok(allowed !== '*' && allowed !== 'https://attacker.example', `another site is allowed to read answers (access-control-allow-origin: ${allowed})`);
  });

  test('every table: what a browser session can read and write', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('begin');
      const dbWs = `secdb_ws_${tag}`;
      const people = { anon: null, stranger: 'secdb-stranger', viewer: 'secdb-viewer', bookkeeper: 'secdb-bookkeeper' } as const;
      await client.query('insert into public.workspaces(id, data) values ($1, $2)', [dbWs, JSON.stringify({
        uid: 'secdb-owner', name: 'Security Sweep DB', currency: 'USD',
        roles: { 'secdb-viewer': 'viewer', 'secdb-bookkeeper': 'bookkeeper' }, members: ['secdb-owner', 'secdb-viewer', 'secdb-bookkeeper'],
      })]);

      const all = await client.query<{ table_name: string; cols: string[] }>(
        `select c.table_name, array_agg(c.column_name::text) as cols from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and t.table_type = 'BASE TABLE' group by c.table_name order by c.table_name`);
      const docTables = all.rows.filter(r => r.cols.includes('id') && r.cols.includes('data')).map(r => r.table_name);
      const otherTables = all.rows.filter(r => !docTables.includes(r.table_name)).map(r => r.table_name);
      assert.ok(docTables.length > 40, `only ${docTables.length} document tables were found: the table walk is broken`);

      const q = (name: string) => `public."${name.replace(/"/g, '""')}"`;
      /** Runs one statement as a browser session inside a savepoint; nothing it does is kept. */
      let refusal = '';
      const attempt = async (who: keyof typeof people, sql: string, params: unknown[]): Promise<number> => {
        refusal = '';
        await client.query('savepoint probe');
        try {
          const claims = who === 'anon' ? { role: 'anon' } : { role: 'authenticated', sub: people[who], email: `${people[who]}@security-sweep.test.invalid` };
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
          await client.query(`set local role ${who === 'anon' ? 'anon' : 'authenticated'}`);
          return (await client.query(sql, params)).rowCount ?? 0;
        } catch (err) {
          refusal = err instanceof Error ? err.message : String(err);
          return -1;
        } finally {
          await client.query('rollback to savepoint probe');
          await client.query('reset role');
          await client.query(`select set_config('request.jwt.claims', '', true)`);
        }
      };

      // A payload the table's own field rules accept, so a refusal means "not allowed", not "unknown field".
      const rules = new Map((await client.query<{ table_name: string; allowed_keys: string[] | null; immutable_keys: string[] | null }>(
        'select table_name, allowed_keys, immutable_keys from public.lf_rules')).rows.map(r => [r.table_name, r]));
      const row = (table: string, uid: string) => {
        const allowed = rules.get(table)?.allowed_keys;
        const wanted: Record<string, unknown> = { workspaceId: dbWs, uid, date: '2026-01-15', status: 'draft', name: 'security sweep', createdAt: '2026-01-15T00:00:00.000Z' };
        return JSON.stringify(Object.fromEntries(Object.entries(wanted).filter(([k]) => !allowed || allowed.includes(k))));
      };
      const changedField = (table: string) => {
        const rule = rules.get(table);
        const fixed = new Set(['id', 'uid', 'workspaceId', ...(rule?.immutable_keys || [])]);
        const key = !rule?.allowed_keys ? 'updatedAt' : ['updatedAt', 'name', 'description', 'notes', ...rule.allowed_keys].find(k => rule.allowed_keys!.includes(k) && !fixed.has(k));
        return JSON.stringify({ [key || 'updatedAt']: '2026-01-16T00:00:00.000Z' });
      };
      for (const table of docTables) {
        const seedId = table === 'workspaces' ? dbWs : `secdb_seed_${tag}`;
        let seeded = table === 'workspaces';
        if (!seeded) {
          // The seed only has to exist; it is not a valid entry. Skip the triggers for this one insert where the
          // test database lets us (a superuser can), and fall back to a plain insert where it does not.
          for (const quiet of [true, false]) {
            await client.query('savepoint seed');
            try {
              if (quiet) await client.query(`set local session_replication_role = replica`);
              await client.query(`insert into ${q(table)}(id, data) values ($1, $2)`, [seedId, row(table, 'secdb-owner')]);
              if (quiet) await client.query(`set local session_replication_role = origin`);
              seeded = true;
              break;
            } catch {
              await client.query('rollback to savepoint seed');
            }
          }
        }
        const cells: Record<string, string> = {};
        for (const who of Object.keys(people) as Array<keyof typeof people>) {
          let cell = '';
          if (seeded && await attempt(who, `select 1 from ${q(table)} where id = $1`, [seedId]) > 0) cell += 'r';
          // A refusal about one field ("Field x is not allowed") says the row was wrong, not that writing is closed:
          // drop that field and ask again, so only a refusal of the write itself counts as closed.
          const fresh = JSON.parse(row(table, people[who] || 'anon')) as Record<string, unknown>;
          for (let tries = 0; tries < 12; tries++) {
            if (await attempt(who, `insert into ${q(table)}(id, data) values ($1, $2)`, [`secdb_new_${tag}_${who}`, JSON.stringify(fresh)]) > 0) { cell += 'i'; break; }
            const field = /Field "([^"]+)" (?:is not allowed|cannot be (?:set|changed))/.exec(refusal)?.[1];
            if (!field || !(field in fresh)) break;
            delete fresh[field];
          }
          if (seeded) {
            for (const change of [changedField(table), '{"updatedAt":"2026-01-16T00:00:00.000Z"}', '{"name":"security sweep 2"}', '{"description":"security sweep"}', '{"notes":"security sweep"}']) {
              if (await attempt(who, `update ${q(table)} set data = data || $2::jsonb where id = $1`, [seedId, change]) > 0) { cell += 'u'; break; }
              if (!/Field "[^"]+" (?:is not allowed|cannot be (?:set|changed))/.test(refusal)) break;
            }
          }
          if (seeded && await attempt(who, `delete from ${q(table)} where id = $1`, [seedId]) > 0) cell += 'd';
          cells[who] = seeded ? cell : `${cell}?`;
        }
        observed.tables[table] = cells;
      }

      for (const table of otherTables) {
        const info = await client.query<{ rls: boolean; grants: string }>(
          `select c.relrowsecurity as rls,
                  concat_ws(',', case when has_table_privilege('anon', c.oid, 'SELECT') then 'anon:select' end,
                                 case when has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') then 'anon:write' end,
                                 case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'authenticated:select' end,
                                 case when has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') then 'authenticated:write' end) as grants
             from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`, [table]);
        observed.otherTables[table] = `${info.rows[0]?.grants || 'no browser grants'}; row security ${info.rows[0]?.rls ? 'on' : 'off'}`;
      }
      await client.query('rollback');
    } finally {
      await client.end();
    }

    // never allowed, whatever the baseline says
    const signedOut = Object.entries(observed.tables).filter(([, c]) => c.anon.replace('?', '') !== '').map(([t, c]) => `${t}: ${c.anon}`);
    assert.deepEqual(signedOut, [], `A signed-out browser can touch these tables:\n  ${signedOut.join('\n  ')}`);
    const crossTenant = Object.entries(observed.tables).filter(([, c]) => /[rud]/.test(c.stranger)).map(([t, c]) => `${t}: ${c.stranger}`);
    assert.deepEqual(crossTenant, [], `A signed-in stranger can read, change or delete another business's row in:\n  ${crossTenant.join('\n  ')}`);
    const exposed = Object.entries(observed.otherTables).filter(([, v]) => !v.startsWith('no browser grants') && v.endsWith('off')).map(([t, v]) => `${t}: ${v}`);
    assert.deepEqual(exposed, [], `These tables are granted to browser roles with row security off:\n  ${exposed.join('\n  ')}`);

    if (WRITE_BASELINE) return;
    const baseline = readBaseline();
    const wider: string[] = [];
    for (const [table, cells] of Object.entries(observed.tables)) {
      for (const [who, cell] of Object.entries(cells)) {
        const approved = baseline.tables[table]?.[who] ?? '';
        const added = [...cell].filter(ch => ch !== '?' && !approved.includes(ch)).join('');
        if (added) wider.push(`${table}: ${who} can now ${[...added].map(ch => ({ r: 'read', i: 'insert', u: 'update', d: 'delete' })[ch]).join(', ')} (approved: "${approved}", now: "${cell}")`);
      }
    }
    assert.deepEqual(wider, [], `The database is more open to browser sessions than approved:\n  ${wider.join('\n  ')}\n${howToApprove}`);
    const widerOther = Object.entries(observed.otherTables).filter(([t, v]) => baseline.otherTables[t] !== v && !v.startsWith('no browser grants')).map(([t, v]) => `${t}: ${v} (approved: ${baseline.otherTables[t] ?? 'not listed'})`);
    assert.deepEqual(widerOther, [], `Grants on these tables changed:\n  ${widerOther.join('\n  ')}\n${howToApprove}`);
  });

  test('the approved list is written when asked for', { skip: !WRITE_BASELINE && 'set LF_SECURITY_WRITE_BASELINE=1 to write security-baseline.json' }, () => {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(observed, null, 2)}\n`);
  });
});
