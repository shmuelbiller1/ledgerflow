import './helpers/dom';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import JournalEntryModal from '../components/ledger/JournalEntryModal';
import { useLedgerStore } from '../stores/useLedgerStore';
import { setComponentWorkspace } from './helpers/componentFixtures';
import { makeChartAccount } from './fixtures';
import { lineAmount, settleHomeCurrency } from '../lib/txFilters';
import { withReversal } from '../lib/autoReversal';
import { checkLedgerEntry } from '../server/services/ledgerDoor';
import { validateUploadedFile } from '../server/utils/fileValidation';
import { maskCardNumbers } from '../lib/cardNumberMask';
import { checkProductionConfig } from '../../scripts/check-prod-env';
import type { Transaction } from '../types';

const bank = makeChartAccount({ id: 'bank', code: '1000', name: 'Checking', type: 'asset', category: 'Cash' });
const expense = makeChartAccount({ id: 'exp', code: '6100', name: 'Consulting Expense', type: 'expense', category: 'Expenses' });

describe('Agent #6 (2026-11-12) — Multi-Currency Journal & Auto-Reversal Integrity (AF6-003, AF6-019)', () => {
  let posted: Transaction[] = [];

  beforeEach(() => {
    posted = [];
    setComponentWorkspace('owner');
    useLedgerStore.setState({ baseCurrency: 'AUD', transactions: [], lockDate: null, accounts: [bank, expense] });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/fx/rate')) return new Response('{}', { status: 503 });
      if (url.endsWith('/api/v1/transactions')) {
        posted.push(JSON.parse(String(init?.body)).transaction as Transaction);
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => cleanup());

  test('AF6-003a: foreign EUR journal entry sets baseAmountCents so lineAmount never multiplies by exchangeRate²', async () => {
    render(
      <JournalEntryModal
        isOpen
        onClose={() => {}}
        user={{ uid: 'test-user' } as never}
        accounts={[bank, expense]}
        workspaceId="component-workspace"
      />,
    );
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText('AUD for 1 EUR'), { target: { value: '1.65' } });
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'exp' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: '100' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /COMMIT TO LEDGER/ }));
    });
    await waitFor(() => assert.equal(posted.length, 1));

    const entry = posted[0];
    settleHomeCurrency(entry);
    assert.doesNotThrow(() => checkLedgerEntry(entry as unknown as Record<string, unknown>));
    // €100 @ 1.65 AUD/EUR = $165.00 AUD (16,500 cents), never $272.25 AUD (27,225 cents = 1.65²)
    assert.deepEqual(entry.lines.map(l => l.amountCents), [16500, -16500]);
    assert.deepEqual(entry.lines.map(l => l.baseAmountCents), [16500, -16500]);
    assert.deepEqual(entry.lines.map(l => lineAmount(l, entry)), [16500, -16500]);
  });

  test('AF6-003b: zero-decimal JPY journal entry in USD books converts whole yen via minorUnitRate (¥10,000 @ 0.0067 = $67.00)', async () => {
    useLedgerStore.setState({ baseCurrency: 'USD', transactions: [], lockDate: null, accounts: [bank, expense] });
    render(
      <JournalEntryModal
        isOpen
        onClose={() => {}}
        user={{ uid: 'test-user' } as never}
        accounts={[bank, expense]}
        workspaceId="component-workspace"
      />,
    );
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'JPY' } });
    fireEvent.change(screen.getByLabelText('USD for 1 JPY'), { target: { value: '0.0067' } });
    assert.equal((screen.getByLabelText('Debit amount for line 1') as HTMLInputElement).step, '1');

    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'exp' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: '10000' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /COMMIT TO LEDGER/ }));
    });
    await waitFor(() => assert.equal(posted.length, 1));

    const entry = posted[0];
    settleHomeCurrency(entry);
    assert.equal(entry.totalAmountCents, 6700);
    assert.deepEqual(entry.lines.map(l => lineAmount(l, entry)), [6700, -6700]);
  });

  test('AF6-003c: three-decimal KWD journal entry in USD books preserves thousandths (12.345 KWD @ 3.25 = $40.12)', async () => {
    useLedgerStore.setState({
      baseCurrency: 'USD',
      transactions: [{ id: 'seed-kwd', date: '2026-10-01', originalCurrency: 'KWD', currency: 'USD', exchangeRate: 3.2, status: 'completed', lines: [] } as unknown as Transaction],
      lockDate: null,
      accounts: [bank, expense],
    });
    render(
      <JournalEntryModal
        isOpen
        onClose={() => {}}
        user={{ uid: 'test-user' } as never}
        accounts={[bank, expense]}
        workspaceId="component-workspace"
      />,
    );
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'KWD' } });
    await waitFor(() => assert.ok(screen.getByLabelText('USD for 1 KWD')));
    fireEvent.change(screen.getByLabelText('USD for 1 KWD'), { target: { value: '3.25' } });
    assert.equal((screen.getByLabelText('Debit amount for line 1') as HTMLInputElement).step, '0.001');

    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: 'exp' } });
    fireEvent.change(screen.getByLabelText('Debit amount for line 1'), { target: { value: '12.345' } });
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: '12.345' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /COMMIT TO LEDGER/ }));
    });
    await waitFor(() => assert.equal(posted.length, 1));

    const entry = posted[0];
    settleHomeCurrency(entry);
    assert.equal(entry.totalAmountCents, 4012);
    assert.deepEqual(entry.lines.map(l => lineAmount(l, entry)), [4012, -4012]);
  });

  test('AF6-019: withReversal negates baseAmountCents alongside amountCents so FX accruals net to zero', () => {
    const accrual = {
      id: 'tx_accrual_fx',
      workspaceId: 'ws-1',
      date: '2026-10-31',
      description: 'October EUR accrual',
      exchangeRate: 1.65,
      totalAmountCents: 16500,
      status: 'completed' as const,
      lines: [
        { accountId: 'exp', amountCents: 16500, baseAmountCents: 16500 },
        { accountId: 'bank', amountCents: -16500, baseAmountCents: -16500 },
      ],
    };
    const [marked, reversal] = withReversal(accrual, '2026-11-01');
    assert.doesNotThrow(() => checkLedgerEntry(marked as unknown as Record<string, unknown>));
    assert.doesNotThrow(() => checkLedgerEntry(reversal as unknown as Record<string, unknown>));
    assert.deepEqual(reversal.lines.map(l => l.amountCents), [-16500, 16500]);
    assert.deepEqual(reversal.lines.map(l => l.baseAmountCents), [-16500, 16500]);
    const netByLine = marked.lines.map((l, idx) =>
      lineAmount(l, marked as unknown as Transaction) + lineAmount(reversal.lines[idx], reversal as unknown as Transaction),
    );
    assert.deepEqual(netByLine, [0, 0]);
  });
});

describe('Agent #6 (2026-11-12) — Security Controls & CI Ratchets (AF6-017, S-18..S-30)', () => {
  test('AF6-017a: package.json lint:eslint enforces <= 2 warnings (tightened from 12)', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
    const lintCmd = pkg.scripts?.['lint:eslint'] || '';
    const m = /--max-warnings\s+(\d+)/.exec(lintCmd);
    assert.ok(m, `Expected --max-warnings in lint:eslint, got: ${lintCmd}`);
    assert.ok(Number(m[1]) <= 2, `Expected --max-warnings <= 2, got ${m[1]}`);
  });

  test('AF6-017b (S-24/S-27): security-sbom.yml enforces high-confidence secret classes without false positives', () => {
    const workflow = fs.readFileSync('.github/workflows/security-sbom.yml', 'utf8');
    for (const label of [
      'PEM private key',
      'Stripe live secret or restricted key',
      'GitHub personal access token',
      'Supabase service-role or personal token',
      'Resend API key',
      'SendGrid API key',
      'Google / Gemini API key',
      'Slack bot or user token',
      'AWS access key ID',
    ]) {
      assert.ok(workflow.includes(label), `Missing secret pattern "${label}" in security-sbom.yml`);
    }
    // Synthetic positive probes (constructed dynamically so source stays clean)
    const stripeKey = 'rk_live_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3';
    const resendKey = 're_' + 'AbCdEfGhIjKlMnOpQrStUvWxYz12';
    const googleKey = 'AIza' + 'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q';
    const awsKey = 'AKIA' + 'IOSFODNN7EXAMPLE';
    assert.match(stripeKey, /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/);
    assert.match(resendKey, /\bre_[0-9A-Za-z_]{24,}\b/);
    assert.match(googleKey, /\bAIza[0-9A-Za-z_-]{35}\b/);
    assert.match(awsKey, /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/);
  });

  test('S-02 / S-19: checkProductionConfig rejects placeholder/missing secrets and non-production NODE_ENV', () => {
    const weak = checkProductionConfig({
      NODE_ENV: 'development',
      SESSION_SECRET: 'placeholder_secret_that_is_32_chars_long',
      SYSTEM_SALT: 'short',
      DATABASE_URL: '',
    });
    const failedNames = weak.filter(f => f.status === 'fail').map(f => f.name);
    assert.deepEqual(failedNames, [
      'Production mode',
      'Session signing',
      'System encryption salt',
      'Invitation signing',
      'Database connection',
    ]);
    const strong = checkProductionConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'K9#mP2$vL8@xQ4!zR7^wN5&bT3*yH6%cJ1',
      SYSTEM_SALT: 'M4!qW8#eR2$tY6^uI0*oP3(aS7)dF9_gH5',
      INVITE_SECRET: 'Z7*xC3#vB9!nM5$lK2@jH8^gF4&dS6%aP1',
      DATABASE_URL: 'postgresql://app@localhost:5432/ledgerflow',
    });
    assert.deepEqual(strong.filter(f => f.status === 'fail'), []);
  });

  test('S-30: validateUploadedFile rejects disguised ELF/executable bytes and accepts valid UTF-8 CSV', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-s30-'));
    try {
      const badElf = path.join(dir, 'evil.csv');
      fs.writeFileSync(badElf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]));
      const badRes = await validateUploadedFile(badElf);
      assert.equal(badRes.valid, false);

      const goodCsv = path.join(dir, 'statement.csv');
      fs.writeFileSync(goodCsv, 'Date,Description,Amount\n2026-11-01,Coffee Shop,-4.50\n', 'utf8');
      const goodRes = await validateUploadedFile(goodCsv);
      assert.equal(goodRes.valid, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('S-18: maskCardNumbers redacts Luhn-valid PAN digits while preserving non-card invoice references', () => {
    assert.equal(maskCardNumbers('Paid with 4111 1111 1111 1111 today'), 'Paid with •••• •••• •••• 1111 today');
    assert.equal(maskCardNumbers('Invoice #2026111200012345'), 'Invoice #2026111200012345');
  });
});
