import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { migrationsSql } from './helpers/migrations';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('Slice 3: C-1, C-2, M-5, F-09c ledger door & RLS integrity guards', () => {
  test('C-2: QBOMigrationWizard never falls back to client addEntity("transactions") when server refuses', () => {
    const src = read('src/components/migration/QBOMigrationWizard.tsx');
    assert.ok(!src.includes("addEntity('transactions'"), 'QBOMigrationWizard must not fall back to addEntity("transactions")');
    assert.ok(!src.includes('addEntity("transactions"'), 'QBOMigrationWizard must not fall back to addEntity("transactions")');
    assert.ok(src.includes('/api/v1/transactions/bulk'), 'QBOMigrationWizard must post chunks to /api/v1/transactions/bulk');
    assert.ok(src.includes('Idempotency-Key'), 'QBOMigrationWizard must send Idempotency-Key per chunk');
  });

  test('C-1: browser components route ledger, reconciliation, and opening-balance writes through server APIs', () => {
    const inbox = read('src/components/ledger/InboxView.tsx');
    assert.ok(!inbox.includes("updateEntity('transactions'"), 'InboxView must not call direct updateEntity("transactions")');
    assert.ok(inbox.includes('/api/v1/transactions/batch'), 'InboxView must categorize via /api/v1/transactions/batch');

    const ledger = read('src/components/ledger/Ledger.tsx');
    assert.ok(!ledger.includes("addEntity('reconciliations'"), 'Ledger must not call addEntity("reconciliations")');
    assert.ok(!ledger.includes("updateEntity('transactions'"), 'Ledger must not call updateEntity("transactions")');
    assert.ok(ledger.includes('/api/v1/transactions/reconciliation/complete'), 'Ledger must complete reconciliation on the server');
    assert.ok(ledger.includes('openingBalanceCents: 0'), 'Ledger must create chartAccounts at zero and post opening balance via /api/v1/transactions');

    const grid = read('src/components/ledger/TransactionGrid.tsx');
    assert.ok(grid.includes('handleVoidTransaction'), 'TransactionGrid onVoid must use handleVoidTransaction');

    const dims = read('src/components/platform/settings/DimensionsSettings.tsx');
    assert.ok(!dims.includes("doc(db, 'transactions'"), 'DimensionsSettings must not batch-update transactions directly');
    assert.ok(dims.includes('/api/v1/transactions/batch'), 'DimensionsSettings must update lines via /api/v1/transactions/batch');

    const ops = read('src/hooks/useEntityOperations.ts');
    assert.ok(ops.includes("path === 'transactions'"), 'useEntityOperations must intercept transactions path and route to /api/v1/transactions');
    assert.ok(ops.includes("path === 'reconciliations' || path === 'payments' || path === 'journalEntries'"), 'useEntityOperations must block direct client writes to reconciliations/payments/journalEntries');
  });

  test('M-5 & C-1: SQL migration enforces server-only ledger writes, settlement guard, and double-entry trigger', () => {
    const sql = migrationsSql();
    assert.ok(sql.includes('create trigger lf_transactions_ledger_integrity before insert or update on public.transactions'), 'M-5 trigger missing');
    assert.ok(sql.includes('create trigger lf_document_settlement_guard before insert or update on public.invoices'), 'invoice settlement guard missing');
    assert.ok(sql.includes('create trigger lf_chart_account_client_guard before insert on public."chartAccounts"'), 'chartAccounts client guard missing');
    assert.ok(sql.includes('revoke update, delete on public."auditLogs" from authenticated'), 'auditLogs revoke update/delete missing');
  });

  test('AF6-011: the final ledger trigger closes empty-line, FX-home-balance, and settlement transition gaps', () => {
    const sql = migrationsSql();
    const close = sql.slice(sql.lastIndexOf('create or replace function public.lf_enforce_balanced_ledger()'));
    assert.match(close, /Posted ledger entry requires a JSON lines array/);
    assert.match(close, /line_count < 2/);
    assert.match(close, /round\(amt_cents \* fx_rate\)/);
    assert.match(close, /home-currency amounts must sum to 0 cents/);
    assert.match(close, /'partial', 'applied'/);
    assert.match(close, /refundedCents/);
    assert.match(close, /immutable_keys.*array\['uid'\]/s);
  });

  test('F-09c: loginAudits exposes own_read RLS policy and SecuritySettings renders sign-in activity', () => {
    const sql = migrationsSql();
    assert.ok(sql.includes('create policy own_read on public."loginAudits" for select to authenticated'), 'loginAudits own_read policy missing');
    const sec = read('src/components/platform/settings/SecuritySettings.tsx');
    assert.ok(sec.includes('/api/v1/auth/login-audits'), 'SecuritySettings must load /api/v1/auth/login-audits');
  });
});
