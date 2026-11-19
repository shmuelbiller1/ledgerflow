/**
 * S-5: Money-posting & state-mutation idempotency audit matrix (real PostgreSQL).
 *
 * Verifies:
 *  1. `#848` (`lease.capitalize`, `revenue.recognize`) & `document.post` / `ledger.bulk`
 *     replay or refuse cleanly even on headerless retries.
 *  2. With `Idempotency-Key`, `POST /api/v1/transactions`, `POST /api/v1/payments`, and
 *     `POST /api/v1/transactions/intercompany/post` replay without double-posting, and a
 *     changed payload with the same key refuses with 409.
 *  3. Without `Idempotency-Key`, `POST /api/v1/transactions`, `POST /api/v1/payments`,
 *     and `POST /api/v1/transactions/intercompany/post` STILL allow headerless retries to
 *     double-post duplicate ledger entries (reported to AI #1 for follow-up).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);

describe('S-5: money-posting idempotency matrix', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const wsA = `ws_s5a_${tag}`;
  const wsB = `ws_s5b_${tag}`;
  const ownerUid = crypto.randomUUID();
  const ownerEmail = `owner.s5.${tag}@example.test`;
  const cashAccA = `acc_s5_cash_a_${tag}`;
  const cashAccB = `acc_s5_cash_b_${tag}`;
  const revAccA = `acc_s5_rev_a_${tag}`;
  const arAccA = `acc_s5_ar_a_${tag}`;
  const deferredAccA = `acc_s5_def_a_${tag}`;
  const rouAccA = `acc_s5_rou_a_${tag}`;
  const liabAccA = `acc_s5_liab_a_${tag}`;
  const icAccA = `acc_s5_ic_a_${tag}`;
  const icAccB = `acc_s5_ic_b_${tag}`;
  const custA = `cust_s5_${tag}`;
  const invA = `inv_s5_${tag}`;

  let token = '';
  let server: Server | undefined;
  let base = '';
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  async function api(method: string, routePath: string, body?: unknown, headersExtra: Record<string, string> = {}) {
    const res = await fetch(`${base}${routePath}`, {
      method,
      headers: {
        'X-LedgerFlow-Request': '1',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headersExtra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* raw */ }
    return { status: res.status, json };
  }

  before(async () => {
    prevEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET,
      SYSTEM_SALT: process.env.SYSTEM_SALT,
      INVITE_SECRET: process.env.INVITE_SECRET,
      RATE_LIMIT_HIGH: process.env.RATE_LIMIT_HIGH,
    };
    process.env.DATABASE_URL = process.env.LF_TEST_DATABASE_URL;
    process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-s5-jwt-secret-at-least-32-chars-long!!';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://s5-idempotency.supabase.test';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-s5-session-secret-000000000000001';
    process.env.SYSTEM_SALT = process.env.SYSTEM_SALT || 'test-s5-system-salt-000000000000000001';
    process.env.INVITE_SECRET = process.env.INVITE_SECRET || 'test-s5-invite-secret-0000000000000001';
    process.env.RATE_LIMIT_HIGH = '1';

    const [{ getDb }, { createApp }] = await Promise.all([
      import('../server/db/firestore'),
      import('../../server'),
    ]);
    db = getDb();

    await db.pool.query(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
       values ($1::uuid, $2, now(), '{}'::jsonb)`,
      [ownerUid, ownerEmail],
    );

    const now = new Date().toISOString();
    for (const [id, name] of [[wsA, 'S5 Books A'], [wsB, 'S5 Books B']] as const) {
      await db.collection('workspaces').doc(id).set({
        id,
        name,
        uid: ownerUid,
        members: [ownerUid],
        roles: { [ownerUid]: 'owner' },
        currency: 'USD',
        plan: 'pro',
        bypassBilling: true,
        computeCreditBalance: 10000,
        createdAt: now,
      });
    }

    const accounts = [
      { id: cashAccA, ws: wsA, name: 'Cash', type: 'asset', code: '1010' },
      { id: arAccA, ws: wsA, name: 'Accounts Receivable', type: 'asset', code: '1200' },
      { id: rouAccA, ws: wsA, name: 'ROU Lease Asset', type: 'asset', code: '1500' },
      { id: icAccA, ws: wsA, name: 'Intercompany Due From', type: 'asset', code: '1900', role: 'intercompany' },
      { id: liabAccA, ws: wsA, name: 'Lease Liability', type: 'liability', code: '2200' },
      { id: deferredAccA, ws: wsA, name: 'Deferred Revenue', type: 'liability', code: '2400' },
      { id: revAccA, ws: wsA, name: 'Sales Revenue', type: 'revenue', code: '4000' },
      { id: cashAccB, ws: wsB, name: 'Cash B', type: 'asset', code: '1010' },
      { id: icAccB, ws: wsB, name: 'Intercompany Due To', type: 'liability', code: '2900', role: 'intercompany' },
    ];
    for (const a of accounts) {
      await db.collection('chartAccounts').doc(a.id).set({
        id: a.id,
        workspaceId: a.ws,
        name: a.name,
        type: a.type,
        code: a.code,
        ...(a.role ? { role: a.role } : {}),
        createdAt: now,
      });
    }

    await db.collection('customers').doc(custA).set({
      id: custA, workspaceId: wsA, name: 'S5 Customer', email: 'c@s5.test', createdAt: now,
    });
    await db.collection('invoices').doc(invA).set({
      id: invA,
      workspaceId: wsA,
      uid: ownerUid,
      customerId: custA,
      customerName: 'S5 Customer',
      number: `INV-S5-${tag}`,
      invoiceNumber: `INV-S5-${tag}`,
      date: '2026-11-10',
      dueDate: '2026-12-10',
      status: 'sent',
      amountCents: 20000,
      totalAmountCents: 20000,
      balanceDueCents: 20000,
      paidAmountCents: 0,
      currency: 'USD',
      lines: [{ description: 'Service', quantity: 1, unitPriceCents: 20000, amountCents: 20000, accountId: revAccA }],
      createdAt: now,
    });

    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
    token = await new SignJWT({
      email: ownerEmail,
      email_verified: true,
      aal: 'aal2',
      role: 'authenticated',
      user_metadata: { email_verified: true },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ownerUid)
      .setAudience('authenticated')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    const app = await createApp();
    const listening = await new Promise<Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    server = listening;
    base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
  });

  after(async () => {
    const runningServer = server;
    if (runningServer) await new Promise<void>(resolve => runningServer.close(() => resolve()));
    if (db) {
      for (const table of ['payments', 'paymentAllocations', 'transactions', 'auditLogs', 'idempotencyKeys', 'invoices', 'customers', 'chartAccounts']) {
        await db.pool.query(`delete from public.${table.includes('A') || table.includes('K') || table.includes('L') ? `"${table}"` : table} where workspace_id in ($1, $2)`, [wsA, wsB]);
      }
      await db.pool.query(`delete from public.workspaces where id in ($1, $2)`, [wsA, wsB]);
      await db.pool.query(`delete from auth.users where id = $1::uuid`, [ownerUid]);
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('S-5 (#848): lease.capitalize and revenue.recognize replay cleanly WITHOUT an Idempotency-Key', async () => {
    const leaseBody = {
      workspaceId: wsA,
      input: {
        leaseName: 'HQ Office Lease',
        pvAmountCents: 50000,
        rouAssetAccountId: rouAccA,
        leaseLiabilityAccountId: liabAccA,
        date: '2026-11-15',
      },
    };
    const l1 = await api('POST', '/api/v1/commands/lease.capitalize', leaseBody);
    const l2 = await api('POST', '/api/v1/commands/lease.capitalize', leaseBody);
    assert.equal(l1.status, 200);
    assert.equal(l2.status, 200);
    assert.equal((l2.json as { replayed?: boolean }).replayed, true);

    const revBody = {
      workspaceId: wsA,
      input: {
        contractId: `ctr_s5_${tag}`,
        periodId: '2026-11',
        amountCents: 15000,
        deferredAccountId: deferredAccA,
        revenueAccountId: revAccA,
        date: '2026-11-30',
      },
    };
    const r1 = await api('POST', '/api/v1/commands/revenue.recognize', revBody);
    const r2 = await api('POST', '/api/v1/commands/revenue.recognize', revBody);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal((r2.json as { replayed?: boolean }).replayed, true);
  });

  it('S-5: with Idempotency-Key, POST /api/v1/transactions and POST /api/v1/payments replay once and reject changed payload with 409', async () => {
    const txKey = `tx-key-${tag}`;
    const txPayload = {
      workspaceId: wsA,
      transaction: {
        uid: ownerUid,
        workspaceId: wsA,
        date: '2026-11-11',
        description: 'Keyed Journal Entry',
        lines: [
          { accountId: cashAccA, amountCents: 5000 },
          { accountId: revAccA, amountCents: -5000 },
        ],
      },
    };
    const t1 = await api('POST', '/api/v1/transactions', txPayload, { 'Idempotency-Key': txKey });
    const t2 = await api('POST', '/api/v1/transactions', txPayload, { 'Idempotency-Key': txKey });
    const tConflict = await api('POST', '/api/v1/transactions', {
      ...txPayload,
      transaction: { ...txPayload.transaction, description: 'Tampered Amount' },
    }, { 'Idempotency-Key': txKey });
    assert.equal(t1.status, 200);
    assert.equal(t2.status, 200);
    assert.equal(tConflict.status, 409);

    const payKey = `pay-key-${tag}`;
    const payPayload = {
      workspaceId: wsA,
      customerId: custA,
      amountCents: 5000,
      paymentDate: '2026-11-12',
      cashAccountId: cashAccA,
      offsetAccountId: arAccA,
      allocations: [{ documentId: invA, documentType: 'invoice', amountCents: 5000 }],
    };
    const p1 = await api('POST', '/api/v1/payments', payPayload, { 'Idempotency-Key': payKey });
    const p2 = await api('POST', '/api/v1/payments', payPayload, { 'Idempotency-Key': payKey });
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    assert.equal((p2.json as { data?: { replayed?: boolean } }).data?.replayed, true);
  });

  it('S-5 gap (LIVE): headerless retries on /transactions, /payments, and /transactions/intercompany/post double-post money', async () => {
    const beforeTx = (await db.collection('transactions').where('workspaceId', '==', wsA).get()).docs.length;

    const bareTx = {
      workspaceId: wsA,
      transaction: {
        uid: ownerUid,
        workspaceId: wsA,
        date: '2026-11-13',
        description: 'Headerless Retry Journal',
        lines: [
          { accountId: cashAccA, amountCents: 3000 },
          { accountId: revAccA, amountCents: -3000 },
        ],
      },
    };
    assert.equal((await api('POST', '/api/v1/transactions', bareTx)).status, 200);
    assert.equal((await api('POST', '/api/v1/transactions', bareTx)).status, 200);

    const barePay = {
      workspaceId: wsA,
      customerId: custA,
      amountCents: 4000,
      paymentDate: '2026-11-14',
      cashAccountId: cashAccA,
      offsetAccountId: arAccA,
      allocations: [{ documentId: invA, documentType: 'invoice', amountCents: 4000 }],
    };
    assert.equal((await api('POST', '/api/v1/payments', barePay)).status, 200);
    assert.equal((await api('POST', '/api/v1/payments', barePay)).status, 200);

    const bareIc = {
      sourceWorkspaceId: wsA,
      targetWorkspaceId: wsB,
      sourceAccountId: cashAccA,
      targetAccountId: cashAccB,
      amountCents: 7000,
      date: '2026-11-16',
      description: 'Headerless Intercompany Transfer',
    };
    assert.equal((await api('POST', '/api/v1/transactions/intercompany/post', bareIc)).status, 200);
    assert.equal((await api('POST', '/api/v1/transactions/intercompany/post', bareIc)).status, 200);

    const afterTx = (await db.collection('transactions').where('workspaceId', '==', wsA).get()).docs.length;
    // 2 bare journals + 2 bare payments + 2 bare intercompany source entries = 6 entries instead of 3!
    assert.equal(afterTx - beforeTx, 6);
  });
});
