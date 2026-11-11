import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { planFor, PLAN_ADD_ON_PRICING } from '../lib/plans';
import { computePlatformFeeQuote, summarizePaymentVolume } from '../lib/paymentVolumeFee';
import {
  buildConnectedAlgorithmSignals,
  computeCloseReadiness,
  computeFirmNoTouchSummary,
  computeNoTouchRate,
  evaluateCalibratedAutoPost,
  groupSimilarUnreviewedLines,
  tryEvaluateAmountInput,
} from '../lib/practiceAutomation';
import {
  chainAuditEntries,
  computeLedgerCloseAnchor,
  GENESIS_AUDIT_HASH,
  sha256Hex,
  verifyAuditHashChain,
} from '../lib/auditHashChain';
import { buildLenderReadyPackage } from '../lib/lenderReadyPackage';
import {
  balanceDimensionLines,
  buildSelfProvingEliminations,
  computeIntercompanyIdentityHash,
} from '../lib/selfBalancingDimensions';
import { labelRoleProblems } from '../lib/labelRoles';
import {
  buildRestrictionReleaseEntries,
  computeOwnerStatement,
  computePropertyRentRoll,
  computeStatementOfFunctionalExpenses,
  computeTenantLedger,
  computeUsIsraelDualTaxSummary,
  reconcileSecurityDepositTrust,
} from '../lib/verticalAccounting';
import {
  computeThirteenWeekTaxSafeRunway,
  evaluateHiringAffordability,
  learnCustomerPaymentProfiles,
} from '../lib/ownerAdvisor';
import type { ChartAccount, DimensionDefinition, Invoice, Payment, Transaction } from '../types';

describe('Pillar 0 — Audit C-1 & C-2 Server-Only Ledger & Unconditional Balance Guard', () => {
  test('SQL migration revokes browser writes on core ledger tables and enforces unconditional balance trigger', () => {
    const sql = fs.readFileSync(
      'supabase/migrations/20261111120000_ledger_server_only_and_balance_check.sql',
      'utf8',
    );
    for (const table of ['transactions', 'journalEntries', 'payments', 'reconciliations']) {
      assert.ok(sql.includes(`'${table}'`), `Migration must target ${table}`);
    }
    assert.match(sql, /drop policy if exists writer_insert on public\.%I/);
    assert.match(sql, /drop policy if exists writer_update on public\.%I/);
    assert.match(sql, /drop policy if exists writer_delete on public\.%I/);
    assert.match(sql, /revoke insert, update, delete on public\.%I from authenticated/);
    assert.match(sql, /create or replace function public\.lf_enforce_balanced_ledger\(\)/);
    const balanceFn = sql.slice(sql.indexOf('create or replace function public.lf_enforce_balanced_ledger()'));
    assert.ok(!balanceFn.includes('lf_is_client()'), 'DB balance trigger must never exempt service_role via lf_is_client()');
    assert.match(sql, /amountPaidCents/);
    assert.match(sql, /partially_paid/);
  });

  test('useEntityOperations routes ledger tables strictly through server endpoints without browser RPC fallback', () => {
    const hookSrc = fs.readFileSync('src/hooks/useEntityOperations.ts', 'utf8');
    assert.ok(!hookSrc.includes('Falling back to direct write'), 'Client fallback write must be removed');
    assert.match(hookSrc, /\/api\/v1\/transactions/);
    assert.match(hookSrc, /Completed reconciliations cannot be deleted directly from the browser/);
  });
});

describe('Strategy 7 & Strategy 4 — Uncapped Entries, Value Meters & Payment Volume Revenue Share', () => {
  test('all plans have uncapped monthly transactions and value-aligned meters', () => {
    for (const tier of ['free', 'growth', 'pro', 'enterprise'] as const) {
      const limits = planFor(tier).limits;
      assert.equal(limits.transactions, null, `${tier} must never cap ledger entries`);
    }
    assert.equal(planFor('free').limits.entities, 1);
    assert.equal(planFor('pro').limits.entities, 3);
    assert.equal(planFor('enterprise').limits.firmClients, 250);
    assert.equal(PLAN_ADD_ON_PRICING.ownerAdvisorMonthlyUsd, 29);
  });

  test('worked platform fee quotes across rails and plans', () => {
    // $2,500.00 card invoice on Free (50 bps) => $12.50 (1,250 cents)
    const starterCard = computePlatformFeeQuote(250_000, 'free', 'card');
    assert.equal(starterCard.platformFeeBps, 50);
    assert.equal(starterCard.platformFeeCents, 1_250);

    // $10,000.00 ACH invoice on Free (25 bps = $25 uncapped, capped at $5.00 = 500 cents)
    const starterAch = computePlatformFeeQuote(1_000_000, 'free', 'us_bank_account');
    assert.equal(starterAch.platformFeeCents, 500);

    // Enterprise plan waives vendor payout platform fees ($0)
    assert.equal(computePlatformFeeQuote(250_000, 'enterprise', 'vendor_payout').platformFeeCents, 0);

    const summary = summarizePaymentVolume(
      [
        { amountCents: 250_000, paymentMethod: 'card', paymentDate: '2026-11-03', status: 'completed' },
        { amountCents: 1_000_000, paymentMethod: 'us_bank_account', paymentDate: '2026-11-09', status: 'completed' },
        { amountCents: 80_000, paymentMethod: 'vendor_payout', paymentDate: '2026-11-10', status: 'completed' },
      ],
      '2026-11',
      'free',
    );
    assert.equal(summary.cardVolumeCents, 250_000);
    assert.equal(summary.bankVolumeCents, 1_000_000);
    assert.equal(summary.vendorPayoutVolumeCents, 80_000);
    assert.equal(summary.platformFeesEarnedCents, 1_250 + 500 + 100);
  });
});

describe('Strategy 1 — Measured No-Touch Rate, Calibrated Auto-Post & Connected Algorithms', () => {
  test('computeNoTouchRate and computeFirmNoTouchSummary compute exact percentages', () => {
    const bankLines = [
      { id: 'bl1', date: '2026-11-01', status: 'matched', matchedTransactionId: 'tx1', ruleIdsApplied: ['r1'] },
      { id: 'bl2', date: '2026-11-02', status: 'matched', matchedTransactionId: 'tx2', ruleIdsApplied: ['r1'] },
      { id: 'bl3', date: '2026-11-03', status: 'matched', matchedTransactionId: 'tx3', ruleIdsApplied: [] },
      { id: 'bl4', date: '2026-11-04', status: 'pending', matchedTransactionId: null, ruleIdsApplied: [] },
    ];
    const txs = [
      { id: 'tx1', status: 'completed' },
      { id: 'tx2', status: 'completed', metadata: { editedByHuman: true } },
      { id: 'tx3', status: 'completed' },
    ] as unknown as Transaction[];

    // Only bl1 was matched by rule AND never edited by a human => 1 / 4 = 25.0%
    const m = computeNoTouchRate(bankLines, txs, '2026-11');
    assert.equal(m.noTouchCount, 1);
    assert.equal(m.totalBankLines, 4);
    assert.equal(m.ratePercent, 25);

    const firm = computeFirmNoTouchSummary([
      { noTouch: { noTouchCount: 90, totalBankLines: 100 }, closeReadiness: { score: 95 } },
      { noTouch: { noTouchCount: 30, totalBankLines: 50 }, closeReadiness: { score: 75 } },
    ]);
    // (90 + 30) / (100 + 50) = 120 / 150 = 80.0%
    assert.equal(firm.firmNoTouchPercent, 80);
    assert.equal(firm.averageCloseReadiness, 85);
  });

  test('evaluateCalibratedAutoPost enforces >=99% accuracy over >=10 verified cases', () => {
    const makePosted = (count: number, accountId: string, startIdx = 0): Transaction[] =>
      Array.from({ length: count }, (_, i) => ({
        id: `h_${startIdx + i}`,
        uid: 'u1',
        workspaceId: 'ws1',
        date: '2026-10-10',
        description: 'GITHUB INC SUBSCRIPTION',
        payee: 'GitHub',
        totalAmountCents: 2000,
        currency: 'USD',
        status: 'completed',
        type: 'actual',
        lines: [
          { accountId, accountName: accountId, amountCents: 2000 },
          { accountId: 'cash', accountName: 'Cash', amountCents: -2000 },
        ],
      }));

    // 9/9 = 100% accuracy, but < 10 cases => must NOT auto_post
    const nineCases = evaluateCalibratedAutoPost(
      { payee: 'GitHub', suggestedAccountId: 'acc_saas' },
      makePosted(9, 'acc_saas'),
    );
    assert.equal(nineCases.decision, 'needs_review');

    // 98/100 = 98% accuracy (< 99%) => must NOT auto_post
    const ninetyEight = evaluateCalibratedAutoPost(
      { payee: 'GitHub', suggestedAccountId: 'acc_saas' },
      [...makePosted(98, 'acc_saas', 0), ...makePosted(2, 'acc_other', 100)],
    );
    assert.equal(ninetyEight.decision, 'needs_review');

    // 100/100 = 100% accuracy (>= 99% and >= 10) => auto_post!
    const hundred = evaluateCalibratedAutoPost(
      { payee: 'GitHub', suggestedAccountId: 'acc_saas' },
      makePosted(100, 'acc_saas'),
    );
    assert.equal(hundred.decision, 'auto_post');
    assert.equal(hundred.accuracy, 1);
  });

  test('TF-IDF clustering, close readiness, amount expression & connected algorithms run cleanly', () => {
    const pending = [
      { id: 'p1', uid: 'u1', workspaceId: 'ws', date: '2026-11-01', description: 'STRIPE *FIGMA INC MONTHLY', totalAmountCents: 4500, status: 'pending', type: 'actual', lines: [] },
      { id: 'p2', uid: 'u1', workspaceId: 'ws', date: '2026-11-05', description: 'STRIPE *FIGMA INC MONTHLY', totalAmountCents: 4500, status: 'pending', type: 'actual', lines: [] },
    ] as unknown as Transaction[];
    const backgroundCorpus = [
      ...pending,
      { id: 'c1', uid: 'u1', workspaceId: 'ws', date: '2026-10-01', description: 'POS DEBIT AWS CLOUD SERVICES', totalAmountCents: 9000, status: 'completed', type: 'actual', lines: [] },
      { id: 'c2', uid: 'u1', workspaceId: 'ws', date: '2026-10-02', description: 'POS DEBIT GOOGLE WORKSPACE', totalAmountCents: 3000, status: 'completed', type: 'actual', lines: [] },
    ] as unknown as Transaction[];

    const clusters = groupSimilarUnreviewedLines(pending, backgroundCorpus);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].count, 2);
    assert.equal(clusters[0].totalAbsAmountCents, 9000);

    const readiness = computeCloseReadiness({
      bankLines: 0,
      bankLogins: 0,
      questions: 0,
      drafts: 0,
      billsWithoutFile: 0,
      lastMonthClosed: true,
      health: { serious: 0, warnings: 0 },
    });
    assert.equal(readiness.score, 100);
    assert.equal(readiness.grade, 'ready');

    const expr = tryEvaluateAmountInput('(120 + 30) / 3');
    assert.deepEqual(expr, { ok: true, cents: 5000 });

    const signals = buildConnectedAlgorithmSignals({ transactions: backgroundCorpus });
    assert.ok(signals.continuousClose.sha256Anchor.length === 64);
  });
});

describe('Strategy 5 — FIPS 180-4 SHA-256 Audit Hash-Chain & Lender-Ready Package', () => {
  test('sha256Hex matches NIST FIPS 180-4 test vectors', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('verifyAuditHashChain detects payload tampering and sequence deletion', () => {
    const raw = [
      { id: 'a1', workspaceId: 'ws1', uid: 'u1', action: 'INVOICE_POSTED', entityType: 'invoice', entityId: 'inv1', details: { amountCents: 100_000 }, timestamp: '2026-11-01T10:00:00.000Z' },
      { id: 'a2', workspaceId: 'ws1', uid: 'u1', action: 'PAYMENT_RECORDED', entityType: 'payment', entityId: 'pay1', details: { amountCents: 100_000 }, timestamp: '2026-11-02T10:00:00.000Z' },
      { id: 'a3', workspaceId: 'ws1', uid: 'u1', action: 'PERIOD_LOCKED', entityType: 'workspace', entityId: 'ws1', details: { lockDate: '2026-11-30' }, timestamp: '2026-11-03T10:00:00.000Z' },
    ];
    const chained = chainAuditEntries(raw);
    assert.equal(chained[0].prevHash, GENESIS_AUDIT_HASH);
    assert.equal(chained[1].prevHash, chained[0].entryHash);
    assert.equal(chained[2].prevHash, chained[1].entryHash);

    const okVerify = verifyAuditHashChain(chained);
    assert.equal(okVerify.valid, true);
    assert.equal(okVerify.chainedCount, 3);

    // Mutate 1 cent in seq 2
    const tampered = chained.map((e, idx) =>
      idx === 1 ? { ...e, details: { amountCents: 99_999 } } : e,
    );
    const badPayload = verifyAuditHashChain(tampered);
    assert.equal(badPayload.valid, false);
    assert.equal(badPayload.brokenAtSeq, 2);

    // Delete middle entry (seq 2)
    const deletedMiddle = [chained[0], chained[2]];
    const badGap = verifyAuditHashChain(deletedMiddle);
    assert.equal(badGap.valid, false);
    assert.equal(badGap.brokenAtSeq, 3);
  });

  test('buildLenderReadyPackage reconciles Trial Balance, Income Statement, Balance Sheet, and SHA-256 certificate', () => {
    const accounts: ChartAccount[] = [
      { id: 'cash', uid: 'u1', workspaceId: 'ws1', code: '1010', name: 'Operating Cash', type: 'asset', balanceCents: 0 },
      { id: 'eq', uid: 'u1', workspaceId: 'ws1', code: '3010', name: 'Owner Capital', type: 'equity', balanceCents: 0 },
      { id: 'rev', uid: 'u1', workspaceId: 'ws1', code: '4010', name: 'SaaS Revenue', type: 'revenue', balanceCents: 0 },
      { id: 'exp', uid: 'u1', workspaceId: 'ws1', code: '5010', name: 'Cloud Hosting', type: 'expense', balanceCents: 0 },
    ];
    const transactions: Transaction[] = [
      {
        id: 't1', uid: 'u1', workspaceId: 'ws1', date: '2026-11-01', description: 'Initial capital', totalAmountCents: 1_000_000, currency: 'USD', status: 'completed', type: 'actual',
        lines: [{ accountId: 'cash', amountCents: 1_000_000 }, { accountId: 'eq', amountCents: -1_000_000 }],
      },
      {
        id: 't2', uid: 'u1', workspaceId: 'ws1', date: '2026-11-05', description: 'Customer subscription', totalAmountCents: 600_000, currency: 'USD', status: 'completed', type: 'actual',
        lines: [{ accountId: 'cash', amountCents: 600_000 }, { accountId: 'rev', amountCents: -600_000 }],
      },
      {
        id: 't3', uid: 'u1', workspaceId: 'ws1', date: '2026-11-08', description: 'Hosting bill', totalAmountCents: 220_000, currency: 'USD', status: 'completed', type: 'actual',
        lines: [{ accountId: 'exp', amountCents: 220_000 }, { accountId: 'cash', amountCents: -220_000 }],
      },
    ];
    const auditLogs = chainAuditEntries([
      { id: 'a1', workspaceId: 'ws1', uid: 'u1', action: 'TX_POSTED', entityType: 'transaction', entityId: 't1', timestamp: '2026-11-01T00:00:00Z' },
    ]);

    const pack = buildLenderReadyPackage({
      workspace: { id: 'ws1', name: 'Acme Corp', currency: 'USD', lockDate: '2026-10-31' },
      period: { from: '2026-11-01', to: '2026-11-30' },
      generatedAt: '2026-11-30T23:59:59',
      accounts,
      transactions,
      invoices: [],
      bills: [],
      auditLogs,
    });

    assert.equal(pack.summary.balancedTrialBalance, true);
    assert.equal(pack.summary.balancedBalanceSheet, true);
    assert.equal(pack.summary.revenueCents, 600_000);
    assert.equal(pack.summary.expenseCents, 220_000);
    assert.equal(pack.summary.netIncomeCents, 380_000);
    // Cash = 10,000 + 6,000 - 2,200 = $13,800 (1,380,000 cents) == Equity ($10,000 + $3,800 retained)
    assert.equal(pack.summary.totalAssetsCents, 1_380_000);
    assert.equal(pack.summary.totalEquityWithRetainedCents, 1_380_000);
    assert.equal(pack.summary.auditChainValid, true);
    assert.equal(pack.files.length, 7);
    assert.equal(computeLedgerCloseAnchor(transactions, '2026-11-30').sha256, pack.summary.ledgerAnchorSha256);
  });
});

describe('Strategy 2 — Self-Balancing Dimensions & Self-Proving Intercompany Eliminations', () => {
  test('balanceDimensionLines auto-generates Due From / Due To lines so every self-balancing fund nets to zero', () => {
    const dims: DimensionDefinition[] = [
      { id: 'fund', name: 'Fund', role: 'self-balancing' },
    ];
    const unbalancedTx: Transaction = {
      id: 'tx_fund_1',
      uid: 'u1',
      workspaceId: 'ws1',
      date: '2026-11-10',
      description: 'Grant program expense paid from operating checking',
      totalAmountCents: 100_000,
      currency: 'USD',
      status: 'completed',
      type: 'actual',
      lines: [
        { accountId: 'prog_exp', amountCents: 100_000, dimensions: { fund: 'Restricted Grant' } },
        { accountId: 'op_cash', amountCents: -100_000, dimensions: { fund: 'Operating' } },
      ],
    };

    assert.equal(labelRoleProblems(unbalancedTx, dims).length, 2);

    const balanced = balanceDimensionLines(unbalancedTx, dims, {
      dueFromAccountId: 'due_from',
      dueToAccountId: 'due_to',
    });
    assert.equal(balanced.addedLines.length, 2);
    assert.equal(balanced.lines.reduce((s, l) => s + l.amountCents, 0), 0);

    const balancedTx: Transaction = { ...unbalancedTx, lines: balanced.lines };
    assert.deepEqual(labelRoleProblems(balancedTx, dims), []);
  });

  test('buildSelfProvingEliminations verifies matched bilateral intercompany pairs and flags mismatches', () => {
    const hash = computeIntercompanyIdentityHash({
      sourceWorkspaceId: 'ws_us',
      targetWorkspaceId: 'ws_il',
      sourceTxId: 'tx_src',
      targetTxId: 'tx_dst',
      date: '2026-11-05',
      sourceAmountCents: 500_000,
      targetAmountCents: 500_000,
      sourceCurrency: 'USD',
      targetCurrency: 'USD',
    });

    const srcTx: Transaction = {
      id: 'tx_src', uid: 'u1', workspaceId: 'ws_us', date: '2026-11-05', description: 'IC Transfer', totalAmountCents: 500_000, currency: 'USD', status: 'completed', type: 'actual',
      metadata: { isIntercompany: true, targetWorkspaceId: 'ws_il', targetTxId: 'tx_dst', sharedIdentityHash: hash },
      lines: [
        { accountId: 'ic_from', accountName: 'Intercompany Due From IL', amountCents: 500_000 },
        { accountId: 'cash_us', accountName: 'US Cash', amountCents: -500_000 },
      ],
    };
    const dstTx: Transaction = {
      id: 'tx_dst', uid: 'u1', workspaceId: 'ws_il', date: '2026-11-05', description: 'IC Receipt', totalAmountCents: 500_000, currency: 'USD', status: 'completed', type: 'actual',
      metadata: { isIntercompany: true, sourceWorkspaceId: 'ws_us', sourceTxId: 'tx_src', sharedIdentityHash: hash },
      lines: [
        { accountId: 'cash_il', accountName: 'IL Cash', amountCents: 500_000 },
        { accountId: 'ic_to', accountName: 'Intercompany Due To US', amountCents: -500_000 },
      ],
    };

    const report = buildSelfProvingEliminations([
      { workspaceId: 'ws_us', transactions: [srcTx] },
      { workspaceId: 'ws_il', transactions: [dstTx] },
    ]);
    assert.equal(report.selfProving, true);
    assert.equal(report.totalEliminatedCents, 500_000);
    assert.equal(report.totalDiscrepancyCents, 0);
    assert.equal(
      report.pairs[0].eliminationLines.reduce((s, l) => s + l.amountCents, 0),
      0,
    );
  });
});

describe('Strategy 3 — Property Management, Non-Profit ASC 958 & US+Israel Dual-Tax Wedges', () => {
  test('Property rent roll, tenant ledger, owner statement, and 3-way security deposit trust reconciliation', () => {
    const rentRoll = computePropertyRentRoll(
      [
        { unitId: 'u1', propertyId: 'p1', propertyName: 'Maple Ct', unitLabel: '1A', tenantId: 't1', tenantName: 'Alice', monthlyRentCents: 250_000, leaseEnd: '2027-06-30', securityDepositHeldCents: 250_000 },
        { unitId: 'u2', propertyId: 'p1', propertyName: 'Maple Ct', unitLabel: '1B', tenantId: 't2', tenantName: 'Bob', monthlyRentCents: 200_000, leaseEnd: '2026-12-15', securityDepositHeldCents: 200_000 },
        { unitId: 'u3', propertyId: 'p1', propertyName: 'Maple Ct', unitLabel: '1C', tenantId: null, tenantName: null, monthlyRentCents: 220_000, leaseEnd: null, securityDepositHeldCents: 0 },
      ],
      [],
      '2026-11-11',
    );
    assert.equal(rentRoll.occupiedUnits, 2);
    assert.equal(rentRoll.vacantUnits, 1);
    assert.equal(rentRoll.scheduledMonthlyRentCents, 450_000);
    assert.equal(rentRoll.vacancyLossMonthlyCents, 220_000);
    assert.equal(rentRoll.rows[1].occupancyStatus, 'expiring_soon');

    const tenantLedger = computeTenantLedger(
      't1',
      [{ id: 'i1', uid: 'u', workspaceId: 'ws', customerId: 't1', number: 'RENT-11', date: '2026-11-01', dueDate: '2026-11-05', amountCents: 250_000, status: 'sent' } as Invoice],
      [{ id: 'pay1', uid: 'u', workspaceId: 'ws', customerId: 't1', paymentDate: '2026-11-03', amountCents: 150_000, paymentMethod: 'ach', allocations: [] } as unknown as Payment],
    );
    assert.equal(tenantLedger.endingBalanceCents, 100_000);

    // Owner statement: $10,000 gross rent - $1,500 repairs - 8% ($800) fee - $500 reserve = $7,200 (720,000 cents)
    const ownerStmt = computeOwnerStatement({
      propertyId: 'p1',
      period: { from: '2026-11-01', to: '2026-11-30' },
      managementFeeBps: 800,
      reserveHoldbackCents: 50_000,
      accounts: [
        { id: 'rent_rev', uid: 'u', workspaceId: 'ws', code: '4000', name: 'Rent Income', type: 'revenue', balanceCents: 0 },
        { id: 'repairs', uid: 'u', workspaceId: 'ws', code: '5100', name: 'Repairs', type: 'expense', balanceCents: 0 },
      ],
      transactions: [
        {
          id: 'otx1', uid: 'u', workspaceId: 'ws', date: '2026-11-05', description: 'Rent & Repairs', totalAmountCents: 1_000_000, currency: 'USD', status: 'completed', type: 'actual',
          lines: [
            { accountId: 'rent_rev', amountCents: -1_000_000, location: 'p1' },
            { accountId: 'repairs', amountCents: 150_000, location: 'p1' },
            { accountId: 'cash', amountCents: 850_000, location: 'p1' },
          ],
        },
      ],
    });
    assert.equal(ownerStmt.managementFeeCents, 80_000);
    assert.equal(ownerStmt.netOwnerDistributionCents, 720_000);

    const trustOk = reconcileSecurityDepositTrust({
      asOfDate: '2026-11-30',
      bankStatementTrustCents: 430_000,
      outstandingDepositsCents: 20_000,
      trustCashBookBalanceCents: 450_000,
      trustLiabilityAccountBalanceCents: 450_000,
      tenantSubledgers: [
        { unitId: 'u1', tenantName: 'Alice', heldCents: 250_000 },
        { unitId: 'u2', tenantName: 'Bob', heldCents: 200_000 },
      ],
    });
    assert.equal(trustOk.threeWayBalanced, true);
  });

  test('Non-Profit Statement of Functional Expenses and ASC 958 restriction release', () => {
    const accounts: ChartAccount[] = [
      { id: 'sal', uid: 'u', workspaceId: 'ws', code: '5000', name: 'Salaries & Wages', type: 'expense', balanceCents: 0 },
    ];
    const txs: Transaction[] = [
      {
        id: 'np1', uid: 'u', workspaceId: 'ws', date: '2026-11-10', description: 'Payroll allocation', totalAmountCents: 1_000_000, currency: 'USD', status: 'completed', type: 'actual',
        lines: [
          { accountId: 'sal', amountCents: 800_000, department: 'Program Services' },
          { accountId: 'sal', amountCents: 120_000, department: 'Management & General' },
          { accountId: 'sal', amountCents: 80_000, department: 'Fundraising' },
          { accountId: 'cash', amountCents: -1_000_000 },
        ],
      },
    ];
    const sfe = computeStatementOfFunctionalExpenses(txs, accounts, { from: '2026-11-01', to: '2026-11-30' });
    assert.equal(sfe.programServicesTotalCents, 800_000);
    assert.equal(sfe.managementAndGeneralTotalCents, 120_000);
    assert.equal(sfe.fundraisingTotalCents, 80_000);
    assert.equal(sfe.programEfficiencyBps, 8000); // 80.00%

    const release = buildRestrictionReleaseEntries({
      fundName: 'Youth STEM Grant',
      releaseDate: '2026-11-30',
      qualifyingExpenseCents: 800_000,
      maxAvailableRestrictedCents: 500_000,
      restrictedReleaseAccountId: 'na_restricted_rel',
      unrestrictedReleaseAccountId: 'na_unrestricted_rel',
    });
    assert.equal(release.releasedCents, 500_000);
    assert.equal(release.remainingRestrictedCents, 0);
    assert.equal(release.lines.reduce((s, l) => s + l.amountCents, 0), 0);
  });

  test('US+Israel dual-tax bridge checks IL VAT, ITA Allocation Numbers, Cost-Plus TP, and US 1099s', () => {
    const dual = computeUsIsraelDualTaxSummary({
      ilSalesNetAgorot: 20_000_00,
      ilOutputVatAgorot: 3_600_00,
      ilInputVatRecoverableAgorot: 1_100_00,
      ilDomesticB2bInvoices: [
        { invoiceNumber: 'IL-101', netAmountAgorot: 12_500_00, allocationNumber: '' }, // >= 10,000 ILS without allocation #
        { invoiceNumber: 'IL-102', netAmountAgorot: 15_000_00, allocationNumber: '987654321' },
      ],
      ilOperatingCostAgorot: 100_000_00, // 100,000 ILS * 0.27 = $27,000 USD (2,700,000 cents)
      ilsToUsdRate: 0.27,
      targetCostPlusMarkupBps: 800, // +8% => $29,160 USD (2,916,000 cents)
      intercompanyBilledToUsParentUsdCents: 2_916_000,
      usVendorPayments: [
        { vendorId: 'v1', vendorName: 'Design Studio LLC', paidUsdCents: 75_000, isCorporation: false, hasW9OnFile: false },
        { vendorId: 'v2', vendorName: 'Cloud Corp Inc', paidUsdCents: 500_000, isCorporation: true, hasW9OnFile: false },
      ],
    });
    assert.equal(dual.netIlVatPayableAgorot, 2_500_00);
    assert.deepEqual(dual.missingAllocationInvoices, ['IL-101']);
    assert.equal(dual.expectedArmLengthRechargeUsdCents, 2_916_000);
    assert.equal(dual.transferPricingCompliant, true);
    assert.equal(dual.us1099ReportableCount, 1);
    assert.deepEqual(dual.us1099MissingW9Vendors, ['Design Studio LLC']);
  });
});

describe('Strategy 6 — Learned Customer Days-to-Pay, 13-Week Tax-Safe Runway & Hiring Simulator', () => {
  test('learns late-paying customer behavior, reserves taxes on 13-week runway, and evaluates hiring', () => {
    const invoices: Invoice[] = [
      // Historical paid invoices for CustSlow: Net 30 stated, actually paid in 48 and 50 days (avg 49 days)
      { id: 'h1', uid: 'u', workspaceId: 'ws', customerId: 'c_slow', customerName: 'SlowCo', number: 'INV-1', date: '2026-08-01', dueDate: '2026-08-31', amountCents: 400_000, status: 'paid' } as Invoice,
      { id: 'h2', uid: 'u', workspaceId: 'ws', customerId: 'c_slow', customerName: 'SlowCo', number: 'INV-2', date: '2026-09-01', dueDate: '2026-10-01', amountCents: 400_000, status: 'paid' } as Invoice,
      // Open invoice for SlowCo issued 2026-11-01 (stated due 2026-12-01, but learned collection = +49 days = 2026-12-20!)
      { id: 'open1', uid: 'u', workspaceId: 'ws', customerId: 'c_slow', customerName: 'SlowCo', number: 'INV-3', date: '2026-11-01', dueDate: '2026-12-01', amountCents: 1_000_000, status: 'sent' } as Invoice,
    ];
    const payments: Payment[] = [
      { id: 'p1', uid: 'u', workspaceId: 'ws', customerId: 'c_slow', paymentDate: '2026-09-18', amountCents: 400_000, paymentMethod: 'ach', allocations: [{ documentId: 'h1', documentType: 'invoice', amountCents: 400_000 }] } as unknown as Payment,
      { id: 'p2', uid: 'u', workspaceId: 'ws', customerId: 'c_slow', paymentDate: '2026-10-21', amountCents: 400_000, paymentMethod: 'ach', allocations: [{ documentId: 'h2', documentType: 'invoice', amountCents: 400_000 }] } as unknown as Payment,
    ];

    const learned = learnCustomerPaymentProfiles(invoices, payments);
    const slowProfile = learned.profiles.get('c_slow')!;
    assert.equal(slowProfile.weightedAvgDaysToPay, 49);
    assert.equal(slowProfile.reliabilityTier, 'chronic_late');
    assert.equal(learned.predictedInflows[0].predictedCollectionDate, '2026-12-20');
    assert.equal(learned.predictedInflows[0].expectedDaysShift, 19);

    const runway = computeThirteenWeekTaxSafeRunway({
      startingCashCents: 4_500_000, // $45,000 gross cash
      existingTaxTrustLiabilityCents: 300_000, // $3,000 unremitted sales tax => $42,000 starting spendable
      startDate: '2026-11-11',
      openInvoices: invoices,
      openBills: [],
      payments,
      recurringWeeklyPayrollCents: 150_000,
      recurringWeeklyOpexCents: 50_000,
      estimatedIncomeTaxReserveBps: 2000,
    });
    assert.equal(runway.startingSpendableCashCents, 4_200_000);
    assert.equal(runway.weeks.length, 13);

    // $100,000 base salary + 18% burden = $118,000/yr ($9,833.33/mo) starting Week 8 keeps > $10k cushion
    const comfortable = evaluateHiringAffordability({
      runway,
      annualBaseSalaryCents: 10_000_000,
      payrollBurdenBps: 1800,
      startWeekNumber: 8,
      minSafetyBufferCents: 200_000,
    });
    assert.equal(comfortable.fullyLoadedAnnualCostCents, 11_800_000);
    assert.equal(comfortable.verdict, 'comfortable');

    // Oversized $400,000/yr hire starting Week 1 breaches cash
    const overHire = evaluateHiringAffordability({
      runway,
      annualBaseSalaryCents: 40_000_000,
      payrollBurdenBps: 1800,
      startWeekNumber: 1,
    });
    assert.equal(overHire.verdict, 'wait_or_stage');
    assert.equal(overHire.safetyBufferBreached, true);
  });
});
