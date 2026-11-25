/**
 * AUP-01: branding per label is saved through PUT /api/v1/workspaces/:id/branding-profiles (owners and
 * accountants) and PDFs for a document on that label (or under it) use it; the books' branding fills the rest.
 */
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { callApi, closeServer, listenOnRandomPort, restoreEnv, signTestJwt, useLiveApiEnv } from './helpers/liveApiServer';
import { layoutDocumentPdf } from '../server/services/pdfService';

test('a document on a label prints that label\'s branding over the books\' (and a child label inherits it)', () => {
  const workspace = {
    name: 'Books', currency: 'USD',
    branding: { footer: 'Books footer', color: '#111111' },
    brandingProfiles: { labels: { 'property:A': { footer: 'Building A footer' } } },
    dimensions: [{ id: 'property' }],
  };
  const doc = { number: 'INV-1', date: '2026-03-01', currency: 'USD', items: [{ description: 'Rent', quantity: 1, amountCents: 1000 }], amountCents: 1000 };
  const plain = JSON.stringify(layoutDocumentPdf('invoice', doc, workspace));
  const onA = JSON.stringify(layoutDocumentPdf('invoice', { ...doc, dimensions: { property: 'A' } }, workspace));
  const onChild = JSON.stringify(layoutDocumentPdf('invoice', { ...doc, dimensions: { property: 'A/C1' } }, workspace));
  assert.match(plain, /Books footer/);
  assert.match(onA, /Building A footer/);
  assert.doesNotMatch(onA, /Books footer/);
  assert.match(onChild, /Building A footer/, 'a label under A inherits A');
});

const enabled = Boolean(process.env.LF_TEST_DATABASE_URL);
describe('AUP-01: saving branding per label', { skip: !enabled && 'requires LF_TEST_DATABASE_URL' }, () => {
  const owner = randomUUID(), viewer = randomUUID(), ws = `ws_aup01_${randomUUID()}`;
  let server: Server | undefined, base = '', ownerToken = '', viewerToken = '', env: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;
  before(async () => {
    env = useLiveApiEnv('aup01-branding');
    const [{ getDb }, { createApp }] = await Promise.all([import('../server/db/firestore'), import('../../server')]);
    db = getDb();
    for (const uid of [owner, viewer]) await db.pool.query("insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values ($1::uuid,$2,now(),'{}'::jsonb)", [uid, `${uid}@example.test`]);
    await db.collection('workspaces').doc(ws).set({ uid: owner, name: 'Branding', currency: 'USD', members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' }, branding: { footer: 'Books footer' } });
    ownerToken = await signTestJwt({ uid: owner, email: `${owner}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    viewerToken = await signTestJwt({ uid: viewer, email: `${viewer}@example.test`, aal: 'aal2', userMetadata: { email_verified: true } });
    const started = await listenOnRandomPort(await createApp());
    server = started.server; base = started.base;
  });
  after(async () => {
    await closeServer(server);
    if (db) {
      await db.pool.query('delete from public."auditLogs" where workspace_id = $1', [ws]);
      await db.pool.query('delete from public.workspaces where id = $1', [ws]);
      await db.pool.query('delete from public.users where id = any($1::text[])', [[owner, viewer]]);
      await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, viewer]]);
    }
    restoreEnv(env);
  });

  test('an owner saves it, a viewer is refused, a malformed label is refused, and the books\' branding is untouched', async () => {
    const path = `/api/v1/workspaces/${ws}/branding-profiles`;
    const profiles = { labels: { 'property:A': { footer: 'Building A footer', color: '#0E7C66' } } };
    const saved = await callApi(base, 'PUT', path, { token: ownerToken, body: { profiles } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal((saved.json as { status: string }).status, 'success');
    const stored = (await db.collection('workspaces').doc(ws).get()).data();
    assert.deepEqual(stored?.brandingProfiles, profiles);
    assert.deepEqual(stored?.branding, { footer: 'Books footer' });
    assert.equal((await callApi(base, 'PUT', path, { token: viewerToken, body: { profiles } })).status, 403);
    const bad = await callApi(base, 'PUT', path, { token: ownerToken, body: { profiles: { labels: { nocolon: { footer: 'x' } } } } });
    assert.equal(bad.status, 400, JSON.stringify(bad.json));
    const badColour = await callApi(base, 'PUT', path, { token: ownerToken, body: { profiles: { labels: { 'property:A': { color: 'green' } } } } });
    assert.equal(badColour.status, 400, JSON.stringify(badColour.json));
    assert.deepEqual((await db.collection('workspaces').doc(ws).get()).data()?.brandingProfiles, profiles, 'a refused save changes nothing');
  });
});
