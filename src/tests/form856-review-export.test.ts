import test from 'node:test';
import assert from 'node:assert/strict';
import { form856ReviewExport, type Form856ReviewPayment } from '../lib/tax/form856ReviewExport';
import { toCsv } from '../lib/csvExport';

const p: Form856ReviewPayment = {
  id: 'p1', date: '2026-03-10', status: 'posted',
  direction: 'made', contactId: 'vendor-1', contactName: 'חברה Alpha',
  contactTaxId: '511111111', amountCents: 118000, vatCents: 18000,
  withheldCents: 30000, withholdingCertificate: 'cert-1', currency: 'ILS',
};
test('E-17 review worksheet keeps exact cents, year, Hebrew and restricted filing status', () => {
  const result = form856ReviewExport([p], '2026', 'ILS');
  assert.equal(result.readyForFiling, false);
  assert.equal(result.canDownloadForReview, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0][2], 'חברה Alpha');
  assert.deepEqual(result.rows[0].slice(5, 8), ['1180.00', '1000.00', '300.00']);
  const csv = toCsv([...result.headers], result.rows);
  assert.match(csv, /חברה Alpha/);
  assert.match(csv, /300\.00/);
});
test('E-17 refuses draft, void, mixed currency, invalid cents and impossible dates', () => {
  for (const invalid of [
    { status: 'draft' as const }, { status: 'void' as const },
    { currency: 'USD' }, { amountCents: Number.NaN },
    { vatCents: 200000 }, { withheldCents: 200000 },
    { date: '2026-02-30' }, { date: '2026-13-01' },
  ]) {
    const result = form856ReviewExport([{ ...p, ...invalid }], '2026', 'ILS');
    assert.equal(result.canDownloadForReview, false, JSON.stringify(invalid));
    assert.deepEqual(result.rows, [], JSON.stringify(invalid));
    assert.ok(result.blockers.length, JSON.stringify(invalid));
  }
});
test('E-17 review is never an authority upload and flags missing evidence', () => {
  const result = form856ReviewExport([{ ...p, contactTaxId: '', withholdingCertificate: '' }], '2026', 'ILS');
  assert.equal(result.readyForFiling, false);
  assert.equal(result.canDownloadForReview, true);
  assert.match(result.notices.join(' '), /tax ID/);
  assert.match(result.notices.join(' '), /certificate/);
  assert.equal(form856ReviewExport([p], '2025', 'ILS').canDownloadForReview, false);
  assert.equal(form856ReviewExport([p], 'bad', 'ILS').canDownloadForReview, false);
});
