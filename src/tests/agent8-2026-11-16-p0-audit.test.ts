/**
 * Agent #8 Independent Deep Audit (2026-11-16) — P0 & P1 Regression Suite.
 *
 * Covers pure math/posting invariants (always run) and live PostgreSQL transactional proofs
 * (run whenever LF_TEST_DATABASE_URL is set):
 * - A8-024 / A7N-04: Tax return & tax recompute minor-unit FX conversion (JPY 0-dec, KWD 3-dec)
 * - A8-002: Multi-currency fiscal year close formatting
 * - A8-005 / A8-007 / A8-008: Server-managed document fields, locked-period re-dating, settled deletion
 * - A8-012 / A8-011b: Cross-tenant asset undo void guard, post-transfer depreciation guard, depreciation account validation
 * - A8-019: FX payment void negates baseAmountCents (zero net GL balance)
 * - A8-016: Bank deposit role check, FX minor-unit conversion, and audit trail
 * - A8-017: Workspace restore rejects forged closed-period backups & clears stale derived tables
 * - A8-013: Bad-debt write-off immune to invoice edit auto-reversal; recovery date & double-reversal guards
 * - A8-001 / A7N-05: FX revaluation re-run after undo + bill custom apAccountId
 * - A8-014: Payroll awaiting_approval period-lock check & undoPayRun cross-tenant guard
 * - A8-003 / A8-004: CMD-1 freeze/pending_deletion guards & manual journal document metadata forgery guard
 * - A8-021: Stock closing reads inside serializable transaction
 */
import { workspaceRetentionCommand } from '../server/commands/workspaceSettings';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { buildTaxReturn, taxByRate, type TaxableDocument } from '../lib/taxReturnDocs';
import { findTaxDifferences } from '../lib/taxRecompute';
import { postInvoiceLedger } from '../services/ledgerPost/invoicePosting';
import { deletePostings } from '../services/ledgerPost/deletePostings';
import type { LedgerPostContext } from '../services/ledgerPost/postingCore';
import { periodYearCloseCommand } from '../server/commands/periods';
import { journalCreateCommand } from '../server/commands/ledger';
import { workspaceCancelDeletionCommand } from '../server/commands/workspaceLifecycle';
import { executeCommand } from '../server/utils/commandExecutor';
import { Firestore } from '../server/db/pgFirestore';
import { BulkRefusal } from '../server/services/ledgerBulkCommit';
import { commitPreparedDocumentPost, prepareDocumentPost } from '../server/services/documentPostService';
import { DisposalError, undoDisposal } from '../server/services/assetDisposalService';
import { TransferError, undoTransfer } from '../server/services/assetTransferService';
import { InServiceError, undoPlaceInService } from '../server/services/placeInServiceService';
import { DepreciationError, runDepreciation } from '../server/services/depreciationService';
import { voidPayment } from '../server/services/paymentVoidService';
import { createDeposit, DepositError } from '../server/services/depositService';
import { exportWorkspaceBackup, RestoreError, restoreWorkspaceBackup } from '../server/services/workspaceRestoreService';
import { BadDebtError, reverseWriteOff, writeOffInvoice } from '../server/services/badDebtService';
import { revaluateForeignBalances, undoRevaluation } from '../server/services/fxRevaluationService';
import { formatTzDate } from '../lib/calendarDate';
import { PayRunError, postPayRun, undoPayRun } from '../server/services/payRunService';
import { writeStockClosing } from '../server/services/stockClosingService';
import { computeWorkspaceTaxReturn } from '../server/services/taxReturnService';
import type { Bill, ChartAccount, Invoice, Transaction } from '../types';

const url = process.env.LF_TEST_DATABASE_URL;

// ---------------------------------------------------------------------------
// 1. Pure accounting & posting tests (run with or without PostgreSQL)
// ---------------------------------------------------------------------------
describe('Agent #8 (2026-11-16) — Pure Accounting & Posting Regressions', () => {
  test('A8-024 / A7N-04: buildTaxReturn, taxByRate, and findTaxDifferences scale JPY (0-dec) and KWD (3-dec) minor units identically to GL', () => {
    // Workspace base currency = USD (2 decimals)
    // Invoice 1: ¥10,000 net + ¥1,000 tax (10%) @ 0.0067 USD/JPY => $67.00 net (6700 cents), $6.70 tax (670 cents)
    const jpyInvoice: TaxableDocument = {
      id: 'inv_jpy',
      date: '2026-06-15',
      status: 'sent',
      currency: 'JPY',
      exchangeRate: 0.0067,
      amountCents: 11_000,
      taxAmountCents: 1_000,
      taxVersion: 2,
      taxTreatment: 'standard',
      taxBreakdown: [{ name: 'JCT', rate: 10, taxCents: 1_000 }],
    };
    // Bill 1: KWD 100.000 net + KWD 10.000 tax (10%) @ 3.25 USD/KWD => $325.00 net (32500 cents), $32.50 tax (3250 cents)
    const kwdBill: TaxableDocument = {
      id: 'bill_kwd',
      date: '2026-06-16',
      status: 'approved',
      currency: 'KWD',
      exchangeRate: 3.25,
      amountCents: 110_000,
      taxAmountCents: 10_000,
      taxVersion: 2,
      taxTreatment: 'standard',
      taxBreakdown: [{ name: 'VAT', rate: 10, taxCents: 10_000 }],
    };

    const ret = buildTaxReturn({
      invoices: [jpyInvoice],
      bills: [kwdBill],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      baseCurrency: 'USD',
    });
    assert.equal(ret.boxes.find(b => b.key === '1')?.cents, 670, 'JPY output tax is 670 USD cents ($6.70), not 7 cents');
    assert.equal(ret.boxes.find(b => b.key === '6')?.cents, 6_700, 'JPY net sales is 6700 USD cents ($67.00), not 67 cents');
    assert.equal(ret.boxes.find(b => b.key === '4')?.cents, 3_250, 'KWD input tax is 3250 USD cents ($32.50), not 32500 cents');
    assert.equal(ret.boxes.find(b => b.key === '7')?.cents, 32_500, 'KWD net purchases is 32500 USD cents ($325.00), not 325000 cents');

    const rates = taxByRate({
      invoices: [jpyInvoice],
      bills: [kwdBill],
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      baseCurrency: 'USD',
    });
    assert.equal(rates.find(r => r.name === 'JCT')?.salesTaxCents, 670);
    assert.equal(rates.find(r => r.name === 'VAT')?.purchasesTaxCents, 3_250);

    // GL accrual entries posted in USD cents match expected minor-unit tax => zero false differences!
    const glTxs: Transaction[] = [
      {
        id: 'tx_jpy', workspaceId: 'ws', uid: 'u1', date: '2026-06-15', status: 'completed', type: 'actual',
        currency: 'USD', exchangeRate: 1, totalAmountCents: 7_370, description: 'Invoice JPY',
        metadata: { invoiceId: 'inv_jpy', type: 'invoice-accrual' },
        lines: [
          { accountId: 'ar', amountCents: 7_370, description: 'Accounts Receivable for Invoice JPY' },
          { accountId: 'rev', amountCents: -6_700, description: 'Sales Revenue for Invoice JPY' },
          { accountId: 'tax', amountCents: -670, description: 'Sales tax collected on Invoice JPY' },
        ],
      },
      {
        id: 'tx_kwd', workspaceId: 'ws', uid: 'u1', date: '2026-06-16', status: 'completed', type: 'actual',
        currency: 'USD', exchangeRate: 1, totalAmountCents: 35_750, description: 'Bill KWD',
        metadata: { billId: 'bill_kwd', type: 'bill-accrual' },
        lines: [
          { accountId: 'exp', amountCents: 32_500, description: 'Expense posting for Bill KWD' },
          { accountId: 'itax', amountCents: 3_250, description: 'Input tax recoverable on Bill KWD' },
          { accountId: 'ap', amountCents: -35_750, description: 'Accounts Payable for Bill KWD' },
        ],
      },
    ];
    const diffs = findTaxDifferences({
      invoices: [jpyInvoice as unknown as Invoice],
      bills: [kwdBill as unknown as Bill],
      transactions: glTxs,
      baseCurrency: 'USD',
    });
    assert.deepEqual(diffs, [], 'GL and tax recompute must agree on JPY and KWD documents with zero false differences');
  });

  test('A8-013 (posting layer): postInvoiceLedger and deletePostings never auto-reverse invoice-bad-debt-writeoff entries', async () => {
    const accounts: ChartAccount[] = [
      { id: 'ar', workspaceId: 'ws', code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' } as ChartAccount,
      { id: 'rev', workspaceId: 'ws', code: '4000', name: 'Sales Revenue', type: 'revenue', category: 'Revenue' } as ChartAccount,
      { id: 'cash', workspaceId: 'ws', code: '1000', name: 'Cash', type: 'asset', category: 'Cash' } as ChartAccount,
    ];
    const existingTxs: Transaction[] = [
      {
        id: 'tx_accrual', workspaceId: 'ws', uid: 'u1', date: '2026-05-01', status: 'completed', type: 'actual',
        currency: 'USD', exchangeRate: 1, totalAmountCents: 10_000, description: 'Invoice INV-1',
        metadata: { invoiceId: 'inv1', type: 'invoice-accrual' },
        lines: [{ accountId: 'ar', amountCents: 10_000 }, { accountId: 'rev', amountCents: -10_000 }],
      },
      {
        id: 'tx_writeoff', workspaceId: 'ws', uid: 'u1', date: '2026-05-20', status: 'completed', type: 'actual',
        currency: 'USD', exchangeRate: 1, totalAmountCents: 10_000, description: 'Bad debt: invoice INV-1',
        metadata: { invoiceId: 'inv1', type: 'invoice-bad-debt-writeoff' },
        lines: [{ accountId: 'bd', amountCents: 10_000 }, { accountId: 'ar', amountCents: -10_000 }],
      },
    ];
    const ctx: LedgerPostContext = {
      accounts, workspaces: [{ id: 'ws', currency: 'USD', name: 'Test' } as never],
      transactions: existingTxs, inventory: [], lockDate: null, uid: 'u1', today: '2026-06-01', capture: [],
    };
    await postInvoiceLedger('inv1', {
      id: 'inv1', number: 'INV-1', customerId: 'c1', customerName: 'Acme', date: '2026-05-01',
      status: 'paid', currency: 'USD', exchangeRate: 1, amountCents: 10_000, amountPaidCents: 10_000,
      settledByRecordsCents: 10_000,
    }, 'ws', 'u1', { collection: 'invoices', docId: 'inv1', action: 'update', data: { notes: 'edited' } }, ctx);

    const posted = ctx.capture![0].txs;
    assert.equal(posted.some(t => t.metadata?.reversesTxId === 'tx_writeoff'), false, 'edit must not reverse bad-debt write-off');
    assert.equal(posted.some(t => t.metadata?.reversesTxId === 'tx_accrual'), true, 'edit still reverses original accrual');

    const delCtx: LedgerPostContext = { ...ctx, capture: [] };
    await deletePostings('inv1', 'invoiceId', 'ws', { collection: 'invoices', docId: 'inv1', action: 'delete' }, delCtx);
    const delPosted = delCtx.capture![0].txs;
    assert.equal(delPosted.some(t => t.metadata?.reversesTxId === 'tx_writeoff'), false, 'deletePostings must not reverse bad-debt write-off');
  });

  test('A8-002: period.yearclose audit formats JPY (0-dec) and KWD (3-dec) without hardcoded / 100', () => {
    const jpyAudit = periodYearCloseCommand.audit(
      { closingDate: '2025-12-31', lockPeriod: true },
      { workspaceId: 'ws', yearStart: '2025-01-01', closingDate: '2025-12-31', lockPeriod: true, year: { netIncome: 50000, income: 80000, cogs: 10000, grossProfit: 70000, expense: 20000 }, closingVersion: 1, currency: 'JPY' },
    );
    assert.ok(jpyAudit && jpyAudit.description.includes('of 50000 (income 80000, costs 30000)'), `Unexpected JPY audit: ${jpyAudit?.description}`);

    const kwdAudit = periodYearCloseCommand.audit(
      { closingDate: '2025-12-31', lockPeriod: false },
      { workspaceId: 'ws', yearStart: '2025-01-01', closingDate: '2025-12-31', lockPeriod: false, year: { netIncome: 12345, income: 20000, cogs: 0, grossProfit: 20000, expense: 7655 }, closingVersion: null, currency: 'KWD' },
    );
    assert.ok(kwdAudit && kwdAudit.description.includes('of 12.345 (income 20.000, costs 7.655)'), `Unexpected KWD audit: ${kwdAudit?.description}`);
  });
});

// ---------------------------------------------------------------------------
// 2. Live PostgreSQL integration proofs
// ---------------------------------------------------------------------------
describe('Agent #8 (2026-11-16) — Live PostgreSQL P0/P1 Security & Accounting Proofs', { skip: !url && 'LF_TEST_DATABASE_URL not set' }, () => {
  const tag = crypto.randomBytes(4).toString('hex');
  const ws = `ws_a8_${tag}`;
  const victimWs = `ws_a8_victim_${tag}`;
  const owner = `u_owner_${tag}`;
  const bookkeeper = `u_book_${tag}`;
  const viewer = `u_view_${tag}`;
  const id = (k: string) => `${ws}_${k}`;
  let db: Firestore;

  const accounts: Array<Record<string, unknown>> = [
    { id: id('cash'), workspaceId: ws, code: '1000', name: 'Checking Bank', type: 'asset', category: 'Cash' },
    { id: id('uf'), workspaceId: ws, code: '1050', name: 'Undeposited Funds', type: 'asset', category: 'Cash', subType: 'undeposited_funds' },
    { id: id('ar'), workspaceId: ws, code: '1100', name: 'Accounts Receivable', type: 'asset', category: 'Receivables' },
    { id: id('inv'), workspaceId: ws, code: '1200', name: 'Inventory Asset', type: 'asset', category: 'Inventory' },
    { id: id('equip'), workspaceId: ws, code: '1500', name: 'Office Equipment', type: 'asset', category: 'Fixed Assets' },
    { id: id('equip2'), workspaceId: ws, code: '1510', name: 'Warehouse Equipment', type: 'asset', category: 'Fixed Assets' },
    { id: id('cip'), workspaceId: ws, code: '1520', name: 'Construction in Progress', type: 'asset', category: 'Fixed Assets' },
    { id: id('accdep'), workspaceId: ws, code: '1590', name: 'Accumulated Depreciation', type: 'asset', category: 'Fixed Assets' },
    { id: id('ap'), workspaceId: ws, code: '2000', name: 'Accounts Payable', type: 'liability', category: 'Payables' },
    { id: id('ap_custom'), workspaceId: ws, code: '2010', name: 'Foreign Vendor AP', type: 'liability', category: 'Payables' },
    { id: id('payliab'), workspaceId: ws, code: '2100', name: 'Payroll Liabilities', type: 'liability', category: 'Payroll' },
    { id: id('taxpay'), workspaceId: ws, code: '2200', name: 'Sales Tax Payable', type: 'liability', category: 'Taxes' },
    { id: id('rev'), workspaceId: ws, code: '4000', name: 'Sales Revenue', type: 'revenue', category: 'Revenue' },
    { id: id('fxgl'), workspaceId: ws, code: '4900', name: 'Unrealized FX Gain/Loss', type: 'revenue', category: 'Other Income' },
    { id: id('exp'), workspaceId: ws, code: '5000', name: 'Operating Expense', type: 'expense', category: 'Operating' },
    { id: id('depexp'), workspaceId: ws, code: '5100', name: 'Depreciation Expense', type: 'expense', category: 'Operating' },
    { id: id('baddebt'), workspaceId: ws, code: '5200', name: 'Bad Debt Expense', type: 'expense', category: 'Operating' },
    { id: id('wages'), workspaceId: ws, code: '5300', name: 'Wages Expense', type: 'expense', category: 'Payroll' },
    { id: id('paytax'), workspaceId: ws, code: '5310', name: 'Payroll Tax Expense', type: 'expense', category: 'Payroll' },
    { id: id('archived_exp'), workspaceId: ws, code: '5999', name: 'Archived Expense', type: 'expense', isArchived: true },
  ];

  const fakeReq = (uid: string, body: unknown = {}, aal: 'aal1' | 'aal2' = 'aal2'): Request =>
    ({ user: { uid, email: `${uid}@test.local`, aal }, body, headers: {} }) as unknown as Request;
  const fakeRes = (): Response => {
    const r = { statusCode: 200, body: undefined as unknown, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; } };
    return r as unknown as Response;
  };

  before(async () => {
    process.env.DATABASE_URL = url!;
    db = new Firestore({ connectionString: url, max: 4 });
    await db.collection('workspaces').doc(ws).set({
      uid: owner,
      name: 'Agent8 Test Books',
      currency: 'USD',
      timezone: 'UTC',
      plan: 'business',
      members: [owner, bookkeeper, viewer],
      roles: { [owner]: 'owner', [bookkeeper]: 'bookkeeper', [viewer]: 'viewer' },
      defaultAccountMappings: { ar: id('ar'), ap: id('ap'), cash: id('cash'), revenue: id('rev'), expense: id('exp') },
    });
    await db.collection('workspaces').doc(victimWs).set({
      uid: 'victim-owner',
      name: 'Victim Tenant Books',
      currency: 'USD',
      members: ['victim-owner'],
      roles: { 'victim-owner': 'owner' },
    });
    for (const acc of accounts) {
      await db.collection('chartAccounts').doc(String(acc.id)).set(acc);
    }
    await db.collection('transactions').doc(`${victimWs}_tx1`).set({
      workspaceId: victimWs,
      uid: 'victim-owner',
      date: '2026-06-10',
      status: 'completed',
      type: 'actual',
      currency: 'USD',
      exchangeRate: 1,
      totalAmountCents: 99_900,
      description: 'Victim Tenant Sacred Ledger Entry',
      lines: [
        { accountId: `${victimWs}_cash`, amountCents: 99_900 },
        { accountId: `${victimWs}_rev`, amountCents: -99_900 },
      ],
    });
  });

  after(async () => {
    const tables = [
      'transactions', 'invoices', 'bills', 'creditNotes', 'vendorCredits', 'payments',
      'paymentAllocations', 'allocationOperations', 'assets', 'employees', 'payRuns',
      'documents', 'inventory', 'stockMoves', 'stockClosings', 'periodBalances',
      'periodClosings', 'repostQueue', 'auditLogs', 'idempotencyKeys', 'chartAccounts',
      'customers', 'vendors', 'workspaces',
    ];
    for (const table of tables) {
      await db.pool.query(`delete from public."${table}" where workspace_id in ($1, $2) or id in ($1, $2)`, [ws, victimWs]).catch(() => undefined);
    }
    await db.terminate();
  });

  test('A8-005 / A8-007 / A8-008: strips forged settledByRecordsCents, blocks locked re-dating, blocks deleting settled docs', async () => {
    const user = { uid: owner, email: 'owner@test.local' };

    // A8-005: Forging settledByRecordsCents on create must be stripped so cash entry IS posted
    const inv1 = id('inv_forged');
    const prep1 = await prepareDocumentPost(db, user, {
      collection: 'invoices', docId: inv1, workspaceId: ws, action: 'create',
      data: {
        number: 'INV-A8-1', customerId: 'c1', customerName: 'Acme', date: '2026-06-10',
        status: 'paid', currency: 'USD', exchangeRate: 1, amountCents: 50_000,
        amountPaidCents: 50_000, settledByRecordsCents: 50_000,
      },
    });
    const res1 = await commitPreparedDocumentPost(db, user, prep1);
    assert.ok(res1.transactions.some(t => t.metadata?.type === 'invoice-payment'), 'Cash entry MUST be posted because forged settledByRecordsCents was stripped');
    const savedInv1 = (await db.collection('invoices').doc(inv1).get()).data();
    assert.equal(savedInv1?.settledByRecordsCents, undefined, 'Forged settledByRecordsCents was not stored');

    // A8-008: Settled invoice (settledByRecordsCents > 0) cannot be deleted or reverted to draft
    const inv2 = id('inv_settled');
    await db.collection('invoices').doc(inv2).set({
      workspaceId: ws, number: 'INV-A8-2', customerId: 'c1', customerName: 'Acme', date: '2026-06-10',
      status: 'paid', currency: 'USD', exchangeRate: 1, amountCents: 30_000, amountPaidCents: 30_000,
      settledByRecordsCents: 30_000,
    });
    await assert.rejects(
      prepareDocumentPost(db, user, { collection: 'invoices', docId: inv2, workspaceId: ws, action: 'delete', data: {} }),
      (e: unknown) => e instanceof BulkRefusal && e.status === 409,
      'Must refuse deleting invoice with recorded payments',
    );
    await assert.rejects(
      prepareDocumentPost(db, user, { collection: 'invoices', docId: inv2, workspaceId: ws, action: 'update', data: { status: 'draft', amountPaidCents: 0 } }),
      (e: unknown) => e instanceof BulkRefusal && e.status === 409,
      'Must refuse reverting settled invoice to draft or reducing amountPaidCents below settledByRecordsCents',
    );

    // A8-005 / A8-008: Refunded credit note cannot have remainingCents restored or be deleted
    const cn1 = id('cn_refunded');
    await db.collection('creditNotes').doc(cn1).set({
      workspaceId: ws, number: 'CN-A8-1', customerId: 'c1', customerName: 'Acme', date: '2026-06-10',
      status: 'applied', currency: 'USD', exchangeRate: 1, amountCents: 10_000, remainingCents: 0,
      refundedCents: 10_000, refundTransactionIds: ['tx_ref1'],
    });
    await assert.rejects(
      prepareDocumentPost(db, user, { collection: 'creditNotes', docId: cn1, workspaceId: ws, action: 'update', data: { remainingCents: 10_000, status: 'open' } }),
      (e: unknown) => e instanceof BulkRefusal && e.status === 409,
      'Must refuse restoring remainingCents on refunded credit note',
    );
    await assert.rejects(
      prepareDocumentPost(db, user, { collection: 'creditNotes', docId: cn1, workspaceId: ws, action: 'delete', data: {} }),
      (e: unknown) => e instanceof BulkRefusal && e.status === 409,
      'Must refuse deleting refunded credit note',
    );

    // A8-007: Posted invoice in locked period cannot be re-dated into open period via update
    const inv3 = id('inv_locked');
    const prep3 = await prepareDocumentPost(db, user, {
      collection: 'invoices', docId: inv3, workspaceId: ws, action: 'create',
      data: { number: 'INV-A8-3', customerId: 'c1', customerName: 'Acme', date: '2026-05-10', status: 'sent', currency: 'USD', exchangeRate: 1, amountCents: 20_000 },
    });
    await commitPreparedDocumentPost(db, user, prep3);
    // Also create a draft in May (should STILL be movable to June!)
    const invDraft = id('inv_draft_may');
    await db.collection('invoices').doc(invDraft).set({
      workspaceId: ws, number: 'INV-DRAFT', customerId: 'c1', customerName: 'Acme', date: '2026-05-12',
      status: 'draft', currency: 'USD', exchangeRate: 1, amountCents: 5_000,
    });

    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-05-31' });
    try {
      await assert.rejects(
        prepareDocumentPost(db, user, { collection: 'invoices', docId: inv3, workspaceId: ws, action: 'update', data: { date: '2026-06-15', amountCents: 99_000 } }),
        (e: unknown) => e instanceof BulkRefusal && e.status === 409,
        'Must refuse re-dating or mutating a locked-period posted invoice into an open period',
      );
      const draftMove = await prepareDocumentPost(db, user, {
        collection: 'invoices', docId: invDraft, workspaceId: ws, action: 'update', data: { date: '2026-06-15' },
      });
      assert.equal(draftMove.document.date, '2026-06-15', 'Unposted draft dated in closed month can still be re-dated to open month');
    } finally {
      await db.collection('workspaces').doc(ws).update({ lockDate: null });
    }
  });

  test('A8-012 / A8-011b: cross-tenant asset undo refuses voiding victim tx; post-transfer dep & archived dep account blocked', async () => {
    const victimTxId = `${victimWs}_tx1`;

    // Full disposal undo pointing to victim tenant tx
    const a1 = id('asset_full');
    await db.collection('assets').doc(a1).set({
      workspaceId: ws, name: 'Poisoned Full', purchaseDate: '2026-01-01', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'disposed', disposedOn: '2026-06-10', disposalTransactionId: victimTxId,
    });
    await assert.rejects(
      undoDisposal(db, { workspaceId: ws, assetId: a1, uid: owner }),
      (e: unknown) => e instanceof DisposalError && e.status === 403,
    );

    // Partial disposal undo pointing to victim tenant tx
    const a2 = id('asset_partial');
    await db.collection('assets').doc(a2).set({
      workspaceId: ws, name: 'Poisoned Partial', purchaseDate: '2026-01-01', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'active', partialDisposals: [{ date: '2026-06-10', percent: 50, proceedsCents: 40_000, gainLossCents: -10_000, transactionId: victimTxId, before: { purchasePriceCents: 100_000, salvageValueCents: 0, accumulatedDepreciationCents: 0 } }],
    });
    await assert.rejects(
      undoDisposal(db, { workspaceId: ws, assetId: a2, uid: owner }),
      (e: unknown) => e instanceof DisposalError && e.status === 403,
    );

    // Transfer undo pointing to victim tenant tx
    const a3 = id('asset_transfer');
    await db.collection('assets').doc(a3).set({
      workspaceId: ws, name: 'Poisoned Transfer', purchaseDate: '2026-01-01', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'active', transfers: [{ date: '2026-06-10', description: 'Move', transactionId: victimTxId, before: { location: 'A', assetAccountId: id('equip'), accumulatedAccountId: id('accdep') } }],
    });
    await assert.rejects(
      undoTransfer(db, { workspaceId: ws, assetId: a3, uid: owner }),
      (e: unknown) => e instanceof TransferError && e.status === 403,
    );

    // Place-in-service undo pointing to victim tenant tx
    const a4 = id('asset_cip');
    await db.collection('assets').doc(a4).set({
      workspaceId: ws, name: 'Poisoned CIP', purchaseDate: '2026-06-10', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'active', placedInService: { date: '2026-06-10', transactionId: victimTxId, cipAccountId: id('cip'), startedOn: '2026-01-01' },
    });
    await assert.rejects(
      undoPlaceInService(db, { workspaceId: ws, assetId: a4, uid: owner }),
      (e: unknown) => e instanceof InServiceError && e.status === 403,
    );

    // Victim transaction MUST remain completely untouched!
    assert.equal((await db.collection('transactions').doc(victimTxId).get()).data()?.status, 'completed', 'Victim tenant transaction MUST NOT be voided');

    // A8-011b: undoTransfer refused when depreciation posted after transfer month
    const ownMoveTx = id('tx_own_move');
    await db.collection('transactions').doc(ownMoveTx).set({
      workspaceId: ws, uid: owner, date: '2026-04-15', status: 'completed', type: 'actual',
      currency: 'USD', exchangeRate: 1, totalAmountCents: 100_000,
      lines: [{ accountId: id('equip2'), amountCents: 100_000 }, { accountId: id('equip'), amountCents: -100_000 }],
    });
    const a5 = id('asset_dep_after_move');
    await db.collection('assets').doc(a5).set({
      workspaceId: ws, name: 'Moved & Depreciated', purchaseDate: '2026-01-01', purchasePriceCents: 120_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 10_000,
      depreciatedThrough: '2026-05', status: 'active',
      transfers: [{ date: '2026-04-15', description: 'Move', transactionId: ownMoveTx, before: { location: 'A', assetAccountId: id('equip'), accumulatedAccountId: id('accdep') } }],
    });
    await assert.rejects(
      undoTransfer(db, { workspaceId: ws, assetId: a5, uid: owner }),
      (e: unknown) => e instanceof TransferError && e.status === 409,
    );

    // A8-011b: runDepreciation refuses asset with archived expenseAccountId
    const a6 = id('asset_bad_acc');
    await db.collection('assets').doc(a6).set({
      workspaceId: ws, name: 'Bad Account Asset', purchaseDate: '2026-01-01', purchasePriceCents: 120_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'active', expenseAccountId: id('archived_exp'), accumulatedAccountId: id('accdep'),
    });
    await assert.rejects(
      runDepreciation(db, { workspaceId: ws, uid: owner, month: '2026-03' }),
      (e: unknown) => e instanceof DepreciationError && e.status === 400,
    );
    // Clean up assets so later tests aren't affected
    for (const k of [a1, a2, a3, a4, a5, a6]) await db.collection('assets').doc(k).delete();
  });

  test('A7N-11: an asset that points at an unrelated entry of its own workspace cannot void it (409, entry untouched)', async () => {
    const ownTxId = id('tx_unrelated_invoice');
    await db.collection('transactions').doc(ownTxId).set({
      workspaceId: ws, uid: owner, date: '2026-06-12', status: 'completed', type: 'actual', currency: 'USD', exchangeRate: 1,
      totalAmountCents: 12_300, description: 'An unrelated invoice entry', metadata: { type: 'invoice' },
      lines: [{ accountId: id('ar'), amountCents: 12_300 }, { accountId: id('rev'), amountCents: -12_300 }],
    });
    const full = id('asset_points_at_invoice');
    await db.collection('assets').doc(full).set({
      workspaceId: ws, name: 'Tampered Full', purchaseDate: '2026-01-01', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'disposed', disposedOn: '2026-06-12', disposalTransactionId: ownTxId,
    });
    await assert.rejects(undoDisposal(db, { workspaceId: ws, assetId: full, uid: owner }),
      (e: unknown) => e instanceof DisposalError && e.status === 409);
    const partial = id('asset_share_points_at_invoice');
    await db.collection('assets').doc(partial).set({
      workspaceId: ws, name: 'Tampered Partial', purchaseDate: '2026-01-01', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'active', partialDisposals: [{ date: '2026-06-12', percent: 50, proceedsCents: 40_000, gainLossCents: -10_000, transactionId: ownTxId, before: { purchasePriceCents: 100_000, salvageValueCents: 0, accumulatedDepreciationCents: 0 } }],
    });
    await assert.rejects(undoDisposal(db, { workspaceId: ws, assetId: partial, uid: owner }),
      (e: unknown) => e instanceof DisposalError && e.status === 409);
    assert.equal((await db.collection('transactions').doc(ownTxId).get()).data()?.status, 'completed', 'the invoice entry is not voided');
    // an entry that no longer exists (an admin deleted it) voids nothing, so the asset can still be restored
    const orphan = id('asset_entry_deleted');
    await db.collection('assets').doc(orphan).set({
      workspaceId: ws, name: 'Entry gone', purchaseDate: '2026-01-01', purchasePriceCents: 100_000,
      salvageValueCents: 0, usefulLifeYears: 5, depreciationMethod: 'straight-line', accumulatedDepreciationCents: 0,
      status: 'disposed', disposedOn: '2026-06-12', disposalTransactionId: id('tx_never_existed'),
    });
    await undoDisposal(db, { workspaceId: ws, assetId: orphan, uid: owner });
  });

  test('A8-019: voidPayment on an FX payment negates baseAmountCents so home-currency GL nets to zero', async () => {
    const payId = id('pay_fx');
    const txId = id('tx_pay_fx');
    await db.collection('payments').doc(payId).set({
      workspaceId: ws, uid: owner, number: 'PMT-FX-1', direction: 'received', status: 'posted',
      date: '2026-06-10', currency: 'EUR', exchangeRate: 1.15, amountCents: 10_000,
      unappliedCents: 10_000, depositAccountId: id('cash'), cashAccountId: id('cash'),
      transactionId: txId, allocations: [],
    });
    await db.collection('transactions').doc(txId).set({
      workspaceId: ws, uid: owner, date: '2026-06-10', status: 'completed', type: 'actual',
      currency: 'EUR', exchangeRate: 1.15, totalAmountCents: 10_000, description: 'EUR Payment',
      metadata: { paymentId: payId, type: 'payment-posting' },
      lines: [
        { accountId: id('cash'), amountCents: 10_000, baseAmountCents: 11_500, description: 'Cash' },
        { accountId: id('ar'), amountCents: -10_000, baseAmountCents: -11_500, description: 'AR' },
      ],
    });

    const voidRes = await voidPayment(db, { workspaceId: ws, paymentId: payId, uid: owner, date: '2026-06-11', reason: 'FX test' });
    assert.equal(voidRes.transactionIds.length, 1);
    const revTx = (await db.collection('transactions').doc(voidRes.transactionIds[0]).get()).data()!;
    const revCash = (revTx.lines as Array<{ accountId: string; amountCents: number; baseAmountCents?: number }>).find(l => l.accountId === id('cash'))!;
    const revAr = (revTx.lines as Array<{ accountId: string; amountCents: number; baseAmountCents?: number }>).find(l => l.accountId === id('ar'))!;
    assert.equal(revCash.amountCents, -10_000);
    assert.equal(revCash.baseAmountCents, -11_500, 'Reversal MUST negate baseAmountCents (-11500), not preserve +11500');
    assert.equal(revAr.baseAmountCents, 11_500, 'AR reversal baseAmountCents must be +11500');
    assert.equal(11_500 + revCash.baseAmountCents!, 0, 'Cash home-currency balance nets to EXACTLY 0');
  });

  test('A8-016: createDeposit blocks viewer, converts JPY payment to USD base cents, and writes audit log', async () => {
    const payJpy = id('pay_uf_jpy');
    await db.collection('payments').doc(payJpy).set({
      workspaceId: ws, uid: owner, number: 'PMT-JPY-1', direction: 'received', status: 'posted',
      date: '2026-06-12', currency: 'JPY', exchangeRate: 0.0067, amountCents: 10_000,
      depositAccountId: id('uf'), cashAccountId: id('uf'), allocations: [],
    });

    await assert.rejects(
      createDeposit(db, { workspaceId: ws, uid: viewer, bankAccountId: id('cash'), paymentIds: [payJpy], date: '2026-06-13' }),
      (e: unknown) => e instanceof DepositError && e.status === 403,
      'Viewer must be refused inside createDeposit',
    );

    const dep = await createDeposit(db, { workspaceId: ws, uid: bookkeeper, bankAccountId: id('cash'), paymentIds: [payJpy], date: '2026-06-13', memo: 'Tokyo wire' });
    assert.equal(dep.totalCents, 6_700, '¥10,000 @ 0.0067 into USD must deposit 6700 cents ($67.00), NOT 10000 cents ($100.00)');

    const auditSnap = await db.collection('auditLogs').where('workspaceId', '==', ws).where('action', '==', 'BANK_DEPOSIT_CREATED').get();
    assert.ok(auditSnap.docs.some(d => d.data().entityId === dep.transactionId), 'Deposit must write BANK_DEPOSIT_CREATED audit log');
  });

  test('A8-013 (live DB): bad-debt write-off survives invoice edit, enforces recovery date & blocks double reversal', async () => {
    const invId = id('inv_bd');
    const user = { uid: owner, email: 'owner@test.local' };
    const prep = await prepareDocumentPost(db, user, {
      collection: 'invoices', docId: invId, workspaceId: ws, action: 'create',
      data: { number: 'INV-BD-1', customerId: 'c1', customerName: 'Acme', date: '2026-06-01', status: 'sent', currency: 'USD', exchangeRate: 1, amountCents: 12_000 },
    });
    await commitPreparedDocumentPost(db, user, prep);

    const wo = await writeOffInvoice(db, { workspaceId: ws, invoiceId: invId, uid: owner, date: '2026-06-10', reason: 'Bankruptcy' });
    assert.equal(wo.writtenOffCents, 12_000);

    // Editing invoice notes must NOT reverse the bad-debt write-off entry
    const editPrep = await prepareDocumentPost(db, user, {
      collection: 'invoices', docId: invId, workspaceId: ws, action: 'update',
      data: { notes: 'Sent to collections agency' },
    });
    const editRes = await commitPreparedDocumentPost(db, user, editPrep);
    assert.equal(editRes.transactions.some(t => t.metadata?.reversesTxId === wo.transactionId), false, 'Invoice edit must not auto-reverse write-off');

    // Backdated recovery before write-off date must be refused
    await assert.rejects(
      reverseWriteOff(db, { workspaceId: ws, invoiceId: invId, uid: owner, date: '2026-06-05' }),
      (e: unknown) => e instanceof BadDebtError && e.status === 400,
    );

    const rec = await reverseWriteOff(db, { workspaceId: ws, invoiceId: invId, uid: owner, date: '2026-06-15', reason: 'Customer paid late' });
    const recTx = (await db.collection('transactions').doc(rec.transactionId).get()).data()!;
    assert.equal(recTx.metadata?.isReversal, true, 'Recovery entry must set metadata.isReversal = true');

    // Double reversal must be refused
    await assert.rejects(
      reverseWriteOff(db, { workspaceId: ws, invoiceId: invId, uid: owner, date: '2026-06-16' }),
      (e: unknown) => e instanceof BadDebtError && e.status === 409,
    );
  });

  test('A8-001 / A7N-05: FX revaluation uses bill apAccountId and can be re-run cleanly after an early undo', async () => {
    // undo is only possible before the next-day reversal takes effect (AUP-34), so this runs on today's date
    const today = formatTzDate(new Date(), 'UTC');
    const billId = id('bill_fx_custom');
    await db.collection('bills').doc(billId).set({
      workspaceId: ws, number: 'BILL-FX-1', vendorId: 'v1', vendorName: 'Euro Vendor',
      date: '2026-06-01', status: 'approved', currency: 'EUR', exchangeRate: 1.0,
      amountCents: 10_000, amountPaidCents: 0, apAccountId: id('ap_custom'),
    });

    const first = await revaluateForeignBalances(db, {
      workspaceId: ws, user: { uid: owner }, date: today, rates: { EUR: 1.2 },
    });
    assert.equal(first.posted, true);
    assert.ok(first.lines.some(l => l.accountId === id('ap_custom')), 'A7N-05: Bill revaluation MUST post to bill custom apAccountId, not default AP');

    await undoRevaluation(db, { workspaceId: ws, user: { uid: owner }, date: today });
    // the reversal of a past month end has already happened: that one cannot be undone (AUP-34)
    const past = await revaluateForeignBalances(db, { workspaceId: ws, user: { uid: owner }, date: '2026-06-30', rates: { EUR: 1.2 } });
    assert.equal(past.posted, true);
    await assert.rejects(undoRevaluation(db, { workspaceId: ws, user: { uid: owner }, date: '2026-06-30' }), /already reversed itself on 2026-07-01/);

    // A8-001: Re-running revaluation on the SAME date after undo MUST succeed (no 409 deadlock)
    const second = await revaluateForeignBalances(db, {
      workspaceId: ws, user: { uid: owner }, date: today, rates: { EUR: 1.25 },
    });
    assert.equal(second.posted, true, 'Re-running FX revaluation after undo must succeed');
    assert.notEqual(second.transactionId, first.transactionId);

    // Clean up bill
    await db.collection('bills').doc(billId).delete();
  });

  test('A8-014: postPayRun checks period lock before awaiting_approval & undoPayRun blocks cross-tenant tx void', async () => {
    const empId = id('emp1');
    await db.collection('employees').doc(empId).set({
      workspaceId: ws, name: 'Ada Lovelace', status: 'active', payType: 'salary',
      salaryCents: 12_000_000, paySchedule: 'monthly',
    });
    await db.collection('workspaces').doc(ws).update({ payrollApproval: true, lockDate: '2026-05-31' });
    try {
      await assert.rejects(
        postPayRun(db, {
          workspaceId: ws, uid: bookkeeper === owner ? owner : owner, // switch role to accountant below
          date: '2026-05-25',
          bankAccountId: id('cash'), wagesAccountId: id('wages'), taxExpenseAccountId: id('paytax'), liabilitiesAccountId: id('payliab'),
        }),
      );
      // Test with accountant submitting an awaiting_approval run in a locked period
      await db.collection('workspaces').doc(ws).update({ roles: { [owner]: 'owner', [bookkeeper]: 'accountant', [viewer]: 'viewer' } });
      await assert.rejects(
        postPayRun(db, {
          workspaceId: ws, uid: bookkeeper, date: '2026-05-25',
          bankAccountId: id('cash'), wagesAccountId: id('wages'), taxExpenseAccountId: id('paytax'), liabilitiesAccountId: id('payliab'),
        }),
        (e: unknown) => e instanceof PayRunError && e.status === 409,
        'Submitting awaiting_approval pay run for a closed period must fail immediately with 409',
      );
    } finally {
      await db.collection('workspaces').doc(ws).update({
        payrollApproval: false, lockDate: null,
        roles: { [owner]: 'owner', [bookkeeper]: 'bookkeeper', [viewer]: 'viewer' },
      });
    }

    // Cross-tenant undoPayRun guard
    const prId = id('pr_poison');
    await db.collection('payRuns').doc(prId).set({
      workspaceId: ws, uid: owner, date: '2026-06-15', status: 'processed', transactionId: `${victimWs}_tx1`, employees: [],
    });
    await assert.rejects(
      undoPayRun(db, { workspaceId: ws, payRunId: prId, uid: owner }),
      (e: unknown) => e instanceof PayRunError && e.status === 403,
    );
    assert.equal((await db.collection('transactions').doc(`${victimWs}_tx1`).get()).data()?.status, 'completed');
  });

  test('A8-003 / A8-004: CMD-1 blocks frozen/pending_deletion workspaces and blocks forged document metadata & dup ID 409', async () => {
    const validJournal = {
      transaction: {
        id: id('j_ok'), workspaceId: ws, date: '2026-06-18', description: 'Office fee',
        status: 'completed' as const, type: 'actual' as const,
        lines: [{ accountId: id('exp'), amountCents: 1_000 }, { accountId: id('cash'), amountCents: -1_000 }],
      },
    };

    // A8-004: Forged metadata.invoiceId refused with 400
    const forged = await executeCommand(fakeReq(owner, validJournal), fakeRes(), {
      definition: journalCreateCommand, workspaceId: ws,
      input: { transaction: { ...validJournal.transaction, id: id('j_forged'), metadata: { invoiceId: 'inv_123' } } },
    }, { getDb: () => db });
    assert.equal(forged.ok, false);
    assert.equal(forged.status, 400);

    // Valid journal succeeds; duplicate ID returns 409 (not 500)
    const first = await executeCommand(fakeReq(owner, validJournal), fakeRes(), {
      definition: journalCreateCommand, workspaceId: ws, input: validJournal,
    }, { getDb: () => db });
    assert.equal(first.ok, true);

    const dup = await executeCommand(fakeReq(owner, validJournal), fakeRes(), {
      definition: journalCreateCommand, workspaceId: ws, input: validJournal,
    }, { getDb: () => db });
    assert.equal(dup.ok, false);
    assert.equal(dup.status, 409, 'Duplicate transaction ID must return 409 Conflict, not 500');

    // A8-003: Frozen workspace refuses CMD-1 commands with 403 WORKSPACE_FROZEN
    await db.collection('workspaces').doc(ws).update({ concurrentUserLimit: 0 });
    try {
      const frozenRes = await executeCommand(fakeReq(owner, validJournal), fakeRes(), {
        definition: journalCreateCommand, workspaceId: ws,
        input: { transaction: { ...validJournal.transaction, id: id('j_frozen') } },
      }, { getDb: () => db });
      assert.equal(frozenRes.ok, false);
      assert.equal(frozenRes.status, 403);
      if (!frozenRes.ok) assert.equal(frozenRes.code, 'WORKSPACE_FROZEN');
    } finally {
      await db.collection('workspaces').doc(ws).update({ concurrentUserLimit: 10 });
    }

    // A8-003: pending_deletion workspace blocks normal commands (409) but allows workspace.canceldeletion
    await db.collection('workspaces').doc(ws).update({ status: 'pending_deletion' });
    const pendingBlocked = await executeCommand(fakeReq(owner, validJournal), fakeRes(), {
      definition: journalCreateCommand, workspaceId: ws,
      input: { transaction: { ...validJournal.transaction, id: id('j_pending') } },
    }, { getDb: () => db });
    assert.equal(pendingBlocked.ok, false);
    assert.equal(pendingBlocked.status, 409);
    if (!pendingBlocked.ok) assert.equal(pendingBlocked.code, 'WORKSPACE_PENDING_DELETION');

    // A legal hold or a longer grace period must stay possible until the purge runs.
    const held = await executeCommand(fakeReq(owner, {}), fakeRes(), {
      definition: workspaceRetentionCommand, workspaceId: ws,
      input: { deletionGraceDays: 60, emailLogDays: 90, errorLogDays: 30, legalHold: true },
    }, { getDb: () => db });
    assert.equal(held.ok, true, `workspace.retention must still work on a pending_deletion workspace: ${JSON.stringify(held)}`);

    const restored = await executeCommand(fakeReq(owner, {}), fakeRes(), {
      definition: workspaceCancelDeletionCommand, workspaceId: ws, input: {},
    }, { getDb: () => db });
    assert.equal(restored.ok, true, 'workspace.canceldeletion must still work on pending_deletion workspace');
  });

  test('A8-017 / A8-021 / A8-024 (live DB): restore blocks forged lockDate, clears derived tables, stockClosing & taxReturn accurate', async () => {
    // Seed a closed-period transaction and a JPY invoice + derived stale rows
    const closedTxId = id('tx_closed_may');
    await db.collection('transactions').doc(closedTxId).set({
      workspaceId: ws, uid: owner, date: '2026-05-15', status: 'completed', type: 'actual',
      currency: 'USD', exchangeRate: 1, totalAmountCents: 25_000, description: 'Closed May Inventory Purchase',
      lines: [{ accountId: id('inv'), amountCents: 25_000 }, { accountId: id('cash'), amountCents: -25_000 }],
    });
    await db.collection('invoices').doc(id('inv_tax_jpy')).set({
      workspaceId: ws, number: 'INV-JPY-TAX', customerId: 'c1', customerName: 'Tokyo Co',
      date: '2026-06-15', status: 'sent', currency: 'JPY', exchangeRate: 0.0067,
      amountCents: 11_000, taxAmountCents: 1_000, taxVersion: 2, taxTreatment: 'standard',
    });

    // A8-024 live DB: computeWorkspaceTaxReturn uses workspace baseCurrency ('USD')
    const liveTax = await computeWorkspaceTaxReturn(db, ws, '2026-06-15', '2026-06-15');
    assert.equal(liveTax.boxes.find(b => b.key === '1')?.cents, 670, 'Server tax return converts JPY tax to 670 USD cents');

    // Lock through 2026-05-31 and verify A8-021 stock closing reads in-tx cleanly
    await db.collection('workspaces').doc(ws).update({ lockDate: '2026-05-31' });
    const closing = await writeStockClosing(db, { workspaceId: ws, asOf: '2026-05-31', uid: owner });
    assert.equal(closing.inventoryBalanceCents, 25_000, 'A8-021: Stock closing computes exact in-transaction inventory balance');

    // Seed stale derived periodBalances & paymentAllocations rows
    await db.collection('periodBalances').doc(`${ws}_2026-05-31`).set({ workspaceId: ws, asOf: '2026-05-31', stale: true });

    // A8-017: Forged unsigned backup claiming lockDate='2099-12-31' to wipe closed May tx MUST BE REFUSED (409)
    await assert.rejects(
      restoreWorkspaceBackup(db, ws, {
        schemaVersion: 1,
        workspace: { id: ws, lockDate: '2099-12-31' },
        accounts,
        transactions: [],
      }),
      (e: unknown) => e instanceof RestoreError && e.status === 409,
      'Must refuse unsigned backup that forges lockDate to delete closed-period entries',
    );

    // Export a genuine server-signed backup, tamper with it => rejected (400)
    const realBackup = await exportWorkspaceBackup(db, ws, owner);
    // A payment-ledger row written after the backup was taken is not in it, so the restore removes it.
    await db.collection('paymentAllocations').doc(`${ws}_stale_alloc`).set({ workspaceId: ws, paymentId: 'ghost', amountCents: 999 });
    const tampered = JSON.parse(JSON.stringify(realBackup));
    tampered.workspace.lockDate = '2099-12-31';
    await assert.rejects(
      restoreWorkspaceBackup(db, ws, tampered),
      (e: unknown) => e instanceof RestoreError && (e.status === 400 || e.status === 409),
      'Tampered server backup must fail checksum/signature verification',
    );

    // Restoring genuine signed backup succeeds AND clears stale derived rows!
    await restoreWorkspaceBackup(db, ws, realBackup);
    assert.equal((await db.collection('periodBalances').doc(`${ws}_2026-05-31`).get()).exists, false, 'Stale periodBalances must be cleared on restore');
    assert.equal((await db.collection('paymentAllocations').doc(`${ws}_stale_alloc`).get()).exists, false, 'Stale paymentAllocations must be cleared on restore');
    assert.equal((await db.collection('stockClosings').doc(`${ws}_2026-05-31`).get()).exists, false, 'Stale stockClosings must be cleared on restore');
    assert.equal((await db.collection('transactions').doc(closedTxId).get()).exists, true, 'Genuine signed backup preserves closed May transaction');
  });
});
