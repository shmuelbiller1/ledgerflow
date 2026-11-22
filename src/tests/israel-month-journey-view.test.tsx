import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
afterEach(() => cleanup());
import { formatCurrency } from '../lib/utils';
import { ilPcn874Preview, israelMonthJourney, type IsraelMonth } from '../lib/israelMonthJourney';
import type { TaxProfiles } from '../lib/tax/profile';
import { IsraelMonthJourneyPanel } from '../components/reporting/IsraelMonthJourneyReportView';

const profiles: TaxProfiles = {
  books: { name: 'Tel Aviv Ltd', registrations: [{ kind: 'vat', number: '514000000', place: { country: 'IL' }, filing: 'monthly' }] },
} as TaxProfiles;
const customers = [
  { id: 'c1', name: 'Buyer Ltd', metadata: { vatNumber: '512345678' } },
  { id: 'c2', name: 'Private customer' },
];
const vendors = [{ id: 'v1', name: 'Supplier Ltd', metadata: { vatNumber: '513333333' } }];
const invoices = [
  { id: 'i1', number: '1001', date: '2026-09-10', status: 'sent', taxVersion: 2, amountCents: 1180000, taxAmountCents: 180000, customerId: 'c1' },
  { id: 'i2', number: '1002', date: '2026-09-15', status: 'sent', taxVersion: 2, amountCents: 118000, taxAmountCents: 18000, customerId: 'c2' },
] as never;
const bills = [{ id: 'b1', number: '9001', date: '2026-09-20', status: 'pending', taxVersion: 2, amountCents: 236000, taxAmountCents: 36000, vendorId: 'v1' }] as never;

const journey = (extra: Partial<Parameters<typeof israelMonthJourney>[0]> = {}): IsraelMonth => israelMonthJourney({
  month: '2026-09', today: '2026-10-19', currency: 'ILS', profiles, order: ['world'],
  invoices, bills, customers, vendors, ...extra,
});
const preview = (dealerId = '514000000') => ilPcn874Preview({
  month: '2026-09', generatedOn: '2026-10-19', currency: 'ILS', dealerId,
  invoices, bills, customers, vendors,
  returns: journey().steps.find(s => s.id === 'vat-report')!.returns,
});
const panel = (props: Partial<React.ComponentProps<typeof IsraelMonthJourneyPanel>> = {}) => render(
  <IsraelMonthJourneyPanel journey={journey()} preview={preview()} currency="ILS" monthText="2026-09"
    onMonthChange={() => {}} dealerId="514000000" onDealerIdChange={() => {}} {...props} />,
);

test('A-152 screen: every step is listed with its screen, status and what the data says', () => {
  panel();
  assert.ok(screen.getByRole('heading', { name: 'Israel month journey' }));
  for (const title of ['Israeli VAT registration for the month', 'Allocation numbers on business invoices', 'Periodic VAT report (form 836 figures)', 'PCN874 draft for the month', 'Close the month'])
    assert.ok(screen.getAllByText(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length >= 1, title);
  assert.ok(screen.getAllByText('Needs attention').length >= 1);
  assert.match(screen.getByText(/next: Allocation numbers/).textContent ?? '', /next: Allocation numbers/);
  // the return's own figures, in the workspace currency
  assert.ok(screen.getAllByText(formatCurrency(1100000, 'ILS')).length >= 1, 'taxable sales 11,000.00');
  assert.ok(screen.getAllByText(formatCurrency(162000, 'ILS')).length >= 1, 'to pay 1,620.00');
  assert.ok(screen.getAllByText('514000000').length);
  // each step opens the screen that does the work
  assert.ok(screen.getByRole('button', { name: 'Open Reports → Tax return' }));
  assert.ok(screen.getByRole('button', { name: 'Open Sales → Invoices' }));
  assert.ok(screen.getByRole('button', { name: 'Open Month-end close' }));
  assert.match(screen.getByText((_c, el) => el?.tagName === 'P' && /nothing files, posts, pays or closes/.test(el.textContent ?? ''))?.textContent ?? '', /nothing files, posts, pays or closes/);
});

test('A-152 screen: allocation numbers are named invoice by invoice', () => {
  panel();
  const table = screen.getByRole('table', { name: /Invoices that need an allocation number/ });
  assert.ok(table);
  assert.match(table.textContent ?? '', /1001/);
  assert.match(table.textContent ?? '', /No allocation number is recorded/);
  assert.match(table.textContent ?? '', /Buyer Ltd/);
});

test('A-152 screen: the PCN874 section says it is not filing-ready and lists what cannot be written', () => {
  panel();
  assert.ok(screen.getByRole('heading', { name: 'PCN874 historical draft' }));
  assert.match(screen.getByText(/not filing-ready/).textContent ?? '', /not filing-ready/);
  const layout = screen.getByRole('table', { name: 'PCN874 layout checks' });
  assert.match(layout.textContent ?? '', /Header record.*131 characters.*No draft text built.*Not built/);
  assert.match(layout.textContent ?? '', /Mapped documents.*2 row\(s\) written.*1 cannot be written/);
  const reconciliation = screen.getByRole('table', { name: 'PCN874 totals reconciliation' });
  assert.match(reconciliation.textContent ?? '', /Draft \(NIS\).*VAT report \(NIS\).*Difference \(NIS\)/);
  assert.ok(screen.getAllByText(/Nothing is submitted from this screen/).length >= 1);
  const table = screen.getByRole('table', { name: /Documents that cannot be written/ });
  assert.match(table.textContent ?? '', /1002/);
  assert.match(table.textContent ?? '', /VAT\/dealer number/);
  assert.equal(screen.queryByRole('button', { name: 'Download PCN874 draft' }), screen.getByRole('button', { name: 'Download PCN874 draft' }));
  assert.ok(screen.getAllByText(/row\(s\)/).length >= 1, 'the row count is stated');
});

test('E-55 validation checks the built fixed-width records when all documents map', () => {
  const validPreview = ilPcn874Preview({
    month: '2026-09', generatedOn: '2026-10-19', currency: 'ILS', dealerId: '514000000',
    invoices: [invoices[0]], bills, customers, vendors,
    returns: journey().steps.find(s => s.id === 'vat-report')!.returns,
  });
  assert.ok(validPreview.draft, 'all remaining documents map to a draft');
  panel({ preview: validPreview });
  const layout = screen.getByRole('table', { name: 'PCN874 layout checks' });
  assert.match(layout.textContent ?? '', /Header record.*131 characters.*131 characters.*Pass/);
  assert.match(layout.textContent ?? '', /Transaction\/detail records.*2 row\(s\) of 60.*All rows 60 characters.*Pass/);
  assert.match(layout.textContent ?? '', /Closing record.*10 characters.*10 characters.*Pass/);
});

test('A-152 screen: the download is offered only when every document maps and the dealer number is nine digits', () => {
  panel({ preview: preview('') });
  const button = screen.getByRole('button', { name: 'Download PCN874 draft' }) as HTMLButtonElement;
  assert.equal(button.disabled, true);
  assert.match(screen.getByRole('status').textContent ?? '', /9-digit dealer number/);
});

test('A-152 screen: a month that is not written as one is reported, not guessed', () => {
  panel({ journey: null, preview: null, monthText: '09/2026' });
  assert.match(screen.getByRole('alert').textContent ?? '', /A month is written as 2026-09/);
});

test('A-152 screen: a capped list is called provisional while it loads', () => {
  panel({ loading: true, partial: true });
  assert.ok(screen.getAllByRole('status').some(node => /Loading/.test(node.textContent ?? '')), 'the loading line');
  assert.match(screen.getByRole('alert').textContent ?? '', /provisional/);
});

/** The delta text in a "Since filed" cell is wrapped in parentheses; quote it for the regex. */
const quoted = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** T-08: the copy the server kept when the month's return was filed (i1 and i2, bill b1). */
const filedCopy = {
  startDate: '2026-09-01', endDate: '2026-09-30', registration: 'vat:IL:514000000',
  boxes: [
    { key: '1', label: 'Tax on sales', cents: 198_000 },
    { key: '2', label: 'Tax due on reverse-charge purchases', cents: 0 },
    { key: '3', label: 'Total tax due', cents: 198_000 },
    { key: '4', label: 'Tax reclaimable on purchases', cents: 36_000 },
    { key: '5', label: 'Net tax to pay (negative: to reclaim)', cents: 162_000 },
    { key: '6', label: 'Sales excluding tax', cents: 1_100_000 },
    { key: '7', label: 'Purchases excluding tax', cents: 200_000 },
    { key: '8', label: 'Zero-rated sales', cents: 0 },
    { key: '9', label: 'Exempt sales', cents: 0 },
  ],
};

test('A-152 screen: T-08 the changes since a return was filed are shown box by box', () => {
  // the return was filed from i1 and i2 alone (output VAT 198,000; input VAT 36,000 from bill b1);
  // a credit note CN1 (VAT 1,800) is saved after the filing
  const credit = { id: 'cn1', number: 'CN1', date: '2026-09-25', status: 'issued', taxVersion: 2, amountCents: 11_800, taxAmountCents: 1_800, customerId: 'c1' } as never;
  panel({
    journey: journey({ creditNotes: [credit], filedPeriods: [filedCopy] }),
  });
  const table = screen.getByRole('table', { name: /The VAT report each registration files for this month/ });
  assert.match(table.textContent ?? '', /Since filed/);
  assert.match(table.textContent ?? '', new RegExp(`Tax on sales : filed ${quoted(formatCurrency(198_000, 'ILS'))}, now ${quoted(formatCurrency(196_200, 'ILS'))}\\(${quoted(formatCurrency(-1_800, 'ILS'))}\\)`));
  assert.match(table.textContent ?? '', new RegExp(`Sales excluding tax : filed ${quoted(formatCurrency(1_100_000, 'ILS'))}, now ${quoted(formatCurrency(1_090_000, 'ILS'))}\\(${quoted(formatCurrency(-10_000, 'ILS'))}\\)`));
});

test('A-152 screen: T-08 nothing changed since filing says so; no filed copy says nothing', () => {
  // the month's i1 and i2 alone (bill b1's input VAT is in the same nine boxes): the copy matches now
  panel({ journey: journey({ filedPeriods: [filedCopy] }) });
  assert.ok(screen.getByText(/Nothing has changed since it was filed/), 'the month as i1 and i2: the copy matches');
});
