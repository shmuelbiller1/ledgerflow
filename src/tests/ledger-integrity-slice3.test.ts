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

  test('AF-12: real document CRUD uses registered commands and RLS denies browser DML', () => {
    const sql = read('supabase/migrations/20261115000000_document_commands_server_only.sql');
    for (const table of ['invoices', 'bills', 'creditNotes', 'vendorCredits']) {
      assert.ok(sql.includes(`'${table}'`), `Migration must close direct writes on ${table}`);
    }
    assert.match(sql, /drop policy if exists writer_insert on public\.%I/);
    assert.match(sql, /drop policy if exists writer_update on public\.%I/);
    assert.match(sql, /drop policy if exists writer_delete on public\.%I/);
    assert.match(sql, /revoke insert, update, delete on public\.%I from authenticated/);
    assert.match(sql, /set allowed_keys = '\{\}'/);

    const rls = read('supabase/tests/rls.test.sql');
    for (const [article, document] of [['an', 'invoice'], ['a', 'bill'], ['a', 'credit note'], ['a', 'vendor credit']] as const) {
      assert.ok(rls.includes(`browser cannot directly update ${article} ${document}`), `RLS suite must cover raw ${document} updates`);
      assert.ok(rls.includes(`browser cannot directly delete a draft ${document}`), `RLS suite must cover raw ${document} deletes`);
    }

    const ops = read('src/hooks/useEntityOperations.ts');
    for (const command of [
      'invoice.create', 'invoice.update', 'invoice.delete',
      'bill.create', 'bill.update', 'bill.delete',
      'creditnote.create', 'creditnote.update', 'creditnote.delete',
      'vendorcredit.create', 'vendorcredit.update', 'vendorcredit.delete',
    ]) assert.ok(ops.includes(`runDocumentCommand('${command}'`), `Expected browser UI to invoke ${command}`);
    assert.match(ops, /sampleSession \|\| currentWorkspaceId === SAMPLE_WORKSPACE_ID/);
    assert.match(ops, /withSamplePosting/);
    assert.match(ops, /replaceAll\('-', ''\)/, 'generated command idempotency keys must pass the server validator');
  });

  test('AF-13: customer and vendor create/update paths use profile commands outside guest/sample workspaces', () => {
    const ops = read('src/hooks/useEntityOperations.ts');
    for (const command of ['customer.create', 'vendor.create']) {
      assert.ok(ops.includes(`runDocumentCommand('${command}'`), `Expected party UI to invoke ${command}`);
    }
    assert.ok(ops.includes("'customer.update'"), 'Expected customer updates to use customer.update');
    assert.ok(ops.includes("'vendor.update'"), 'Expected vendor updates to use vendor.update');
    assert.match(ops, /path === 'customers'/);
    assert.match(ops, /path === 'vendors'/);
    assert.match(ops, /sampleSession \|\| currentWorkspaceId === SAMPLE_WORKSPACE_ID/);
    // the generic door is a command now; the sample company's own copy is the local store
    assert.match(ops, /await savePlainRecord\(currentWorkspaceId, path, docId, finalData, \{ create: true \}\)/, 'an ordinary record is created by naming record.save');
    assert.match(ops, /await savePlainRecord\(currentWorkspaceId, path, id, localData\)/, 'an ordinary record is saved by naming record.save');
    assert.match(ops, /await deletePlainRecord\(currentWorkspaceId, path, id\)/, 'an ordinary record is deleted by naming record.delete');
    assert.ok(!/setDoc\(doc\(db, path, docId\)/.test(ops), 'no browser write may remain on the generic path');
  });

  test('AF-14: warranty dates use an authorized server command and reject browser metadata bypasses', () => {
    const panel = read('src/components/reporting/WarrantyRegisterPanel.tsx');
    assert.ok(panel.includes("runCommand('warranty.update'"), 'WarrantyRegisterPanel must save through the command runner');
    assert.ok(!panel.includes("updateEntity('customers'"), 'WarrantyRegisterPanel must not patch customer metadata directly');
    const operations = read('src/hooks/useEntityOperations.ts');
    assert.ok(operations.includes('assertCustomerHistoryServerManaged(path,'), 'Local create/update paths must reject direct warranty and RMA history writes');
    assert.ok(!operations.includes('hasWarrantyPathPatch'), 'No legacy bypass may route warranty field paths around the command');
    const command = read('src/server/commands/customers.ts');
    assert.ok(command.includes('warrantyCandidates([invoice]'), 'The command must revalidate the selected issued-invoice serial');
    assert.ok(command.includes('createWarrantyRecord('), 'The server must build the actor-stamped warranty history');
    const migration = read('supabase/migrations/20261115000000_document_commands_server_only.sql');
    assert.ok(migration.includes('create or replace function public.lf_warranty_guard()'), 'Customer warranty metadata needs a server-only database guard');
    const rls = read('supabase/tests/rls.test.sql');
    assert.ok(rls.includes('a bookkeeper writes a warranty record from the browser'), 'RLS suite must cover browser warranty writes');
    assert.ok(rls.includes('and cannot change its warranty date'), 'RLS suite must cover browser edits to saved warranty history');
    assert.ok(read('src/server/auth/apiAuthenticate.ts').includes("/^(customer|warranty)\\./"), 'Warranty commands use the customer API-key scope');
  });

  test('AF-15: automation-rule persistence uses registered commands and RLS closes browser DML', () => {
    const rules = read('src/hooks/useAutoRules.ts');
    for (const command of ['autorule.create', 'autorule.update', 'autorule.delete', 'autorule.group', 'autorule.recordhits']) {
      assert.ok(rules.includes(`runCommand('${command}'`), `useAutoRules must invoke ${command}`);
    }
    assert.ok(read('src/hooks/transactionActions/ruleActions.ts').includes("runCommand('autorule.create'"));
    assert.ok(read('src/components/ledger/InboxView.tsx').includes("runCommand('autorule.create'"));
    assert.ok(read('src/hooks/transactionActions/postingHelpers.ts').includes("runCommand('autorule.create'"));
    const migration = read('supabase/migrations/20261115000000_document_commands_server_only.sql');
    assert.ok(migration.includes('drop policy if exists writer_insert on public."autoRules"'));
    assert.ok(migration.includes("where table_name = 'autoRules'"));
    const rls = read('supabase/tests/rls.test.sql');
    assert.ok(rls.includes('a bookkeeper cannot update a rule through lf_update'));
    assert.ok(rls.includes('a raw browser DELETE cannot bypass the command'));
  });

  test('AF6-011: the final ledger trigger closes empty-line, FX-home-balance, and settlement transition gaps', () => {
    const sql = migrationsSql();
    const close = sql.slice(sql.lastIndexOf('create or replace function public.lf_enforce_balanced_ledger()'));
    assert.match(close, /Posted ledger entry requires a JSON lines array/);
    assert.match(close, /line_count < 2/);
    // FX parity is explicit: line rates override the header rate and floor(x + 0.5)
    // matches JavaScript Math.round for both positive and negative half-cents.
    assert.match(close, /line_rate := coalesce\(\(elem->>'exchangeRate'\)::numeric, fx_rate\)/);
    assert.match(close, /base_value := floor\(amt_cents::numeric \* line_rate \+ 0\.5\)::bigint/);
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
