/**
 * The browser's ledger check: entries the server signs (`verification.hash`) without a link
 * (`previousHash`) are not a broken chain. Two invoices saved through the server commands showed
 * "Hash Integrity: BROKEN, Chain Index broken at 1" on balanced books (15 Nov). A link that is recorded
 * and does not match is still reported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DoubleEntryAuditor } from '../services/auditor';
import type { ChartAccount, Transaction } from '../types';

const accounts = [{ id: 'ar', name: 'A/R', type: 'asset' }, { id: 'rev', name: 'Sales', type: 'income' }] as ChartAccount[];
const entry = (id: string, createdAt: string, verification?: Record<string, string>): Transaction => ({
  id, workspaceId: 'w', uid: 'u', date: createdAt.slice(0, 10), createdAt, description: id, status: 'completed', type: 'actual',
  totalAmountCents: 1000, lines: [{ accountId: 'ar', amountCents: 1000 }, { accountId: 'rev', amountCents: -1000 }],
  ...(verification ? { verification } : {}),
} as unknown as Transaction);

test('server-signed entries with no link are not a broken chain', () => {
  const result = DoubleEntryAuditor.auditLedger([
    entry('inv1', '2026-11-15T17:10:00Z', { hash: 'h1' }),
    entry('inv2', '2026-11-15T17:12:00Z', { hash: 'h2' }),
  ], accounts);
  assert.equal(result.hashChainValid, true);
  assert.equal(result.brokenChainIndex, null);
  assert.equal(result.isBalanced, true);
});

test('linked entries whose link matches are valid; a link that does not match is still reported', () => {
  const good = DoubleEntryAuditor.auditLedger([
    entry('a', '2026-11-01T10:00:00Z', { hash: 'ha', previousHash: 'genesis' }),
    entry('b', '2026-11-02T10:00:00Z', { hash: 'hb', previousHash: 'ha' }),
  ], accounts);
  assert.equal(good.hashChainValid, true);
  const bad = DoubleEntryAuditor.auditLedger([
    entry('a', '2026-11-01T10:00:00Z', { hash: 'ha', previousHash: 'genesis' }),
    entry('b', '2026-11-02T10:00:00Z', { hash: 'hb', previousHash: 'tampered' }),
  ], accounts);
  assert.equal(bad.hashChainValid, false);
  assert.equal(bad.brokenChainIndex, 1);
});

test('a recorded link that does not match an unlinked signed entry before it is still reported', () => {
  const result = DoubleEntryAuditor.auditLedger([
    entry('a', '2026-11-01T10:00:00Z', { hash: 'ha' }),
    entry('b', '2026-11-02T10:00:00Z', { hash: 'hb', previousHash: 'tampered' }),
  ], accounts);
  assert.equal(result.hashChainValid, false);
  assert.equal(result.brokenChainIndex, 1);
});

