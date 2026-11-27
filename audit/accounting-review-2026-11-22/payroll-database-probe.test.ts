// Diagnostic intentionally asserts observed behavior, including known defects.
// Run ONLY with the dedicated local test database; never point this at a real workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const url = process.env.LF_TEST_DATABASE_URL;
const valid = url && new URL(url).hostname === '127.0.0.1' && new URL(url).port === '55439' && new URL(url).pathname === '/lf_test';

test('synthetic local Postgres payroll persists forecast-based FICA in journal and run', { skip: !valid && 'dedicated local audit database required' }, async () => {
  process.env.DATABASE_URL = url;
  const { getDb } = await import('../../src/server/db/firestore');
  const { postPayRun } = await import('../../src/server/services/payRunService');
  const db = getDb();
  const ws = `ws_audit_pay_${crypto.randomBytes(5).toString('hex')}`;
  const id = (v: string) => `${ws}_${v}`;
  try {
    await db.collection('workspaces').doc(ws).set({ uid:'owner-audit', name:'Synthetic audit only', currency:'USD', members:['owner-audit'], timezone:'UTC' });
    const account = (name: string, data: Record<string, unknown>) => db.collection('chartAccounts').doc(id(name)).set({ workspaceId:ws, uid:'owner-audit', isActive:true, ...data });
    await account('bank',{name:'Bank',code:'1000',type:'asset',category:'Cash'});
    await account('wages',{name:'Wages',code:'6000',type:'expense'});
    await account('tax',{name:'Payroll Tax',code:'6010',type:'expense'});
    await account('liab',{name:'Payroll Liability',code:'2100',type:'liability'});
    await db.collection('employees').doc(id('employee')).set({ workspaceId:ws, uid:'owner-audit', name:'Synthetic', role:'Staff', salaryCents:24_000_000, payFrequency:'Monthly', status:'Active', filingStatus:'Married', state:'TX', createdAt:'2026-01-01' });
    const results = [];
    for (let month = 1; month <= 11; month++) {
      const result = await postPayRun(db, { workspaceId:ws, uid:'owner-audit', date:`2026-${String(month).padStart(2,'0')}-10`, bankAccountId:id('bank'), wagesAccountId:id('wages'), taxExpenseAccountId:id('tax'), liabilitiesAccountId:id('liab') });
      assert.ok('transactionId' in result);
      const run = (await db.collection('payRuns').doc(result.payRunId).get()).data()!;
      const entry = (await db.collection('transactions').doc(String(run.transactionId)).get()).data()!;
      const person = (run.employees as Array<{ taxes:{socialSecurityCents:number;medicareCents:number};grossCents:number }>)[0];
      assert.equal(run.status,'processed');
      assert.equal(person.grossCents,2_000_000);
      assert.equal((entry.lines as Array<{amountCents:number}>).reduce((s,l)=>s+l.amountCents,0),0);
      results.push({ month, ss:person.taxes.socialSecurityCents, medicare:person.taxes.medicareCents });
    }
    // IRS expected month 1 SS = 124000 cents; month 11 Medicare = 29000 + 18000 cents.
    assert.deepEqual(results[0], {month:1,ss:94550,medicare:29000});
    assert.deepEqual(results[10], {month:11,ss:94550,medicare:29000});
    console.log('Persisted first and eleventh pay-run results:', JSON.stringify([results[0],results[10]]));
  } finally {
    for (const table of ['transactions','payRuns','employees','chartAccounts','auditLogs','notifications','workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`,[ws]);
    await db.terminate();
  }
});
