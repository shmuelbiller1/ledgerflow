/**
 * Independent Audit Probe 02 (2026-11-16, main f6ff005) — Findings C1, F, G
 * Proves against live PostgreSQL (`lf_test`) + the real Express routes that:
 *   C1: `PUT /api/v1/transactions/:id` as bookkeeper allows `{ partialUpdate: { exchangeRate: 9.99, currency: 'JPY' } }`,
 *       corrupting stored entry currency/rate in place (`200`).
 *   F:  (1) `reportRoutes.ts` endpoints (`balance-sheet`, `trial-balance`, `cash-flow`, `budget-vs-actual`,
 *           `general-ledger`, `aging`, `statement`) return `500` instead of `403` for non-member stranger;
 *       (2) `brainRoutes.ts` `/analyze` and `/classify` return `500` instead of `403`/`402` on cross-ws API key,
 *           read-only viewer, and zero-credit workspace;
 *       (3) `rememberReport` clears the whole 500-entry `REPORT_CACHE` once saturated with junk queries.
 *   G:  Owner PDF preview (`GET /api/v1/documents/invoice/:id/pdf`) stamps `originalIssuedAt`, causing the
 *       actual issuance/email `takeCopyMark` to receive `'copy'` instead of `'original'` (`AF11-10`).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import { getDb } from '../../../src/server/db/firestore';
import { createApp } from '../../../server';
import { REPORT_CACHE_LIMIT, rememberReport, reportCacheSize } from '../../../src/server/routes/reportRoutes';
import { takeCopyMark } from '../../../src/server/services/copyMarkService';

async function main() {
  const db = getDb();
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_a9p2_${tag}`;
  const wsOther = `ws_a9p2_other_${tag}`;
  const owner = crypto.randomUUID();
  const bookkeeper = crypto.randomUUID();
  const viewer = crypto.randomUUID();
  const stranger = crypto.randomUUID();

  const issuer = 'https://a9p2.test.invalid';
  const secretText = `a9p2-${crypto.randomBytes(24).toString('hex')}`;
  process.env.SUPABASE_URL = issuer;
  process.env.SUPABASE_JWT_SECRET = secretText;

  const mint = (sub: string) =>
    new SignJWT({ role: 'authenticated', aal: 'aal2', email: `${sub}@a9p2.test.invalid` })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuer(`${issuer}/auth/v1`).setAudience('authenticated')
      .setExpirationTime('15m').sign(new TextEncoder().encode(secretText));

  await db.pool.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now()), ($5, $6, now()), ($7, $8, now())',
    [owner, `${owner}@a9p2.test`, bookkeeper, `${bookkeeper}@a9p2.test`, viewer, `${viewer}@a9p2.test`, stranger, `${stranger}@a9p2.test`],
  );

  const ilTax = { books: { place: { country: 'IL' } } };
  await db.collection('workspaces').doc(wsId).set({
    id: wsId, uid: owner, name: 'Probe 02', currency: 'USD',
    members: [owner, bookkeeper, viewer],
    roles: { [owner]: 'owner', [bookkeeper]: 'bookkeeper', [viewer]: 'viewer' },
    taxProfiles: ilTax,
    computeCreditBalance: 1000,
  });
  await db.collection('workspaces').doc(wsOther).set({
    id: wsOther, uid: owner, name: 'Other', currency: 'USD',
    members: [owner], roles: { [owner]: 'owner' },
    computeCreditBalance: 1000,
  });

  const expId = `${wsId}_exp`;
  const cashId = `${wsId}_cash`;
  await db.collection('chartAccounts').doc(expId).set({ id: expId, workspaceId: wsId, name: 'Supplies', type: 'expense', code: '6000' });
  await db.collection('chartAccounts').doc(cashId).set({ id: cashId, workspaceId: wsId, name: 'Cash', type: 'asset', category: 'Cash', code: '1000' });

  const txId = `${wsId}_tx1`;
  await db.collection('transactions').doc(txId).set({
    id: txId, workspaceId: wsId, uid: owner, date: '2026-10-15', description: 'Manual Entry',
    status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1, totalAmountCents: 11000,
    lines: [
      { id: 'l1', accountId: expId, accountName: 'Supplies', amountCents: 11000 },
      { id: 'l2', accountId: cashId, accountName: 'Cash', amountCents: -11000 },
    ],
  });

  const invId = `${wsId}_inv_il`;
  await db.collection('invoices').doc(invId).set({
    id: invId, workspaceId: wsId, uid: owner, number: 'INV-IL-1', customerId: 'c1', customerName: 'Acme IL',
    date: '2026-10-15', status: 'sent', amountCents: 11800, items: [{ description: 'Service', quantity: 1, amountCents: 10000 }],
  });

  const keyId = `lf_id_${wsId}_deadbeef`;
  const keySecret = 'probe2secret123';
  await db.collection('apiKeys').doc(keyId).set({
    id: keyId, workspaceId: wsId, uid: owner,
    keyHash: crypto.createHash('sha256').update(keySecret).digest('hex'),
    scopes: ['brain:analyze', 'read:transactions', 'write:transactions'],
    expiresAt: 'never',
  });

  const [ownerJwt, bkJwt, viewerJwt, strangerJwt] = await Promise.all([mint(owner), mint(bookkeeper), mint(viewer), mint(stranger)]);
  const app = await createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>(r => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // C1: partialUpdate currency/exchangeRate
    const c1Res = await fetch(`${base}/api/v1/transactions/${txId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bkJwt}` },
      body: JSON.stringify({ partialUpdate: { exchangeRate: 9.99, currency: 'JPY' } }),
    });
    const txAfter = (await db.collection('transactions').doc(txId).get()).data();

    // F1: Report routes returning 500 on stranger
    const reportPaths = [
      `/api/v1/reports/balance-sheet?workspaceId=${wsId}&endDate=2026-10-31`,
      `/api/v1/reports/trial-balance?workspaceId=${wsId}`,
      `/api/v1/reports/cash-flow?workspaceId=${wsId}&startDate=2026-10-01&endDate=2026-10-31`,
      `/api/v1/reports/budget-vs-actual?workspaceId=${wsId}&month=2026-10`,
      `/api/v1/reports/general-ledger?workspaceId=${wsId}&startDate=2026-10-01&endDate=2026-10-31`,
      `/api/v1/reports/aging?workspaceId=${wsId}&type=ar`,
      `/api/v1/reports/statement?workspaceId=${wsId}&type=customer&contactId=c1`,
    ];
    const reportStatuses: Record<string, number> = {};
    for (const p of reportPaths) {
      const r = await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${strangerJwt}` } });
      reportStatuses[p.split('?')[0]] = r.status;
    }

    // F2: brainRoutes 500s
    const brainCrossWs = await fetch(`${base}/api/v1/brain/classify`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${keyId}.${keySecret}` },
      body: JSON.stringify({ workspaceId: wsOther, description: 'Coffee' }),
    });
    const brainViewer = await fetch(`${base}/api/v1/brain/classify`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${viewerJwt}` },
      body: JSON.stringify({ workspaceId: wsId, description: 'Coffee' }),
    });
    await db.collection('workspaces').doc(wsId).update({ computeCreditBalance: 0 });
    const brainZeroCredits = await fetch(`${base}/api/v1/brain/classify`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerJwt}` },
      body: JSON.stringify({ workspaceId: wsId, description: 'Coffee' }),
    });
    await db.collection('workspaces').doc(wsId).update({ computeCreditBalance: 1000 });

    // F3: REPORT_CACHE wipe thrashing
    const t0 = Date.now();
    rememberReport(`legit_hot_${tag}`, { ok: true }, t0);
    for (let i = 0; i < REPORT_CACHE_LIMIT + 5; i++) {
      rememberReport(`junk_${tag}_${i}`, { ok: i }, t0 + 100);
    }
    const cacheSizeAfterFlood = reportCacheSize();

    // G: Owner preview consumes copyMark original
    const previewRes = await fetch(`${base}/api/v1/documents/invoice/${invId}/pdf?workspaceId=${wsId}&preview=1`, {
      headers: { authorization: `Bearer ${ownerJwt}` },
    });
    const nextEmailCopyMark = await takeCopyMark(db, 'invoice', invId, { taxProfiles: ilTax });

    console.log(JSON.stringify({
      probe: 'A9_probe02_tx_fx_partial_update_report_brain_500s_and_copymark',
      C1_partialUpdateStatus: c1Res.status,
      C1_mutatedCurrency: txAfter?.currency,
      C1_mutatedExchangeRate: txAfter?.exchangeRate,
      F1_reportStrangerStatuses: reportStatuses,
      F2_brainCrossWsStatus: brainCrossWs.status,
      F2_brainViewerStatus: brainViewer.status,
      F2_brainZeroCreditsStatus: brainZeroCredits.status,
      F3_cacheSizeAfterFlood: cacheSizeAfterFlood,
      G_previewStatus: previewRes.status,
      G_copyMarkLeftForEmail: nextEmailCopyMark,
    }, null, 2));

    assert.equal(c1Res.status, 200);
    assert.equal(txAfter?.currency, 'JPY');
    assert.equal(txAfter?.exchangeRate, 9.99);
    assert.ok(Object.values(reportStatuses).every(s => s === 500), `Expected all 500: ${JSON.stringify(reportStatuses)}`);
    assert.equal(brainCrossWs.status, 500);
    assert.equal(brainViewer.status, 500);
    assert.equal(brainZeroCredits.status, 500);
    assert.ok(cacheSizeAfterFlood < 20, `Expected full cache clear thrashing, got ${cacheSizeAfterFlood}`);
    assert.equal(previewRes.status, 200);
    assert.equal(nextEmailCopyMark, 'copy');
  } finally {
    server.close();
    for (const table of ['transactions', 'invoices', 'chartAccounts', 'apiKeys', 'auditLogs', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = any($1) or id = any($1)`, [[wsId, wsOther]]).catch(() => {});
    }
    await db.pool.query('delete from auth.users where id = any($1::uuid[])', [[owner, bookkeeper, viewer, stranger]]).catch(() => {});
    await db.terminate();
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
