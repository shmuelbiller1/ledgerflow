/** Tax profiles (PLAN §6): on the books and on label values, inherited from parents, registrations per level. */
import test, { after, before, describe } from 'node:test';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import { nodeAncestry, registrationKey, registrationsOn, resolveSellerProfile, taxProfilesProblem, type TaxProfiles } from '../lib/tax/profile';

const profiles: TaxProfiles = {
  books: { name: 'Holding Ltd', place: { country: 'IL', city: 'Tel Aviv' }, basis: 'accrual',
    registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'bimonthly' }] },
  labels: {
    'world:us': { name: 'Acme US', place: { country: 'US' } },
    'world:us/texas': { name: 'Acme Texas LLC', place: { country: 'US', state: 'TX', city: 'Austin' },
      registrations: [
        { kind: 'sales_tax', number: '32000000001', place: { country: 'US', state: 'TX' }, filing: 'quarterly', validFrom: '2026-01-01' },
        { kind: 'employer', number: '12-3456789', place: { country: 'US' } },
      ] },
    'location:eilat': { place: { country: 'IL', city: 'Eilat', district: 'Eilat' } },
  },
};

test('parents of a label value, nearest first', () => {
  assert.deepEqual(nodeAncestry('us/texas/austin'), ['us/texas/austin', 'us/texas', 'us']);
});

test('a line for the Texas LLC takes its place and registrations; a child value inherits them', () => {
  const tx = resolveSellerProfile(profiles, { world: 'us/texas/austin-store' }, ['world', 'location']);
  assert.equal(tx.name, 'Acme Texas LLC');
  assert.deepEqual(tx.place, { country: 'US', state: 'TX', city: 'Austin' });
  assert.deepEqual(tx.from, ['world:us/texas', 'world:us', 'books']);
  assert.equal(tx.basis, 'accrual', 'from the books');
  assert.deepEqual(tx.registrations?.map(r => r.kind), ['sales_tax', 'employer'], 'its own, not the Israeli VAT number');
});

test('no label with a profile: the books; the first label in order wins', () => {
  assert.equal(resolveSellerProfile(profiles, { project: 'p1' }, ['world', 'location']).name, 'Holding Ltd');
  const eilat = resolveSellerProfile(profiles, { location: 'eilat' }, ['world', 'location']);
  assert.deepEqual(eilat.place, { country: 'IL', city: 'Eilat', district: 'Eilat' });
  assert.equal(eilat.registrations?.[0].number, '514000000', 'inherits the books\' VAT number');
  assert.equal(resolveSellerProfile(profiles, { world: 'us/texas', location: 'eilat' }, ['world', 'location']).name, 'Acme Texas LLC');
  assert.deepEqual(resolveSellerProfile(null, {}, []).from, []);
});

test('registrations in force on a date, and their keys', () => {
  const tx = resolveSellerProfile(profiles, { world: 'us/texas' }, ['world']);
  assert.equal(registrationsOn(tx, 'sales_tax', '2025-12-31').length, 0);
  assert.equal(registrationKey(registrationsOn(tx, 'sales_tax', '2026-01-01')[0]), 'sales_tax:US-TX:32000000001');
});

test('what a profile needs before it is saved', () => {
  assert.equal(taxProfilesProblem(profiles), null);
  assert.match(String(taxProfilesProblem([])), /not readable/);
  assert.match(String(taxProfilesProblem({ books: { place: { country: 'usa' } } })), /two-letter/);
  assert.match(String(taxProfilesProblem({ books: { place: { country: 'US', state: 'Texas' } } })), /short code/);
  assert.match(String(taxProfilesProblem({ labels: { nolabel: {} } })), /not a label/);
  assert.match(String(taxProfilesProblem({ labels: { 'world:x': { registrations: [{ kind: 'gst', number: '1', place: { country: 'CA' } }] } } })), /kind/);
  assert.match(String(taxProfilesProblem({ books: { registrations: [{ kind: 'vat', number: '1', place: { country: 'IL' }, validFrom: '2026-02-01', validTo: '2026-01-01' }] } })), /ends before/);
  assert.match(String(taxProfilesProblem({ books: { registrations: [{ kind: 'vat', number: '<x>', place: { country: 'IL' } }] } })), /1 to 40/);
  // A-101: Israeli advance tax payment (mikdamot) rate and frequency
  assert.equal(taxProfilesProblem({ books: { advanceTaxRatePercent: 3.5, advanceTaxFrequency: 'bimonthly' } }), null);
  assert.match(String(taxProfilesProblem({ books: { advanceTaxRatePercent: -1 } })), /between 0 and 100/);
  assert.match(String(taxProfilesProblem({ books: { advanceTaxRatePercent: 105 } })), /between 0 and 100/);
  assert.match(String(taxProfilesProblem({ books: { advanceTaxFrequency: 'yearly' as never } })), /monthly or bimonthly/);
});

test('A-101: advance tax rate and frequency inheritance', () => {
  const p: TaxProfiles = {
    books: { advanceTaxRatePercent: 4.5, advanceTaxFrequency: 'bimonthly' },
    labels: {
      'world:il': { name: 'Israel Entity', advanceTaxRatePercent: 3.0 },
      'world:child': { name: 'Child Subsidiary' },
    },
  };
  const il = resolveSellerProfile(p, { world: 'il' }, ['world']);
  assert.equal(il.advanceTaxRatePercent, 3.0, 'uses own rate');
  assert.equal(il.advanceTaxFrequency, 'bimonthly', 'inherits frequency from books');

  const child = resolveSellerProfile(p, { world: 'child' }, ['world']);
  assert.equal(child.advanceTaxRatePercent, 4.5, 'inherits rate from books');
  assert.equal(child.advanceTaxFrequency, 'bimonthly', 'inherits frequency from books');
});

describe('Against the database', { skip: !process.env.LF_TEST_DATABASE_URL && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_taxp_${crypto.randomBytes(4).toString('hex')}`;
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const put = async (uid: string, body: unknown) => {
    const res = await fetch(`${base}/api/v1/workspaces/${ws}/tax-profiles`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-uid': uid }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  before(async () => {
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: 'owner-1', name: 'Tax', members: ['owner-1', 'acct-1', 'book-1'], roles: { 'acct-1': 'accountant', 'book-1': 'bookkeeper' } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'x@example.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server?.close();
    for (const table of ['auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('owners and accountants save the profiles; a bookkeeper and a bad profile are refused; audited', async () => {
    assert.equal((await put('book-1', { profiles })).status, 403);
    assert.equal((await put('owner-1', { profiles: { books: { place: { country: 'israel' } } } })).status, 400);
    const saved = await put('acct-1', { profiles });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const stored = (await db.collection('workspaces').doc(ws).get()).data()?.taxProfiles as TaxProfiles;
    assert.deepEqual(stored, profiles);
    assert.equal((await put('owner-1', { profiles: { labels: {} } })).status, 200);
    assert.deepEqual((await db.collection('workspaces').doc(ws).get()).data()?.taxProfiles, {}, 'emptied');
    const audit = await db.pool.query(`select count(*)::int as n from public."auditLogs" where workspace_id = $1 and data->>'action' = 'TAX_PROFILES_SET'`, [ws]);
    assert.equal(audit.rows[0].n, 2);
  });
});
