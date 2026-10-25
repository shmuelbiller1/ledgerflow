/**
 * Tests for S-05: Idempotency Audit
 *
 * Verifies that endpoints that post money are properly guarded against duplicate posting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllMoneyPostingEndpoints,
  getGuardedEndpoints,
  getUnguardedEndpoints,
  generateIdempotencyAuditReport,
  checkEndpointIdempotency
} from '../server/services/idempotencyAudit';

describe('Idempotency Audit', () => {
  describe('getAllMoneyPostingEndpoints', () => {
    it('should return all money-posting endpoints', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      assert.ok(endpoints.length > 0);
    });

    it('should include transaction endpoints', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const txEndpoints = endpoints.filter(e => e.path.includes('/transactions'));
      assert.ok(txEndpoints.length > 0);
    });

    it('should include invoice endpoints', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const invoiceEndpoints = endpoints.filter(e => e.path.includes('/invoices'));
      assert.ok(invoiceEndpoints.length > 0);
    });

    it('should include payment endpoints', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const paymentEndpoints = endpoints.filter(
        e => e.path.includes('/payments') || e.path.includes('/pay-runs')
      );
      assert.ok(paymentEndpoints.length > 0);
    });
  });

  describe('getGuardedEndpoints', () => {
    it('should return only guarded endpoints', () => {
      const guarded = getGuardedEndpoints();
      assert.ok(guarded.length > 0);
      assert.ok(guarded.every(e => e.guardsAgainstRetry));
    });

    it('should have idempotency mechanisms', () => {
      const guarded = getGuardedEndpoints();
      assert.ok(guarded.every(e => e.idempotencyMechanism !== null));
    });
  });

  describe('getUnguardedEndpoints', () => {
    it('should return unguarded endpoints', () => {
      const unguarded = getUnguardedEndpoints();
      assert.ok(Array.isArray(unguarded));
    });

    it('should return endpoints with recommended fixes', () => {
      const unguarded = getUnguardedEndpoints();
      assert.ok(
        unguarded.every(e => e.recommendedFix && e.recommendedFix.length > 0)
      );
    });
  });

  describe('checkEndpointIdempotency', () => {
    it('should find known guarded endpoints', () => {
      const result = checkEndpointIdempotency('/api/v1/transactions', 'POST');
      assert.strictEqual(result.isGuarded, true);
      assert.ok(result.endpoint !== undefined);
      assert.strictEqual(result.endpoint?.guardsAgainstRetry, true);
    });

    it('should find known unguarded endpoints', () => {
      const result = checkEndpointIdempotency('/api/v1/transactions/:id', 'PUT');
      assert.strictEqual(result.isGuarded, false);
    });

    it('should return undefined for unknown endpoints', () => {
      const result = checkEndpointIdempotency('/api/v1/unknown', 'POST');
      assert.strictEqual(result.isGuarded, false);
      assert.strictEqual(result.endpoint, undefined);
    });
  });

  describe('generateIdempotencyAuditReport', () => {
    it('should generate a report with all sections', () => {
      const report = generateIdempotencyAuditReport();

      assert.ok(report.includes('# Idempotency Audit Report'));
      assert.ok(report.includes('##'));
      assert.ok(report.includes('Total Money-Posting Endpoints:'));
      assert.ok(report.includes('Guarded Endpoints:'));
      assert.ok(report.includes('Unguarded Endpoints:'));
    });

    it('should include guarded endpoints table', () => {
      const report = generateIdempotencyAuditReport();
      assert.ok(report.includes('## ✅ GUARDED ENDPOINTS'));
      assert.ok(report.includes('| Method | Path |'));
    });

    it('should include unguarded endpoints if any exist', () => {
      const report = generateIdempotencyAuditReport();
      const unguarded = getUnguardedEndpoints();

      if (unguarded.length > 0) {
        assert.ok(report.includes('## ⚠️ UNGUARDED ENDPOINTS'));
        assert.ok(report.includes('A retried request CAN post twice!'));
      }
    });

    it('should include recommendations for AI #1 if there are unguarded endpoints', () => {
      const report = generateIdempotencyAuditReport();
      const unguarded = getUnguardedEndpoints();

      if (unguarded.length > 0) {
        assert.ok(report.includes('## 🎯 RECOMMENDATIONS FOR AI #1'));
      }
    });
  });

  describe('endpoint coverage', () => {
    it('should cover transaction creation', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const hasTxCreate = endpoints.some(
        e => e.path === '/api/v1/transactions' && e.method === 'POST'
      );
      assert.strictEqual(hasTxCreate, true);
    });

    it('should cover invoice posting', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const hasInvoicePost = endpoints.some(
        e => e.path.includes('/invoices') && e.method === 'POST'
      );
      assert.strictEqual(hasInvoicePost, true);
    });

    it('should cover payment posting', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const hasPaymentPost = endpoints.some(
        e => e.path.includes('/payments') && e.method === 'POST'
      );
      assert.strictEqual(hasPaymentPost, true);
    });

    it('should cover bill posting', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const hasBillPost = endpoints.some(
        e => e.path.includes('/bills') && e.method === 'POST'
      );
      assert.strictEqual(hasBillPost, true);
    });

    it('should cover payment run posting', () => {
      const endpoints = getAllMoneyPostingEndpoints();
      const hasPayRunPost = endpoints.some(
        e => e.path.includes('/pay-runs') && e.method === 'POST'
      );
      assert.strictEqual(hasPayRunPost, true);
    });
  });

  describe('idempotency mechanism verification', () => {
    it('should verify that guarded endpoints use executeIdempotent', () => {
      const guarded = getGuardedEndpoints();
      const usingExecuteIdempotent = guarded.filter(e =>
        e.idempotencyMechanism?.includes('executeIdempotent')
      );

      assert.ok(usingExecuteIdempotent.length > 0);
    });

    it('should verify that guarded endpoints use executeCommand', () => {
      const guarded = getGuardedEndpoints();
      const usingExecuteCommand = guarded.filter(e =>
        e.idempotencyMechanism?.includes('executeCommand')
      );

      assert.ok(usingExecuteCommand.length > 0);
    });
  });
});

describe('Idempotency Audit - Endpoint Categories', () => {
  it('should categorize endpoints by risk level', () => {
    const endpoints = getAllMoneyPostingEndpoints();
    const highRisk = endpoints.filter(e => e.riskLevel === 'high');
    const mediumRisk = endpoints.filter(e => e.riskLevel === 'medium');
    const lowRisk = endpoints.filter(e => e.riskLevel === 'low');

    assert.ok(highRisk.length > 0);
    assert.ok(mediumRisk.length > 0);
    assert.ok(lowRisk.length >= 0);
  });

  it('should have more guarded than unguarded endpoints', () => {
    const guarded = getGuardedEndpoints();
    const unguarded = getUnguardedEndpoints();

    assert.ok(guarded.length > unguarded.length);
  });
});
