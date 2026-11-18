/**
 * Independent Audit Probe 03 (2026-11-16, main f6ff005) — Findings A1–A6 & H1
 * Proves against live PostgreSQL (`lf_test`) under `ROLE authenticated` + express/tax math that:
 *   A1: `viewer` inserts `${ws}_stageSets` (`kind: 'stageSets'`) into `public.documents`!
 *   A2: `viewer` inserts spoofed attachment with `linkedCollection`/`linkedId` into `public.documents`!
 *   A3: `viewer` inserts poisoned `kind: 'journalTemplate'` into `public.documents`, which
 *       `GET /api/v1/workspaces/:ws/journal-templates` serves `200` to the owner!
 *   A4: `viewer` inserts unvalidated `kind: 'timeEntry'` (`hours`/`employeeId`/`rateCents`/`status`) into `public.documents`!
 *   A6: `viewer` updates the owner's `public."supportTickets"` status to `'closed'`!
 *   H1: `usSalesTaxReturn` returns `67` instead of `6700` on a `JPY` invoice (`100x` undercount)!
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import express from 'express';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { getDb } from '../../../src/server/db/firestore';
import { journalTemplateRouter } from '../../../src/server/routes/journalTemplateRoutes';
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn';

async function main() {
  const db = getDb();
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_a9p3_${tag}`;
  const owner = `owner_${tag}`;
  const viewer = `viewer_${tag}`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId, uid: owner, name: 'Probe 03 RLS', currency: 'USD',
    members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' },
  });
  await db.collection('supportTickets').doc(`${wsId}_t1`).set({
    id: `${wsId}_t1`, workspaceId: wsId, uid: owner, subject: 'Need help', status: 'open',
  });

  const pool = new pg.Pool({ connectionString: process.env.LF_TEST_DATABASE_URL });
  const client = await pool.connect();

  let stageSetsRows: number;
  let attachmentRows: number;
  let templateRows: number;
  let timeEntryRows: number;
  let ticketUpdateRows: number;

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE authenticated`);
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: viewer, role: 'authenticated', email: 'viewer@test.local' })],
    );

    stageSetsRows = (await client.query(
      `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_stageSets`, JSON.stringify({ workspaceId: wsId, uid: viewer, kind: 'stageSets', sets: { invoices: ['Hacked'] } })],
    )).rowCount ?? 0;

    attachmentRows = (await client.query(
      `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_att1`, JSON.stringify({ workspaceId: wsId, uid: viewer, name: 'spoof.pdf', linkedCollection: 'invoices', linkedId: 'inv_victim', fileUrl: 'data:application/pdf;base64,AA==' })],
    )).rowCount ?? 0;

    templateRows = (await client.query(
      `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_jt1`, JSON.stringify({ workspaceId: wsId, uid: viewer, kind: 'journalTemplate', name: 'Poisoned Payroll', lines: [{ accountId: 'x', debitCents: 99999, creditCents: 0 }] })],
    )).rowCount ?? 0;

    timeEntryRows = (await client.query(
      `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_te1`, JSON.stringify({ workspaceId: wsId, uid: viewer, kind: 'timeEntry', hours: 100, employeeId: 'e1', rateCents: 5000, status: 'approved', date: '2026-11-10' })],
    )).rowCount ?? 0;

    ticketUpdateRows = (await client.query(
      `UPDATE public."supportTickets" SET data = jsonb_set(data, '{status}', '"closed"'::jsonb) WHERE id = $1`,
      [`${wsId}_t1`],
    )).rowCount ?? 0;

    await client.query('COMMIT');
  } finally {
    client.release();
    await pool.end();
  }

  // Verify owner GET /journal-templates serves viewer-injected poisoned template!
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown; userRole?: string }).user = { uid: owner, email: 'owner@test.local' };
    (req as express.Request & { userRole?: string }).userRole = 'owner';
    next();
  });
  app.use('/api/v1/workspaces/:workspaceId/journal-templates', journalTemplateRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>(r => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const tplRes = await fetch(`${base}/api/v1/workspaces/${wsId}/journal-templates`);
    const tplBody = await tplRes.json() as { data?: { templates?: Array<{ name?: string }> } };
    const poisonedServedToOwner = Boolean(tplBody.data?.templates?.some(t => t.name === 'Poisoned Payroll'));

    // H1: usSalesTaxReturn JPY undercount
    const ret = usSalesTaxReturn({
      registration: 'sales_tax:US-TX:TX-1',
      profiles: {
        books: {
          name: 'US Co',
          place: { country: 'US', state: 'TX' },
          registrations: [{ kind: 'sales_tax', place: { country: 'US', state: 'TX' }, number: 'TX-1', validFrom: '2020-01-01', frequency: 'monthly' }],
        },
        entities: {},
      },
      order: [],
      invoices: [{
        id: 'inv_jpy_tx',
        date: '2026-10-15',
        status: 'sent',
        currency: 'JPY',
        exchangeRate: 0.0067,
        amountCents: 10000,
        taxAmountCents: 0,
        items: [],
        taxVersion: 2,
      }],
      customers: [],
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });

    console.log(JSON.stringify({
      probe: 'A9_probe03_rls_documents_support_tickets_and_jpy_sales_tax',
      viewerStageSetsInserted: stageSetsRows,
      viewerAttachmentInserted: attachmentRows,
      viewerJournalTemplateInserted: templateRows,
      viewerTimeEntryInserted: timeEntryRows,
      viewerClosedOwnerTicket: ticketUpdateRows,
      ownerServedPoisonedTemplate: poisonedServedToOwner,
      usSalesTaxReturnJpyGrossSalesCents: ret.grossSalesCents,
      expectedUsdGrossSalesCents: 6700,
    }, null, 2));

    assert.equal(stageSetsRows, 1);
    assert.equal(attachmentRows, 1);
    assert.equal(templateRows, 1);
    assert.equal(timeEntryRows, 1);
    assert.equal(ticketUpdateRows, 1);
    assert.equal(poisonedServedToOwner, true);
    assert.equal(ret.grossSalesCents, 67);
  } finally {
    server.close();
    await db.pool.query(`delete from public.documents where workspace_id = $1`, [wsId]).catch(() => {});
    await db.pool.query(`delete from public."supportTickets" where workspace_id = $1`, [wsId]).catch(() => {});
    await db.pool.query(`delete from public.workspaces where id = $1`, [wsId]).catch(() => {});
    await db.terminate();
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
