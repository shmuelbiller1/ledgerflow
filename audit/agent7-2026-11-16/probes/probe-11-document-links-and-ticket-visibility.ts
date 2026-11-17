/**
 * Agent #7 Probe 11 (2026-11-16) — A7S-03 (+ the documents link half of A7S-02/04)
 *
 * Proves against live PostgreSQL 16.2 with every migration applied (`npm run db:test-setup`) and the
 * real `authenticated` role + `request.jwt.claims` path the browser uses, that WITHOUT the patch:
 *
 *   A. a workspace member can read every other member's support tickets (ticket_read: lf_is_member),
 *      including the support-side bookkeeping fields (unreadForAdmin, errorDiagnostics);
 *   B. a VIEWER can rewrite the ledger link of a file they uploaded (documents own_update + the
 *      linkedTransactionId/linkedCollection/linkedId/linkedLabel allowlist), detaching it from the entry
 *      it is the evidence for;
 *   C. a client can send unreadForAdmin / lastMessageBy on a ticket it may update.
 *
 * and that WITH `11-document-links-and-ticket-visibility.patch` applied, A and B are refused and C is
 * refused by the allowlist while the uploader's own metadata (tags, notes) still goes through.
 *
 * Run: DATABASE_URL=… npx tsx audit/agent7-2026-11-16/probes/probe-11-document-links-and-ticket-visibility.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL || process.env.LF_TEST_DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL (a disposable test database with the migrations applied).');

const suffix = crypto.randomUUID().slice(0, 8);
const wsId = `ws_p11_${suffix}`;
const owner = `owner_${suffix}`;
const viewer = `viewer_${suffix}`;
const viewer2 = `viewer2_${suffix}`;
const docUploadedByViewer = `doc_${suffix}`;

async function asUser(client: pg.Client, uid: string) {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ role: 'authenticated', sub: uid, email: `${uid}@test.local` }),
  ]);
  await client.query('set local role authenticated');
}

async function asPostgres(client: pg.Client) {
  await client.query('reset role');
  await client.query(`select set_config('request.jwt.claims', '', true)`);
}

/** Runs `sql` as `uid`; resolves to the row count or the SQLSTATE when the database refuses it. */
async function attempt(client: pg.Client, uid: string, sql: string, params: unknown[] = []) {
  // a refused statement aborts the surrounding transaction, so every attempt sits in its own savepoint
  await client.query('savepoint attempt');
  await asUser(client, uid);
  try {
    const res = await client.query(sql, params);
    await asPostgres(client);
    await client.query('release savepoint attempt');
    return { refused: false as const, rows: res.rows, rowCount: res.rowCount ?? 0 };
  } catch (error) {
    // the failed statement leaves the transaction unusable until the savepoint is rolled back
    await client.query('rollback to savepoint attempt');
    await asPostgres(client);
    return { refused: true as const, code: (error as { code?: string }).code || 'unknown', message: (error as Error).message };
  }
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const findings: string[] = [];
  try {
    await client.query('begin');
    // the workspace and two members: the owner, a viewer, and a second viewer for the ticket test
    await client.query(`insert into workspaces(id, data) values ($1, $2::jsonb)`, [
      wsId,
      JSON.stringify({ uid: owner, name: 'Probe 11', roles: { [viewer]: 'viewer', [viewer2]: 'viewer' } }),
    ]);
    // a ticket opened by the other viewer, and a file uploaded by `viewer`
    await client.query(`insert into "supportTickets"(id, data) values ($1, $2::jsonb)`, [
      `ticket_${suffix}`,
      JSON.stringify({ workspaceId: wsId, uid: viewer2, subject: 'Billing question', status: 'open', unreadForAdmin: 3, errorDiagnostics: 'token=secret' }),
    ]);
    await client.query(`insert into documents(id, data) values ($1, $2::jsonb)`, [
      docUploadedByViewer,
      JSON.stringify({
        workspaceId: wsId, uid: viewer, name: 'receipt.pdf', fileUrl: 'https://files.test/r.pdf',
        linkedCollection: 'transactions', linkedId: 'tx_original', linkedTransactionId: 'tx_original', tags: ['receipt'], notes: 'March',
      }),
    ]);

    // A. another member's ticket is readable by a plain viewer
    const readOtherTicket = await attempt(client, viewer,
      `select id, data->>'subject' as subject, data->>'unreadForAdmin' as unread from "supportTickets" where id = $1`,
      [`ticket_${suffix}`]);
    if (!readOtherTicket.refused && readOtherTicket.rows.length === 1) {
      findings.push(`A. OPEN: viewer read another member's ticket (subject=${readOtherTicket.rows[0].subject}, unreadForAdmin=${readOtherTicket.rows[0].unread})`);
    }

    // B. a viewer rewrites the ledger link of the file they uploaded
    const relink = await attempt(client, viewer,
      `update documents set data = lf_set_path(data, '{linkedTransactionId}', $1::jsonb) where id = $2`,
      [JSON.stringify('tx_forged'), docUploadedByViewer]);
    const relinked = await client.query(`select data->>'linkedTransactionId' as link from documents where id = $1`, [docUploadedByViewer]);
    if (!relink.refused && relinked.rows[0]?.link === 'tx_forged') {
      findings.push(`B. OPEN: a viewer relinked doc ${docUploadedByViewer} from tx_original to tx_forged without lf_can_write`);
    }

    // C. support-side bookkeeping fields from a client
    const badge = await attempt(client, viewer2,
      `update "supportTickets" set data = lf_set_path(data, '{unreadForAdmin}', $1::jsonb) where id = $2`,
      [JSON.stringify(0), `ticket_${suffix}`]);
    if (!badge.refused) {
      findings.push('C. OPEN: a client wrote unreadForAdmin on its own ticket (support-side state)');
    }

    // D. the uploader's own harmless metadata must keep working after the patch
    const tags = await attempt(client, viewer,
      `update documents set data = lf_set_path(data, '{tags}', $1::jsonb) where id = $2`,
      [JSON.stringify(['receipt', 'march']), docUploadedByViewer]);

    // E. the directory view shows the row without pay or bank details
    await client.query(`insert into employees(id, data) values ($1, $2::jsonb)`, [
      `emp_${suffix}`,
      JSON.stringify({ workspaceId: wsId, name: 'Dana', role: 'Designer', salaryCents: 900000, bankAccount: '12345678', bankRouting: '021000021' }),
    ]);
    const directory = await attempt(client, viewer, `select data from public.lf_employee_directory where id = $1`, [`emp_${suffix}`]);
    const directoryRow = directory.refused ? null : (directory.rows[0]?.data as Record<string, unknown> | undefined);
    if (directoryRow) {
      assert.equal(directoryRow.name, 'Dana', 'the directory still names the employee');
      assert.equal(directoryRow.salaryCents, undefined, 'the directory carries no salary');
      assert.equal(directoryRow.bankAccount, undefined, 'the directory carries no bank account');
    }
    console.log('probe 11 results');
    console.log('  A/B/C (the gaps this patch closes):');
    if (findings.length === 0) console.log('    none open — the patch is applied and every attempt was refused');
    for (const line of findings) console.log(`    ${line}`);
    console.log('  D. uploader metadata after the patch:', tags.refused ? `refused (${tags.code})` : 'allowed');
    console.log('  E. directory view:', directoryRow ? 'pay and bank fields absent' : `not readable (${directory.refused ? directory.code : 'no row'})`);
    await client.query('rollback');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
