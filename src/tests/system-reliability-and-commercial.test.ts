import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { setCachedReport, getCachedReport, invalidateReportCache } from '../lib/reportCache';
import { generateSearchTokens, searchTransactions } from '../lib/serverSearch';
import { retryWithBackoff } from '../lib/retryUtils';
import { checkVersionConflict, resolveConflictLWW, VersionedEntity } from '../lib/conflictEngine';
import { evaluateApprovalRequirement } from '../lib/approvalWorkflow';
import { addComment, getCommentsForEntity } from '../lib/commentService';
import { t } from '../locales/i18n';
import { Transaction, Invoice } from '../types';

describe('System Reliability, Commercial & Platform Utilities Suite', () => {

  describe('1. Report Caching & Invalidation (Item 60)', () => {
    test('getCachedReport returns cached data before TTL expiry and clears on invalidation', () => {
      setCachedReport('trial_balance_ws1', { netBalanceCents: 50000 }, 10000);
      
      const cached = getCachedReport<{ netBalanceCents: number }>('trial_balance_ws1');
      assert.equal(cached?.netBalanceCents, 50000);

      invalidateReportCache('trial_balance');
      const cleared = getCachedReport('trial_balance_ws1');
      assert.equal(cleared, null);
    });
  });

  describe('2. Server Search Tokens & Query Filter (Item 61)', () => {
    test('generateSearchTokens produces lowercase n-gram prefixes', () => {
      const tokens = generateSearchTokens('Acme Corp', '10000');
      assert.ok(tokens.includes('acme'));
      assert.ok(tokens.includes('ac'));
      assert.ok(tokens.includes('corp'));
    });

    test('searchTransactions filters by payee, amount, and description', () => {
      const mockTx: Transaction[] = [
        {
          id: 'tx_s1',
          uid: 'usr_1',
          workspaceId: 'ws_1',
          date: '2026-09-01',
          description: 'Consulting Services Invoice',
          payee: 'Stark Industries',
          totalAmountCents: 45000,
          currency: 'USD',
          status: 'completed',
          type: 'income',
          createdAt: '2026-09-01T00:00:00Z',
          lines: [{ accountId: 'a1', accountName: 'Revenue', amountCents: -45000 }]
        }
      ];

      assert.equal(searchTransactions(mockTx, 'Stark').length, 1);
      assert.equal(searchTransactions(mockTx, '45000').length, 1);
      assert.equal(searchTransactions(mockTx, 'NonExistent').length, 0);
    });
  });

  describe('3. Retry with Backoff Utility (Item 72)', () => {
    test('retryWithBackoff retries failed promises and succeeds on subsequent attempts', async () => {
      let attempts = 0;
      const result = await retryWithBackoff(async () => {
        attempts++;
        if (attempts < 2) throw new Error('Transient Network Flake');
        return 'SUCCESS';
      }, { maxRetries: 3, initialDelayMs: 10 });

      assert.equal(result, 'SUCCESS');
      assert.equal(attempts, 2);
    });
  });

  describe('4. Version Conflict Engine (Item 73)', () => {
    test('checkVersionConflict flags conflict when server entity is newer than client expectation', () => {
      const clientEntity: VersionedEntity = { id: 'inv_1', expectedUpdatedAt: '2026-09-17T10:00:00Z', _version: 1 };
      const serverEntity: VersionedEntity = { id: 'inv_1', updatedAt: '2026-09-17T10:05:00Z', _version: 2 };

      const conflict = checkVersionConflict(clientEntity, serverEntity);
      assert.equal(conflict.hasConflict, true);
      assert.ok(conflict.reason?.includes('modified'));

      const resolved = resolveConflictLWW(clientEntity, serverEntity);
      assert.equal(resolved._version, 2);
    });
  });

  describe('5. Approval Workflow Engine (Item 128)', () => {
    test('evaluateApprovalRequirement requires approval when invoice exceeds rule threshold', () => {
      const rule = {
        id: 'rule_1',
        workspaceId: 'ws_1',
        entityType: 'invoice' as const,
        thresholdCents: 1000000, // $10,000 threshold
        approverRoles: ['owner' as const],
        autoApproveBelowThreshold: true
      };

      const highInvoice: Invoice = {
        id: 'inv_large',
        uid: 'usr_1',
        workspaceId: 'ws_1',
        customerId: 'cust_stark',
        amountCents: 2500000, // $25,000
        dueDate: '2026-10-01',
        status: 'draft'
      };

      const evalRes = evaluateApprovalRequirement(highInvoice, 'invoice', rule);
      assert.equal(evalRes.requiresApproval, true);
      assert.equal(evalRes.autoApproved, false);
    });
  });

  describe('6. Comments Service & Demo Seeder & i18n (Items 129, 139, 144)', () => {
    test('addComment attaches audit notes to transaction records', () => {
      const c = addComment({
        workspaceId: 'ws_1',
        entityType: 'transaction',
        entityId: 'tx_s1',
        authorEmail: 'cfo@company.com',
        comment: 'Verified with bank receipt #9912'
      });

      assert.ok(c.id);
      const list = getCommentsForEntity('transaction', 'tx_s1');
      assert.equal(list.length, 1);
      assert.equal(list[0].comment, 'Verified with bank receipt #9912');
    });

    test('i18n translation dictionary resolves keys across locales', () => {
      assert.equal(t('common.save', 'en'), 'Save Changes');
      assert.equal(t('common.save', 'es'), 'Guardar Cambios');
      assert.equal(t('common.save', 'fr'), 'Enregistrer');
    });
  });
});
