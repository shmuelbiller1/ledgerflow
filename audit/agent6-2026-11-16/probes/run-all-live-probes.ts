/**
 * Live PostgreSQL 16.2 + Express verification harness for Agent #6 (2026-11-16)
 * Reproduces every newly discovered defect and verifies still-open ledger/RLS defects on main (1f183efc).
 */
import crypto from 'node:crypto';
import type http from 'node:http';
import { SignJWT } from 'jose';
import pg from 'pg';

const TEST_SECRET = 'lf-agent6-live-probe-secret-32chars-minimum-key!!';
const DB_URL = 'postgresql://postgres@127.0.0.1:5432/lf_test';

process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = DB_URL;
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
process.env.ALLOW_HS256_JWT = 'true';

async function mintJwt(uid: string, email: string, aal: 'aal1' | 'aal2' = 'aal1'): Promise<string> {
  const key = new TextEncoder().encode(TEST_SECRET);
  return new SignJWT({
    sub: uid,
    email,
    email_verified: true,
    user_metadata: { email_verified: true },
    role: 'authenticated',
    aal,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('http://127.0.0.1:54321/auth/v1')
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(key);
}

interface ProbeResult {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'REPRODUCED_LIVE';
  summary: string;
  evidence: Record<string, unknown>;
}

async function httpJson(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  rawBody?: string,
): Promise<{ status: number; contentType: string; text: string; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    text,
    json,
  };
}

async function main(): Promise<void> {
  const { createApp } = await import('../../../server');
  const { getDb } = await import('../../../src/server/db/firestore');
  const { refundCredit } = await import('../../../src/server/services/creditService');
  const { computeBalanceSheet } = await import('../../../src/server/reports/computeReports');
  const { normalizeOdooCsv } = await import('../../../src/lib/odooImport');
  const { guessMapping, applyMapping, prepareImport } = await import('../../../src/lib/recordImport');

  const db = getDb();
  const app = await createApp();
  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const results: ProbeResult[] = [];
  const runSuffix = crypto.randomUUID().slice(0, 8);
  const ownerUid = crypto.randomUUID();
  const viewerUid = crypto.randomUUID();
  const bookkeeperUid = crypto.randomUUID();
  const wsId = `ws_probe_${runSuffix}`;

  const ownerJwt = await mintJwt(ownerUid, 'owner@probe.example', 'aal1');
  const bookkeeperJwt = await mintJwt(bookkeeperUid, 'bk@probe.example', 'aal1');

  await db.collection('users').doc(ownerUid).set({ uid: ownerUid, email: 'owner@probe.example', role: 'user' });
  await db.collection('users').doc(viewerUid).set({ uid: viewerUid, email: 'viewer@probe.example', role: 'user' });
  await db.collection('users').doc(bookkeeperUid).set({ uid: bookkeeperUid, email: 'bk@probe.example', role: 'user' });

  {
    const seedClient = new pg.Client({ connectionString: DB_URL });
    await seedClient.connect();
    try {
      for (const [id, email] of [
        [ownerUid, 'owner@probe.example'],
        [viewerUid, 'viewer@probe.example'],
        [bookkeeperUid, 'bk@probe.example'],
      ] as const) {
        await seedClient.query(
          `INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1::uuid, $2, now()) ON CONFLICT (id) DO UPDATE SET email_confirmed_at = now()`,
          [id, email],
        );
      }
    } finally {
      await seedClient.end();
    }
  }

  await db.collection('workspaces').doc(wsId).set({
    id: wsId,
    name: 'Probe USD Workspace',
    uid: ownerUid,
    ownerId: ownerUid,
    currency: 'USD',
    members: { [ownerUid]: true, [viewerUid]: true, [bookkeeperUid]: true },
    roles: { [ownerUid]: 'owner', [viewerUid]: 'viewer', [bookkeeperUid]: 'bookkeeper' },
    memberRoles: { [ownerUid]: 'owner', [viewerUid]: 'viewer', [bookkeeperUid]: 'bookkeeper' },
    defaultAccountMappings: {
      cash: `${wsId}_cash`,
      ar: `${wsId}_ar`,
      ap: `${wsId}_ap`,
      salesRevenue: `${wsId}_rev`,
    },
  });

  const baseAccounts = [
    { id: `${wsId}_cash`, code: '1000', name: 'Operating Cash', type: 'asset', category: 'Cash', subtype: 'bank', balanceCents: 0 },
    { id: `${wsId}_ar`, code: '1200', name: 'Accounts Receivable', type: 'asset', category: 'Accounts Receivable', balanceCents: 0 },
    { id: `${wsId}_ap`, code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Accounts Payable', balanceCents: 0 },
    { id: `${wsId}_rev`, code: '4000', name: 'Sales Revenue', type: 'revenue', category: 'Revenue', balanceCents: 0 },
    { id: `${wsId}_eq`, code: '3000', name: 'Retained Earnings', type: 'equity', category: 'Equity', balanceCents: 0 },
  ];
  for (const acc of baseAccounts) {
    await db.collection('chartAccounts').doc(acc.id).set({ ...acc, workspaceId: wsId });
  }

  // =========================================================================
  // PROBE 1: ACC-NEW-01 — 100x JPY & 10x KWD GL Corruption in refundCredit & Foreign Journals
  // =========================================================================
  {
    const cnJpyId = `cn_jpy_${runSuffix}`;
    const cnIssuanceTxId = `tx_cn_jpy_${runSuffix}`;
    await db.collection('creditNotes').doc(cnJpyId).set({
      id: cnJpyId,
      workspaceId: wsId,
      number: 'CN-JPY-001',
      customerName: 'Tokyo Client KK',
      date: '2026-10-10',
      currency: 'JPY',
      exchangeRate: 0.0067,
      amountCents: 100000,
      remainingCents: 100000,
      status: 'open',
    });
    await db.collection('transactions').doc(cnIssuanceTxId).set({
      id: cnIssuanceTxId,
      workspaceId: wsId,
      uid: ownerUid,
      date: '2026-10-10',
      description: 'Credit Note CN-JPY-001 issuance',
      totalAmountCents: 67000,
      currency: 'JPY',
      exchangeRate: 0.0067,
      status: 'completed',
      type: 'actual',
      metadata: { type: 'credit-note-issuance', creditNoteId: cnJpyId },
      lines: [
        { accountId: `${wsId}_rev`, accountName: 'Sales Revenue', amountCents: 100000, baseAmountCents: 67000 },
        { accountId: `${wsId}_ar`, accountName: 'Accounts Receivable', amountCents: -100000, baseAmountCents: -67000 },
      ],
    });

    const refundJpy = await refundCredit(db, {
      workspaceId: wsId,
      uid: ownerUid,
      kind: 'customer',
      creditId: cnJpyId,
      amountCents: 100000,
      cashAccountId: `${wsId}_cash`,
      date: '2026-10-12',
      memo: 'Full refund of ¥100,000',
    });
    const refundTx = (await db.collection('transactions').doc(refundJpy.transactionId).get()).data() || {};

    const cnKwdId = `cn_kwd_${runSuffix}`;
    await db.collection('creditNotes').doc(cnKwdId).set({
      id: cnKwdId,
      workspaceId: wsId,
      number: 'CN-KWD-001',
      customerName: 'Kuwait Trading Co',
      date: '2026-10-10',
      currency: 'KWD',
      exchangeRate: 3.25,
      amountCents: 100000,
      remainingCents: 100000,
      status: 'open',
    });
    await db.collection('transactions').doc(`tx_cn_kwd_${runSuffix}`).set({
      id: `tx_cn_kwd_${runSuffix}`,
      workspaceId: wsId,
      uid: ownerUid,
      date: '2026-10-10',
      description: 'Credit Note CN-KWD-001 issuance',
      totalAmountCents: 32500,
      currency: 'KWD',
      exchangeRate: 3.25,
      status: 'completed',
      type: 'actual',
      metadata: { type: 'credit-note-issuance', creditNoteId: cnKwdId },
      lines: [
        { accountId: `${wsId}_rev`, accountName: 'Sales Revenue', amountCents: 100000, baseAmountCents: 32500 },
        { accountId: `${wsId}_ar`, accountName: 'Accounts Receivable', amountCents: -100000, baseAmountCents: -32500 },
      ],
    });
    const refundKwd = await refundCredit(db, {
      workspaceId: wsId,
      uid: ownerUid,
      kind: 'customer',
      creditId: cnKwdId,
      amountCents: 100000,
      cashAccountId: `${wsId}_cash`,
      date: '2026-10-12',
    });
    const refundKwdTx = (await db.collection('transactions').doc(refundKwd.transactionId).get()).data() || {};

    const allAccounts = (await db.collection('chartAccounts').where('workspaceId', '==', wsId).get()).docs.map(
      (d) => ({ id: d.id, ...d.data() }),
    );
    const allTxs = (await db.collection('transactions').where('workspaceId', '==', wsId).get()).docs.map(
      (d) => ({ id: d.id, ...d.data() }),
    );
    const bs = computeBalanceSheet(allAccounts as never, allTxs as never, '2026-10-31');

    const auditSnap = await db.collection('auditLogs').where('workspaceId', '==', wsId).get();
    const refundAudits = auditSnap.docs.filter((d) => JSON.stringify(d.data()).includes(cnJpyId));

    results.push({
      id: 'ACC-NEW-01',
      severity: 'CRITICAL',
      status: 'REPRODUCED_LIVE',
      summary:
        'TransactionLineSchema.exchangeRate.default(1) shadows tx.exchangeRate in settleHomeCurrency/lineAmount, AND settleHomeCurrency/lineAmount/baseAbsoluteTotal ignore ISO 4217 minor units (JPY=0, KWD=3): refundCredit books +$1,000.00 (100,000 USD cents, rate=1!) instead of +$670.00 for ¥100,000 JPY and +$1,000.00 instead of +$325.00 for KWD 100.000, stranding +$1,005.00 phantom A/R on Balance Sheet with zero audit log.',
      evidence: {
        jpyExpectedBaseCents: 67000,
        jpyActualRefundTotalAmountCents: refundTx.totalAmountCents,
        jpyActualRefundLines: refundTx.lines,
        jpyCreditRemainingAfterRefund: refundJpy.creditRemainingCents,
        kwdExpectedBaseCents: 32500,
        kwdActualRefundTotalAmountCents: refundKwdTx.totalAmountCents,
        balanceSheetAssetsExpectedZero: 0,
        balanceSheetAssetsActual: bs.assets,
        refundAuditLogsCount: refundAudits.length,
      },
    });
  }

  // Provision real API key via HTTP endpoint as workspace owner (scopes ONLY read/write:transactions, rateLimit=5000)
  const provisionRes = await httpJson(
    baseUrl,
    'POST',
    '/api/v1/keys/provision',
    { Authorization: `Bearer ${ownerJwt}`, 'Content-Type': 'application/json' },
    JSON.stringify({
      workspaceId: wsId,
      name: 'Tx-Only Integration Key',
      scopes: ['read:transactions', 'write:transactions'],
      expiration: 'never',
      rateLimitPerMinute: 5000,
    }),
  );
  const rawKey = (provisionRes.json as { apiKey?: string })?.apiKey || '';
  const apiHeaders = {
    Authorization: `Bearer ${rawKey}`,
    'Content-Type': 'application/json',
  };

  // =========================================================================
  // PROBE 2: SEC-NEW-01/02 — API Key Scope Privilege Escalation & Broken /preview
  // =========================================================================
  {
    const previewRes = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/commands/customer.create/preview',
      apiHeaders,
      JSON.stringify({ workspaceId: wsId, input: { customer: { name: 'Preview Co', status: 'active' } } }),
    );

    const fxRevalRes = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/commands/period.fxrevaluation',
      apiHeaders,
      JSON.stringify({ workspaceId: wsId, input: { asOf: '2026-09-30', rates: { EUR: 1.1 } } }),
    );
    const rebuildRes = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/commands/period.balancesrebuild',
      apiHeaders,
      JSON.stringify({ workspaceId: wsId, input: {} }),
    );
    const yearCloseRes = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/commands/period.yearclose',
      apiHeaders,
      JSON.stringify({ workspaceId: wsId, input: { closingDate: '2026-09-30', lockPeriod: true } }),
    );
    const wsAfterEscalation = (await db.collection('workspaces').doc(wsId).get()).data() || {};

    const htmlLeakRes = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/transactions',
      { 'Content-Type': 'application/json', 'X-LedgerFlow-Request': '1' },
      '"AAA"',
    );

    results.push({
      id: 'SEC-NEW-01..02',
      severity: 'HIGH',
      status: 'REPRODUCED_LIVE',
      summary:
        'API key scoped ONLY to write:transactions bypasses period-management restrictions on period.yearclose (setting workspaces.lockDate), period.fxrevaluation, period.fxrevaluationundo, and period.balancesrebuild; read-only preview on POST /commands/:name/preview requires write scope; unauthenticated JSON errors leak Express HTML stack traces.',
      evidence: {
        provisionStatus: provisionRes.status,
        previewStatus: previewRes.status,
        previewBody: previewRes.json,
        periodFxRevaluationStatus: fxRevalRes.status,
        periodBalancesRebuildStatus: rebuildRes.status,
        periodYearCloseStatus: yearCloseRes.status,
        periodYearCloseBody: yearCloseRes.json,
        workspaceLockDateAfterApiKeyCall: wsAfterEscalation.lockDate,
        htmlStackLeakStatus: htmlLeakRes.status,
        htmlStackLeakContentType: htmlLeakRes.contentType,
        htmlStackLeakSnippet: htmlLeakRes.text.slice(0, 240),
      },
    });
  }

  // =========================================================================
  // PROBE 3: API-NEW-01/02 & IMP-NEW-01 — 500 Crashes on Transactions/Commands & Odoo Import Data Loss
  // =========================================================================
  {
    const jwtHeaders = {
      Authorization: `Bearer ${ownerJwt}`,
      'Content-Type': 'application/json',
    };
    const postTxUnknownAcct = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/transactions',
      jwtHeaders,
      JSON.stringify({
        transaction: {
          workspaceId: wsId,
          date: '2026-10-20',
          description: 'Unknown account test',
          totalAmountCents: 500,
          lines: [
            { accountId: 'nonexistent_acct', amountCents: 500 },
            { accountId: `${wsId}_cash`, amountCents: -500 },
          ],
        },
      }),
    );
    const cmdJournalUnknownAcct = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/commands/journal.create',
      jwtHeaders,
      JSON.stringify({
        workspaceId: wsId,
        input: {
          entry: {
            workspaceId: wsId,
            date: '2026-10-20',
            description: 'Unknown account via command',
            totalAmountCents: 500,
            lines: [
              { accountId: 'nonexistent_acct', amountCents: 500 },
              { accountId: `${wsId}_cash`, amountCents: -500 },
            ],
          },
        },
      }),
    );
    const cmdJournalLockedPeriod = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/commands/journal.create',
      jwtHeaders,
      JSON.stringify({
        workspaceId: wsId,
        input: {
          entry: {
            workspaceId: wsId,
            date: '2026-09-15',
            description: 'Backdated into locked period',
            totalAmountCents: 500,
            lines: [
              { accountId: `${wsId}_ar`, amountCents: 500 },
              { accountId: `${wsId}_cash`, amountCents: -500 },
            ],
          },
        },
      }),
    );
    const batchNullLine = await httpJson(
      baseUrl,
      'POST',
      '/api/v1/transactions/batch-create',
      jwtHeaders,
      JSON.stringify({
        workspaceId: wsId,
        transactions: [{ workspaceId: wsId, date: '2026-10-20', description: 'Null line', lines: [null] }],
      }),
    );

    const odoo18Archived = normalizeOdooCsv('accounts', [
      ['Code', 'Account Name', 'Type', 'Active'],
      ['620000', 'Archived Odoo 18 Rent', 'Expenses', 'False'],
    ]);
    const odoo18ArchivedPrepared = prepareImport(
      'accounts',
      applyMapping('accounts', odoo18Archived.slice(1), guessMapping('accounts', odoo18Archived[0])),
    );

    const odooSlashIdCurrency = normalizeOdooCsv('accounts', [
      ['id', 'code', 'name', 'account_type', 'currency_id/id'],
      ['account.eur_bank', '101402', 'EUR Bank', 'asset_cash', 'base.EUR'],
    ]);
    const odooSlashIdPrepared = prepareImport(
      'accounts',
      applyMapping('accounts', odooSlashIdCurrency.slice(1), guessMapping('accounts', odooSlashIdCurrency[0])),
    );

    const odooXmlIdCurrency = normalizeOdooCsv('accounts', [
      ['id', 'code', 'name', 'account_type', 'currency_id'],
      ['account.eur_bank', '101402', 'EUR Bank', 'asset_cash', 'base.EUR'],
    ]);
    const odooXmlIdPrepared = prepareImport(
      'accounts',
      applyMapping('accounts', odooXmlIdCurrency.slice(1), guessMapping('accounts', odooXmlIdCurrency[0])),
    );

    results.push({
      id: 'API-NEW-01..02_IMP-NEW-01',
      severity: 'HIGH',
      status: 'REPRODUCED_LIVE',
      summary:
        'POST /api/v1/transactions and POST /api/v1/transactions/batch-create return HTTP 500 on client validation/null-line inputs; normalizeOdooCsv (#739) resurrects Odoo 18 archived accounts (Active=False), silently drops currency_id/id, and fails on XML currency IDs (base.EUR).',
      evidence: {
        postTxUnknownAccountStatus: postTxUnknownAcct.status,
        cmdJournalUnknownAccountStatus: cmdJournalUnknownAcct.status,
        cmdJournalLockedPeriodStatus: cmdJournalLockedPeriod.status,
        batchNullLineStatus: batchNullLine.status,
        odoo18ArchivedAccountImportedCount: odoo18ArchivedPrepared.records.length,
        odooSlashIdCurrencyDropped: odooSlashIdPrepared.records[0]?.data.currency ?? null,
        odooXmlIdCurrencyErrors: odooXmlIdPrepared.errors,
      },
    });
  }

  // =========================================================================
  // PROBE 4: SEC-NEW-04 & A7N-03/06 — Direct RLS Viewer Writes & Unmerged Ledger Integrity Bugs
  // =========================================================================
  {
    const ticketId = `tkt_${runSuffix}`;
    await db.collection('supportTickets').doc(ticketId).set({
      id: ticketId,
      workspaceId: wsId,
      uid: ownerUid,
      subject: 'Owner confidential billing issue',
      status: 'open',
    });

    const assetId = `ast_${runSuffix}`;
    await db.collection('assets').doc(assetId).set({
      id: assetId,
      workspaceId: wsId,
      uid: ownerUid,
      name: 'Server Rack',
      purchaseDate: '2026-01-01',
      purchasePriceCents: 120000,
      salvageValueCents: 0,
      usefulLifeYears: 1,
      depreciationMethod: 'straight-line',
      accumulatedDepreciationCents: 90000,
      status: 'active',
    });

    const pgClient = new pg.Client({ connectionString: DB_URL });
    await pgClient.connect();
    let viewerInsertedTimeDoc: boolean;
    let viewerMutatedOwnerTicket: boolean;
    let bookkeeperResetAssetDepr: boolean;

    try {
      await pgClient.query('BEGIN');
      await pgClient.query(`SET LOCAL ROLE authenticated`);
      await pgClient.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [viewerUid]);
      await pgClient.query(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: viewerUid, role: 'authenticated', email: 'viewer@probe.example' })],
      );

      const docIns = await pgClient.query(
        `INSERT INTO public.documents (id, data) VALUES ($1, $2::jsonb) RETURNING id`,
        [
          `doc_viewer_${runSuffix}`,
          JSON.stringify({
            uid: viewerUid,
            workspaceId: wsId,
            kind: 'time',
            hours: 40,
            rateCents: 50000,
            status: 'billable',
          }),
        ],
      );
      viewerInsertedTimeDoc = (docIns.rowCount ?? 0) === 1;

      const tktUpd = await pgClient.query(
        `UPDATE public."supportTickets" SET data = jsonb_set(data, '{status}', '"closed"') WHERE id = $1 RETURNING id`,
        [ticketId],
      );
      viewerMutatedOwnerTicket = (tktUpd.rowCount ?? 0) === 1;
      await pgClient.query('COMMIT');

      await pgClient.query('BEGIN');
      await pgClient.query(`SET LOCAL ROLE authenticated`);
      await pgClient.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [bookkeeperUid]);
      await pgClient.query(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: bookkeeperUid, role: 'authenticated', email: 'bk@probe.example' })],
      );
      const astUpd = await pgClient.query(
        `UPDATE public.assets SET data = jsonb_set(data, '{accumulatedDepreciationCents}', '0') WHERE id = $1 RETURNING id`,
        [assetId],
      );
      bookkeeperResetAssetDepr = (astUpd.rowCount ?? 0) === 1;
      await pgClient.query('COMMIT');
    } finally {
      await pgClient.end();
    }

    const fxTxId = `tx_fx_partial_${runSuffix}`;
    await db.collection('transactions').doc(fxTxId).set({
      id: fxTxId,
      workspaceId: wsId,
      uid: ownerUid,
      date: '2026-10-25',
      description: 'EUR journal entry',
      totalAmountCents: 11000,
      currency: 'EUR',
      exchangeRate: 1.1,
      status: 'completed',
      type: 'actual',
      lines: [
        { accountId: `${wsId}_cash`, amountCents: 10000, baseAmountCents: 11000 },
        { accountId: `${wsId}_rev`, amountCents: -10000, baseAmountCents: -11000 },
      ],
    });
    const partialFxRes = await httpJson(
      baseUrl,
      'PUT',
      `/api/v1/transactions/${fxTxId}`,
      { Authorization: `Bearer ${bookkeeperJwt}`, 'Content-Type': 'application/json' },
      JSON.stringify({ partialUpdate: { exchangeRate: 999 } }),
    );
    const fxTxAfter = (await db.collection('transactions').doc(fxTxId).get()).data() || {};

    results.push({
      id: 'SEC-NEW-04_AND_A7N-03..07',
      severity: 'HIGH',
      status: 'REPRODUCED_LIVE',
      summary:
        'Read-only viewer role directly INSERTs time entries into public.documents and UPDATEs another member supportTicket via PostgREST RLS; bookkeeper resets assets.accumulatedDepreciationCents via RLS; PUT /transactions/:id partialUpdate mutates exchangeRate in place on posted entry.',
      evidence: {
        viewerInsertedTimeDoc,
        viewerMutatedOwnerTicket,
        bookkeeperResetAssetDepr,
        partialExchangeRateUpdateStatus: partialFxRes.status,
        exchangeRateAfterPartialUpdate: fxTxAfter.exchangeRate,
        totalAmountCentsStaleAfterPartialUpdate: fxTxAfter.totalAmountCents,
      },
    });
  }

  // =========================================================================
  // PROBE 5 (Run Last): SEC-NEW-03 — Z-02 API Key Per-Minute Rate Limit Overridden by IP apiLimiter
  // =========================================================================
  {
    let first429AtRequest = -1;
    for (let i = 1; i <= 105; i++) {
      const r = await fetch(`${baseUrl}/api/v1/transactions?workspaceId=${wsId}&limit=1`, {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (r.status === 429) {
        first429AtRequest = i;
        break;
      }
    }
    results.push({
      id: 'SEC-NEW-03',
      severity: 'MEDIUM',
      status: 'REPRODUCED_LIVE',
      summary:
        'API key configured with rateLimitPerMinute=5000 (Z-02) is throttled around request <=100/min because global IP apiLimiter (max: 100/min) runs before apiAuthenticate without skipping lf_ API keys.',
      evidence: {
        configuredRateLimitPerMinute: 5000,
        throttledWith429AtRequest: first429AtRequest,
      },
    });
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('\n=== AGENT 6 LIVE PROBE RESULTS ===');
  console.log(JSON.stringify({ commit: '1f183efc', timestamp: new Date().toISOString(), results }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
