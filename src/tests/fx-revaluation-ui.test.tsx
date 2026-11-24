/**
 * The revaluation panel a person actually presses (R-07), in the currency tool. The numbers
 * themselves are the lib's business (src/tests/fx-revaluation.test.ts); here it is about what the
 * panel shows, what it asks for, and what it refuses to do for somebody who may not post entries.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuthStore } from '../stores/useAuthStore';
import FxRevaluationPanel from '../components/finance/FxRevaluationPanel';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { addDaysYMD } from '../lib/fiscalCalendar';
import { dayBefore } from '../lib/periodLock';
import { getLocalDateISO } from '../lib/utils';

interface Call { path: string; body: Record<string, unknown>; headers?: Record<string, string> }

/** fetch that answers each path with its own status and body, and records what was asked. */
function stubRoutes(responses: Record<string, { status?: number; body: unknown } | Array<{ status?: number; body: unknown }>>): Call[] {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({
      path,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {},
      ...(init?.headers ? { headers: init.headers as Record<string, string> } : {}),
    });
    const found = Object.entries(responses).filter(([key]) => path.includes(key)).sort(([a], [b]) => b.length - a.length)[0];
    const configured = found?.[1];
    const sequence = Array.isArray(configured) ? configured : configured ? [configured] : [];
    const index = found ? counts.get(found[0]) || 0 : 0;
    const answer = sequence[Math.min(index, sequence.length - 1)] ?? { status: 500, body: { message: 'unexpected path in the test: ' + path } };
    if (found) counts.set(found[0], index + 1);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

const TODAY = getLocalDateISO();
const TOMORROW = addDaysYMD(TODAY, 1);

const PLAN = {
  status: 'ok',
  date: TODAY,
  reversalDate: TOMORROW,
  baseCurrency: 'USD',
  posted: false,
  transactionId: null,
  netGainCents: 12000,
  debitTotalCents: 12000,
  documentCount: 1,
  currencies: ['EUR'],
  unpriced: [],
  summary: "1 document in EUR: $120.00 of movement in the accounts, an unrealized gain of $120.00. It reverses the next day, so the documents keep their own rates.",
  lines: [
    { accountId: 'ar', accountName: 'Accounts Receivable', amountCents: 12000, description: "Accounts Receivable at today's rate: 1 invoice (INV-1, Acme)" },
    { accountId: 'fx', accountName: 'Unrealized FX Gain/Loss', amountCents: -12000, description: "Unrealized FX gain at today's rates" },
  ],
  details: [{
    id: 'i1', side: 'customer', number: 'INV-1', partyName: 'Acme', currency: 'EUR',
    openCents: 100000, bookedRate: 1.08, todayRate: 1.2, bookedBaseCents: 108000, todayBaseCents: 120000, deltaCents: 12000,
  }],
  skipped: [],
};

describe('the revaluation panel', () => {
  beforeEach(() => { setComponentWorkspace('owner'); });
  // the panel talks to the API with plain fetch, which this test stubs; no database client is
  // created here, so nothing has to be disposed — the panel is only ever rendered and clicked.
  afterEach(() => cleanup());

  test('switching books clears a preview before posting', async () => {
    stubRoutes({ '/revaluation/preview': { body: PLAN } });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await screen.findByRole('button', { name: 'Post it' });
    const ws = useAuthStore.getState().workspaces[0];
    act(() => useAuthStore.setState({ currentWorkspaceId: 'other-books', workspaces: [ws, { ...ws, id: 'other-books', name: 'Other books' }] }));
    assert.ok(screen.queryByRole('button', { name: 'Post it' }) === null);
    assert.ok(screen.queryByText('INV-1') === null);
  });

  test('a delayed preview from old books cannot populate new books', async () => {
    let finish!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch;
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(finish));
    const ws = useAuthStore.getState().workspaces[0];
    act(() => useAuthStore.setState({ currentWorkspaceId: 'other-books', workspaces: [ws, { ...ws, id: 'other-books', name: 'Other books' }] }));
    await act(async () => { finish(Response.json(PLAN)); });
    assert.ok(screen.queryByRole('button', { name: 'Post it' }) === null);
    assert.ok(screen.queryByText('INV-1') === null);
  });

  test('a delayed posting response is not shown in a new workspace', async () => {
    let finish!: (response: Response) => void;
    globalThis.fetch = (async input => String(input).includes('/preview') ? Response.json(PLAN) : new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch;
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post it' }));
    await waitFor(() => assert.ok(finish));
    const ws = useAuthStore.getState().workspaces[0];
    act(() => useAuthStore.setState({ currentWorkspaceId: 'other-books', workspaces: [ws, { ...ws, id: 'other-books', name: 'Other books' }] }));
    await act(async () => { finish(Response.json({ status: 'success', data: { ...PLAN, posted: true, transactionId: 'old-transaction' } })); });
    assert.ok(screen.queryByText(/Posted for/) === null);
    assert.ok(screen.queryByRole('button', { name: 'Undo it' }) === null);
  });

  test('a new sign-in invalidates the previous preview even for the same user', async () => {
    stubRoutes({ '/revaluation/preview': { body: PLAN } });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await screen.findByRole('button', { name: 'Post it' });
    await act(async () => { useAuthStore.getState().setUser(useAuthStore.getState().user); });
    assert.ok(screen.queryByRole('button', { name: 'Post it' }) === null);
  });

  test('the preview says what moves, in money and in the rates behind it', async () => {
    stubRoutes({ '/revaluation/preview': { body: PLAN } });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByText(/1 document in EUR/)));
    assert.ok(screen.getByText('INV-1'));
    assert.ok(screen.getByText('Acme'));
    assert.ok(screen.getByText('1.0800'), 'the rate the invoice was booked at is shown, not hidden');
    assert.ok(screen.getByText('1.2000'));
    assert.match(screen.getByText('INV-1').closest('tr')?.textContent || '', /1,000\.00/, 'the open amount in the invoice currency, formatted');
    assert.match(screen.getByText('INV-1').closest('tr')?.textContent || '', /1,080\.00.*1,200\.00/, 'what is in the books, and what today gives');
    // one line per account the entry touches, and the sum of it in money
    assert.ok(screen.getByText('Accounts Receivable'));
    assert.ok(screen.getByText('Unrealized FX Gain/Loss'));
    assert.ok(screen.getByText("Unrealized FX gain at today's rates"));
    assert.match(screen.getByText('Accounts Receivable').closest('li')?.textContent || '', /\+?\$120\.00/);
    assert.match(screen.getByText('Unrealized FX Gain/Loss').closest('li')?.textContent || '', /-\$120\.00/, 'the other side of the entry, in the other direction');
  });

  test('nothing is posted by looking: the run is asked for only when the button is pressed', async () => {
    const calls = stubRoutes({
      '/revaluation/preview': { body: PLAN },
      '/commands/period.fxrevaluation': { body: { status: 'success', data: { ...PLAN, posted: true, transactionId: 'tx-abcdef12' } } },
    });
    render(<FxRevaluationPanel />);
    // booleans, never the element itself: node's assert inspects a failing DOM node, and a jsdom
    // element drags the whole document into the message until the process runs out of memory.
    assert.ok(screen.queryByText('Post it') === null, 'nothing is offered for posting before there is a plan to look at');
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.equal(calls.length, 1));
    assert.match(calls[0].path, /\/revaluation\/preview$/);
    assert.deepEqual(calls[0].body, { workspaceId: 'component-workspace', date: TODAY }, 'the preview explicitly values this workspace at the date shown in the panel');
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }));
    await waitFor(() => assert.equal(calls.length, 2));
    assert.match(calls[1].path, /\/commands\/period\.fxrevaluation$/);
    assert.deepEqual(calls[1].body, { workspaceId: 'component-workspace', input: { date: TODAY } });
    const operationId = calls[1].headers?.['Idempotency-Key'];
    assert.ok(operationId, 'the command request carries a stable retry key');
    assert.match(operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'the retry key is a cryptographically generated UUID');
  });

  test('a retry after a lost run response reuses its idempotency key', async () => {
    const calls = stubRoutes({
      '/revaluation/preview': { body: PLAN },
      '/commands/period.fxrevaluation': [
        { status: 503, body: { status: 'error', message: 'Temporary server error' } },
        { body: { status: 'success', data: { ...PLAN, posted: true, transactionId: 'tx-abcdef12' } } },
      ],
    });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Post it' })));
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }));
    await waitFor(() => assert.ok(screen.getByRole('alert')));
    const firstKey = calls[1].headers?.['Idempotency-Key'];
    assert.ok(firstKey);
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }));
    await waitFor(() => assert.ok(screen.getByText(new RegExp(`reversing on ${TOMORROW}`))));
    assert.equal(calls[2].headers?.['Idempotency-Key'], firstKey);
  });

  test('after posting, unsafe undo is paused with an explanation and sends no request', async () => {
    const calls = stubRoutes({
      '/commands/period.fxrevaluation': { body: { status: 'success', data: { ...PLAN, posted: true, transactionId: 'tx-abcdef12' } } },
      '/revaluation/preview': { body: PLAN },
    });
    render(<FxRevaluationPanel />);
    assert.ok(screen.getByText(/Undo is temporarily unavailable while historical balance handling is reviewed/));
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Post it' })));
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }));
    await waitFor(() => assert.ok(screen.getByText(new RegExp(`reversing on ${TOMORROW}`))));
    assert.ok(screen.queryByRole('button', { name: 'Post it' }) === null);
    const undo = screen.getByRole('button', { name: 'Undo it' }) as HTMLButtonElement;
    assert.equal(undo.disabled, true);
    assert.ok(screen.getByText(/undoing an older revaluation can change historical balances/i));
    fireEvent.click(undo);
    assert.equal(calls.length, 2);
  });

  test('historical month-end asks for that day’s rates and tolerates an incomplete preview payload', async () => {
    const date = dayBefore(`${TODAY.slice(0, 7)}-01`);
    const reversalDate = addDaysYMD(date, 1);
    const calls = stubRoutes({
      '/revaluation/preview': [
        { body: {
          status: 'ok', date, reversalDate, baseCurrency: 'USD', posted: false,
          summary: `Type the EUR and GBP rates for ${date} to complete the preview. Nothing was posted.`,
          unpriced: ['EUR', 'GBP'],
        } },
        { body: { ...PLAN, date, reversalDate, unpriced: [], currencies: ['EUR', 'GBP'] } },
      ],
    });
    render(<FxRevaluationPanel />);
    fireEvent.change(screen.getByLabelText('Date to value balances at'), { target: { value: date } });
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByLabelText(`1 EUR in USD on ${date}`)));
    assert.ok(screen.getByText(/no partial entry can be posted/i));
    fireEvent.change(screen.getByLabelText(`1 EUR in USD on ${date}`), { target: { value: '1.2' } });
    fireEvent.change(screen.getByLabelText(`1 GBP in USD on ${date}`), { target: { value: '1.5' } });
    assert.ok(screen.queryByRole('button', { name: 'Post it' }) === null, 'rates must be checked again after an edit');
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Post it' })));
    assert.deepEqual(calls.map(call => call.body), [
      { workspaceId: 'component-workspace', date, rates: {} },
      { workspaceId: 'component-workspace', date, rates: { EUR: 1.2, GBP: 1.5 } },
    ], 'a past date sends only the rates the person actually entered');
  });

  test('somebody who may not post a period entry can still see what it would do', async () => {
    setComponentWorkspace('viewer');
    stubRoutes({ '/revaluation/preview': { body: PLAN } });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Post it' })));
    assert.equal((screen.getByRole('button', { name: 'Post it' }) as HTMLButtonElement).disabled, true, 'the button is there and says no');
    assert.ok(screen.getByText(/An owner or an accountant can post this/));
  });

  test('when there is nothing to move, it says so and the button is not offered as a yes', async () => {
    const empty = { ...PLAN, lines: [], details: [], posted: false, documentCount: 0, debitTotalCents: 0, netGainCents: 0, currencies: [], summary: "Nothing to post: 3 documents looked at, and every open foreign one already stands at today's rate." };
    stubRoutes({ '/revaluation/preview': { body: empty } });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByText(/Nothing to post/)));
    assert.equal((screen.getByRole('button', { name: 'Post it' }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.queryByText('INV-1') === null, 'no table of nothing');
  });

  test('a rate that cannot be had is said in the service\'s own words, and nothing is claimed', async () => {
    stubRoutes({
      '/revaluation/preview': {
        status: 503,
        body: { status: 'error', message: 'The GBP rate is not available from the exchange service right now, and a revaluation cannot leave a currency out. Nothing was posted — try again in a little while.' },
      },
    });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByText(/The GBP rate is not available/)));
    assert.ok(screen.queryByRole('button', { name: 'Post it' }) === null, 'no plan, so nothing to post');
  });

  test('the documents left out are listed with the reason, when somebody opens that', async () => {
    stubRoutes({
      '/revaluation/preview': {
        body: { ...PLAN, skipped: [{ id: 'i2', number: 'INV-2', reason: 'already at today\'s EUR rate' }, { id: 'b1', number: 'BILL-1', reason: 'the bill is paid, so nothing is owed on it' }] },
      },
    });
    render(<FxRevaluationPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show what would move' }));
    await waitFor(() => assert.ok(screen.getByText('2 documents left out, and why')));
    fireEvent.click(screen.getByText('2 documents left out, and why'));
    assert.ok(screen.getByText('INV-2: already at today\'s EUR rate'));
    assert.ok(screen.getByText('BILL-1: the bill is paid, so nothing is owed on it'));
  });
});
