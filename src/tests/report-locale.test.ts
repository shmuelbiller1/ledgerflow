/**
 * A-220: dates and amounts on a report header read the reader's way.
 *
 * The expected strings are worked by hand for the three locales the owner named — en-US
 * (`Oct 1, 2026`), en-GB (`1 Oct 2026`) and he-IL (`1 באוק׳ 2026`) — and for amounts through the
 * same `moneyText` the rows use. A date is a stored calendar day: no timezone may move it.
 */
import './helpers/dom';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import {
  REPORT_LOCALES,
  reportAmountText,
  reportDateText,
  reportDateTextFor,
  reportHeadingText,
  reportLocaleFor,
  reportPeriodText,
  reportPeriodTextIn,
  resolveReportLocale,
} from '../lib/reportLocale';
import { ReportPeriodHeading } from '../components/reporting/ReportPeriodHeading';
import { useUIStore } from '../stores/useUIStore';
import { useAuthStore } from '../stores/useAuthStore';

/** Hebrew currency text carries invisible bidi marks; compare what a reader sees. */
const plain = (text: string) => text.replace(/[\u200e\u200f\u061c]/g, '').replace(/\u00a0/g, ' ').trim();

afterEach(() => {
  cleanup();
  useUIStore.setState({ language: 'en', dateFormatPref: 'MMM DD, YYYY' });
});

test('A-220: the three locales the owner named, and the locale a workspace resolves to', () => {
  assert.deepEqual([...REPORT_LOCALES], ['en-US', 'en-GB', 'he-IL']);
  // a saved money format decides dates too, so a header and its totals agree
  assert.equal(resolveReportLocale({ moneyDisplayLocale: 'en-GB' }), 'en-GB');
  assert.equal(resolveReportLocale({ moneyDisplayLocale: 'de-DE' }), 'de-DE');
  // Hebrew saved as `he` still means Israel
  assert.equal(resolveReportLocale({ moneyDisplayLocale: 'he' }), 'he-IL');
  // no saved format: the interface language decides, then en-US
  assert.equal(resolveReportLocale({ language: 'he' }), 'he-IL');
  assert.equal(resolveReportLocale({ language: 'en' }), 'en-US');
  assert.equal(resolveReportLocale(), 'en-US');
  // an unreadable saved value is ignored rather than thrown
  assert.equal(resolveReportLocale({ moneyDisplayLocale: 'not a locale!!' }), 'en-US');
});

test('A-220: one date, written the three ways by hand', () => {
  assert.equal(reportDateText('2026-10-01', 'en-US'), 'Oct 1, 2026');
  assert.equal(reportDateText('2026-10-01', 'en-GB'), '1 Oct 2026');
  assert.equal(reportDateText('2026-10-01', 'he-IL'), '1 באוק׳ 2026');
  // not a timezone-shifted date: a stored day stays that day
  assert.equal(reportDateText('2026-01-01', 'en-US'), 'Jan 1, 2026');
  assert.equal(reportDateText('2026-12-31', 'en-GB'), '31 Dec 2026');
  // empty or unreadable input is shown as given, never silently blanked
  assert.equal(reportDateText('', 'en-US'), '');
  assert.equal(reportDateText(null, 'en-US'), '');
  assert.equal(reportDateText('not a date', 'en-US'), 'not a date');
});

test('A-220: a period reads as one range, and a single day is written once', () => {
  assert.equal(reportPeriodText('2026-10-01', '2026-10-31', 'en-US'), 'Oct 1, 2026 – Oct 31, 2026');
  assert.equal(reportPeriodText('2026-10-01', '2026-10-31', 'en-GB'), '1 Oct 2026 – 31 Oct 2026');
  assert.equal(reportPeriodText('2026-10-01', '2026-10-31', 'he-IL'), '1 באוק׳ 2026 – 31 באוק׳ 2026');
  assert.equal(reportPeriodText('2026-10-01', '2026-10-01', 'en-GB'), '1 Oct 2026');
  assert.equal(reportPeriodText('', '2026-10-31', 'en-US'), 'until Oct 31, 2026');
  assert.equal(reportPeriodText('2026-10-01', '', 'en-US'), 'from Oct 1, 2026');
  assert.equal(reportPeriodText('', '', 'en-US'), '');
  // a backwards period is shown as typed: the report explains the problem itself
  assert.equal(reportPeriodText('2026-10-31', '2026-10-01', 'en-GB'), '31 Oct 2026 – 1 Oct 2026');
});

test('A-220: amounts follow the same locale as the rows, worked by hand', () => {
  // $1,234.56 / £1,234.56 / ₪1,234.56 in each locale's own convention
  assert.equal(plain(reportAmountText(123456, 'USD', 2, { locale: 'en-US' })), '$1,234.56');
  assert.equal(plain(reportAmountText(123456, 'GBP', 2, { locale: 'en-GB' })), '£1,234.56');
  assert.equal(plain(reportAmountText(123456, 'ILS', 2, { locale: 'he-IL' })), '1,234.56 ₪');
  // a negative total keeps the chosen style
  assert.equal(plain(reportAmountText(-123456, 'USD', 2, { locale: 'en-US', negativeStyle: 'accounting' })), '($1,234.56)');
  assert.equal(plain(reportAmountText(-123456, 'GBP', 2, { locale: 'en-GB' })), '-£1,234.56');
  // zero decimals for a currency without them (yen)
  assert.equal(plain(reportAmountText(1234, 'JPY', 0, { locale: 'en-US' })), '¥1,234');
});

test('A-220: a report heading carries the report and its period', () => {
  assert.equal(reportHeadingText('Profit and loss', '2026-10-01', '2026-10-31', 'en-US'), 'Profit and loss · Oct 1, 2026 – Oct 31, 2026');
  assert.equal(reportHeadingText('Profit and loss', '2026-10-01', '2026-10-31', 'en-GB'), 'Profit and loss · 1 Oct 2026 – 31 Oct 2026');
  assert.equal(reportHeadingText('Balance sheet', '', '', 'he-IL'), 'Balance sheet');
});

test('A-220: the heading on the page follows the workspace, not the browser', () => {
  useUIStore.setState({ language: 'en' });
  useAuthStore.setState({
    workspaces: [{ id: 'ws-1', name: 'Books', moneyDisplay: { locale: 'en-GB' } }] as never,
    currentWorkspaceId: 'ws-1',
  } as never);

  const { rerender } = render(
    React.createElement(ReportPeriodHeading, { startDate: '2026-10-01', endDate: '2026-10-31' }),
  );
  const heading = screen.getByTestId('report-period-heading');
  assert.equal(heading.getAttribute('data-report-locale'), 'en-GB');
  assert.equal(heading.textContent, '1 Oct 2026 – 31 Oct 2026');

  // the same workspace saved as Israel reads Hebrew dates
  useAuthStore.setState({ workspaces: [{ id: 'ws-1', name: 'Books', moneyDisplay: { locale: 'he-IL' } }] as never } as never);
  rerender(React.createElement(ReportPeriodHeading, { startDate: '2026-10-01', endDate: '2026-10-31' }));
  assert.equal(screen.getByTestId('report-period-heading').textContent, '1 באוק׳ 2026 – 31 באוק׳ 2026');

  // an as-of header (balance sheet, trial balance) names one date
  rerender(React.createElement(ReportPeriodHeading, { asOf: true, startDate: '2026-10-01', endDate: '2026-10-31' }));
  assert.equal(screen.getByTestId('report-period-heading').textContent, 'As of 31 באוק׳ 2026');
});

test('A-220: with no saved format the interface language picks the dates', () => {
  useAuthStore.setState({ workspaces: [{ id: 'ws-2', name: 'Books' }] as never, currentWorkspaceId: 'ws-2' } as never);
  useUIStore.setState({ language: 'he' });
  render(React.createElement(ReportPeriodHeading, { startDate: '2026-10-01', endDate: '2026-10-31' }));
  assert.equal(screen.getByTestId('report-period-heading').getAttribute('data-report-locale'), 'he-IL');
  assert.equal(screen.getByTestId('report-period-heading').textContent, '1 באוק׳ 2026 – 31 באוק׳ 2026');
});


test("H-8: the reader's own date format wins on a report header, so the page writes one day one way", () => {
  // Preferences → Date Display Format. Before H-8 the header ignored it and said "Oct 1, 2026"
  // while the rows under it (formatDate, the transaction grid) said "2026-10-01" or "01/10/2026".
  assert.equal(reportDateTextFor('2026-10-01', 'en-US', 'YYYY-MM-DD'), '2026-10-01');
  assert.equal(reportDateTextFor('2026-10-01', 'en-US', 'MM/DD/YYYY'), '10/01/2026');
  assert.equal(reportDateTextFor('2026-10-01', 'en-US', 'DD/MM/YYYY'), '01/10/2026');
  // the month-name layout keeps the country's own month names
  assert.equal(reportDateTextFor('2026-10-01', 'en-GB', 'MMM DD, YYYY'), '1 Oct 2026');
  // and with no choice the locale decides exactly as before
  assert.equal(reportDateTextFor('2026-10-01', 'en-GB', null), '1 Oct 2026');
  assert.equal(reportPeriodTextIn('2026-10-01', '2026-10-31', 'en-US', 'DD/MM/YYYY'), '01/10/2026 – 31/10/2026');
  // a single day is still written once, and a half-open range keeps its wording
  assert.equal(reportPeriodTextIn('2026-10-01', '2026-10-01', 'en-US', 'YYYY-MM-DD'), '2026-10-01');
  assert.equal(reportPeriodTextIn('', '2026-10-31', 'en-US', 'YYYY-MM-DD'), 'until 2026-10-31');
});

test('H-8: only a format the app actually offers is honoured', () => {
  assert.equal(reportLocaleFor({ dateFormat: 'YYYY-MM-DD' }).dateFormat, 'YYYY-MM-DD');
  // an unknown value (an older saved preference, a hand-edited store) falls back to the locale
  // instead of printing a layout nobody selected
  assert.equal(reportLocaleFor({ dateFormat: 'dd.mm.yy' }).dateFormat, null);
  assert.equal(reportLocaleFor({ dateFormat: undefined, language: 'he' }).locale, 'he-IL');
});

test("H-8: the heading on the page follows the reader's format as well as the workspace", () => {
  useAuthStore.setState({
    workspaces: [{ id: 'ws-1', name: 'Books', moneyDisplay: { locale: 'en-GB' } }] as never,
    currentWorkspaceId: 'ws-1',
  } as never);
  useUIStore.setState({ language: 'en', dateFormatPref: 'YYYY-MM-DD' });
  const { rerender } = render(
    React.createElement(ReportPeriodHeading, { startDate: '2026-10-01', endDate: '2026-10-31' }),
  );
  assert.equal(screen.getByTestId('report-period-heading').textContent, '2026-10-01 – 2026-10-31');

  // an as-of header (balance sheet) names the one day in the chosen layout
  rerender(React.createElement(ReportPeriodHeading, { asOf: true, startDate: '2026-10-01', endDate: '2026-10-31' }));
  assert.equal(screen.getByTestId('report-period-heading').textContent, 'As of 2026-10-31');

  // back to the default: the locale writes it again, unchanged from A-220
  useUIStore.setState({ dateFormatPref: 'MMM DD, YYYY' });
  rerender(React.createElement(ReportPeriodHeading, { startDate: '2026-10-01', endDate: '2026-10-31' }));
  assert.equal(screen.getByTestId('report-period-heading').textContent, '1 Oct 2026 – 31 Oct 2026');
});

test("H-8: a statement header writes its period in the reader's format, not the stored ISO string", async () => {
  useUIStore.setState({ language: 'en', dateFormatPref: 'DD/MM/YYYY' });
  useAuthStore.setState({
    workspaces: [{ id: 'ws-1', name: 'Books', moneyDisplay: { locale: 'en-GB' } }] as never,
    currentWorkspaceId: 'ws-1',
  } as never);
  const { StatementColumns } = await import('../components/ledger/StatementColumns');
  render(React.createElement(StatementColumns, {
    kind: 'pl' as never,
    title: 'Profit and loss',
    accounts: [], transactions: [],
    startDate: '2026-10-01', endDate: '2026-10-31',
    compare: false, mode: 'months' as never, onModeChange: () => {},
    showPercent: false, onPercentChange: () => {},
    totalData: null, previousTotalData: null, totalAuthoritative: false,
    formatMoney: (cents: number) => String(cents),
    sortBy: 'name', sortDir: 'asc', onSort: () => {},
  } as never));
  const line = screen.getByText(/Activity inside each period/);
  assert.match(line.textContent || '', /01\/10\/2026 – 31\/10\/2026/);
  assert.doesNotMatch(line.textContent || '', /2026-10-01 to/);
});
