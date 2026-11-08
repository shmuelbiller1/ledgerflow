/**
 * L-123 step 6: screens that review only the entries loaded in this browser (Accountant Ask, Time Machine, the
 * forensic audit and the forensic auditor) say so when the loaded entries are capped, and say nothing when every
 * entry is loaded. The auditor's downloaded log says the same next to its scan count.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { LoadedEntriesOnlyNote } from '../components/common/LoadedEntriesOnlyNote';
import AskLoop from '../components/ledger/AskLoop';
import { useLedgerStore } from '../stores/useLedgerStore';

const setCapped = (capped: boolean) =>
  useLedgerStore.setState({ transactions: [], truncatedCollections: capped ? { transactions: true } : {} } as never);

describe('L-123 step 6: loaded-entries-only notes', () => {
  afterEach(() => { cleanup(); setCapped(false); });

  test('the note shows only when the loaded entries are capped', () => {
    setCapped(false);
    render(<LoadedEntriesOnlyNote testId="n" what="these findings" />);
    assert.equal(screen.queryByTestId('n'), null);
    cleanup();
    setCapped(true);
    render(<LoadedEntriesOnlyNote testId="n" what="these findings" />);
    assert.match(screen.getByTestId('n').textContent ?? '', /these findings cover only the loaded entries/);
  });

  test('Accountant Ask says its questions cover only the loaded entries when capped', () => {
    setCapped(true);
    render(<AskLoop />);
    assert.ok(screen.getByTestId('askloop-loaded-only'));
  });
});
