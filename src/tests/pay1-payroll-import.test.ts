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

// ---- #261 review (pure) ----
test('#261 review: labels compare as text (Unicode form, Hebrew points) but a name shared by two labels is refused', () => {
  const rows = readPayrollCsv([HEADER, '05/15/2026,Ana Ruiz,E1,Cafe\u0301 North,"1,000.00",200.00,0.00,800.00,76.50,0.00', '05/15/2026,Dov Levi,E2,\u05D1\u05BCית,"1,000.00",200.00,0.00,800.00,76.50,0.00'].join('\n'), 'gusto').rows;
  const labelled = payrollEntries(rows, ACCOUNTS, { dimensionId: 'property', nodes: [{ id: 'C1', description: 'Caf\u00E9 North' }, { id: 'B1', description: '\u05D1\u05D9\u05EA' }] });
  assert.deepEqual(labelled.problems, []);
  assert.deepEqual(labelled.payDates[0].lines.filter(l => l.accountId === 'wages').map(l => l.label), ['C1', 'B1']);
  const twice = payrollEntries(rows.slice(0, 1), ACCOUNTS, { dimensionId: 'property', nodes: [{ id: 'C1', description: 'Café North' }, { id: 'C2', aliases: ['Café North'] }, { id: 'C3', description: 'Café North' }] });
  assert.match(twice.problems[0], /names more than one property label \(C1, C3\)\. Use the label's code/);
});

test('#261 review: rows with nothing paid are left out; a file of only such rows is refused', () => {
  const zero = '05/15/2026,Zed Null,E9,Maple House,0.00,0.00,0.00,0.00,0.00,0.00';
  assert.equal(readPayrollCsv([HEADER, MAY_15[0], zero].join('\n'), 'gusto').rows.length, 1);
  assert.deepEqual(readPayrollCsv([HEADER, zero].join('\n'), 'gusto').problems, ['Every row in the file is zero: there is no payroll to record.']);
});

test('#261 review: more than 100 lines split by label is refused before posting', () => {
  // 34 facilities × 3 expense lines + 5 credit lines = 107 lines
  const many = Array.from({ length: 34 }, (_, i) => `05/15/2026,P${i},E${i},F${i},100.00,20.00,5.00,75.00,7.65,3.00`);
  const nodes34 = Array.from({ length: 34 }, (_, i) => ({ id: `F${i}` }));
  const { problems } = payrollEntries(readPayrollCsv([HEADER, ...many].join('\n'), 'gusto').rows, ACCOUNTS, { dimensionId: 'property', nodes: nodes34 });
  assert.deepEqual(problems, ['The payroll of 2026-05-15 needs 107 lines split by label; an entry holds at most 100. Import it without splitting, or in parts.']);
});

const url = process.env.LF_TEST_DATABASE_URL;

describe('PAY-1 on the database', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_pay1_${crypto.randomBytes(4).toString('hex')}`;
  const OWNER = 'owner-1';
  let server: Server;
  let base = '';
  let db: import('../server/db/pgFirestore').Firestore;
  const acct: Record<string, string> = {};
  let accounts: PayrollAccounts = {};
  const send = async (uid: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-uid': uid }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const importFile = (csv: string, extra: Record<string, unknown> = {}, uid = OWNER) =>
    send(uid, 'POST', `/api/v1/workspaces/${ws}/pay-runs/imports`, { provider: 'gusto', csv, fileName: 'gusto-may.csv', accounts, labelDimensionId: 'property', ...extra });
  const entries = async () => (await db.collection('transactions').where('workspaceId', '==', ws).get()).docs.map(d => ({ ...d.data(), id: d.id }) as { id: string; date: string; status?: string; reversalEventId?: string; metadata?: Record<string, unknown>; lines: Array<{ accountId: string; amountCents: number; dimensions?: Record<string, string> }> });
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
    const { getDb } = await import('../server/db/firestore');
    db = getDb();
    await db.collection('workspaces').doc(ws).set({ uid: OWNER, name: 'Five Facilities', currency: 'USD', timezone: 'UTC', members: [OWNER, 'book'], roles: { book: 'bookkeeper' }, dimensions: [{ id: 'property', name: 'Facility' }] });
    const app = express();
    app.use(express.json({ limit: '6mb' }));
    app.use((req, _res, next) => { (req as unknown as { user: { uid: string; email: string } }).user = { uid: String(req.header('x-test-uid')), email: 'owner@five.test' }; next(); });
    app.use('/api/v1/workspaces', workspaceRouter);
    app.use('/api/v1/transactions', transactionRouter);
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

  test('the file posts two entries; 2026-05-15 is 1,652,250 split over the five facilities', async () => {
    const res = await importFile(FILE);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.entries.map((e: { payDate: string; totals: { costCents: number } }) => [e.payDate, e.totals.costCents]), [['2026-05-15', 1_652_250], ['2026-05-29', 110_650]]);
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

  test('#261 review: a Reverse & Correct replacement stands — the same pay date is not imported on top of it', async () => {
    const one = [HEADER, MAY_15[1].replace('05/15/2026', '05/22/2026')].join('\n');
    const first = await importFile(one);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const original = first.body.entries[0].transactionId;
    const entry = (await entries()).find(e => e.id === original)!;
    const corrected = await send(OWNER, 'POST', `/api/v1/transactions/${original}/reverse`, { workspaceId: ws, reversalDate: '2026-05-22', reason: 'hours', replacement: { lines: entry.lines.map(l => ({ accountId: l.accountId, amountCents: l.amountCents })), description: 'Payroll 2026-05-22 corrected' } });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    const again = await importFile(one);
    assert.equal(again.status, 409);
    assert.match(again.body.message, /was reversed and corrected in the books \(Reverse & Correct\)\. The corrected entry stands/);
  });

  test('#261 review: another workspace imports the same figures as its own payroll', async () => {
    const other = `${ws}_twin`;
    await db.collection('workspaces').doc(other).set({ uid: OWNER, name: 'Twin', currency: 'USD', timezone: 'UTC', members: [OWNER] });
    const twin: Record<string, string> = {};
    for (const [code, type, name] of [['2100', 'liability', 'Clearing'], ['2110', 'liability', 'WH'], ['2120', 'liability', 'Ded'], ['2130', 'liability', 'Tax due'], ['2140', 'liability', 'Ben due'], ['6000', 'expense', 'Wages'], ['6010', 'expense', 'Tax'], ['6020', 'expense', 'Ben']]) {
      twin[code] = `${other}_${code}`;
      await db.collection('chartAccounts').doc(twin[code]).set({ workspaceId: other, code, type, name });
    }
    const res = await send(OWNER, 'POST', `/api/v1/workspaces/${other}/pay-runs/imports`, { provider: 'gusto', csv: [HEADER, ...MAY_15].join('\n'), accounts: {
      wages: twin['6000'], employerTaxExpense: twin['6010'], employerBenefitExpense: twin['6020'], withholdings: twin['2110'], deductions: twin['2120'], employerTaxLiability: twin['2130'], employerBenefitLiability: twin['2140'], clearing: twin['2100'],
    } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    for (const table of ['transactions', 'chartAccounts', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [other]).catch(() => {});
  });

  test('#261 review: a bank account is refused as clearing by its subtype; payroll approval rules are kept', async () => {
    const one = [HEADER, MAY_15[2].replace('05/15/2026', '05/23/2026')].join('\n');
    await db.collection('chartAccounts').doc(`${ws}_op`).set({ workspaceId: ws, code: '1010', type: 'asset', subtype: 'Checking', name: 'Operating' });
    const subtype = await importFile(one, { accounts: { ...accounts, clearing: `${ws}_op` } });
    assert.equal(subtype.status, 400);
    assert.match(subtype.body.problems[0], /must be a clearing account .* Operating is not/);
    await db.collection('workspaces').doc(ws).set({ twoPersonRule: true }, { merge: true });
    const twoPerson = await importFile(one);
    assert.equal(twoPerson.status, 409);
    assert.match(twoPerson.body.message, /two-person rule/);
    await db.collection('workspaces').doc(ws).set({ twoPersonRule: false, payrollApproval: true, roles: { book: 'bookkeeper', acct: 'accountant' }, members: [OWNER, 'book', 'acct'] }, { merge: true });
    const accountant = await importFile(one, {}, 'acct');
    assert.equal(accountant.status, 409);
    assert.match(accountant.body.message, /an owner imports it/);
    await db.collection('workspaces').doc(ws).set({ payrollApproval: false }, { merge: true });
    assert.equal((await entries()).filter(e => e.date === '2026-05-23').length, 0);
  });

  test('refused: a bookkeeper, a closed month, accounts of the wrong kind, an unknown column', async () => {
    const one = [HEADER, MAY_15[0].replace('05/15/2026', '05/20/2026')].join('\n');
    assert.equal((await importFile(one, {}, 'book')).status, 403);
    const wrongKind = await importFile(one, { accounts: { ...accounts, withholdings: acct['6000'] } });
    assert.equal(wrongKind.status, 400);
    assert.deepEqual(wrongKind.body.problems, ['"Withholdings owed" must be a liability account; Wages is not.']);
    const bankClearing = await importFile(one, { accounts: { ...accounts, clearing: acct['1000'] } });
    assert.match(bankClearing.body.problems[0], /must be a clearing account .* Checking is not/);
    const unknown = await importFile([`${HEADER},Bonus`, `${MAY_15[0]},1.00`].join('\n'));
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.problems[0], /"Bonus"/);
    await db.collection('workspaces').doc(ws).set({ lockDate: '2026-05-31' }, { merge: true });
    const locked = await importFile(one);
    assert.equal(locked.status, 409);
    assert.match(locked.body.message, /Nothing from this file was posted/);
    assert.equal((await entries()).filter(e => e.date === '2026-05-20').length, 0);
  });
});
