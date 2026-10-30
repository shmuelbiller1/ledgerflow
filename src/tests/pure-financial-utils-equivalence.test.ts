import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyChartValue,
  formatCurrency as pureFormatCurrency,
  formatDecimal as pureFormatDecimal,
  formatDollars as pureFormatDollars,
  formatMoney,
  formatSignedAmount as pureFormatSignedAmount,
  getCurrencyDivisor as pureGetCurrencyDivisor,
  getCurrencyFractionDigits as pureGetCurrencyFractionDigits,
  isAmountText as pureIsAmountText,
  parseAmountToCents as pureParseAmountToCents,
  readAmountCents as pureReadAmountCents,
} from '../lib/moneyFormat';
import {
  addToDateISO as pureAddToDateISO,
  calendarDateISO as pureCalendarDateISO,
  formatTzDate as pureFormatTzDate,
  getDateInTimezoneISO,
  getLocalDateISO as pureGetLocalDateISO,
  monthBoundsISO as pureMonthBoundsISO,
  parseDateInTimezone,
  parseLocalDate as pureParseLocalDate,
  workspaceYearMonth as pureWorkspaceYearMonth,
} from '../lib/calendarDate';
import { calculateFXCents as pureCalculateFXCents, roundCents as pureRoundCents } from '../lib/cents';
import {
  THREE_DECIMAL_CURRENCIES as pureThreeDecimal,
  amountStep as pureAmountStep,
  convertMinorUnits,
  minorToMajor as pureMinorToMajor,
} from '../lib/currencyMinorUnits';
import { parseCsvChecked, sanitizeCsvCell as pureSanitizeCsvCell } from '../lib/csv';
import { csvMoney, toCsv } from '../lib/csvExport';
import * as browserUtils from '../lib/utils';
import { useAuthStore } from '../stores/useAuthStore';
import { computeCustomerBalanceSummary, computeVendorBalanceSummary } from '../server/reports/partyReports';
import type { Bill, Customer, Invoice, Vendor, Workspace } from '../types';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_equiv',
    name: 'Equivalence Books',
    uid: 'user_equiv',
    members: ['user_equiv'],
    currency: 'USD',
    timezone: 'America/New_York',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Workspace;
}

afterEach(() => {
  useAuthStore.setState({ workspaces: [], currentWorkspaceId: null });
  if (typeof globalThis !== 'undefined') {
    delete (globalThis as { window?: unknown }).window;
  }
});

describe('Pure financial, timezone, and CSV module equivalence', () => {
  test('2-decimal and 3-decimal currency minor units, formatting, and parsing match browser utils', () => {
    assert.deepEqual(pureThreeDecimal, browserUtils.THREE_DECIMAL_CURRENCIES);

    for (const code of ['USD', 'EUR', 'GBP', 'ILS']) {
      assert.equal(pureGetCurrencyFractionDigits(code), 2);
      assert.equal(pureGetCurrencyDivisor(code), 100);
      assert.equal(pureAmountStep(code), '0.01');
      assert.equal(pureMinorToMajor(12345, code), 123.45);
    }

    assert.equal(pureGetCurrencyFractionDigits('JPY'), 0);
    assert.equal(pureGetCurrencyDivisor('JPY'), 1);
    assert.equal(pureAmountStep('JPY'), '1');
    assert.equal(pureMinorToMajor(10000, 'JPY'), 10000);
    assert.equal(convertMinorUnits(10000, 0.0067, 'JPY', 'USD'), 6700);

    assert.equal(currencyChartValue(12345), 123.45);
    (globalThis as { window?: { __ledgerBaseCurrency?: string } }).window = { __ledgerBaseCurrency: 'KWD' };
    assert.equal(currencyChartValue(12345), 12.345);
    delete (globalThis as { window?: unknown }).window;

    for (const code of ['KWD', 'BHD', 'JOD', 'OMR', 'TND', 'IQD', 'LYD']) {
      assert.equal(pureGetCurrencyFractionDigits(code), 3);
      assert.equal(pureGetCurrencyDivisor(code), 1000);
      assert.equal(pureAmountStep(code), '0.001');
      assert.equal(pureMinorToMajor(12345, code), 12.345);
      assert.equal(convertMinorUnits(12345, 3.25, code, 'USD'), 4012);
    }
    assert.equal(pureFormatDecimal(12345), '123.45');
    assert.equal(pureFormatDecimal(12345), browserUtils.formatDecimal(12345));

    assert.equal(formatMoney(0, 'USD'), '$0.00');
    assert.equal(formatMoney(-12345, 'USD'), '-$123.45');
    assert.equal(formatMoney(-12345, 'USD', { locale: 'en-US', negativeStyle: 'accounting' }), '($123.45)');
    assert.equal(
      formatMoney(-12345, 'KWD', { locale: 'en-US', negativeStyle: 'accounting' }),
      `(${formatMoney(12345, 'KWD', { locale: 'en-US' })})`,
    );
    assert.equal(pureFormatDollars(9876.54, 'USD'), browserUtils.formatDollars(9876.54, 'USD'));
    assert.equal(pureFormatSignedAmount(4500, 'out', 'USD'), browserUtils.formatSignedAmount(4500, 'out', 'USD'));
    assert.equal(pureFormatSignedAmount(4500, 'in', 'USD'), '+$45.00');
    assert.equal(pureFormatSignedAmount(4500, 'none', 'USD'), '$45.00');

    // Large integer cents near safe accounting limits and HALF_UP rounding
    assert.equal(pureFormatDecimal(900_719_925_474_099), '9007199254740.99');
    assert.equal(pureParseAmountToCents('9007199254740.99'), 900_719_925_474_099);
    assert.equal(pureParseAmountToCents('($1,234.56)'), -123456);
    assert.equal(pureReadAmountCents('1,234.56'), 123456);
    assert.equal(pureReadAmountCents('12..34'), null);
    assert.equal(pureIsAmountText('(1,234.50)'), true);
    assert.equal(pureIsAmountText('12+34'), false);

    assert.equal(pureRoundCents(100.5), 101);
    assert.equal(pureRoundCents(-100.5), -101);
    assert.equal(pureCalculateFXCents(10000, 1.23456), 12346);
    assert.equal(pureCalculateFXCents(10000, 1.23456), browserUtils.calculateFXCents(10000, 1.23456));
  });

  test('browser utils read active workspace preferences from useAuthStore while formatMoney stays pure', () => {
    useAuthStore.setState({
      currentWorkspaceId: 'ws_equiv',
      workspaces: [
        makeWorkspace({
          currency: 'EUR',
          timezone: 'Pacific/Auckland',
          moneyDisplay: { locale: 'de-DE', negativeStyle: 'accounting' },
        }),
      ],
    });

    // Browser readAmountCents picks up workspace comma-decimal locale (de-DE)
    assert.equal(browserUtils.readAmountCents('12,50'), 1250);
    assert.equal(pureReadAmountCents('12,50'), 1250);

    // Browser formatCurrency picks up workspace moneyDisplay (accounting parentheses + de-DE separators)
    assert.equal(browserUtils.formatCurrency(-2500, 'USD'), pureFormatCurrency(-2500, 'USD'));
    assert.ok(browserUtils.formatCurrency(-2500, 'USD').startsWith('('));

    // Pure formatMoney ignores global browser store unless moneyDisplay is passed explicitly
    assert.equal(formatMoney(-2500, 'USD'), '-$25.00');
    assert.equal(formatMoney(-2500, 'USD', { locale: 'en-US', negativeStyle: 'accounting' }), '($25.00)');
  });

  test('timezone boundary dates resolve deterministically per explicit timezone and match browser store when omitted', () => {
    // 2026-01-01T01:30:00Z is still 2025-12-31 in Los Angeles (UTC-8), 2026-01-01 in UTC & Tokyo
    const utcNewYear = new Date('2026-01-01T01:30:00.000Z');
    assert.equal(getDateInTimezoneISO(utcNewYear, 'America/Los_Angeles'), '2025-12-31');
    assert.equal(getDateInTimezoneISO(utcNewYear, 'America/New_York'), '2025-12-31');
    assert.equal(getDateInTimezoneISO(utcNewYear, 'UTC'), '2026-01-01');
    assert.equal(getDateInTimezoneISO(utcNewYear, 'Asia/Tokyo'), '2026-01-01');
    assert.equal(pureFormatTzDate(utcNewYear, 'America/Los_Angeles'), '2025-12-31');

    // Month-end boundary: 2026-10-31T23:30:00Z is Nov 1 in Tokyo (UTC+9), Oct 31 in Los Angeles (UTC-7)
    const monthEdge = new Date('2026-10-31T23:30:00.000Z');
    assert.equal(getDateInTimezoneISO(monthEdge, 'Asia/Tokyo'), '2026-11-01');
    assert.equal(getDateInTimezoneISO(monthEdge, 'America/Los_Angeles'), '2026-10-31');

    // Browser store timezone feeds getLocalDateISO / workspaceYearMonth / parseLocalDate when omitted
    useAuthStore.setState({
      currentWorkspaceId: 'ws_equiv',
      workspaces: [makeWorkspace({ timezone: 'America/Los_Angeles' })],
    });
    assert.equal(browserUtils.getLocalDateISO(utcNewYear), '2025-12-31');
    assert.equal(pureGetLocalDateISO(utcNewYear), '2025-12-31');
    assert.deepEqual(browserUtils.workspaceYearMonth(), pureWorkspaceYearMonth());

    useAuthStore.setState({
      currentWorkspaceId: 'ws_equiv',
      workspaces: [makeWorkspace({ timezone: 'Asia/Tokyo' })],
    });
    assert.equal(browserUtils.getLocalDateISO(utcNewYear), '2026-01-01');
    assert.equal(browserUtils.getLocalDateISO(monthEdge), '2026-11-01');
    assert.deepEqual(browserUtils.workspaceYearMonth(), pureWorkspaceYearMonth());

    // parseDateInTimezone matches parseLocalDate for that workspace timezone
    assert.equal(
      parseDateInTimezone('2026-06-15', 'Asia/Tokyo').getTime(),
      pureParseLocalDate('2026-06-15').getTime(),
    );

    // Pure civil calendar arithmetic
    assert.equal(pureCalendarDateISO(new Date(2024, 1, 29)), '2024-02-29');
    assert.equal(pureAddToDateISO('2024-01-31', { months: 1 }), '2024-02-29');
    assert.equal(pureAddToDateISO('2025-01-31', { months: 1 }), '2025-02-28');
    assert.deepEqual(pureMonthBoundsISO('2024-02-15'), { start: '2024-02-01', end: '2024-02-29' });
  });

  test('server party balance reports honor explicit workspace timezone independent of client store', () => {
    useAuthStore.setState({
      currentWorkspaceId: 'ws_equiv',
      workspaces: [makeWorkspace({ timezone: 'Pacific/Kiritimati' })],
    });

    const customers: Customer[] = [{ id: 'c1', workspaceId: 'ws_1', name: 'Acme Corp' } as Customer];
    const invoices: Invoice[] = [
      {
        id: 'inv_future',
        workspaceId: 'ws_1',
        customerId: 'c1',
        customerName: 'Acme Corp',
        date: '2999-12-31',
        dueDate: '2999-12-31',
        amountCents: 50000,
        status: 'sent',
      } as Invoice,
      {
        id: 'inv_past',
        workspaceId: 'ws_1',
        customerId: 'c1',
        customerName: 'Acme Corp',
        date: '2025-01-15',
        dueDate: '2025-02-15',
        amountCents: 12500,
        status: 'sent',
      } as Invoice,
    ];
    const custRows = computeCustomerBalanceSummary(customers, invoices, [], [], undefined, undefined, 'America/New_York');
    assert.equal(custRows.length, 1);
    assert.equal(custRows[0].balanceCents, 12500);

    const vendors: Vendor[] = [{ id: 'v1', workspaceId: 'ws_1', name: 'Supply Co' } as Vendor];
    const bills: Bill[] = [
      {
        id: 'bill_future',
        workspaceId: 'ws_1',
        vendorId: 'v1',
        vendorName: 'Supply Co',
        date: '2999-12-31',
        dueDate: '2999-12-31',
        amountCents: 30000,
        status: 'approved',
      } as Bill,
      {
        id: 'bill_past',
        workspaceId: 'ws_1',
        vendorId: 'v1',
        vendorName: 'Supply Co',
        date: '2025-03-10',
        dueDate: '2025-04-10',
        amountCents: 8400,
        status: 'approved',
      } as Bill,
    ];
    const vendRows = computeVendorBalanceSummary(vendors, bills, [], [], undefined, undefined, 'America/New_York');
    assert.equal(vendRows.length, 1);
    assert.equal(vendRows[0].balanceCents, 8400);

    // Browser callers omitting date & timezone (e.g. Sales.tsx) still honor the active workspace timezone
    const aheadDay = getDateInTimezoneISO(new Date(), 'Pacific/Kiritimati');
    const behindDay = getDateInTimezoneISO(new Date(), 'Pacific/Niue');
    const edgeInvoice: Invoice = {
      id: 'inv_edge',
      workspaceId: 'ws_1',
      customerId: 'c1',
      customerName: 'Acme Corp',
      date: aheadDay,
      dueDate: aheadDay,
      amountCents: 3300,
      status: 'sent',
    } as Invoice;
    useAuthStore.setState({
      currentWorkspaceId: 'ws_equiv',
      workspaces: [makeWorkspace({ timezone: 'Pacific/Kiritimati' })],
    });
    assert.equal(computeCustomerBalanceSummary(customers, [edgeInvoice], [], [])[0].balanceCents, 3300);
    if (aheadDay > behindDay) {
      useAuthStore.setState({
        currentWorkspaceId: 'ws_equiv',
        workspaces: [makeWorkspace({ timezone: 'Pacific/Niue' })],
      });
      assert.equal(computeCustomerBalanceSummary(customers, [edgeInvoice], [], [])[0].balanceCents, 0);
    }
  });

  test('CSV cell sanitization neutralizes formula injection while preserving numeric amounts and round-trip quoting', () => {
    assert.equal(pureSanitizeCsvCell('=1+1'), '"\'=1+1"');
    assert.equal(pureSanitizeCsvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
    assert.equal(pureSanitizeCsvCell("-cmd|' /C calc'!A0"), `"'-cmd|' /C calc'!A0"`);
    assert.equal(pureSanitizeCsvCell('@IMPORTXML("http://evil")'), '"\'@IMPORTXML(""http://evil"")"');
    assert.equal(pureSanitizeCsvCell('\t=1'), '"\'\t=1"');
    assert.equal(pureSanitizeCsvCell('\r=1'), '"\'\r=1"');

    // Formatted negative numbers are preserved without leading apostrophe
    assert.equal(pureSanitizeCsvCell('-1,234.56'), '"-1,234.56"');
    assert.equal(pureSanitizeCsvCell('-$50.00'), '"-$50.00"');
    assert.equal(pureSanitizeCsvCell(-1234.56), '-1234.56');
    assert.equal(pureSanitizeCsvCell(null), '""');
    assert.equal(pureSanitizeCsvCell(undefined), '""');
    assert.equal(pureSanitizeCsvCell('Acme "West", Inc.'), browserUtils.sanitizeCsvCell('Acme "West", Inc.'));

    const csv = toCsv(
      ['Vendor', 'Memo', 'Amount'],
      [['Acme, "North"', '=HYPERLINK("http://x")', csvMoney(-12345)]],
    );
    const parsed = parseCsvChecked(csv);
    assert.deepEqual(parsed, [
      ['Vendor', 'Memo', 'Amount'],
      ['Acme, "North"', "'=HYPERLINK(\"http://x\")", '-123.45'],
    ]);
  });
});
