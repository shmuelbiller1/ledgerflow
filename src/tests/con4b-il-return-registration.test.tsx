/**
 * CON-4b: a filed VAT return can name the registration it is for, so a workspace with two Israeli registrations
 * (Tel Aviv 514000001 on the books, Eilat 514000002 on the label world:eilat) records each one's return apart.
 * Figures by hand (agorot), September 2026:
 *   Tel Aviv INV 1001 net 100,000 + 18% 18,000;  Eilat INV 2001 net 50,000 exempt (a sale in Eilat by the Eilat dealer)
 *   the Tel Aviv return filed for 514000001: 1 document, output VAT 18,000 — the Eilat invoice is not in its copy
 *   the same again → 409; the whole workspace for the same month afterwards → 409; a registration not in the profiles → 400
 * The journey counts a return as filed only for its own registration; one filed for the whole workspace still cannot
 * be told whose it is when there are two. On the screen, an owner records one registration's return as filed, after
 * a question naming the registration and period.
 * Review: the Eilat invoice carries its label on its first line (items[0].dimensions, as the invoice screen saves it);
 * a bill on splits[0]; the whole-workspace view ignores a registration's record; ids are sha256 of the exact key;
 * a sales-tax permit or a VAT number that ended before the period is refused; whole and Tel Aviv filed at once → one wins.
 */
import './helpers/dom';
import test, { afterEach, after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { israelMonthJourney } from '../lib/israelMonthJourney';
import type { TaxProfiles } from '../lib/tax/profile';
import { IsraelMonthJourneyPanel } from '../components/reporting/IsraelMonthJourneyReportView';
import { wholeWorkspaceReturn, filedRegistrationChanges } from '../lib/tax/filedReturns';
import { belongsTo, documentEntityLabels } from '../lib/tax/ilVatReturn';

const PROFILES: TaxProfiles = {
  books: { name: 'Tel Aviv Ltd', place: { country: 'IL', city: 'Tel Aviv' }, registrations: [{ kind: 'vat', number: '514000001', place: { country: 'IL' }, validFrom: '2020-01-01', filing: 'monthly' }] },
  labels: { 'world:eilat': { name: 'Eilat Ltd', place: { country: 'IL', city: 'Eilat' }, registrations: [{ kind: 'vat', number: '514000002', place: { country: 'IL' }, validFrom: '2020-01-01', filing: 'monthly' }] } },
};
const TA = 'vat:IL:514000001';
const EILAT = 'vat:IL:514000002';
const invoices = [
  { id: 'i1', number: '1001', date: '2026-09-10', status: 'sent', taxVersion: 2, amountCents: 118_000, taxAmountCents: 18_000, taxTreatment: 'standard' },
  { id: 'i2', number: '2001', date: '2026-09-12', status: 'sent', taxVersion: 2, amountCents: 50_000, taxAmountCents: 0, taxTreatment: 'exempt', items: [{ dimensions: { world: 'eilat' } }, { dimensions: { world: 'telaviv' } }] },
];
const journey = (filedPeriods: Array<{ startDate: string; endDate: string; registration?: string }>) =>
  israelMonthJourney({ month: '2026-09', today: '2026-10-05', currency: 'ILS', profiles: PROFILES, order: ['world'], invoices: invoices as never, filedPeriods });
const filedOf = (j: ReturnType<typeof journey>) => j.steps.find(s => s.id === 'vat-report')!.returns.map(r => [r.registration, r.filed, r.recordedForDates]);

test('a return filed for one registration counts for that one only', () => {
  assert.deepEqual(filedOf(journey([{ startDate: '2026-09-01', endDate: '2026-09-30', registration: TA }])), [[TA, true, false], [EILAT, false, false]]);
  // the whole workspace, with two registrations: recorded, but whose it is cannot be told
  assert.deepEqual(filedOf(journey([{ startDate: '2026-09-01', endDate: '2026-09-30' }])), [[TA, false, true], [EILAT, false, true]]);
  assert.deepEqual(filedOf(journey([{ startDate: '2026-09-01', endDate: '2026-09-30', registration: TA }, { startDate: '2026-09-01', endDate: '2026-09-30', registration: EILAT }])), [[TA, true, false], [EILAT, true, false]]);
});

test('the entity label is the first line\'s, as invoices (items) and bills (splits) are saved', () => {
  assert.deepEqual(documentEntityLabels(invoices[1] as never), { world: 'eilat' });
  const bill = { id: 'b1', date: '2026-09-15', splits: [{ dimensions: { world: 'eilat' } }] };
  assert.equal(belongsTo(bill as never, PROFILES, ['world'], EILAT), true);
  assert.equal(belongsTo(bill as never, PROFILES, ['world'], TA), false);
  assert.equal(belongsTo(invoices[0] as never, PROFILES, ['world'], TA), true, 'no label: the books');
});

test('the whole-workspace view compares only with the whole workspace\'s record', () => {
  const scoped = { startDate: '2026-09-01', endDate: '2026-09-30', registration: TA };
  assert.equal(wholeWorkspaceReturn([scoped], '2026-09-01', '2026-09-30'), undefined);
  const whole = { startDate: '2026-09-01', endDate: '2026-09-30' };
  assert.equal(wholeWorkspaceReturn([scoped, whole], '2026-09-01', '2026-09-30'), whole);
});

describe('on the screen', () => {
  let questions: string[] = [];
  let answer = true;
  beforeEach(() => { questions = []; answer = true; window.confirm = (m?: string) => { questions.push(String(m)); return answer; }; });
  afterEach(() => cleanup());
  test('declining the question files nothing', async () => {
    const asked: unknown[] = [];
    answer = false;
    render(<IsraelMonthJourneyPanel journey={journey([])} preview={null} currency="ILS" monthText="2026-09" onMonthChange={() => {}} dealerId="" onDealerIdChange={() => {}} onRecordFiled={async r => { asked.push(r); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record 514000002 as filed' }));
    assert.deepEqual(questions, ['File the return of 514000002 for 2026-09-01 to 2026-09-30? A copy is kept and can\'t be changed.']);
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(asked, []);
  });
  test('an owner records the Eilat registration\'s return as filed; the request names it', async () => {
    const asked: Array<Record<string, string>> = [];
    render(<IsraelMonthJourneyPanel journey={journey([{ startDate: '2026-09-01', endDate: '2026-09-30', registration: TA }])} preview={null} currency="ILS"
      monthText="2026-09" onMonthChange={() => {}} dealerId="" onDealerIdChange={() => {}} onRecordFiled={async r => { asked.push(r); }} />);
    assert.equal(screen.queryByRole('button', { name: 'Record 514000001 as filed' }), null, 'already filed');
    fireEvent.click(screen.getByRole('button', { name: 'Record 514000002 as filed' }));
    await waitFor(() => assert.deepEqual(asked, [{ ...asked[0], registration: EILAT, startDate: '2026-09-01', endDate: '2026-09-30' }]));
  });
  test('a refusal is shown in words; without the right role there is no button', async () => {
    const view = render(<IsraelMonthJourneyPanel journey={journey([])} preview={null} currency="ILS" monthText="2026-09" onMonthChange={() => {}} dealerId="" onDealerIdChange={() => {}}
      onRecordFiled={async () => { throw new Error('A return for this period was already filed'); }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record 514000001 as filed' }));
    await waitFor(() => assert.match(screen.getByRole('alert').textContent || '', /already filed/));
    view.unmount();
    render(<IsraelMonthJourneyPanel journey={journey([])} preview={null} currency="ILS" monthText="2026-09" onMonthChange={() => {}} dealerId="" onDealerIdChange={() => {}} />);
    assert.equal(screen.queryByRole('button', { name: /as filed/ }), null);
  });
});

const url = process.env.LF_TEST_DATABASE_URL;
describe('Filing for one registration (database)', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const ws = `ws_con4b_${crypto.randomBytes(4).toString('hex')}`;
  let db: import('../server/db/pgFirestore').Firestore;
  let svc: typeof import('../server/services/taxReturnService');
  before(async () => {
    process.env.DATABASE_URL = url;
    db = (await import('../server/db/firestore')).getDb() as never;
    svc = await import('../server/services/taxReturnService');
    await db.collection('workspaces').doc(ws).set({ uid: 'o', name: 'Two dealers', currency: 'ILS', members: ['o'], taxProfiles: PROFILES, dimensions: [{ id: 'world', isWorld: true, name: 'Entity' }] });
    for (const inv of invoices) await db.collection('invoices').doc(`${ws}_${inv.id}`).set({ ...inv, workspaceId: ws });
  });
  after(async () => {
    for (const table of ['invoices', 'taxReturns', 'auditLogs', 'workspaces']) await db.pool.query(`delete from public."${table}" where workspace_id = $1 or id = $1`, [ws]);
    await db.terminate();
  });

  test('the Tel Aviv return holds Tel Aviv\'s document only; the same again and the whole workspace are refused', async () => {
    const period = { workspaceId: ws, uid: 'o', startDate: '2026-09-01', endDate: '2026-09-30' };
    const filed = await svc.fileTaxReturn(db as never, { ...period, registration: TA });
    assert.equal(filed.registration, TA);
    assert.equal(filed.documentCount, 1, 'the Eilat invoice is not in its copy');
    assert.equal(filed.boxes.find(b => b.key === '3')?.cents, 18_000);
    await assert.rejects(svc.fileTaxReturn(db as never, { ...period, registration: TA }), /already filed/);
    await assert.rejects(svc.fileTaxReturn(db as never, period), /single registrations were already filed/);
    await assert.rejects(svc.fileTaxReturn(db as never, { ...period, registration: 'vat:IL:999999999' }), /not one of this workspace's VAT registrations in force/);
    const eilat = await svc.fileTaxReturn(db as never, { ...period, registration: EILAT });
    assert.equal(eilat.documentCount, 1);
    const listed = (await svc.listTaxReturns(db as never, ws)).map(r => r.registration).sort();
    assert.deepEqual(listed, [TA, EILAT]);
  });

  test('a sales-tax permit, or a VAT number that ended before the period, files no return', async () => {
    const ws2 = `${ws}_p`;
    await db.collection('workspaces').doc(ws2).set({ uid: 'o', name: 'Old', currency: 'ILS', members: ['o'], taxProfiles: {
      books: { name: 'Old Ltd', place: { country: 'IL' }, registrations: [
        { kind: 'vat', number: '514000003', place: { country: 'IL' }, validFrom: '2020-01-01', validTo: '2026-08-31' },
        { kind: 'sales_tax', number: 'P-1', place: { country: 'US', state: 'NY' } }] } } });
    try {
      const period = { workspaceId: ws2, uid: 'o', startDate: '2026-09-01', endDate: '2026-09-30' };
      await assert.rejects(svc.fileTaxReturn(db as never, { ...period, registration: 'vat:IL:514000003' }), (e: Error & { status?: number }) => e.status === 400 && /in force from 2026-09-01 to 2026-09-30/.test(e.message));
      await assert.rejects(svc.fileTaxReturn(db as never, { ...period, registration: 'sales_tax:US-NY:P-1' }), (e: Error & { status?: number }) => e.status === 400);
      // August overlaps the VAT number's last month: allowed
      const aug = await svc.fileTaxReturn(db as never, { ...period, startDate: '2026-08-01', endDate: '2026-08-31', registration: 'vat:IL:514000003' });
      assert.equal(aug.documentCount, 0);
    } finally {
      await db.pool.query(`delete from public."taxReturns" where workspace_id = $1`, [ws2]);
      await db.pool.query(`delete from public."auditLogs" where workspace_id = $1`, [ws2]);
      await db.pool.query(`delete from public."workspaces" where id = $1`, [ws2]);
    }
  });

  test('ids: the exact key, never a look-alike', () => {
    const a = svc.taxReturnId(ws, '2026-09-01', '2026-09-30', 'vat:IL:51/1');
    const b = svc.taxReturnId(ws, '2026-09-01', '2026-09-30', 'vat:IL:51-1');
    const c = svc.taxReturnId(ws, '2026-09-01', '2026-09-30', 'vat:IL-תל אביב:1');
    const d = svc.taxReturnId(ws, '2026-09-01', '2026-09-30', 'vat:IL-חיפה:1');
    assert.equal(new Set([a, b, c, d]).size, 4);
    assert.equal(svc.taxReturnId(ws, '2026-09-01', '2026-09-30'), `${ws}_tax_2026-09-01_2026-09-30`);
  });

  test('the whole workspace and Tel Aviv filed at the same moment: exactly one is kept', async () => {
    const period = { workspaceId: ws, uid: 'o', startDate: '2026-10-01', endDate: '2026-10-31' };
    const results = await Promise.allSettled([svc.fileTaxReturn(db as never, period), svc.fileTaxReturn(db as never, { ...period, registration: TA })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, JSON.stringify(results.map(r => r.status === 'rejected' ? String(r.reason) : 'ok')));
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    const october = (await svc.listTaxReturns(db as never, ws)).filter(r => r.startDate === '2026-10-01');
    assert.equal(october.length, 1);
  });

  test('T-08: the stored copy compares with the same boxes recomputed after a late document', async () => {
    // the Tel Aviv return is filed from INV 1001 alone (net 100,000 + VAT 18,000)
    const filed = await svc.fileTaxReturn(db as never, { workspaceId: ws, uid: 'o', startDate: '2026-09-01', endDate: '2026-09-30', registration: TA });
    assert.equal(filed.documentCount, 1);
    // then a second Tel Aviv invoice is saved after the filing (net 50,000 + VAT 9,000): the same boxes recomputed now
    const late = { id: 'i3', number: '1003', date: '2026-09-28', status: 'sent', taxVersion: 2, amountCents: 59000, taxAmountCents: 9000 };
    await db.collection('invoices').doc(`${ws}_i3`).set({ ...late, workspaceId: ws });
    const listed = await svc.listTaxReturns(db as never, ws);
    // by hand: box 1 filed 18,000, now 27,000 (+9,000); box 6 filed 100,000, now 150,000 (+50,000)
    const changes = filedRegistrationChanges(listed, '2026-09-01', '2026-09-30', TA, [
      { key: '1', label: 'Tax on sales', cents: 27_000 },
      { key: '3', label: 'Total tax due', cents: 27_000 },
      { key: '5', label: 'Net tax to pay (negative: to reclaim)', cents: 27_000 },
      { key: '6', label: 'Sales excluding tax', cents: 150_000 },
    ]);
    assert.deepEqual(changes, [
      { key: '1', label: 'Tax on sales', filedCents: 18_000, nowCents: 27_000 },
      { key: '3', label: 'Total tax due', filedCents: 18_000, nowCents: 27_000 },
      { key: '5', label: 'Net tax to pay (negative: to reclaim)', filedCents: 18_000, nowCents: 27_000 },
      { key: '6', label: 'Sales excluding tax', filedCents: 100_000, nowCents: 150_000 },
    ]);
    // the journey over the same documents shows the same comparison
    const journey = israelMonthJourney({
      month: '2026-09', today: '2026-10-20', currency: 'ILS', profiles: PROFILES, order: ['world'],
      filedPeriods: listed as never,
      invoices: [invoices[0], late] as never,
    });
    const returned = journey.steps.find(s => s.id === 'vat-report')!.returns.find(r => r.registration === TA)!;
    assert.equal(returned.filed, true);
    assert.deepEqual(returned.changes, changes);
  });
});
