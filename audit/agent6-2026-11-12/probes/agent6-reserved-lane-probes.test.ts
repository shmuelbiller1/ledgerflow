import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { calculateFederalIncomeTaxWithholding } from '../../../src/lib/tax/usFederalPayroll';
import { planFxRevaluation } from '../../../src/lib/fxRevaluation';
import { buildAuditLogRecord, verifyAuditHashChain } from '../../../src/server/services/auditLogService';
import { GENESIS_AUDIT_HASH } from '../../../src/lib/auditHashChain';

describe('Agent #6 (2026-11-12) — Reserved-Lane Reproducer Probes & Patch Verification', () => {
  test('All 7 standalone reserved-lane patches exist and pass git apply --check cleanly together', () => {
    const patchDir = path.resolve('audit/agent6-2026-11-12/patches');
    const patches = fs.readdirSync(patchDir).filter(f => f.endsWith('.patch')).sort();
    assert.equal(patches.length, 7);
    const fullPaths = patches.map(p => path.join(patchDir, p));
    execFileSync('git', ['apply', '--check', ...fullPaths], { stdio: 'pipe' });
  });

  test('Probe AF6-004: IRS Pub 15-T Step-2 brackets currently over-withhold $1,892/yr on two $52k Single jobs (fixed by Patch 02)', () => {
    const singleCombined104k = calculateFederalIncomeTaxWithholding(10400000, 'single', false, 'annually', '2026-05-01');
    const twoStep2Jobs52k = 2 * calculateFederalIncomeTaxWithholding(5200000, 'single', true, 'annually', '2026-05-01');
    // Pre-patch discrepancy: 2 * 22% * $4,300 = $1,892.00 (189,200 cents)
    assert.equal(singleCombined104k, 1341000);
    assert.equal(twoStep2Jobs52k - singleCombined104k, 189200);
  });

  test('Probe AF6-005: planFxRevaluation currently understates JPY revaluation by 100x ($0.03 instead of $3.00; fixed by Patch 03)', () => {
    const plan = planFxRevaluation(
      [{
        id: 'inv-jpy-1',
        side: 'customer',
        number: 'INV-JPY-1',
        partyName: 'Tokyo Client',
        currency: 'JPY',
        status: 'sent',
        amountCents: 10000, // ¥10,000
        exchangeRate: 0.0067, // $67.00 USD booked
        accountId: 'ar-1',
        accountName: 'Accounts Receivable',
      }],
      (ccy) => (ccy === 'JPY' ? 0.007 : undefined),
      { id: 'fx-gl', name: 'Unrealized FX Gain/Loss' },
      'USD',
      '2026-10-31',
    );
    // Pre-patch: 70 - 67 = 3 cents ($0.03) instead of 7000 - 6700 = 300 cents ($3.00)
    assert.equal(plan.details[0]?.deltaCents, 3);
  });

  test('Probe AF6-006: auditLogService.verifyAuditHashChain currently fails on entryHash-linked records produced by writeServerAuditLog (fixed by Patch 04)', () => {
    const e1 = buildAuditLogRecord(
      {
        workspaceId: 'ws-probe',
        uid: 'u-1',
        action: 'INVOICE_POSTED',
        entityType: 'invoice',
        entityId: 'inv-1',
        details: { description: 'Entry 1' },
        timestamp: '2026-11-12T00:00:00.000Z',
      },
      'aud-1',
      { seq: 1, prevHash: GENESIS_AUDIT_HASH },
    );
    // writeServerAuditLog passes prev.entryHash (NOT prev.chainHash) as the next entry's prevHash
    const e2 = buildAuditLogRecord(
      {
        workspaceId: 'ws-probe',
        uid: 'u-1',
        action: 'PAYMENT_POSTED',
        entityType: 'payment',
        entityId: 'pay-1',
        details: { description: 'Entry 2' },
        timestamp: '2026-11-12T00:01:00.000Z',
      },
      'aud-2',
      { seq: 2, prevHash: e1.entryHash },
    );
    assert.deepEqual(verifyAuditHashChain([e1, e2]), { valid: false, brokenAtId: 'aud-2' });
  });
});
