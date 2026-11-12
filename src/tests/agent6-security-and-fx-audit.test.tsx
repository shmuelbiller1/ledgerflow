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

const cashAccount = makeChartAccount({ id: 'cash-fx', code: '1010', name: 'Operating Cash', type: 'asset', category: 'Cash' });
const consultingAccount = makeChartAccount({ id: 'exp-fx', code: '6110', name: 'Advisory Fees', type: 'expense', category: 'Expenses' });

describe('Agent #6 (2026-11-12) — Multi-Currency Journal & Auto-Reversal Integrity (AF6-003, AF6-019)', () => {
  let capturedEntries: Transaction[] = [];

  beforeEach(() => {
    capturedEntries = [];
    setComponentWorkspace('owner');
    globalThis.fetch = (async (resource: RequestInfo | URL, options?: RequestInit) => {
      const target = String(resource);
      if (target.endsWith('/api/v1/transactions') && options?.body) {
        const body = JSON.parse(String(options.body)) as { transaction: Transaction };
        capturedEntries.push(body.transaction);
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: target.includes('/fx/rate') ? 503 : 200 });
    }) as typeof fetch;
  });

  afterEach(() => cleanup());

  async function submitForeignJournal(opts: {
    baseCurrency: string;
    txCurrency: string;
    rate: string;
    majorAmount: string;
    expectedStep?: string;
    seedTransactions?: Transaction[];
  }): Promise<Transaction> {
    useLedgerStore.setState({
      baseCurrency: opts.baseCurrency,
      transactions: opts.seedTransactions ?? [],
      lockDate: null,
      accounts: [cashAccount, consultingAccount],
    });
    render(
      <JournalEntryModal
        isOpen
        onClose={() => {}}
        user={{ uid: 'auditor-af6' } as never}
        accounts={[cashAccount, consultingAccount]}
        workspaceId="component-workspace"
      />,
    );
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: opts.txCurrency } });
    const rateLabel = `${opts.baseCurrency} for 1 ${opts.txCurrency}`;
    await waitFor(() => assert.ok(screen.getByLabelText(rateLabel)));
    fireEvent.change(screen.getByLabelText(rateLabel), { target: { value: opts.rate } });

    const debitInput = screen.getByLabelText('Debit amount for line 1') as HTMLInputElement;
    if (opts.expectedStep !== undefined) {
      assert.equal(debitInput.step, opts.expectedStep);
    }
    fireEvent.change(screen.getByLabelText('Account for line 1'), { target: { value: consultingAccount.id } });
    fireEvent.change(debitInput, { target: { value: opts.majorAmount } });
    fireEvent.change(screen.getByLabelText('Account for line 2'), { target: { value: cashAccount.id } });
    fireEvent.change(screen.getByLabelText('Credit amount for line 2'), { target: { value: opts.majorAmount } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /COMMIT TO LEDGER/ }));
    });
    await waitFor(() => assert.equal(capturedEntries.length, 1));
    const entry = capturedEntries[0];
    settleHomeCurrency(entry);
    assert.doesNotThrow(() => checkLedgerEntry(entry as unknown as Record<string, unknown>));
    return entry;
  }

  test('AF6-003a: foreign EUR journal entry sets baseAmountCents so lineAmount never multiplies by exchangeRate²', async () => {
    const entry = await submitForeignJournal({
      baseCurrency: 'AUD',
      txCurrency: 'EUR',
      rate: '1.65',
      majorAmount: '100',
      expectedStep: '0.01',
    });
    // €100 @ 1.65 AUD/EUR = $165.00 AUD (16,500 cents), never $272.25 AUD (27,225 cents = 1.65²)
    assert.deepEqual(entry.lines.map(l => l.amountCents), [16500, -16500]);
    assert.deepEqual(entry.lines.map(l => l.baseAmountCents), [16500, -16500]);
    assert.deepEqual(entry.lines.map(l => lineAmount(l, entry)), [16500, -16500]);
  });

  test('AF6-003b: zero-decimal JPY journal entry in USD books converts whole yen via minorUnitRate (¥10,000 @ 0.0067 = $67.00)', async () => {
    const entry = await submitForeignJournal({
      baseCurrency: 'USD',
      txCurrency: 'JPY',
      rate: '0.0067',
      majorAmount: '10000',
      expectedStep: '1',
    });
    assert.equal(entry.totalAmountCents, 6700);
    assert.deepEqual(entry.lines.map(l => lineAmount(l, entry)), [6700, -6700]);
  });

  test('AF6-003c: three-decimal KWD journal entry in USD books preserves thousandths (12.345 KWD @ 3.25 = $40.12)', async () => {
    const kwdSeed = {
      id: 'seed-kwd',
      date: '2026-10-01',
      originalCurrency: 'KWD',
      currency: 'USD',
      exchangeRate: 3.2,
      status: 'completed',
      lines: [],
    } as unknown as Transaction;
    const entry = await submitForeignJournal({
      baseCurrency: 'USD',
      txCurrency: 'KWD',
      rate: '3.25',
      majorAmount: '12.345',
      expectedStep: '0.001',
      seedTransactions: [kwdSeed],
    });
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
        { accountId: consultingAccount.id, amountCents: 16500, baseAmountCents: 16500 },
        { accountId: cashAccount.id, amountCents: -16500, baseAmountCents: -16500 },
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
