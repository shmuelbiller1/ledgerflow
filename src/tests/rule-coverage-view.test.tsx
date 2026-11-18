/**
 * A-111 screen: tax rule coverage. Hand-checked against the packs themselves: Texas is one row with
 * a rate, a nexus rule and a use-tax rule, filtering by country keeps only that country's rows,
 * filtering by a kind hides the rows without it, and the gaps name a place with no filing rule.
 * The screen reads no workspace data, so nothing has to be loaded for it.
 */
import './helpers/dom';
import test, { afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import RulePackCoverageReportView from '../components/reporting/RulePackCoverageReportView';

describe('Tax rule coverage screen', () => {
  afterEach(() => cleanup());

  test('lists the places with their kinds and reads the coverage of the packs', () => {
    render(<RulePackCoverageReportView asOfDate="2026-10-13" />);
    const table = screen.getByRole('table');
    const head = within(table).getAllByRole('columnheader').map(cell => cell.textContent || '');
    for (const head_ of ['Place', 'Rate', 'Nexus', 'Filing', 'Registration', 'Taxability', 'Rules', 'Sources']) {
      assert.ok(head.some(h => h.includes(head_)), `the table has a ${head_} column`);
    }
    const texas = within(table).getAllByRole('row').find(row => (row.textContent || '').includes('US/TX'));
    assert.ok(texas, 'Texas is a row');
    assert.match(texas!.textContent || '', /us-sales-tax/, 'the packs behind the row are named');
    assert.match(screen.getByText(/place\(s\) ·/).textContent || '', /rule\(s\) in force on Oct 13, 2026/);
    // the gaps are the places that have rules but none of a kind, never a place the packs are silent about
    const filingGap = screen.getByText(/^Filing:/).closest('p')!;
    assert.match(filingGap.textContent || '', /covered place\(s\) have no rule of this kind/);
    assert.match(filingGap.textContent || '', /all of them in the CSV/, 'the head is capped and the CSV has every one');
  });

  test('the country and kind filters narrow the table and the CSV stays available', () => {
    render(<RulePackCoverageReportView asOfDate="2026-10-13" />);
    const before = within(screen.getByRole('table')).getAllByRole('row').length;
    assert.equal((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled, false, 'the CSV has rows to write');
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'IL' } });
    const israel = within(screen.getByRole('table')).getAllByRole('row');
    assert.ok(israel.length < before, 'fewer rows with one country');
    assert.ok(israel.slice(1).every(row => (row.textContent || '').startsWith('IL')));
    // a kind filter keeps only places with that kind: Israel has a filing rule and no nexus rule
    fireEvent.change(screen.getByLabelText('Kind of rule'), { target: { value: 'filing' } });
    assert.equal(within(screen.getByRole('table')).getAllByRole('row').length, 2, 'only Israel\'s row has a filing rule');
    fireEvent.change(screen.getByLabelText('Kind of rule'), { target: { value: 'nexus' } });
    assert.equal(within(screen.getByRole('table')).getAllByRole('row').length, 1, 'no row: Israel has no nexus rule');
    assert.equal((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled, true, 'nothing to export');
  });

  test('a date before a table started leaves its rules out, and the screen says what it is not', () => {
    render(<RulePackCoverageReportView asOfDate="2025-06-01" />);
    assert.match(screen.getByText(/never a statement that no tax applies/).textContent || '', /that place's own authority governs|authority governs/);
    const table = screen.getByRole('table');
    const alabama = within(table).getAllByRole('row').find(row => (row.textContent || '').includes('US/AL'));
    assert.ok(alabama);
    assert.doesNotMatch(alabama!.textContent || '', /us-marketplace-facilitator/);
    const us = within(table).getAllByRole('row').slice(1).find(row => (row.textContent || '').startsWith('US'));
    assert.ok(us, 'the federal US row is a country row of its own');
    assert.match(us!.textContent || '', /filings/, 'the US filing pack is counted there');
  });

  test('A-99: the Israel special-areas block names each spelling the pack recognises and its source', () => {
    render(<RulePackCoverageReportView asOfDate="2026-10-13" />);
    const block = screen.getByText('Israel: the places outside the ordinary rate (A-99)').closest('details')!;
    assert.match(block.textContent || '', /אילת/, 'the Hebrew name is on the screen, not only in the table');
    assert.match(block.textContent || '', /Eilat Free Trade Zone Law/, 'the statute is named');
    assert.match(block.textContent || '', /1985-11-01 onward/, 'the law’s commencement day is the date shown');
    assert.match(block.textContent || '', /exemption is\s+\n?\s*not a zero rate|exemption is not a zero rate/, 'and the screen says an exemption is not a zero rate');
    // the recognition line answers for the spellings a book actually carries, in the same words the
    // table uses: a Hebrew address is Eilat, an unstated city is the ordinary area
    const resolution = block.querySelector('p:last-of-type')!;
    assert.match(resolution.textContent || '', /אילת\s*→\s*eilat/, 'the screen shows the resolution it applied');
    assert.match(resolution.textContent || '', /Tel Aviv\s*→\s*ordinary/, 'and says plainly when a place is not special');
  });

});
