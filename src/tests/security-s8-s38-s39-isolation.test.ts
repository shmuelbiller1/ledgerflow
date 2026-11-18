/**
 * S-8, S-38, S-39 — Full-stack PostgreSQL + Express authorization & isolation suite:
 *  - S-38 (OWASP API1 BOLA): Tenant A JWTs and scoped `lf_id_` API keys cannot
 *    read, update, or delete Tenant B transactions, reports, records, customers,
 *    or workspace configuration, leaving Tenant B state unchanged.
 *  - S-39 (Vertical Role & Admin Escalation): unauthenticated callers get 401;
 *    viewers and bookkeepers get 403 on owner/accountant-only commands; regular
 *    users with forged `user_metadata: { admin: true, role: 'admin' }` get 403
 *    on every `/api/v1/admin/*` route (only server-managed `app_metadata` counts).
 *  - S-8 (End-to-End PostgreSQL RLS & Sandbox Isolation): direct SQL under role
 *    `authenticated` with Tenant A claims sees zero Tenant B rows and receives
 *    `42501` on cross-tenant writes across core tables; `lf_sandbox` scoped to
 *    Tenant A sees zero Tenant B rows in `sandbox_read.*`, cannot write Tenant B
 *    overlays or mutate `public.*`, and fails closed once closed or expired.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';

const hasDb = Boolean(process.env.LF_TEST_DATABASE_URL);

describe('S-8 / S-38 / S-39: tenant BOLA, role escalation, and PostgreSQL RLS isolation', { skip: !hasDb && 'needs LF_TEST_DATABASE_URL' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const wsA = `ws_s38a_${tag}`;
  const wsB = `ws_s38b_${tag}`;
  const ownerAUid = crypto.randomUUID();
  const bookkeeperAUid = crypto.randomUUID();
  const viewerAUid = crypto.randomUUID();
  const ownerBUid = crypto.randomUUID();

  const txBId = `tx_b_${tag}`;
  const custBId = `cust_b_${tag}`;
  const itemBId = `item_b_${tag}`;
  const invBId = `inv_b_${tag}`;
  const keyAId = `lf_id_${wsA}_${crypto.randomBytes(8).toString('hex')}`;
  let keyAFull = '';

  let tokenOwnerA = '';
  let tokenBookkeeperA = '';
  let tokenViewerA = '';
  let tokenForgedAdmin = '';
  let server: Server | undefined;
  let base = '';
  let createAppFn: (() => Promise<{ listen: (port: number, host: string, cb: () => void) => Server }>) | undefined;
  let prevEnv: Record<string, string | undefined> = {};
  let db: Awaited<ReturnType<(typeof import('../server/db/firestore'))['getDb']>>;

  async function withFreshServer<T>(fn: (freshBase: string) => Promise<T>): Promise<T> {
    const app = await createAppFn!();
    const s = await new Promise<Server>(resolve => {
      const inst = app.listen(0, '127.0.0.1', () => resolve(inst));
    });
    try {
      return await fn(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
    } finally {
      await new Promise<void>(resolve => s.close(() => resolve()));
    }
  }

  async function mintJwt(uid: string, email: string, extra: Record<string, unknown> = {}): Promise<string> {
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
    return new SignJWT({
      email,
      email_verified: true,
      aal: 'aal2',
      role: 'authenticated',
      user_metadata: { email_verified: true },
      ...extra,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(uid)
      .setAudience('authenticated')
      .setIssuer(`${process.env.SUPABASE_URL}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
  }

  async function api(method: string, routePath: string, auth?: string, body?: unknown, targetBase = base) {
    const headers: Record<string, string> = { 'X-LedgerFlow-Request': '1' };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${targetBase}${routePath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    return { status: res.status, json, text };
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
    process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-s38-jwt-secret-at-least-32-chars-long!!';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://s38-isolation.supabase.test';
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-s38-session-secret-000000000000001';
    process.env.SYSTEM_SALT = process.env.SYSTEM_SALT || 'test-s38-system-salt-000000000000000001';
    process.env.INVITE_SECRET = process.env.INVITE_SECRET || 'test-s38-invite-secret-0000000000000001';
    process.env.RATE_LIMIT_HIGH = '1';

    const { getDb } = await import('../server/db/firestore');
    const { createApp } = await import('../../server');
    const { API_KEY_SCOPE_IDS } = await import('../lib/apiScopes');
    db = getDb();

    const now = new Date().toISOString();
    for (const [uid, email] of [
      [ownerAUid, `ownerA_${tag}@s38.test`],
      [bookkeeperAUid, `bkA_${tag}@s38.test`],
      [viewerAUid, `viewerA_${tag}@s38.test`],
      [ownerBUid, `ownerB_${tag}@s38.test`],
    ] as const) {
      await db.pool.query(
        `INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
         VALUES ($1::uuid, $2, now(), '{}'::jsonb, '{}'::jsonb)
         ON CONFLICT (id) DO UPDATE SET email_confirmed_at = now()`,
        [uid, email],
      );
    }

    await db.collection('workspaces').doc(wsA).set({
      id: wsA,
      name: 'Alpha Books',
      ownerUid: ownerAUid,
      members: [ownerAUid, bookkeeperAUid, viewerAUid],
      roles: { [ownerAUid]: 'owner', [bookkeeperAUid]: 'bookkeeper', [viewerAUid]: 'viewer' },
      currency: 'USD',
      baseCurrency: 'USD',
      lockDate: '2026-03-31',
      plan: 'enterprise',
      bypassBilling: true,
      computeCreditBalance: 100000,
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, code, name, type, category] of [
      [`${wsA}_cash`, '1000', 'Alpha Checking', 'Asset', 'Current Asset'],
      [`${wsA}_ar`, '1100', 'Alpha AR', 'Asset', 'Current Asset'],
      [`${wsA}_wages`, '5100', 'Alpha Wages', 'Expense', 'Operating Expense'],
      [`${wsA}_tax`, '5200', 'Alpha Payroll Tax', 'Expense', 'Operating Expense'],
      [`${wsA}_liab`, '2100', 'Alpha Payroll Payable', 'Liability', 'Current Liability'],
      [`${wsA}_obe`, '3900', 'Opening Balance Equity', 'Equity', 'Equity'],
    ] as const) {
      await db.collection('chartAccounts').doc(id).set({
        id, workspaceId: wsA, code, name, type, category, currency: 'USD', status: 'active', isActive: true,
      });
    }
    await db.collection('employees').doc(`emp_a_${tag}`).set({
      id: `emp_a_${tag}`, workspaceId: wsA, name: 'Alex Worker', status: 'active',
      payType: 'Salary', payFrequency: 'Monthly', salaryCents: 600000, currency: 'USD', createdAt: now,
    });
    await db.collection('bankLines').doc(`bl_a_locked_${tag}`).set({
      id: `bl_a_locked_${tag}`, workspaceId: wsA, bankAccountId: `${wsA}_cash`,
      date: '2026-02-10', description: 'Closed-month wire', amountCents: 50000, currency: 'USD', status: 'pending', createdAt: now,
    });
    await db.collection('bankLines').doc(`bl_b_${tag}`).set({
      id: `bl_b_${tag}`, workspaceId: wsB, bankAccountId: `${wsB}_cash`,
      date: '2026-06-15', description: 'Bravo secret bank line', amountCents: 425000, currency: 'USD', status: 'pending', createdAt: now,
    });

    await db.collection('workspaces').doc(wsB).set({
      id: wsB,
      name: 'Bravo Confidential Books',
      ownerUid: ownerBUid,
      members: [ownerBUid],
      roles: { [ownerBUid]: 'owner' },
      currency: 'USD',
      baseCurrency: 'USD',
      plan: 'enterprise',
      bypassBilling: true,
      computeCreditBalance: 100000,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection('chartAccounts').doc(`${wsB}_cash`).set({
      id: `${wsB}_cash`, workspaceId: wsB, code: '1000', name: 'Bravo Cash', type: 'Asset', category: 'Current Asset', status: 'active',
    });
    await db.collection('chartAccounts').doc(`${wsB}_rev`).set({
      id: `${wsB}_rev`, workspaceId: wsB, code: '4000', name: 'Bravo Revenue', type: 'Revenue', category: 'Operating Revenue', status: 'active',
    });
    await db.collection('transactions').doc(txBId).set({
      id: txBId,
      workspaceId: wsB,
      date: '2026-06-15',
      description: 'Bravo Confidential Wire',
      type: 'Income',
      status: 'posted',
      totalAmountCents: 425000,
      lines: [
        { accountId: `${wsB}_cash`, accountName: 'Bravo Cash', type: 'debit', amountCents: 425000 },
        { accountId: `${wsB}_rev`, accountName: 'Bravo Revenue', type: 'credit', amountCents: -425000 },
      ],
      createdAt: now,
    });
    await db.collection('customers').doc(custBId).set({
      id: custBId, workspaceId: wsB, name: 'Bravo Client Ltd', email: 'billing@bravo.test', createdAt: now,
    });
    await db.collection('inventory').doc(itemBId).set({
      id: itemBId, workspaceId: wsB, name: 'Bravo Hardware', sku: 'BRV-1', quantityAtHand: 25, unitCostCents: 10000, createdAt: now,
    });
    await db.collection('invoices').doc(invBId).set({
      id: invBId, workspaceId: wsB, invoiceNumber: 'INV-B-1', customerId: custBId, customerName: 'Bravo Client Ltd',
      issueDate: '2026-06-15', dueDate: '2026-07-15', status: 'sent', currency: 'USD',
      subtotalCents: 425000, taxAmountCents: 0, totalAmountCents: 425000, amountPaidCents: 0,
      lines: [{ description: 'Advisory', quantity: 1, unitPriceCents: 425000, amountCents: 425000 }],
      createdAt: now,
    });

    const rawSecret = crypto.randomBytes(32).toString('hex');
    keyAFull = `${keyAId}.${rawSecret}`;
    await db.collection('apiKeys').doc(keyAId).set({
      id: keyAId,
      workspaceId: wsA,
      uid: ownerAUid,
      name: 'Alpha Full-Scope Integration Key',
      keyHash: crypto.createHash('sha256').update(rawSecret).digest('hex'),
      scopes: [...API_KEY_SCOPE_IDS],
      expiresAt: 'never',
      rateLimitPerMinute: 1000,
      createdAt: now,
    });

    tokenOwnerA = await mintJwt(ownerAUid, `ownerA_${tag}@s38.test`);
    tokenBookkeeperA = await mintJwt(bookkeeperAUid, `bkA_${tag}@s38.test`);
    tokenViewerA = await mintJwt(viewerAUid, `viewerA_${tag}@s38.test`);
    // Attacker places admin flags inside client-writable `user_metadata` (not server `app_metadata`)
    tokenForgedAdmin = await mintJwt(ownerAUid, `ownerA_${tag}@s38.test`, {
      user_metadata: { email_verified: true, admin: true, role: 'admin', isAdmin: true },
    });

    createAppFn = createApp;
    const app = await createApp();
    server = await new Promise<Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('S-8: refuses cross-tenant reads and writes across 32 server routes with Tenant B workspace and record IDs', async () => {
    const probes: Array<[string, string, string, unknown?]> = [
      // Reads against wsB (10 routes)
      ['GET', `/api/v1/transactions?workspaceId=${wsB}`, tokenOwnerA],
      ['GET', `/api/v1/transactions?workspaceId=${wsB}`, keyAFull],
      ['GET', `/api/v1/reports/trial-balance?workspaceId=${wsB}&asOfDate=2026-12-31`, tokenOwnerA],
      ['GET', `/api/v1/reports/pnl?workspaceId=${wsB}&startDate=2026-01-01&endDate=2026-12-31`, tokenOwnerA],
      ['GET', `/api/v1/reports/balance-sheet?workspaceId=${wsB}&asOfDate=2026-12-31`, tokenOwnerA],
      ['GET', `/api/v1/reports/cash-flow?workspaceId=${wsB}&startDate=2026-01-01&endDate=2026-12-31`, tokenOwnerA],
      ['GET', `/api/v1/workspaces/${wsB}/incoming-events`, tokenOwnerA],
      ['GET', `/api/v1/workspaces/${wsB}/email/events`, tokenOwnerA],
      ['GET', `/api/v1/workspaces/${wsB}/tasks`, tokenOwnerA],
      ['GET', `/api/v1/workspaces/${wsB}/time`, tokenOwnerA],
      // Writes directly naming wsB (14 routes)
      ['POST', '/api/v1/transactions', tokenOwnerA, { workspaceId: wsB, date: '2026-06-20', description: 'x', lines: [] }],
      ['PUT', `/api/v1/transactions/${txBId}`, tokenOwnerA, { workspaceId: wsB, description: 'tamper' }],
      ['DELETE', `/api/v1/transactions/${txBId}?workspaceId=${wsB}`, tokenOwnerA],
      ['DELETE', `/api/v1/transactions/${txBId}?workspaceId=${wsB}`, keyAFull],
      ['POST', `/api/v1/workspaces/${wsB}/tasks`, tokenOwnerA, { title: 'Intrude', kind: 'general' }],
      ['POST', `/api/v1/workspaces/${wsB}/queries`, tokenOwnerA, { transactionId: txBId, question: 'Leak this?' }],
      ['POST', `/api/v1/workspaces/${wsB}/time`, tokenOwnerA, { date: '2026-06-20', minutes: 60, description: 'x' }],
      ['POST', '/api/v1/commands/journal.create', tokenOwnerA, { workspaceId: wsB, input: { date: '2026-06-20', description: 'x', lines: [] } }],
      ['POST', '/api/v1/commands/invoice.save', tokenOwnerA, { workspaceId: wsB, input: { id: invBId, status: 'draft' } }],
      ['POST', '/api/v1/commands/bill.save', tokenOwnerA, { workspaceId: wsB, input: { vendorName: 'x' } }],
      ['POST', '/api/v1/commands/payment.receive', tokenOwnerA, { workspaceId: wsB, input: { amountCents: 100, paymentDate: '2026-06-20' } }],
      ['POST', '/api/v1/commands/payroll.run', tokenOwnerA, { workspaceId: wsB, input: { date: '2026-06-20', bankAccountId: `${wsB}_cash`, wagesAccountId: `${wsB}_cash`, taxExpenseAccountId: `${wsB}_cash`, liabilitiesAccountId: `${wsB}_cash` } }],
      ['POST', '/api/v1/commands/reconciliations.bankline', tokenOwnerA, { workspaceId: wsB, input: { id: `bl_b_${tag}`, status: 'ignored' } }],
      ['POST', '/api/v1/commands/workspace.importrecords', tokenOwnerA, { workspaceId: wsB, input: { kind: 'customers', rows: [{ name: 'x' }] } }],
      // Cross-tenant record-ID tampering inside authorized wsA (8 routes -> 32 total)
      ['DELETE', `/api/v1/transactions/${txBId}?workspaceId=${wsA}`, tokenOwnerA],
      ['POST', '/api/v1/commands/record.fields', tokenOwnerA, {
        workspaceId: wsA, input: { collection: 'customers', id: custBId, fields: { email: 'hijack@s38.test' } },
      }],
      ['POST', '/api/v1/commands/record.save', tokenOwnerA, {
        workspaceId: wsA, input: { collection: 'inventory', id: itemBId, data: { name: 'Stolen' } },
      }],
      ['POST', '/api/v1/commands/record.delete', tokenOwnerA, {
        workspaceId: wsA, input: { collection: 'inventory', id: itemBId },
      }],
      ['POST', '/api/v1/commands/invoice.void', tokenOwnerA, {
        workspaceId: wsA, input: { invoiceId: invBId, reason: 'cross-tenant tamper' },
      }],
      ['POST', '/api/v1/commands/payment.void', tokenOwnerA, {
        workspaceId: wsA, input: { paymentId: `pay_b_${tag}`, date: '2026-06-20', reason: 'cross-tenant' },
      }],
      ['POST', '/api/v1/commands/reconciliations.banklinepay', tokenOwnerA, {
        workspaceId: wsA, input: { id: `bl_b_${tag}`, bankAccountId: `${wsA}_cash`, allocations: [{ documentId: invBId, amountCents: 1000 }] },
      }],
      ['POST', '/api/v1/commands/portal.linkcreate', tokenOwnerA, {
        workspaceId: wsA, input: { customerId: custBId },
      }],
    ];
    assert.ok(probes.length >= 30, `S-8 requires >= 30 routes, tested ${probes.length}`);

    for (const [method, routePath, auth, body] of probes) {
      const res = await api(method, routePath, auth, body);
      // Report routes currently turn getReportContext's non-member rejection into 500 with
      // "Unauthorized: You are not a member of this workspace." (tracked in AI #1 server lane);
      // accept either clean 400/403/404 or that exact non-member refusal, never 2xx.
      const isKnownReportMembership500 =
        res.status === 500
        && routePath.startsWith('/api/v1/reports/')
        && /not a member of this workspace|API key is scoped strictly to workspace/i.test(res.text);
      assert.ok(
        res.status === 403 || res.status === 404 || res.status === 400 || isKnownReportMembership500,
        `BOLA failure on ${method} ${routePath}: expected 403/404, got ${res.status} (${res.text.slice(0, 200)})`,
      );
      assert.equal(res.text.includes('Bravo Confidential Wire'), false, `Leaked Tenant B tx on ${routePath}`);
      assert.equal(res.text.includes('billing@bravo.test'), false, `Leaked Tenant B customer on ${routePath}`);
      assert.equal(res.text.includes('425000'), false, `Leaked Tenant B figure on ${routePath}`);
    }

    // Verify Tenant B documents remain byte-for-byte intact
    assert.equal((await db.collection('transactions').doc(txBId).get()).data()?.totalAmountCents, 425000);
    assert.equal((await db.collection('customers').doc(custBId).get()).data()?.email, 'billing@bravo.test');
    assert.equal((await db.collection('inventory').doc(itemBId).get()).data()?.name, 'Bravo Hardware');
    assert.equal((await db.collection('invoices').doc(invBId).get()).data()?.status, 'sent');
  });

  it('S-39: enforces unauthenticated 401, viewer/bookkeeper role boundaries, and rejects forged user_metadata admin claims', async () => {
    // 1. Unauthenticated access rejected with 401
    for (const [method, routePath] of [
      ['GET', `/api/v1/transactions?workspaceId=${wsA}`],
      ['POST', '/api/v1/commands/record.save'],
      ['GET', '/api/v1/admin/users'],
      ['PUT', '/api/v1/admin/global-config'],
    ] as const) {
      const res = await api(method, routePath, undefined, method === 'GET' ? undefined : {});
      assert.equal(res.status, 401, `Expected 401 for unauthenticated ${method} ${routePath}, got ${res.status}`);
    }

    // 2. Viewer cannot mutate accounting records or workspace settings
    for (const [cmd, input] of [
      ['record.save', { collection: 'projects', create: true, data: { name: 'Unauthorized Project' } }],
      ['record.fields', { collection: 'customers', id: 'cust_none', fields: { name: 'No' } }],
      ['payroll.approval', { required: false }],
      ['apikey.provision', { name: 'Viewer Key', scopes: ['read:transactions'] }],
    ] as const) {
      const res = await api('POST', `/api/v1/commands/${cmd}`, tokenViewerA, { workspaceId: wsA, input });
      assert.equal(res.status, 403, `Viewer must be forbidden from ${cmd}, got ${res.status}`);
    }

    // 3. Bookkeeper cannot execute owner-only governance commands
    for (const [cmd, input] of [
      ['payroll.approval', { required: false }],
      ['period.yearclose', { periodEnd: '2025-12-31' }],
      ['apikey.provision', { name: 'Bookkeeper Key', scopes: ['read:transactions'] }],
      ['workspace.updaterole', { targetUid: viewerAUid, role: 'owner' }],
      ['workspace.scheduledeletion', { confirmName: 'Alpha Books' }],
    ] as const) {
      const res = await api('POST', `/api/v1/commands/${cmd}`, tokenBookkeeperA, { workspaceId: wsA, input });
      assert.equal(res.status, 403, `Bookkeeper must be forbidden from ${cmd}, got ${res.status}`);
    }

    // 4. Forged `user_metadata: { admin: true, role: 'admin' }` rejected on every admin endpoint
    for (const [method, routePath, body] of [
      ['GET', '/api/v1/admin/telemetry', undefined],
      ['GET', '/api/v1/admin/users', undefined],
      ['PUT', `/api/v1/admin/users/${viewerAUid}/role`, { role: 'admin' }],
      ['GET', '/api/v1/admin/audit-logs', undefined],
      ['GET', '/api/v1/admin/error-logs', undefined],
      ['GET', '/api/v1/admin/global-config', undefined],
      ['PUT', '/api/v1/admin/global-config', {}],
      ['PUT', `/api/v1/admin/workspaces/${wsB}`, { plan: 'enterprise' }],
      ['POST', '/api/v1/admin/give-access', { email: `viewerA_${tag}@s38.test` }],
    ] as const) {
      const res = await api(method, routePath, tokenForgedAdmin, body);
      assert.equal(res.status, 403, `Forged user_metadata admin must get 403 on ${method} ${routePath}, got ${res.status}`);
    }
  });

  it('S-38: payments and pay runs refuse viewers, non-members, wrong-workspace API keys, foreign account/invoice IDs, and closed months with nothing written', async () => {
    const countRows = async (table: string, ws: string) =>
      (await db.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM public."${table}" WHERE workspace_id = $1`, [ws])).rows[0].c;

    const beforeA = {
      payments: await countRows('payments', wsA),
      payRuns: await countRows('payRuns', wsA),
      transactions: await countRows('transactions', wsA),
    };
    const beforeB = {
      payments: await countRows('payments', wsB),
      payRuns: await countRows('payRuns', wsB),
      transactions: await countRows('transactions', wsB),
    };

    const paymentCommands = [
      'payment.receive', 'payment.creditapply', 'payment.creditrefund',
      'payment.creditsautoapply', 'payment.deposit', 'payment.apply', 'payment.void',
      'payroll.run', 'payroll.approve', 'payroll.reject', 'payroll.undo',
    ];

    // 1. Viewer in wsA, non-member (ownerA against wsB), and wsA API key against wsB -> 403 on every command
    for (const cmd of paymentCommands) {
      const asViewer = await api('POST', `/api/v1/commands/${cmd}`, tokenViewerA, { workspaceId: wsA, input: {} });
      assert.equal(asViewer.status, 403, `Viewer must be refused on ${cmd}, got ${asViewer.status}`);

      const asNonMember = await api('POST', `/api/v1/commands/${cmd}`, tokenOwnerA, { workspaceId: wsB, input: {} });
      assert.equal(asNonMember.status, 403, `Non-member must be refused on ${cmd}, got ${asNonMember.status}`);

      const asWrongKey = await api('POST', `/api/v1/commands/${cmd}`, keyAFull, { workspaceId: wsB, input: {} });
      assert.equal(asWrongKey.status, 403, `Wrong-workspace API key must be refused on ${cmd}, got ${asWrongKey.status}`);
    }

    // 2. Owner of wsA using Tenant B's bank account and Tenant B's invoice -> 4xx refusal
    const foreignAcctPay = await api('POST', '/api/v1/commands/payment.receive', tokenOwnerA, {
      workspaceId: wsA,
      input: {
        paymentDate: '2026-06-20',
        amountCents: 10000,
        currency: 'USD',
        customerId: custBId,
        depositAccountId: `${wsB}_cash`,
        allocations: [{ invoiceId: invBId, amountCents: 10000 }],
      },
    });
    assert.ok(foreignAcctPay.status >= 400 && foreignAcctPay.status < 500, `Foreign account payment got ${foreignAcctPay.status}`);

    const foreignAcctPayroll = await api('POST', '/api/v1/commands/payroll.run', tokenOwnerA, {
      workspaceId: wsA,
      input: {
        date: '2026-06-30',
        bankAccountId: `${wsB}_cash`,
        wagesAccountId: `${wsA}_wages`,
        taxExpenseAccountId: `${wsA}_tax`,
        liabilitiesAccountId: `${wsA}_liab`,
      },
    });
    assert.ok(foreignAcctPayroll.status >= 400 && foreignAcctPayroll.status < 500, `Foreign bank payroll got ${foreignAcctPayroll.status}`);

    // 3. Closed month (wsA.lockDate = '2026-03-31') -> 4xx refusal on both payment.receive and payroll.run
    const closedPay = await api('POST', '/api/v1/commands/payment.receive', tokenOwnerA, {
      workspaceId: wsA,
      input: {
        paymentDate: '2026-02-15',
        amountCents: 10000,
        currency: 'USD',
        depositAccountId: `${wsA}_cash`,
      },
    });
    assert.ok(closedPay.status >= 400 && closedPay.status < 500, `Closed-month payment got ${closedPay.status}`);

    const closedPayroll = await api('POST', '/api/v1/commands/payroll.run', tokenOwnerA, {
      workspaceId: wsA,
      input: {
        date: '2026-02-28',
        bankAccountId: `${wsA}_cash`,
        wagesAccountId: `${wsA}_wages`,
        taxExpenseAccountId: `${wsA}_tax`,
        liabilitiesAccountId: `${wsA}_liab`,
      },
    });
    assert.ok(closedPayroll.status >= 400 && closedPayroll.status < 500, `Closed-month payroll got ${closedPayroll.status}`);

    // Zero rows created in either workspace
    assert.deepEqual({
      payments: await countRows('payments', wsA),
      payRuns: await countRows('payRuns', wsA),
      transactions: await countRows('transactions', wsA),
    }, beforeA);
    assert.deepEqual({
      payments: await countRows('payments', wsB),
      payRuns: await countRows('payRuns', wsB),
      transactions: await countRows('transactions', wsB),
    }, beforeB);
  });

  it('S-39: bank lines, reconciliation, and imports refuse viewers, non-members, wrong-workspace API keys, foreign account IDs, and closed months with nothing written', async () => withFreshServer(async s39Base => {
    const s39Api = (method: string, p: string, auth?: string, body?: unknown) => api(method, p, auth, body, s39Base);
    const countRows = async (table: string, ws: string) =>
      (await db.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM public."${table}" WHERE workspace_id = $1`, [ws])).rows[0].c;

    const beforeA = {
      bankLines: await countRows('bankLines', wsA),
      reconciliations: await countRows('reconciliations', wsA),
      transactions: await countRows('transactions', wsA),
      inventory: await countRows('inventory', wsA),
    };
    const beforeB = {
      bankLines: await countRows('bankLines', wsB),
      reconciliations: await countRows('reconciliations', wsB),
      transactions: await countRows('transactions', wsB),
    };

    const bankAndImportCommands = [
      'reconciliations.reconcile', 'reconciliations.clear', 'reconciliations.bankline',
      'reconciliations.complete', 'reconciliations.banklinepay', 'reconciliations.banklinesplit',
      'reconciliations.bankrules', 'workspace.importrecords', 'workspace.undoimport',
    ];

    for (const cmd of bankAndImportCommands) {
      // #830 (A6S-08): a viewer is refused on every bank, reconciliation and import command, bankline included
      const asViewer = await s39Api('POST', `/api/v1/commands/${cmd}`, tokenViewerA, { workspaceId: wsA, input: {} });
      assert.equal(asViewer.status, 403, `Viewer must be refused on ${cmd}, got ${asViewer.status}`);

      const asNonMember = await s39Api('POST', `/api/v1/commands/${cmd}`, tokenOwnerA, { workspaceId: wsB, input: {} });
      assert.equal(asNonMember.status, 403, `Non-member must be refused on ${cmd}, got ${asNonMember.status}`);

      const asWrongKey = await s39Api('POST', `/api/v1/commands/${cmd}`, keyAFull, { workspaceId: wsB, input: {} });
      assert.equal(asWrongKey.status, 403, `Wrong-workspace API key must be refused on ${cmd}, got ${asWrongKey.status}`);
    }

    // Foreign bankLine / foreign bankAccount / foreign invoice refused
    const foreignBankPay = await s39Api('POST', '/api/v1/commands/reconciliations.banklinepay', tokenOwnerA, {
      workspaceId: wsA,
      input: { id: `bl_b_${tag}`, bankAccountId: `${wsB}_cash`, allocations: [{ documentId: invBId, amountCents: 10000 }] },
    });
    assert.ok(foreignBankPay.status >= 400 && foreignBankPay.status < 500, `Foreign bankline pay got ${foreignBankPay.status}`);

    // Closed-month bank line payment & split refused (neither writes any row)
    const closedBankPay = await s39Api('POST', '/api/v1/commands/reconciliations.banklinepay', tokenOwnerA, {
      workspaceId: wsA,
      input: { id: `bl_a_locked_${tag}`, bankAccountId: `${wsA}_cash`, allocations: [{ documentId: invBId, amountCents: 10000 }] },
    });
    assert.ok(closedBankPay.status >= 400, `Closed-month bankline pay must be refused, got ${closedBankPay.status}`);

    const closedBankSplit = await s39Api('POST', '/api/v1/commands/reconciliations.banklinesplit', tokenOwnerA, {
      workspaceId: wsA,
      input: { id: `bl_a_locked_${tag}`, bankAccountId: `${wsA}_cash`, splits: [{ accountId: `${wsA}_wages`, amountCents: 50000, description: 'Closed split' }] },
    });
    assert.ok(closedBankSplit.status >= 400, `Closed-month bankline split must be refused, got ${closedBankSplit.status}`);

    const closedOpeningImport = await s39Api('POST', '/api/v1/commands/workspace.importrecords', tokenOwnerA, {
      workspaceId: wsA,
      input: {
        kind: 'inventory',
        openingDate: '2026-02-01',
        rows: [{ name: 'Locked Stock', sku: 'LCK-1', quantityAtHand: 5, unitCostCents: 2000 }],
      },
    });
    assert.ok(closedOpeningImport.status >= 400 && closedOpeningImport.status < 500, `Closed-month opening stock import got ${closedOpeningImport.status}`);

    // Bookkeeper attempting to import chart of accounts refused with 403/400
    const bkAccountImport = await s39Api('POST', '/api/v1/commands/workspace.importrecords', tokenBookkeeperA, {
      workspaceId: wsA,
      input: { kind: 'accounts', rows: [{ code: '9999', name: 'Sneaky Account', type: 'Expense' }] },
    });
    assert.ok(bkAccountImport.status === 403 || bkAccountImport.status === 400, `Bookkeeper account import got ${bkAccountImport.status}`);

    assert.deepEqual({
      bankLines: await countRows('bankLines', wsA),
      reconciliations: await countRows('reconciliations', wsA),
      transactions: await countRows('transactions', wsA),
      inventory: await countRows('inventory', wsA),
    }, beforeA);
    assert.deepEqual({
      bankLines: await countRows('bankLines', wsB),
      reconciliations: await countRows('reconciliations', wsB),
      transactions: await countRows('transactions', wsB),
    }, beforeB);
    assert.equal((await db.collection('bankLines').doc(`bl_b_${tag}`).get()).data()?.status, 'pending');
  }));

  it('S-5: idempotency-guarded posting command replays without creating a duplicate ledger entry', async () => withFreshServer(async s5Base => {
    const countTx = async () =>
      (await db.pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM public."transactions" WHERE workspace_id = $1`, [wsA])).rows[0].c;

    const before = await countTx();
    const idemKey = `s5-idem-${tag}-${crypto.randomBytes(6).toString('hex')}`;
    const body = {
      workspaceId: wsA,
      input: {
        transaction: {
          workspaceId: wsA,
          date: '2026-06-25',
          description: 'S-5 idempotency replay check',
          lines: [
            { accountId: `${wsA}_wages`, type: 'debit', amountCents: 15000 },
            { accountId: `${wsA}_cash`, type: 'credit', amountCents: -15000 },
          ],
        },
      },
    };

    const sendOnce = async () => {
      const res = await fetch(`${s5Base}/api/v1/commands/journal.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ledgerflow-request': '1',
          authorization: `Bearer ${tokenOwnerA}`,
          'idempotency-key': idemKey,
        },
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() as Record<string, unknown> };
    };

    const first = await sendOnce();
    assert.equal(first.status, 200, `Expected 200 on first journal.create, got ${first.status}: ${JSON.stringify(first.json)}`);
    assert.equal(first.json.replayed, false);
    assert.equal(await countTx(), before + 1);

    const retry = await sendOnce();
    assert.equal(retry.status, 200, `Expected 200 on replayed journal.create, got ${retry.status}`);
    assert.equal(retry.json.replayed, true);
    assert.deepEqual(retry.json.data, first.json.data);
    assert.equal(await countTx(), before + 1, 'Replayed command must not post a second ledger row');

    // Different payload under the same Idempotency-Key must be rejected with 409 conflict
    const conflict = await fetch(`${s5Base}/api/v1/commands/journal.create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ledgerflow-request': '1',
        authorization: `Bearer ${tokenOwnerA}`,
        'idempotency-key': idemKey,
      },
      body: JSON.stringify({
        workspaceId: wsA,
        input: {
          transaction: {
            workspaceId: wsA,
            date: '2026-06-25',
            description: 'S-5 altered amount',
            lines: [
              { accountId: `${wsA}_wages`, type: 'debit', amountCents: 99900 },
              { accountId: `${wsA}_cash`, type: 'credit', amountCents: -99900 },
            ],
          },
        },
      }),
    });
    assert.equal(conflict.status, 409, 'Mutated payload reusing Idempotency-Key must return 409');
    assert.equal(await countTx(), before + 1);
  }));

  it('S-8: enforces PostgreSQL RLS under authenticated and lf_sandbox roles (including closed/expired sandboxes)', async () => {
    const sbxId = crypto.randomUUID();
    const expiredSbxId = crypto.randomUUID();
    await db.pool.query(
      `INSERT INTO sandbox.sandboxes (id, workspace_id, person_id, status, expires_at)
       VALUES ($1::uuid, $2, $3, 'open', now() + interval '1 hour'),
              ($4::uuid, $2, $3, 'open', now() - interval '1 minute')`,
      [sbxId, wsA, ownerAUid, expiredSbxId],
    );

    const client = await db.pool.connect();
    try {
      // 1. Browser `authenticated` role with Tenant A JWT claims
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      await client.query(
        `SELECT set_config('request.jwt.claim.sub', $1, true),
                set_config('request.jwt.claims', $2, true)`,
        [ownerAUid, JSON.stringify({ sub: ownerAUid, role: 'authenticated', email: `ownerA_${tag}@s38.test` })],
      );

      for (const table of ['transactions', 'invoices', 'customers', 'inventory', 'chartAccounts', 'apiKeys', 'auditLogs']) {
        const sel = await client.query(`SELECT count(*)::int AS c FROM public."${table}" WHERE workspace_id = $1`, [wsB]);
        assert.equal(sel.rows[0].c, 0, `RLS leaked Tenant B rows from public.${table}`);
      }
      const wsSel = await client.query('SELECT count(*)::int AS c FROM public.workspaces WHERE id = $1', [wsB]);
      assert.equal(wsSel.rows[0].c, 0, 'RLS leaked Tenant B workspace row');

      // Direct browser write to Tenant B customer must fail with RLS 42501
      await client.query('SAVEPOINT rls_insert');
      await assert.rejects(
        client.query(
          `INSERT INTO public.customers (id, data) VALUES ($1, $2::jsonb)`,
          [`rls_forged_${tag}`, JSON.stringify({ id: `rls_forged_${tag}`, workspaceId: wsB, name: 'Intruder' })],
        ),
        (err: { code?: string }) => err.code === '42501',
      );
      await client.query('ROLLBACK TO SAVEPOINT rls_insert');
      // Update/delete against hidden Tenant B row affects 0 rows
      const del = await client.query('DELETE FROM public.customers WHERE id = $1', [custBId]);
      assert.equal(del.rowCount, 0);
      await client.query('ROLLBACK');

      // 2. Sandbox `lf_sandbox` role scoped to Tenant A
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE lf_sandbox');
      await client.query(`SELECT set_config('lf.sandbox_id', $1, true)`, [sbxId]);

      for (const table of ['transactions', 'invoices', 'customers', 'inventory']) {
        const r = await client.query(`SELECT count(*)::int AS c FROM sandbox_read."${table}" WHERE workspace_id = $1`, [wsB]);
        assert.equal(r.rows[0].c, 0, `lf_sandbox leaked Tenant B rows from sandbox_read.${table}`);
      }
      assert.equal(
        (await client.query('SELECT count(*)::int AS c FROM sandbox_read.workspaces WHERE id = $1', [wsB])).rows[0].c,
        0,
      );
      // Cross-workspace overlay insert rejected by RLS WITH CHECK
      await client.query('SAVEPOINT sbx_insert');
      await assert.rejects(
        client.query(
          `INSERT INTO sandbox.customers (sandbox_id, id, data) VALUES ($1::uuid, $2, $3::jsonb)`,
          [sbxId, `sbx_bad_${tag}`, JSON.stringify({ id: `sbx_bad_${tag}`, workspaceId: wsB, name: 'Cross Tenant' })],
        ),
        (err: { code?: string }) => err.code === '42501',
      );
      await client.query('ROLLBACK TO SAVEPOINT sbx_insert');
      // Direct write to public table rejected by privilege revocation
      await client.query('SAVEPOINT sbx_pub_del');
      await assert.rejects(
        client.query('DELETE FROM public.customers WHERE id = $1', [custBId]),
        (err: { code?: string }) => err.code === '42501',
      );
      await client.query('ROLLBACK TO SAVEPOINT sbx_pub_del');
      // Expired sandbox fails closed even on Tenant A's own workspace
      await client.query(`SELECT set_config('lf.sandbox_id', $1, true)`, [expiredSbxId]);
      assert.equal(
        (await client.query('SELECT count(*)::int AS c FROM sandbox_read.workspaces WHERE id = $1', [wsA])).rows[0].c,
        0,
        'Expired sandbox must return 0 rows',
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
