/**
 * Agent #13 probe, AF13-002 / AF13-003, 2026-11-11.
 *
 * Two questions about `buildCloseChecklist` (src/lib/closeChecklist.ts), the checklist the
 * Month-End Close screen shows and `readyToClose` uses to decide whether a month can close:
 *  AF13-002 — is a cancelled or rejected invoice/bill more than 60 days overdue counted as an
 *             old receivable/payable ("Old receivables and payables reviewed")?
 *  AF13-003 — is a bank line the user deliberately marked "ignored" counted as "not matched yet"
 *             ("Bank lines matched")?
 * Both would keep a genuinely finished month from closing without a sign-off.
 * Run: NODE_ENV=test npx tsx --test audit/agent13-2026-11-11/probes/af13-002-003-checklist-statuses.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloseChecklist, readyToClose } from '../../../src/lib/closeChecklist';
import { makeBill, makeChartAccount, makeInvoice, makeTransaction } from '../../../src/tests/fixtures';
import type { BankStatementLine } from '../../../src/types';

const MONTH = '2026-03';
const account = makeChartAccount({ id: 'ar', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' });
const cash = makeChartAccount({ id: 'cash', name: 'Checking', type: 'asset', category: 'Cash' });

const posted = makeTransaction({
  id: 't1', date: '2026-03-05', status: 'completed',
  lines: [
    { id: 'l1', accountId: 'ar', accountName: 'Accounts Receivable', amountCents: 5000 },
    { id: 'l2', accountId: 'rev', accountName: 'Sales', amountCents: -5000 },
  ],
});

const bankLine = (overrides: Partial<BankStatementLine>): BankStatementLine => ({
  id: 'bl1', uid: 'u1', workspaceId: 'ws-1', date: '2026-03-06', description: 'Card payment',
  amountCents: -1200, status: 'pending', ...overrides,
} as BankStatementLine);

test('AF13-002: a cancelled invoice 90 days overdue is not an old receivable', () => {
  const items = buildCloseChecklist({
    month: MONTH,
    transactions: [posted],
    accounts: [account, cash],
    bankLines: [bankLine({ status: 'matched', matchedTransactionId: 't1' })],
    invoices: [
      makeInvoice({ id: 'i-cancelled', number: 'INV-C', amountCents: 5000, status: 'cancelled', date: '2025-11-01', dueDate: '2025-12-01' }),
      makeInvoice({ id: 'i-rejected', number: 'INV-R', amountCents: 5000, status: 'rejected', date: '2025-11-01', dueDate: '2025-12-01' }),
    ],
    bills: [
      makeBill({ id: 'b-cancelled', number: 'B-C', amountCents: 5000, status: 'cancelled', date: '2025-11-01', dueDate: '2025-12-01' } as never),
    ],
  } as never);
  const aging = items.find(i => i.id === 'aging')!;
  assert.equal(aging.count, 0, 'cancelled and rejected documents are not owed by anyone');
  assert.equal(aging.status, 'done');
});

test('AF13-003: a bank line marked ignored is not waiting to be matched', () => {
  const items = buildCloseChecklist({
    month: MONTH,
    transactions: [posted],
    accounts: [account, cash],
    bankLines: [
      bankLine({ id: 'bl-matched', status: 'matched', matchedTransactionId: 't1' }),
      bankLine({ id: 'bl-ignored', status: 'ignored' }),
    ],
    invoices: [],
    bills: [],
  } as never);
  const reconcile = items.find(i => i.id === 'reconcile')!;
  assert.equal(reconcile.count, 0, 'an ignored line was reviewed and deliberately left out');
  assert.equal(reconcile.status, 'done');
  assert.deepEqual(readyToClose(items, {}), { ready: true });
});
