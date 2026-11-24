/**
 * R-11, the #926 tail: a report's money reads in the book's currency, and a capped list or an
 * empty period is said plainly rather than implied.
 *
 * Each test here was red against the code before the fix:
 *  - the party-report footer printed the default currency (`$1,234.56` on a JPY book) while the
 *    cells beside it printed the book's (`¥123,456`);
 *  - six report screens called `formatCurrency(cents)` with no currency at all, so a JPY, ILS or
 *    KWD book was labelled in US dollars;
 *  - four report screens that read honestly-capped browser lists said nothing about the cap;
 *  - eight empty states were one flat sentence, telling "nothing loaded" apart from "nothing here"
 *    in no case.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { Users } from 'lucide-react';
import { PartyReportLayout } from '../components/reporting/PartyReportLayout';
import ReportEmptyState from '../components/reporting/ReportEmptyState';
import DepreciationLedgerReportView from '../components/reporting/DepreciationLedgerReportView';
import { markComponentCollectionsLoaded, setComponentWorkspace } from './helpers/componentFixtures';
import { useAuthStore } from '../stores/useAuthStore';
import { useLedgerStore } from '../stores/useLedgerStore';

type Row = { id: string; name: string; balanceCents: number };

function renderPartyLayout(data: Row[], opts: { currency?: string; capped?: readonly ('invoices' | 'bills' | 'payments')[] } = {}) {
  return render(
    <PartyReportLayout<Row>
      title="Balances"
      description="balances"
      icon={Users}
      totalLabel="Due"
      totalAmountCents={123456}
      {...(opts.currency ? { currency: opts.currency } : {})}
      exportFilename="x.csv"
      onExportCSV={() => {}}
      searchTerm=""
      onSearchChange={() => {}}
      columns={[
        { key: 'name', header: 'Customer' },
        { key: 'balanceCents', header: 'Balance', align: 'right' },
      ]}
      data={data}
      getRowId={r => r.id}
      sumKeys={['balanceCents']}
      {...(opts.capped ? { cappedCollections: opts.capped, cappedWhat: 'this balance summary', cappedTestId: 'cap' } : {})}
    />,
  );
}

const rows: Row[] = [{ id: 'a', name: 'Acme', balanceCents: 123456 }];

describe('the party-report totals row follows the report currency', () => {
  beforeEach(() => {
    setComponentWorkspace('owner');
    useLedgerStore.setState({ baseCurrency: 'USD', truncatedCollections: {} });
    window.__ledgerBaseCurrency = 'USD';
  });
  afterEach(() => cleanup());

  test('a JPY report prints its total and its rows in yen, not US dollars', () => {
    const { container } = renderPartyLayout(rows, { currency: 'JPY' });
    const header = container.querySelector('div.text-base.font-mono.font-bold')?.textContent || '';
    const foot = container.querySelector('tfoot')?.textContent || '';
    // ¥123,456 in a JPY book (0 decimals); "$1,234.56" is the pre-fix output
    assert.match(header, /123,456/, `header total: ${header}`);
    assert.match(foot, /123,456/, `footer total: ${foot}`);
    assert.doesNotMatch(foot, /\$/, `footer must not print a dollar sign: ${foot}`);
    assert.doesNotMatch(header, /\$/, `header must not print a dollar sign: ${header}`);
  });

  test('a caller that passes no currency falls back to the book currency, never a hardcoded USD', () => {
    // the workspace is JPY; the report is one of the screens (Journal Sheet, Budget vs Actual) that
    // never passed a currency at all
    const ws = useAuthStore.getState().getCurrentWorkspace();
    assert.ok(ws, 'a workspace is signed in for this test');
    useAuthStore.setState({ workspaces: [{ ...ws, currency: 'JPY' }] });
    useLedgerStore.setState({ baseCurrency: 'JPY' });
    window.__ledgerBaseCurrency = 'JPY';
    const { container } = renderPartyLayout(rows);
    const foot = container.querySelector('tfoot')?.textContent || '';
    assert.match(foot, /123,456/, `footer total: ${foot}`);
    assert.doesNotMatch(foot, /\$/, `footer must not print a dollar sign: ${foot}`);
  });
});

describe('a capped list is named on the report that reads it', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    setComponentWorkspace('owner');
    const ws = useAuthStore.getState().getCurrentWorkspace();
    if (ws) useAuthStore.setState({ workspaces: [{ ...ws, currency: 'USD' }] });
    window.__ledgerBaseCurrency = 'USD';
    useLedgerStore.setState({ baseCurrency: 'USD', truncatedCollections: {} });
  });

  test('nothing is said when every list is complete', () => {
    useLedgerStore.setState({ truncatedCollections: {} });
    const { container } = renderPartyLayout(rows, { capped: ['invoices', 'bills'] });
    assert.equal(container.querySelector('[data-testid="cap"]'), null);
  });

  test('only the capped lists are named, and the sentence says the figure may be incomplete', () => {
    useLedgerStore.setState({ truncatedCollections: { invoices: true, bills: true } });
    const { container } = renderPartyLayout(rows, { capped: ['invoices', 'bills', 'payments'] });
    const note = container.querySelector('[data-testid="cap"]');
    assert.ok(note, 'the capped note is shown');
    const text = note!.textContent || '';
    assert.match(text, /invoices and bills/);
    assert.doesNotMatch(text, /payments/, 'payments was not capped and must not be named');
    assert.match(text, /may be incomplete/);
  });
});

describe('a report with no data says which kind of nothing it is', () => {
  afterEach(() => cleanup());

  test('the shared empty state carries the reason and a next step, not a bare sentence', () => {
    const { container } = render(
      <ReportEmptyState
        title="No fixed assets in this period."
        description="Add a fixed asset in Fixed Assets; its monthly depreciation runs then appear here."
      />,
    );
    const box = container.querySelector('[data-report-empty-state]');
    assert.ok(box, 'the empty state renders its marker');
    assert.match(box!.textContent || '', /No fixed assets in this period\./);
    assert.match(box!.textContent || '', /Add a fixed asset/);
  });

  test('the depreciation ledger uses the empty state, not one flat sentence', async () => {
    setComponentWorkspace('owner');
    markComponentCollectionsLoaded('assets', 'transactions');
    useLedgerStore.setState({ assets: [], transactions: [], truncatedCollections: {} });
    const { container } = render(<DepreciationLedgerReportView />);
    await act(async () => {});
    const empty = container.querySelector('[data-report-empty-state]');
    assert.ok(empty, 'the ledger shows the shared empty state when it has no assets');
    assert.match(empty!.textContent || '', /fixed asset/i);
  });
});
