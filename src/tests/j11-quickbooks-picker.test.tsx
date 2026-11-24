/**
 * J-11 / Issue #903 (Agent #11): the QuickBooks migration wizard's actual file picker.
 *
 * Reproduced in the issue against the real QBOMigrationWizard (review pin bce500c1):
 *   1. A valid QuickBooks CSV (Date,Memo,Account,Split,Amount) reached the XLSX reader — which
 *      reads a zip — and failed with "Can't find end of central directory: is this a zip file?",
 *      leaving zero rows and no visible explanation.
 *   2. Picking a replacement file left the previous file's rows (and mappings) on screen and
 *      actionable: "replacement.csv is displayed alongside the old 10 rows and Next is still enabled".
 *   3. A failed read of the replacement could leave the old draft implied by the new file's name.
 *
 * These tests drive the real dropzone input with real File objects (not the parser, not the sample):
 * the CSV and XLSX paths, the immediate invalidation of earlier rows, the visible refusal with
 * retry guidance, and the stale-read guard (a slow read of a replaced file never arms the draft).
 *
 * NB for future editors: never pass a rendered DOM node as `actual` to `assert.equal` — the
 * failing-error inspection walks React's expando state on live nodes and hangs this file. Compare
 * with `assert.ok(x === null, …)` or assert on `textContent` strings instead.
 */
import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExcelJS from 'exceljs';
import QBOMigrationWizard from '../components/migration/QBOMigrationWizard';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { useLedgerStore } from '../stores/useLedgerStore';

const realFileReader = globalThis.FileReader;

// jsdom's FileReader accepts only jsdom Blobs, and the Node runtime's global `File` is not one —
// build test files with the window constructor so the real picker reads them.
const FileCtor = window.File as unknown as typeof File;

const QB_CSV = 'Date,Memo,Account,Split,Amount\n2026-01-02,Deposit,Checking,Revenue,1.25\n';
const QB_CSV_TWO = 'Date,Memo,Account,Split,Amount\n2026-02-01,Old one,Checking,Revenue,2.00\n2026-02-02,Old two,Checking,Revenue,3.00\n';
const TRUNCATED_CSV = 'Date,Memo,Account,Split,Amount\n2026-01-02,"never closed';

function pickerInput(): HTMLInputElement {
  return screen.getByLabelText('Upload QuickBooks export') as HTMLInputElement;
}

function pickFile(file: File) {
  fireEvent.change(pickerInput(), { target: { files: [file] } });
}

function csvFile(name: string, text: string): File {
  return new FileCtor([text], name, { type: 'text/csv' });
}

function continueButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Loader2 action' }) as HTMLButtonElement;
}

function hasText(re: string | RegExp): boolean {
  return screen.queryByText(re) !== null;
}

/** A FileReader whose reads stay pending until the test completes them, in any order. */
class DeferredFileReader {
  static instances: DeferredFileReader[] = [];
  onload: ((e: { target: DeferredFileReader }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onabort: ((e: unknown) => void) | null = null;
  result: ArrayBuffer | null = null;
  aborted = false;
  pendingFile: File | null = null;
  constructor() {
    DeferredFileReader.instances.push(this);
  }
  readAsArrayBuffer(file: File) {
    this.pendingFile = file;
  }
  readAsText(file: File) {
    this.pendingFile = file;
  }
  abort() {
    this.aborted = true;
    this.onabort?.({});
  }
  /** Completes the read even if it was aborted — proving the stale-read guard, not the abort, is the defence. */
  complete(text: string) {
    this.result = new TextEncoder().encode(text).buffer;
    this.onload?.({ target: this });
  }
}

async function workbookFile(name: string): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('GL');
  sheet.addRow(['Date', 'Memo', 'Account', 'Split', 'Amount']);
  sheet.addRow(['2026-01-02', 'Deposit', 'Checking', 'Revenue', 1.25]);
  const buf = await wb.xlsx.writeBuffer();
  return new FileCtor([buf as unknown as BlobPart], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

beforeEach(() => {
  globalThis.FileReader = realFileReader;
  DeferredFileReader.instances = [];
  setComponentWorkspace('owner');
  useLedgerStore.setState({ accounts: [], transactions: [] });
  render(<QBOMigrationWizard isOpen onClose={() => {}} />);
});

afterEach(() => {
  cleanup();
  globalThis.FileReader = realFileReader;
  DeferredFileReader.instances = [];
  localStorage.clear();
});

describe('J-11 the QuickBooks picker (#903)', () => {
  test('a valid QuickBooks CSV export reaches the mapper instead of the workbook reader', async () => {
    pickFile(csvFile('qb-general-ledger.csv', QB_CSV));
    await screen.findByText(/1 transactions parsed ready for mapping/);
    // the row the issue filed (#903): one mapped-ready row, nothing refused
    await screen.findByText('Deposit');
    assert.equal(continueButton().disabled, false, 'Next is armed for the one valid row');
  });

  test('a valid QuickBooks XLSX export is read through the workbook reader', async () => {
    pickFile(await workbookFile('qb-general-ledger.xlsx'));
    await screen.findByText(/1 transactions parsed ready for mapping/);
    await screen.findByText('Deposit');
    assert.equal(continueButton().disabled, false);
  });

  test('picking a replacement clears the previous rows before the new read lands', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Try with Sample Export' }));
    await screen.findByText(/10 transactions parsed ready for mapping/);
    assert.equal(continueButton().disabled, false, 'Next is armed for the sample');

    // a replacement whose read is held open: the old rows must be gone while it is still reading
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    pickFile(csvFile('replacement.csv', QB_CSV));
    await screen.findByText(/Reading replacement\.csv/);
    assert.ok(!hasText(/10 transactions parsed/), 'stale rows leave the screen at pick time');
    assert.ok(!hasText(/1 transactions parsed/), 'nothing implies the old rows came from the replacement');
    assert.equal(continueButton().disabled, true, 'nothing stale stays actionable');

    DeferredFileReader.instances.at(-1)!.complete(QB_CSV);
    await screen.findByText(/1 transactions parsed ready for mapping/);
    await screen.findByText('Deposit');
    assert.equal(continueButton().disabled, false);
  });

  test('a bad replacement is refused in words with retry guidance, and the old draft stays gone', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Try with Sample Export' }));
    await screen.findByText(/10 transactions parsed ready for mapping/);

    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    pickFile(csvFile('replacement.csv', TRUNCATED_CSV));
    await screen.findByText(/Reading replacement\.csv/);
    DeferredFileReader.instances.at(-1)!.complete(TRUNCATED_CSV);

    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent || '', /never closed|cut off|Could not read/i, 'says what went wrong');
    assert.match(alert.textContent || '', /Nothing from an earlier file is being used/i, 'says the old draft is gone');
    assert.match(alert.textContent || '', /Try with Sample Export|choose the export file again/i, 'says what to do next');
    assert.ok(!hasText(/10 transactions parsed/), 'the failed read cannot revive the old rows');
    assert.equal(continueButton().disabled, true);
  });

  test('a slow read of a replaced file can never arm the new draft', async () => {
    cleanup();
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    render(<QBOMigrationWizard isOpen onClose={() => {}} />);

    pickFile(csvFile('first.csv', QB_CSV_TWO));
    pickFile(csvFile('replacement.csv', QB_CSV));
    // onDrop runs on a microtask: wait for both picks to reach the reader before counting
    await waitFor(() => assert.equal(DeferredFileReader.instances.length, 2, 'one reader per pick'));
    const [first, second] = DeferredFileReader.instances;
    assert.equal(first.aborted, true, 'the replaced read is aborted');

    second.complete(QB_CSV);
    await screen.findByText(/1 transactions parsed ready for mapping/);
    await screen.findByText('Deposit');

    // the old read lands late anyway (it raced past the abort): it must change nothing
    first.complete(QB_CSV_TWO);
    await waitFor(() => {
      assert.ok(!hasText('Old one'), 'the late read never lands its rows');
      assert.ok(!hasText('Old two'));
    });
    assert.ok(hasText(/1 transactions parsed ready for mapping/), 'the replacement file keeps the screen');
    assert.equal(continueButton().disabled, false);
  });

  test('the sample is a pick too: it replaces whatever was in flight', async () => {
    cleanup();
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    render(<QBOMigrationWizard isOpen onClose={() => {}} />);

    pickFile(csvFile('first.csv', QB_CSV_TWO));
    await waitFor(() => assert.equal(DeferredFileReader.instances.length, 1, 'the pick reached the reader'));
    fireEvent.click(screen.getByRole('button', { name: 'Try with Sample Export' }));
    const [slow] = DeferredFileReader.instances;
    slow.complete(QB_CSV_TWO);
    await screen.findByText(/10 transactions parsed ready for mapping/);
    assert.ok(!hasText('Old one'), 'the superseded read changes nothing');
    assert.equal(continueButton().disabled, false);
  });

  test('a rejected drop supersedes an in-flight read; its rows never land late (PR #1036 review)', async () => {
    cleanup();
    globalThis.FileReader = DeferredFileReader as unknown as typeof FileReader;
    render(<QBOMigrationWizard isOpen onClose={() => {}} />);

    // a slow read of a valid pick is in flight…
    pickFile(csvFile('first.csv', QB_CSV_TWO));
    await waitFor(() => assert.equal(DeferredFileReader.instances.length, 1, 'the pick reached the reader'));

    // …then the person drops a legacy .xls, which is refused. The refusal must be the last word.
    fireEvent.change(pickerInput(), {
      target: { files: [new FileCtor(['not-a-zip'], 'old-format.xls', { type: 'application/vnd.ms-excel' })] },
    });
    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent || '', /cannot be read here/, 'the refusal names the file-type problem');

    // the superseded read lands late anyway (complete() fires even after abort): it must change nothing
    DeferredFileReader.instances[0].complete(QB_CSV_TWO);
    await waitFor(() => {
      assert.ok(!hasText('Old one'), 'the late read never resurrects its rows');
      assert.ok(!hasText('Old two'));
    });
    assert.ok(screen.queryByRole('alert'), 'the refusal stays visible');
    assert.ok(hasText(/cannot be read here/), 'the refusal is not overwritten');
    assert.equal(continueButton().disabled, true, 'nothing stale becomes actionable');
  });
});
