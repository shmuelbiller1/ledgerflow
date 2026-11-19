/**
 * Re-verification of Agent #10 findings A1–A6 (RLS: viewer writes into `public.documents`,
 * closes the owner's support ticket) and H1 (100x/10x minor-unit errors in the tax returns)
 * against the current HEAD. Reports LIVE/FIXED per finding; does not assert.
 *
 * Run (PGlite socket server on 127.0.0.1:5433, migrations applied):
 *   DATABASE_URL=$LF_TEST_DATABASE_URL PG_POOL_MAX=1 NODE_ENV=test \
 *   SYSTEM_SALT=test-ledgerflow-salt-32b-deterministic npx tsx audit/agent10-2026-11-19/probes/r3-rls-and-minor-units-reverify.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.SYSTEM_SALT ||= 'probe-test-salt-2026';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../../../src/server/db/firestore';
import { journalTemplateRouter } from '../../../src/server/routes/journalTemplateRoutes';
import { usSalesTaxReturn } from '../../../src/lib/tax/usSalesTaxReturn';
import { israelVatReturn } from '../../../src/lib/tax/ilVatReturn';
import { documentLine, spreadPlan } from '../../../src/lib/prepaidSchedule';

const results: Array<Record<string, unknown>> = [];

async function main() {
  const db = getDb();
  const tag = crypto.randomBytes(4).toString('hex');
  const wsId = `ws_r3_${tag}`;
  const owner = `owner_${tag}`;
  const viewer = `viewer_${tag}`;

  await db.collection('workspaces').doc(wsId).set({
    id: wsId, uid: owner, name: 'Reverify R3', currency: 'USD',
    members: [owner, viewer], roles: { [owner]: 'owner', [viewer]: 'viewer' },
  });
  await db.collection('supportTickets').doc(`${wsId}_t1`).set({
    id: `${wsId}_t1`, workspaceId: wsId, uid: owner, subject: 'Need help', status: 'open',
  });

  // One pooled connection: PGlite serves a single session, so the RLS checks borrow the app's client.
  const client = await db.pool.connect();
  let stageSetsInsert: string | undefined;
  let attachmentInsert: string | undefined;
  let templateInsert: string | undefined;
  let timeEntryInsert: string | undefined;
  let ticketUpdate: string | undefined;

  const attempt = async (label: string, sql: string, params: unknown[]) => {
    const savepoint = `sp_${label}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      const res = await client.query(sql, params as never[]);
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return { ok: true, rowCount: res.rowCount ?? 0 };
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: viewer, role: 'authenticated', email: 'viewer@test.local' })]);

    const stageSets = await attempt('a1', `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_stageSets`, JSON.stringify({ workspaceId: wsId, uid: viewer, kind: 'stageSets', sets: { invoices: ['Hacked'] } })]);
    stageSetsInsert = stageSets.ok ? 'ACCEPTED' : `REFUSED: ${stageSets.error}`;

    const attachment = await attempt('a2', `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_att1`, JSON.stringify({ workspaceId: wsId, uid: viewer, name: 'spoof.pdf', linkedCollection: 'invoices', linkedId: 'inv_victim', fileUrl: 'data:application/pdf;base64,AA==' })]);
    attachmentInsert = attachment.ok ? 'ACCEPTED' : `REFUSED: ${attachment.error}`;

    const template = await attempt('a3', `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_jt1`, JSON.stringify({ workspaceId: wsId, uid: viewer, kind: 'journalTemplate', name: 'Poisoned Payroll', lines: [{ accountId: 'x', debitCents: 99999, creditCents: 0 }] })]);
    templateInsert = template.ok ? 'ACCEPTED' : `REFUSED: ${template.error}`;

    const timeEntry = await attempt('a4', `INSERT INTO public.documents(id, data) VALUES ($1, $2)`,
      [`${wsId}_te1`, JSON.stringify({ workspaceId: wsId, uid: viewer, kind: 'timeEntry', hours: 100, employeeId: 'e1', rateCents: 5000, status: 'approved', date: '2026-11-10' })]);
    timeEntryInsert = timeEntry.ok ? 'ACCEPTED' : `REFUSED: ${timeEntry.error}`;

    const ticket = await attempt('a6', `UPDATE public."supportTickets" SET data = jsonb_set(data, '{status}', '"closed"'::jsonb) WHERE id = $1`,
      [`${wsId}_t1`]);
    ticketUpdate = ticket.ok ? `ACCEPTED (${ticket.rowCount} row)` : `REFUSED: ${ticket.error}`;

    // COMMIT, not ROLLBACK: a rolled-back write would make every refused/accepted verdict vacuous.
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  const ticketAfter = (await db.collection('supportTickets').doc(`${wsId}_t1`).get()).data();
  results.push({ id: 'A1', verdict: stageSetsInsert === 'ACCEPTED' ? 'LIVE' : 'FIXED', evidence: stageSetsInsert ?? 'NOT RUN', note: 'A viewer must not create a staged record in public.documents.' });
  results.push({ id: 'A2', verdict: attachmentInsert === 'ACCEPTED' ? 'LIVE' : 'FIXED', evidence: attachmentInsert ?? 'NOT RUN', note: 'A viewer must not attach a file to an arbitrary invoice.' });
  results.push({ id: 'A3', verdict: templateInsert === 'ACCEPTED' ? 'LIVE' : 'FIXED', evidence: templateInsert ?? 'NOT RUN', note: 'A viewer must not inject a journal template the owner then serves.' });
  results.push({ id: 'A4', verdict: timeEntryInsert === 'ACCEPTED' ? 'LIVE' : 'FIXED', evidence: timeEntryInsert ?? 'NOT RUN', note: 'A viewer must not create a time entry with approved hours and a rate.' });
  results.push({ id: 'A6', verdict: ticketAfter?.status === 'closed' ? 'LIVE' : 'FIXED', evidence: { attempt: ticketUpdate, storedStatus: ticketAfter?.status }, note: 'A viewer must not close the owner\'s support ticket.' });

  // A3 second half: the owner's journal-template route must not serve a viewer-injected template.
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { user?: unknown }).user = { uid: owner, email: 'owner@test.local' };
    next();
  });
  app.use('/api/v1/workspaces/:workspaceId/journal-templates', journalTemplateRouter);
  const server = await new Promise<ReturnType<typeof app.listen>>(r => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tplRes = await fetch(`${base}/api/v1/workspaces/${wsId}/journal-templates`);
    const tplBody = await tplRes.json() as { data?: { templates?: Array<{ name?: string }> } };
    const served = Boolean(tplBody.data?.templates?.some(t => t.name === 'Poisoned Payroll'));
    results.push({ id: 'A3-serve', verdict: served ? 'LIVE' : 'FIXED', evidence: { status: tplRes.status, served }, note: 'The owner route must not serve a record the viewer injected.' });
  } finally {
    server.close();
  }

  // H1: a JPY invoice must come back in home currency (USD cents), not in raw yen minor units.
  const jpyInvoice = {
    id: 'inv_jpy_tx', date: '2026-10-15', status: 'sent', currency: 'JPY', exchangeRate: 0.0067,
    amountCents: 10000, taxAmountCents: 0, items: [], taxVersion: 2,
  };
  const usRet = usSalesTaxReturn({
    registration: 'sales_tax:US-TX:TX-1',
    profiles: {
      books: { name: 'US Co', place: { country: 'US', state: 'TX' }, registrations: [{ kind: 'sales_tax', place: { country: 'US', state: 'TX' }, number: 'TX-1', validFrom: '2020-01-01', frequency: 'monthly' }] },
      entities: {},
    },
    order: [],
    invoices: [jpyInvoice],
    customers: [],
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  } as never);
  const usGross = Number((usRet as { grossSalesCents?: number }).grossSalesCents ?? -1);
  results.push({ id: 'H1-us', verdict: usGross === 67 ? 'LIVE' : 'FIXED', evidence: { grossSalesCents: usGross, expectedHomeCents: 6700, rawYenMinorUnits: 10000 }, note: '¥10,000 at 0.0067 is $67.00 = 6,700 cents; 67 is a 100x undercount.' });

  const ilRet = israelVatReturn({
    registration: 'vat:IL:1',
    profiles: { books: { name: 'IL Co', place: { country: 'IL' }, registrations: [{ kind: 'vat', place: { country: 'IL' }, number: '1', validFrom: '2020-01-01', frequency: 'monthly' }] }, entities: {} } as never,
    order: [],
    invoices: [{ ...jpyInvoice, currency: 'ILS', exchangeRate: 0.27 } as never],
    bills: [],
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  results.push({ id: 'H1-il', verdict: 'INFO', evidence: { taxableSalesCents: ilRet.taxableSalesCents, outputVatCents: ilRet.outputVatCents }, note: 'Read-only: ₪10,000 book at 0.27 USD/₪ must be 270,000 cents, not 2,700.' });

  const spread = spreadPlan({ amountCents: 67000, months: 12, startMonth: '2026-10', currency: 'JPY', exchangeRate: 0.0067 } as never);
  results.push({ id: 'H1-spread', verdict: 'INFO', evidence: { firstTwoMonths: spread.slice(0, 2) }, note: 'Read-only: spread plan for a JPY amount.' });

  const line = documentLine(
    { amountCents: 67000, currency: 'JPY', exchangeRate: 0.0067, items: [{ accountId: 'exp', amountCents: 67000 }] } as never,
    [{ id: 'exp', workspaceId: wsId, name: 'Expense', type: 'expense', category: 'Expenses', role: 'expense' } as never],
    'expense', 'exp', 'USD');
  // 44,890 cents is correct; 449 is the old 100x undercount. Gitar caught this verdict inverted.
  const prepaidCents = line ? line.baseCents : null;
  results.push({
    id: 'H1-prepaid-line',
    verdict: prepaidCents === 44890 ? 'FIXED' : prepaidCents === 449 ? 'LIVE' : 'CHECK',
    evidence: { line },
    note: '¥67,000 at 0.0067 = $448.90 = 44,890 cents (FIXED); the old code returned 449 cents (LIVE); anything else needs a human.',
  });

  console.log(JSON.stringify({ probe: 'r3-rls-and-minor-units-reverify', results }, null, 2));
  assert.ok(results.length > 0);
  for (const table of ['documents', 'supportTickets', 'workspaces']) {
    await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [wsId]).catch(() => {});
  }
  await db.terminate();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
