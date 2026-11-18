/**
 * PAY-1: an outside payroll provider's CSV becomes one balanced entry per pay date; the bank payment clears it; the
 * same file is refused twice; a reversed entry can be imported again; costs are split by facility; nothing is
 * guessed. The database part needs LF_TEST_DATABASE_URL.
 *
 * Worked figures (cents). Five facilities, one person each, Gusto file, pay date 2026-05-15:
 *   facility       gross    withheld  deductions    net       employer tax (7.65%)  employer benefits   cost
 *   F1 Maple     400,000     80,000     20,000    300,000         30,600                 12,000         442,600
 *   F2 Oak       300,000     60,000     15,000    225,000         22,950                  9,000         331,950
 *   F3 Pine      250,000     50,000          0    200,000         19,125                      0         269,125
 *   F4 Cedar     350,000     70,000     17,500    262,500         26,775                 10,500         387,275
 *   F5 Birch     200,000     40,000     10,000    150,000         15,300                  6,000         221,300
 *   total      1,500,000    300,000     62,500  1,137,500        114,750                 37,500       1,652,250
 * Each row: gross − withheld − deductions = net (400,000 − 80,000 − 20,000 = 300,000, …).
 * The entry: DR wages 1,500,000 + employer tax 114,750 + benefits 37,500 = 1,652,250
 *            CR withholdings 300,000 + deductions 62,500 + employer tax owed 114,750 + benefits owed 37,500
 *               + payroll clearing 1,137,500 = 1,652,250 → balanced.
 * The bank pays the net 1,137,500 on 2026-05-15 → payroll clearing back to 0.
 * A second pay date, 2026-05-29: F1 Maple 100,000 gross, 20,000 withheld, 5,000 deductions, 75,000 net,
 *   7,650 employer tax, 3,000 benefits → cost 110,650; its own entry.
 */
import './helpers/dom';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { payrollCents, payrollDate, payrollEntries, readPayrollCsv, type PayrollAccounts } from '../lib/payrollProviderImport';
import { deriveScopedOperationKey } from '../server/utils/idempotency';
import { applyJsonBodyParser } from '../server/http/securityMiddleware';

const HEADER = 'Pay Date,Employee,Employee ID,Department,Gross Earnings,Employee Taxes,Employee Deductions,Net Pay,Employer Taxes,Employer Contributions';
const MAY_15 = [
  '05/15/2026,Ana Ruiz,E1,Maple House,"4,000.00",800.00,200.00,"3,000.00",306.00,120.00',
  '05/15/2026,Ben Cole,E2,Oak Court,"3,000.00",600.00,150.00,"2,250.00",229.50,90.00',
  '05/15/2026,Cy Diaz,E3,Pine Lodge,"2,500.00",500.00,0.00,"2,000.00",191.25,0.00',
  '05/15/2026,Dee Park,E4,Cedar Hall,"3,500.00",700.00,175.00,"2,625.00",267.75,105.00',
  '05/15/2026,Eli Moss,E5,Birch Home,"2,000.00",400.00,100.00,"1,500.00",153.00,60.00',
];
const MAY_29 = ['05/29/2026,Ana Ruiz,E1,Maple House,"1,000.00",200.00,50.00,750.00,76.50,30.00'];
const FILE = [HEADER, ...MAY_15, ...MAY_29].join('\n');
const nodes = [
  { id: 'F1', description: 'Maple House' }, { id: 'F2', description: 'Oak Court' }, { id: 'F3', description: 'Pine Lodge' },
  { id: 'F4', description: 'Cedar Hall', aliases: ['Cedar'] }, { id: 'F5', description: 'Birch Home' },
];
const ACCOUNTS: PayrollAccounts = {
  wages: 'wages', employerTaxExpense: 'ertax', employerBenefitExpense: 'erben', withholdings: 'wh',
  deductions: 'ded', employerTaxLiability: 'ertaxdue', employerBenefitLiability: 'erbendue', clearing: 'clear',
};
const sumBy = (lines: Array<{ accountId: string; amountCents: number }>, id: string) => lines.filter(l => l.accountId === id).reduce((s, l) => s + l.amountCents, 0);

test('PAY-1: amounts and dates are read exactly, never guessed', () => {
  assert.deepEqual(['4,000.00', '$1,234.5', '(12.00)', '-0.01', '', '12.345', 'abc', '1.2.3'].map(payrollCents), [400_000, 123_450, -1_200, -1, 0, null, null, null]);
  assert.deepEqual(['05/15/2026', '2026-05-29', '02/30/2026', '15/05/2026', 'May 15'].map(payrollDate), ['2026-05-15', '2026-05-29', null, null, null]);
});

test('PAY-1 worked figures: five facilities on 2026-05-15 make one balanced entry of 1,652,250, split by facility', () => {
  const read = readPayrollCsv(FILE, 'gusto');
  assert.deepEqual(read.problems, []);
  assert.equal(read.rows.length, 6);
  const { payDates, problems } = payrollEntries(read.rows, ACCOUNTS, { dimensionId: 'property', nodes });
  assert.deepEqual(problems, []);
  assert.deepEqual(payDates.map(p => p.payDate), ['2026-05-15', '2026-05-29'], 'one entry per pay date, oldest first');
  const may15 = payDates[0];
  assert.deepEqual(may15.totals, { people: 5, grossCents: 1_500_000, employeeTaxCents: 300_000, deductionCents: 62_500, employerTaxCents: 114_750, employerBenefitCents: 37_500, netCents: 1_137_500, costCents: 1_652_250 });
  assert.equal(may15.lines.reduce((s, l) => s + l.amountCents, 0), 0, 'balanced');
  assert.equal(may15.lines.filter(l => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0), 1_652_250);
  assert.deepEqual(['wages', 'ertax', 'erben', 'wh', 'ded', 'ertaxdue', 'erbendue', 'clear'].map(id => sumBy(may15.lines, id)),
    [1_500_000, 114_750, 37_500, -300_000, -62_500, -114_750, -37_500, -1_137_500]);
  // the cost of each facility: its wages + employer tax + benefits
  const cost = (label: string) => may15.lines.filter(l => l.label === label).reduce((s, l) => s + l.amountCents, 0);
  assert.deepEqual(['F1', 'F2', 'F3', 'F4', 'F5'].map(cost), [442_600, 331_950, 269_125, 387_275, 221_300]);
  assert.ok(may15.lines.filter(l => !l.label).every(l => l.amountCents < 0), 'what is owed and the clearing line are not split');
  assert.deepEqual([payDates[1].totals.grossCents, payDates[1].totals.netCents, payDates[1].totals.costCents], [100_000, 75_000, 110_650]);
});

test('PAY-1: without a label the expense is one line per account', () => {
  const { payDates } = payrollEntries(readPayrollCsv(FILE, 'gusto').rows, ACCOUNTS);
  assert.deepEqual(payDates[0].lines.filter(l => l.accountId === 'wages').map(l => l.amountCents), [1_500_000]);
});

test('PAY-1 review: the same file in two workspaces gets two keys (one workspace never blocks another)', async () => {
  const { payrollImportKey } = await import('../server/services/payrollImportService');
  const { payDates } = payrollEntries(readPayrollCsv(FILE, 'gusto').rows, ACCOUNTS);
  assert.notEqual(payrollImportKey('ws_a', 'gusto', payDates[0]), payrollImportKey('ws_b', 'gusto', payDates[0]));
  assert.equal(payrollImportKey('ws_a', 'gusto', payDates[0]), payrollImportKey('ws_a', 'gusto', payDates[0]));
});

test('PAY-1: an unknown column, a row that does not add up, a missing account or an unknown facility stops the import', () => {
  const extra = readPayrollCsv([`${HEADER},Bonus`, `${MAY_15[0]},100.00`].join('\n'), 'gusto');
  assert.deepEqual(extra.rows, []);
  assert.match(extra.problems[0], /This column is not in the Gusto \(payroll journal\) column set, so nothing is imported: "Bonus"/);
  assert.match(readPayrollCsv(FILE, 'adp').problems[0], /not in the ADP \(payroll register\) column set/, 'another provider\'s column set is not assumed');
  const off = readPayrollCsv([HEADER, '05/15/2026,Ana Ruiz,E1,Maple House,"4,000.00",800.00,200.00,"3,050.00",306.00,120.00'].join('\n'), 'gusto');
  assert.deepEqual(off.problems, ['Row 2 (Ana Ruiz): gross 4,000.00 less withholdings 800.00 and deductions 200.00 is 3,000.00, but net pay is 3,050.00.']);
  const rows = readPayrollCsv(FILE, 'gusto').rows;
  assert.deepEqual(payrollEntries(rows, { ...ACCOUNTS, employerBenefitLiability: undefined }).problems, ['Choose the account for "Employer benefits owed".']);
  const unknownPlace = payrollEntries(rows, ACCOUNTS, { dimensionId: 'property', nodes: nodes.filter(n => n.id !== 'F3') });
  assert.deepEqual(unknownPlace.problems, ['Row 4 (Cy Diaz): "Pine Lodge" is not one of this workspace\'s property labels. Add it, or fix the file.']);
  assert.deepEqual(payrollEntries(rows, ACCOUNTS, { dimensionId: 'property', nodes: nodes.map(n => (n.id === 'F3' ? { ...n, description: 'Pine Lodge East' } : n)) }).problems.length, 1, 'no near match');
});

test('PAY-1: the ADP and Paychex column sets add their tax columns together', () => {
  const adp = readPayrollCsv([
    'Pay Date,Employee Name,Home Department,Gross Pay,Federal Income Tax,Social Security,Medicare,State Income Tax,Retirement 401k,Net Pay,Employer Social Security,Employer Medicare,FUTA,SUTA,Employer 401k Match',
    '05/15/2026,Ana Ruiz,Maple House,"4,000.00",400.00,248.00,58.00,94.00,200.00,"3,000.00",248.00,58.00,0.00,0.00,120.00',
  ].join('\n'), 'adp');
  assert.deepEqual(adp.problems, []);
  // 400 + 248 + 58 + 94 = 800.00 withheld; 248 + 58 = 306.00 employer tax
  assert.deepEqual([adp.rows[0].employeeTaxCents, adp.rows[0].deductionCents, adp.rows[0].employerTaxCents, adp.rows[0].employerBenefitCents], [80_000, 20_000, 30_600, 12_000]);
  const paychex = readPayrollCsv([
    'Check Date,Employee,Location,Total Gross,Federal Withholding,Social Security EE,Medicare EE,State Withholding,Deductions,Net Pay,Social Security ER,Medicare ER,FUTA,SUI',
    '2026-05-15,Ana Ruiz,Maple House,4000.00,400.00,248.00,58.00,94.00,200.00,3000.00,248.00,58.00,0.00,0.00',
  ].join('\n'), 'paychex');
  assert.deepEqual(paychex.problems, []);
  assert.deepEqual([paychex.rows[0].payDate, paychex.rows[0].netCents, paychex.rows[0].employerTaxCents], ['2026-05-15', 300_000, 30_600]);
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('PAY-1 on the database', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_pay1_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  let failAuditOn: string | undefined;
  const acct: Record<string, string> = {};
  let accounts: PayrollAccounts = {};
  const send = async (uid: string, method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const legacyImportPath = `/api/v1/workspaces/${ws}/pay-runs/imports`;
  const importFile = (csv: string, extra: Record<string, unknown> = {}, uid = OWNER) =>
    send(uid, 'POST', legacyImportPath, { provider: 'gusto', csv, fileName: 'gusto-may.csv', accounts, labelDimensionId: 'property', ...extra });
  const entries = async () => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as { id: string; date: string; status?: string; reversalEventId?: string; metadata?: Record<string, unknown>; lines: Array<{ accountId: string; amountCents: number; dimensions?: Record<string, string> }> });
  const payrollAudits = async () => (await db.collection('auditLogs')
    .where('workspaceId', '==', ws).where('action', '==', 'PAYROLL_IMPORTED').get()).docs
    .map(d => d.data()).sort((a, b) => Number(a.seq) - Number(b.seq));
  const balance = async (code: string, endDate: string) => {
    const gl = (await send(OWNER, 'GET', `/api/v1/reports/general-ledger?startDate=2026-01-01&endDate=${endDate}&accountId=${acct[code]}&workspaceId=${ws}`)).body;
    return (Array.isArray(gl) ? gl : gl.accounts || []).find((a: { accountId: string }) => a.accountId === acct[code])?.endingBalanceCents ?? 0;
  };

  before(async () => {
    process.env.DATABASE_URL = url;
    const express = (await import('express')).default;
    const { workspaceRouter } = await import('../server/routes/workspaceRoutes');
    const { transactionRouter } = await import('../server/routes/transactionRoutes');
    const { reportRouter } = await import('../server/routes/reportRoutes');
    const { createCommandRouter } = await import('../server/routes/commandRoutes');
    const { writeServerAuditLog } = await import('../server/services/auditLogService');
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Five Facilities', currency: 'USD', timezone: 'UTC', members: [OWNER, 'book'], roles: { book: 'bookkeeper' }, dimensions: [{ id: 'property', name: 'Facility' }] });
    const app = express();
    applyJsonBodyParser(app);
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@five.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/commands', createCommandRouter(undefined, {
      auditWriter: async (entry, options) => {
        if (entry.action === 'PAYROLL_IMPORTED' && failAuditOn && entry.details.description.includes(failAuditOn)) {
          throw new Error('Test audit failure on the second pay date');
        }
        return writeServerAuditLog(entry, options);
      },
    }));
    app.use('/api/v1/transactions', transactionRouter);
    app.use('/api/v1/documents', (await import('../server/routes/documentPostRoutes')).documentPostRouter);
    app.use('/api/v1/reports', reportRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const imported = await send(OWNER, 'POST', `/api/v1/workspaces/${ws}/import-records`, { kind: 'accounts', rows: [
      { name: 'Checking', code: '1000', type: 'Bank' },
      { name: 'Payroll clearing', code: '2100', type: 'Other Current Liability' },
      { name: 'Withholdings payable', code: '2110', type: 'Other Current Liability' },
      { name: 'Deductions payable', code: '2120', type: 'Other Current Liability' },
      { name: 'Payroll taxes payable', code: '2130', type: 'Other Current Liability' },
      { name: 'Benefits payable', code: '2140', type: 'Other Current Liability' },
      { name: 'Wages', code: '6000', type: 'Expense' },
      { name: 'Payroll taxes', code: '6010', type: 'Expense' },
      { name: 'Employee benefits', code: '6020', type: 'Expense' },
    ] });
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    for (const d of (await db.collection('chartAccounts').where('workspaceId', '==', ws).get()).docs) acct[String(d.data().code)] = d.id;
    accounts = {
      wages: acct['6000'], employerTaxExpense: acct['6010'], employerBenefitExpense: acct['6020'], withholdings: acct['2110'], deductions: acct['2120'],
      employerTaxLiability: acct['2130'], employerBenefitLiability: acct['2140'], clearing: acct['2100'],
    };
    for (const n of nodes) await db.collection('dimensionNodes').doc(`${ws}_${n.id}`).set({ workspaceId: ws, dimensionId: 'property', status: 'active', ...n });
  });

  after(async () => {
    server?.close();
    for (const table of ['transactions', 'bankLines', 'chartAccounts', 'dimensionNodes', 'auditLogs', 'idempotencyKeys', 'workspaces']) {
      await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]).catch(() => {});
    }
    const { getSupabase } = await import('../lib/db/client');
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
    await db.terminate();
  });

  test('payroll.import preview shows dates, totals and accounts without posting or auditing', async () => {
    const body = { workspaceId: ws, input: { provider: 'gusto', csv: FILE, accounts, labelDimensionId: 'property' } };
    const previewPath = '/api/v1/commands/payroll.import/preview';
    const operationId = 'preview-only';
    const response = await send(OWNER, 'POST', previewPath, body, { 'x-operation-id': operationId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { preview } = response.body;
    assert.deepEqual(preview.lines, [
      '2026-05-15: 5 people, gross $15,000.00, net $11,375.00',
      '2026-05-29: 1 person, gross $1,000.00, net $750.00',
    ]);
    assert.deepEqual(preview.accounts.filter((line: { accountId: string }) => line.accountId === acct['2100']), [
      { accountId: acct['2100'], accountName: 'Payroll clearing', amountCents: -1_137_500, description: 'Net pay, payroll 2026-05-15' },
      { accountId: acct['2100'], accountName: 'Payroll clearing', amountCents: -75_000, description: 'Net pay, payroll 2026-05-29' },
    ]);
    assert.ok(preview.accounts.some((line: { accountId: string; amountCents: number; description: string }) =>
      line.accountId === acct['6000'] && line.amountCents === 400_000 && line.description.endsWith('(F1)')));
    assert.ok(!JSON.stringify(preview).includes('Ana Ruiz'), 'a successful preview should show figures, not employee rows');
    for (const path of [previewPath, '/api/v1/commands/payroll.import']) {
      const denied = await send('book', 'POST', path, body);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, 'ROLE_REQUIRED');
    }
    assert.deepEqual(await entries(), []);
    assert.deepEqual(await payrollAudits(), []);
    const key = deriveScopedOperationKey(ws, 'payroll.import', operationId);
    assert.equal((await db.collection('idempotencyKeys').doc(key).get()).exists, false);
  });

  test('the file posts two entries; 2026-05-15 is 1,652,250 split over the five facilities', async () => {
    const res = await importFile(FILE);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.entries.map((e: { payDate: string; totals: { costCents: number } }) => [e.payDate, e.totals.costCents]), [['2026-05-15', 1_652_250], ['2026-05-29', 110_650]]);
    const audits = await payrollAudits();
    assert.deepEqual(audits.map(({ entityId, entityType, uid, email, details }) => ({ entityId, entityType, uid, email, details })), [
      {
        entityId: res.body.entries[0].transactionId, entityType: 'transactions', uid: OWNER, email: 'owner@five.test',
        details: { transactionId: res.body.entries[0].transactionId, description: 'Imported the Gusto (payroll journal) payroll of 2026-05-15: 5 people, gross $15,000.00, net $11,375.00' },
      }, {
        entityId: res.body.entries[1].transactionId, entityType: 'transactions', uid: OWNER, email: 'owner@five.test',
        details: { transactionId: res.body.entries[1].transactionId, description: 'Imported the Gusto (payroll journal) payroll of 2026-05-29: 1 person, gross $1,000.00, net $750.00' },
      },
    ]);
    assert.equal(audits[1].prevHash, audits[0].entryHash, 'both audit entries are in the same chain');
    const may15 = (await entries()).find(e => e.date === '2026-05-15')!;
    assert.equal(may15.metadata?.type, 'payroll-import');
    assert.equal(may15.lines.reduce((s, l) => s + l.amountCents, 0), 0);
    const wagesByFacility = may15.lines.filter(l => l.accountId === acct['6000']).map(l => [l.dimensions?.property, l.amountCents]);
    assert.deepEqual(wagesByFacility, [['F1', 400_000], ['F2', 300_000], ['F3', 250_000], ['F4', 350_000], ['F5', 200_000]]);
    assert.deepEqual([await balance('6000', '2026-05-31'), await balance('6010', '2026-05-31'), await balance('6020', '2026-05-31')], [1_600_000, 122_400, 40_500], 'both pay dates: 1,500,000 + 100,000; 114,750 + 7,650; 37,500 + 3,000');
    assert.deepEqual([await balance('2110', '2026-05-31'), await balance('2120', '2026-05-31'), await balance('2100', '2026-05-31')], [320_000, 67_500, 1_212_500], 'owed: withheld, deductions, and net pay not yet paid');
  });

  test('the same file again is refused and nothing more is posted', async () => {
    const count = (await entries()).length;
    const again = await importFile(FILE);
    assert.equal(again.status, 409);
    assert.match(again.body.message, /The payroll of 2026-05-15 from this file \(\$15,000\.00 gross, 5 people\) is already in the books\. Nothing from this file was posted/);
    assert.equal((await entries()).length, count);
  });

  test('the bank pays the 1,137,500 net: payroll clearing is left with the 2026-05-29 net only', async () => {
    const lineId = `${ws}_bl_net`;
    const saved = await send(OWNER, 'POST', '/api/v1/transactions/bulk', { workspaceId: ws, transactions: [], bankLines: [{ id: lineId, date: '2026-05-15', description: 'GUSTO NET PAY', amountCents: -1_137_500, status: 'pending', accountId: acct['1000'] }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const split = await send(OWNER, 'POST', `/api/v1/transactions/bank-lines/${lineId}/split`, { workspaceId: ws, splits: [{ accountId: acct['2100'], amountCents: 1_137_500, description: 'Net pay 2026-05-15' }] });
    assert.equal(split.status, 200, JSON.stringify(split.body));
    assert.equal(await balance('2100', '2026-05-15'), 0, 'the 2026-05-15 net is cleared');
    assert.equal(await balance('2100', '2026-05-31'), 75_000, '2026-05-29\'s 75,000 waits for its payment');
    assert.equal(await balance('1000', '2026-05-31'), -1_137_500);
  });

  test('a reversed pay date can be imported again; a corrected file posts; other pay dates still refuse', async () => {
    const may29 = (await entries()).find(e => e.date === '2026-05-29' && e.metadata?.type === 'payroll-import')!;
    const reversed = await send(OWNER, 'POST', `/api/v1/transactions/${may29.id}/reverse`, { workspaceId: ws, reversalDate: '2026-05-29', reason: 'Wrong hours' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
    assert.equal(await balance('6000', '2026-05-31'), 1_500_000, 'the 2026-05-29 wages are reversed');
    // the corrected 2026-05-29: 1,100.00 gross, 220.00 withheld, 55.00 deductions, 825.00 net
    const corrected = await importFile([HEADER, '05/29/2026,Ana Ruiz,E1,Maple House,"1,100.00",220.00,55.00,825.00,84.15,33.00'].join('\n'));
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    assert.equal(await balance('6000', '2026-05-31'), 1_610_000);
    // the first 2026-05-29 figures again: allowed, since its entry is reversed (a new entry id)
    const same = await importFile([HEADER, ...MAY_29].join('\n'));
    assert.equal(same.status, 200, JSON.stringify(same.body));
    assert.notEqual(same.body.entries[0].transactionId, may29.id);
    // the whole file still refuses: 2026-05-15 is in the books
    assert.equal((await importFile(FILE)).status, 409);
  });

  test('legacy payroll import keeps its complete success, malformed body and duplicate responses', async () => {
    const input = {
      provider: 'gusto', csv: [HEADER, MAY_29[0].replace('05/29/2026', '06/12/2026')].join('\n'),
      fileName: 'gusto-june.csv', accounts, labelDimensionId: 'property',
    };
    const headers = { 'idempotency-key': 'payroll-import-legacy-test' };
    const refused = await send(OWNER, 'POST', legacyImportPath, { ...input, provider: 'unrecognised' }, headers);
    assert.deepEqual(refused, { status: 400, body: {
      status: 'error', message: 'Choose the provider, the file and the accounts', problems: [],
    } });

    const count = (await entries()).length;
    const posted = await send(OWNER, 'POST', legacyImportPath, input, headers);
    const transactionId = posted.body.entries?.[0]?.transactionId;
    assert.match(String(transactionId), /^payroll-import-[a-f0-9]{32}$/);
    assert.deepEqual(posted, { status: 200, body: { status: 'success', entries: [{
      transactionId, payDate: '2026-06-12', totals: {
        people: 1, grossCents: 100_000, employeeTaxCents: 20_000, deductionCents: 5_000,
        employerTaxCents: 7_650, employerBenefitCents: 3_000, netCents: 75_000, costCents: 110_650,
      },
    }] } });

    const retried = await send(OWNER, 'POST', legacyImportPath, input, headers);
    assert.deepEqual(retried, { status: 409, body: {
      status: 'error',
      message: 'The payroll of 2026-06-12 from this file ($1,000.00 gross, 1 person) is already in the books. Nothing from this file was posted. To correct it, reverse that entry first.',
      problems: [],
    } });
    assert.equal((await entries()).length, count + 1);
    const key = deriveScopedOperationKey(ws, 'payroll.import', headers['idempotency-key']);
    assert.equal((await db.collection('idempotencyKeys').doc(key).get()).exists, false);
  });

  test('legacy payroll import keeps the ledger-validator error for an all-zero pay date', async () => {
    const csv = 'Pay Date,Employee,Department,Gross Earnings,Net Pay\n2026-07-01,Example Employee,Maple House,0.00,0.00';
    const count = (await entries()).length;
    assert.deepEqual(await importFile(csv), { status: 500, body: {
      status: 'error', message: 'The payroll could not be imported',
      details: 'Schema validation failed: lines: Too small: expected array to have >=1 items',
    } });
    assert.equal((await entries()).length, count);
  });

  test('payroll.import rolls back both pay dates and the retry key if the second audit fails', async () => {
    const path = '/api/v1/commands/payroll.import';
    const input = { provider: 'gusto', csv: [HEADER,
      MAY_29[0].replace('05/29/2026', '07/10/2026'),
      MAY_29[0].replace('05/29/2026', '07/24/2026'),
    ].join('\n'), accounts };
    const body = { workspaceId: ws, input };
    const operationId = 'command-payroll-retry';
    const headers = { 'x-operation-id': operationId };
    const key = db.collection('idempotencyKeys').doc(deriveScopedOperationKey(ws, 'payroll.import', operationId));
    const before = { entries: (await entries()).length, audits: (await payrollAudits()).length };

    failAuditOn = '2026-07-24';
    try {
      const failed = await send(OWNER, 'POST', path, body, headers);
      assert.equal(failed.status, 500);
    } finally {
      failAuditOn = undefined;
    }
    assert.equal((await entries()).length, before.entries);
    assert.equal((await payrollAudits()).length, before.audits);
    assert.equal((await key.get()).exists, false);

    const posted = await send(OWNER, 'POST', path, body, headers);
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    assert.equal(posted.body.replayed, false);
    assert.deepEqual(posted.body.data.entries.map((e: { payDate: string }) => e.payDate), ['2026-07-10', '2026-07-24']);
    assert.equal((await key.get()).data()?.status, 'success');
    assert.deepEqual(await send(OWNER, 'POST', path, body, headers), {
      ...posted, body: { ...posted.body, replayed: true },
    });
    const different = await send(OWNER, 'POST', path, { ...body, input: { ...input, fileName: 'other.csv' } }, headers);
    assert.equal(different.status, 409);
    assert.equal(different.body.code, 'CONFLICT');
    for (const duplicatePath of [path, `${path}/preview`]) {
      const duplicate = await send(OWNER, 'POST', duplicatePath, body);
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.code, 'CONFLICT');
      assert.match(duplicate.body.message, /2026-07-10.*is already in the books/);
    }
    assert.equal((await entries()).length, before.entries + 2);
    assert.equal((await payrollAudits()).length, before.audits + 2);
    const { payrollImportCommand, payrollImportInput } = await import('../server/commands/payroll');
    assert.equal(payrollImportCommand.inverse?.(payrollImportInput.parse(input), posted.body.data), null, 'reversing a single journal would not undo the file');
  });

  test('a single pay date advertises a working journal.reverse inverse', async () => {
    const { payrollImportCommand, payrollImportInput } = await import('../server/commands/payroll');
    const example = payrollImportInput.parse(payrollImportCommand.describe.example);
    assert.deepEqual(readPayrollCsv(example.csv, example.provider).problems, []);
    const input = { ...example, accounts };
    const posted = await send(OWNER, 'POST', '/api/v1/commands/payroll.import', { workspaceId: ws, input });
    assert.equal(posted.status, 200, JSON.stringify(posted.body));
    const inverse = payrollImportCommand.inverse?.(input, posted.body.data);
    assert.ok(inverse);
    assert.equal(inverse.command, 'journal.reverse');
    const reversed = await send(OWNER, 'POST', `/api/v1/commands/${inverse.command}`, { workspaceId: ws, input: inverse.input });
    assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
    const original = await db.collection('transactions').doc(posted.body.data.entries[0].transactionId).get();
    assert.equal(original.data()?.reversalEventId, reversed.body.data.reversal.id);
  });

  test('refused: a bookkeeper, a closed month, accounts of the wrong kind, an unknown column', async () => {
    const one = [HEADER, MAY_15[0].replace('05/15/2026', '05/20/2026')].join('\n');
    const denied = { status: 403, body: { status: 'error', message: 'Forbidden: requires one of roles [owner, accountant]' } };
    assert.deepEqual(await importFile(one, {}, 'book'), denied);
    assert.deepEqual(await importFile(one, { provider: 'unknown' }, 'book'), denied, 'role check precedes body validation');
    await db.collection('workspaces').doc(ws).set({ lockDate: '2026-05-31' }, { merge: true });
    assert.deepEqual(await importFile(one, { accounts: { ...accounts, withholdings: acct['6000'] } }), { status: 400, body: {
      status: 'error', message: 'Choose accounts of the right kind',
      problems: ['"Withholdings owed" must be a liability account; Wages is not.'],
    } }, 'account validation precedes the lock');
    const bankClearing = await importFile(one, { accounts: { ...accounts, clearing: acct['1000'] } });
    assert.match(bankClearing.body.problems[0], /must be a clearing account .* Checking is not/);
    const unknown = await importFile([`${HEADER},Bonus`, `${MAY_15[0]},1.00`].join('\n'));
    assert.deepEqual(unknown, { status: 400, body: {
      status: 'error', message: 'The file cannot be imported',
      problems: ['This column is not in the Gusto (payroll journal) column set, so nothing is imported: "Bonus". Remove it from the file, or check the provider.'],
    } });
    assert.deepEqual(await importFile(one), { status: 409, body: {
      status: 'error', message: 'Period Locked: 2026-05-20 is in a closed period (closed through 2026-05-31). Nothing from this file was posted.', problems: [],
    } });
    assert.equal((await entries()).filter(e => e.date === '2026-05-20').length, 0);
  });

  test('one closed pay date refuses the whole file on both the preview and the command', async () => {
    await db.collection('workspaces').doc(ws).set({ lockDate: '2026-05-31' }, { merge: true });
    const body = { workspaceId: ws, input: { provider: 'gusto', csv: [HEADER,
      MAY_29[0].replace('05/29/2026', '05/20/2026'),
      MAY_29[0].replace('05/29/2026', '08/07/2026'),
    ].join('\n'), accounts } };
    const before = { entries: (await entries()).length, audits: (await payrollAudits()).length };
    for (const suffix of ['/preview', '']) {
      const response = await send(OWNER, 'POST', `/api/v1/commands/payroll.import${suffix}`, body);
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'PERIOD_LOCKED');
      assert.match(response.body.message, /Nothing from this file was posted/);
    }
    assert.equal((await entries()).length, before.entries);
    assert.equal((await payrollAudits()).length, before.audits);
  });

  test('the payroll import wrapper does not bypass the runner’s freeze and pending-deletion gates', async () => {
    const input = { provider: 'gusto', csv: [HEADER, MAY_29[0].replace('05/29/2026', '08/07/2026')].join('\n'), accounts };
    const workspace = db.collection('workspaces').doc(ws);
    const count = (await entries()).length;
    for (const [patch, status, code, message] of [
      [{ concurrentUserLimit: 0 }, 403, 'WORKSPACE_FROZEN', /administratively suspended/],
      [{ concurrentUserLimit: 1, status: 'pending_deletion' }, 409, 'WORKSPACE_PENDING_DELETION', /scheduled for deletion/],
    ] as const) {
      await workspace.set(patch, { merge: true });
      const legacy = await send(OWNER, 'POST', legacyImportPath, input);
      assert.equal(legacy.status, status);
      assert.match(legacy.body.message, message);
      const named = await send(OWNER, 'POST', '/api/v1/commands/payroll.import', { workspaceId: ws, input });
      assert.equal(named.status, status);
      assert.equal(named.body.code, code);
    }
    assert.equal((await entries()).length, count);
  });
});
