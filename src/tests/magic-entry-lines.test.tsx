/**
 * The quick-entry window ("paid $80 lunch card yesterday") used to hand only { amount } to onAdd. The save
 * ignores `amount`, so every entry reached the server with no lines and was refused: "Failed to add
 * transaction. Protocol interrupted. Invalid transaction structure: at least 2 lines required."
 * These tests render the window, save through the real handleQuickAdd and stub only the server.
 */
import { describeSaveFailures, standardChart, stubServer, serverScenarios, captureToasts, settle, assertNoSuccess, type ServerCall } from './helpers/failureHarness';
import { setComponentWorkspace } from './helpers/componentFixtures';
import test, { afterEach, beforeEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getSupabase } from '../lib/db/client';
import MagicEntry from '../components/ledger/MagicEntry';
import { aiService } from '../services/aiService';
import { useLedgerStore } from '../stores/useLedgerStore';

const SENTENCE = 'paid $80 lunch card yesterday';
const isTxSave = (call: ServerCall) => call.method === 'POST' && /\/api\/v1\/transactions$/.test(call.url);

async function openAndParse(sentence = SENTENCE) {
  mock.method(aiService, 'parseMagicEntry', async () => null); // the local parser reads the sentence
  useLedgerStore.setState({ accounts: standardChart(), transactions: [] });
  render(<MagicEntry />);
  fireEvent.change(screen.getByLabelText('Describe the transaction'), { target: { value: sentence } });
  await act(async () => { await new Promise(r => setTimeout(r, 900)); }); // the window parses after 800 ms
}
const save = () => act(async () => { fireEvent.click(screen.getByText(/Looks Right - Save It/)); });

describeSaveFailures({
  name: 'quick entry (MagicEntry)',
  collections: ['transactions', 'accounts'],
  stub: { isSave: isTxSave },
  refusedWords: /locked|Failed to add/i,
  open: () => openAndParse(),
  save,
  draftKept() {
    assert.equal((screen.getByLabelText('Describe the transaction') as HTMLInputElement).value, SENTENCE);
    assert.ok(screen.getByText(/Looks Right - Save It/), 'the parsed entry is still there to save again');
  },
});

describe('quick entry: what it sends', () => {
  beforeEach(() => { setComponentWorkspace('owner'); useLedgerStore.getState().resetStore(); });
  afterEach(async () => {
    cleanup();
    mock.restoreAll();
    getSupabase().realtime.disconnect();
    await getSupabase().auth.dispose();
  });

  test('a parsed sentence posts two balanced lines (expense debit, cash credit) and says added only after the server', async () => {
    const toasts = captureToasts();
    const server = stubServer(serverScenarios.ok(), { isSave: isTxSave });
    await openAndParse();
    await save();
    await settle();
    const sent = server.saves();
    assert.equal(sent.length, 1);
    const lines = (sent[0].body as { transaction: { lines: { accountId: string; amountCents: number }[] } }).transaction.lines;
    assert.deepEqual(lines.map(l => [l.accountId, l.amountCents]), [['office', 8000], ['cash', -8000]]);
    assert.ok(toasts.of('success').some(t => /Transaction added/.test(t)));
  });

  test('a sentence with no amount is not sent; the user is told to enter one', async () => {
    const toasts = captureToasts();
    const server = stubServer(serverScenarios.ok(), { isSave: isTxSave });
    await openAndParse('lunch with a client');
    if (screen.queryByText(/Looks Right - Save It/)) await save();
    await settle();
    assert.equal(server.saves().length, 0, 'nothing reached the server');
    assertNoSuccess(toasts);
  });

  test('saving again after a failed reply sends the identical request (same id and time), so the server replays it instead of posting twice', async () => {
    const server = stubServer(serverScenarios.network(), { isSave: isTxSave });
    await openAndParse();
    await save();
    await settle();
    await save();
    await settle();
    // the server compares the whole request with the one it holds for the id, so the retry must be identical
    const bodies = server.saves().map(c => JSON.stringify(c.body));
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  });

  test('the entry is posted in the books\' currency', async () => {
    const server = stubServer(serverScenarios.ok(), { isSave: isTxSave });
    await openAndParse();
    await save();
    await settle();
    assert.equal((server.saves()[0].body as { transaction: { currency: string } }).transaction.currency, 'USD');
  });

  test('without a cash account nothing is posted (never both sides on one account)', async () => {
    const toasts = captureToasts();
    const server = stubServer(serverScenarios.ok(), { isSave: isTxSave });
    await openAndParse();
    act(() => { useLedgerStore.setState({ accounts: standardChart().filter(a => a.id !== 'cash') }); });
    await save();
    await settle();
    assert.equal(server.saves().length, 0);
    assert.ok(toasts.of('error').some(t => /cash or bank account/.test(t)));
  });

  test('an amount in another currency than the books is not posted under the books\' currency', async () => {
    const toasts = captureToasts();
    const server = stubServer(serverScenarios.ok(), { isSave: isTxSave });
    await openAndParse('paid €80 lunch card yesterday'); // the component workspace keeps USD books
    await save();
    await settle();
    assert.equal(server.saves().length, 0);
    assert.ok(toasts.of('error').some(t => /in EUR but your books are in USD/.test(t)));
  });

  test('an inactive account is never chosen for the entry', async () => {
    const server = stubServer(serverScenarios.ok(), { isSave: isTxSave });
    await openAndParse();
    act(() => {
      useLedgerStore.setState({ accounts: [{ ...standardChart().find(a => a.id === 'office')!, id: 'old-office', isActive: false }, ...standardChart()] });
    });
    await save();
    await settle();
    const lines = (server.saves()[0].body as { transaction: { lines: { accountId: string }[] } }).transaction.lines;
    assert.deepEqual(lines.map(l => l.accountId), ['office', 'cash']);
  });
});
