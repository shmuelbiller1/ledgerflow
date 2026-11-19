/**
 * R-7 on the screen: the panel lists the accounts behind a change, and, when a reader opens one,
 * the posted lines on each side — from the server, with a way into each entry. When the server
 * cannot answer it says so and offers "Try again" instead of showing an empty list.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import StatementChangePanel from '../components/reporting/StatementChangePanel';
import { buildStatementChange, type StatementSides } from '../lib/statementChange';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useUIStore } from '../stores/useUIStore';

const current: StatementSides = {
  income: { sales: { name: 'Sales', code: '4000', balance: 1_200_000 } },
  expense: { rent: { name: 'Rent', code: '6000', balance: 100_000 } },
};
const prior: StatementSides = {
  income: { sales: { name: 'Sales', code: '4000', balance: 1_000_000 } },
  expense: { rent: { name: 'Rent', code: '6000', balance: 100_000 } },
};
// net profit: 1,200,000 − 100,000 = 1,100,000 now, 1,000,000 − 100,000 = 900,000 before: +200,000
const change = buildStatementChange(current, prior, { signs: { income: 1, expense: -1 } });

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
let calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
let answer: () => Response = () => new Response('{}', { status: 500 });

beforeEach(() => {
  calls = [];
  answer = () => new Response('{}', { status: 500 });
  setComponentWorkspace('owner');
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return answer();
  }) as typeof fetch;
});
afterEach(() => cleanup());

const explanation = (totalCents: number, description: string) => JSON.stringify({
  lines: [{ key: `${description}-1`, transactionId: 'tx-1', date: '2026-03-02', description, accountName: 'Sales', amountCents: totalCents, document: { type: 'invoice', id: 'inv-1' }, bankMatched: false, attachments: 0 }],
  totalCents,
  entries: 1,
});

const renderPanel = () => render(
  <StatementChangePanel
    title="What changed in net profit"
    summary="Net profit is $11,000.00 for this period and $9,000.00 for the period before ($2,000.00)."
    change={change}
    source={{ kind: 'flow', current: { start: '2026-03-01', end: '2026-03-31' }, prior: { start: '2026-02-01', end: '2026-02-28' } }}
    sign={-1}
    formatCurrency={money}
    onClose={() => {}}
  />,
);

describe('the change panel', () => {
  test('lists the accounts that moved, the biggest share first, with the account that did not move left out', () => {
    renderPanel();
    const table = screen.getByRole('table', { name: /Accounts behind the change/i });
    const rows = within(table).getAllByRole('row').slice(1);
    assert.equal(rows.length, 1);
    assert.match(rows[0].textContent || '', /Sales/);
    assert.equal(screen.queryByText('Rent'), null);
    assert.match(screen.getByText(/Accounts that did not move are not listed/).textContent || '', /not listed/);
  });

  test('asks the server for both periods when one account is opened, and shows each side’s lines', async () => {
    answer = () => new Response(explanation(1_200_000, 'March invoice'), { status: 200 });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show.*Sales/i }));
    });
    await act(async () => {});
    const bodies = calls.map(call => call.body).filter(Boolean) as Array<Record<string, unknown>>;
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies.map(body => [body.startDate, body.endDate]), [
      ['2026-03-01', '2026-03-31'],
      ['2026-02-01', '2026-02-28'],
    ]);
    assert.deepEqual(bodies[0].accountIds, ['sales']);
    assert.equal(calls.every(call => call.url === '/api/v1/reports/explain'), true);
    assert.ok(screen.getAllByText('This period').length >= 1);
    assert.ok(screen.getAllByText('The period before').length >= 1);
    assert.ok(screen.getAllByText('March invoice').length >= 1);
  });

  test('an entry opens its document, so the reader can go straight to the record', async () => {
    answer = () => new Response(explanation(1_200_000, 'March invoice'), { status: 200 });
    const opened: unknown[] = [];
    useUIStore.setState({ openRecord: ((target: unknown) => { opened.push(target); }) as never });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show.*Sales/i }));
    });
    await act(async () => {});
    const links = screen.getAllByRole('button', { name: /March invoice/ });
    fireEvent.click(links[0]);
    assert.deepEqual(opened[0], { type: 'invoice', id: 'inv-1' });
  });

  test('a server that cannot answer says so and offers Try again, and never shows an empty list', async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show.*Sales/i }));
    });
    await act(async () => {});
    assert.ok(screen.getAllByRole('alert').some(node => /could not be loaded/i.test(node.textContent || '')));
    assert.equal(screen.queryByText(/No posted entries on this side/), null);
    const before = calls.length;
    answer = () => new Response(explanation(1_200_000, 'March invoice'), { status: 200 });
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    });
    await act(async () => {});
    assert.ok(calls.length > before);
  });

  test('a period with no entries on one side says that side is empty rather than broken', async () => {
    answer = () => new Response(JSON.stringify({ lines: [], totalCents: 0, entries: 0 }), { status: 200 });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show.*Sales/i }));
    });
    await act(async () => {});
    assert.equal(screen.getAllByText('No posted entries on this side.').length, 2);
  });
});

describe('the change panel with nothing to explain', () => {
  test('says no account moved, and asks the server nothing', async () => {
    const unchanged = buildStatementChange(current, current, { signs: { income: 1, expense: -1 } });
    render(
      <StatementChangePanel
        title="What changed in net profit"
        summary="No change."
        change={unchanged}
        source={{ kind: 'flow', current: { start: '2026-03-01', end: '2026-03-31' }, prior: { start: '2026-02-01', end: '2026-02-28' } }}
        sign={-1}
        formatCurrency={money}
        onClose={() => {}}
      />,
    );
    await act(async () => {});
    assert.ok(screen.getByRole('status'));
    assert.match(screen.getByRole('status').textContent || '', /No account moved/);
    assert.equal(calls.length, 0);
  });
});
