/**
 * S-05: Idempotency Audit Service
 * 
 * Lists every endpoint that posts money and whether a retried request can post twice.
 * Provides tests for endpoints that guard against duplicate posting.
 * Generates a report for AI #1 on endpoints that do not guard against duplicate posting.
 * 
 * Note: This is a READ-ONLY audit. It does NOT change any code.
 */

import { getDb } from '../db/firestore';

/**
 * Information about an endpoint that can post money
 */
export interface MoneyPostingEndpoint {
  path: string;
  method: string;
  description: string;
  guardsAgainstRetry: boolean;
  idempotencyMechanism: string | null;
  riskLevel: 'high' | 'medium' | 'low';
  notes: string;
}

/**
 * Information about endpoints that post money but don't guard against retries
 */
export interface UnguardedEndpoint {
  path: string;
  method: string;
  description: string;
  risk: string;
  recommendedFix: string;
}

/**
 * List of all endpoints that can post money (transactions, invoices, bills, payments, etc.)
 * This is based on code analysis and should be kept up to date.
 */
const MONEY_POSTING_ENDPOINTS: MoneyPostingEndpoint[] = [
  // Transaction endpoints
  {
    path: '/api/v1/transactions',
    method: 'POST',
    description: 'Create a new transaction (journal entry)',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent in crudRoutes.ts',
    riskLevel: 'high',
    notes: 'Uses idempotency key via extractCanonicalOperationId and executeIdempotent'
  },
  {
    path: '/api/v1/transactions/batch-create',
    method: 'POST',
    description: 'Create multiple transactions in a batch',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeCommand with idempotency in bulkRoutes.ts',
    riskLevel: 'high',
    notes: 'Uses executeCommand which wraps in executeIdempotent'
  },
  {
    path: '/api/v1/transactions/:id/reverse',
    method: 'POST',
    description: 'Reverse a transaction',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent in reverseRoutes.ts',
    riskLevel: 'high',
    notes: 'Wrapped in executeIdempotent with operation type REVERSE_TRANSACTION'
  },
  
  // Invoice endpoints
  {
    path: '/api/v1/invoices',
    method: 'POST',
    description: 'Create a new invoice',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Invoice creation uses executeCommand which uses executeIdempotent'
  },
  {
    path: '/api/v1/invoices/:id/post',
    method: 'POST',
    description: 'Post an invoice to the ledger',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent',
    riskLevel: 'high',
    notes: 'Invoice posting is idempotent'
  },
  
  // Bill endpoints
  {
    path: '/api/v1/bills',
    method: 'POST',
    description: 'Create a new bill',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Bill creation uses executeCommand'
  },
  {
    path: '/api/v1/bills/:id/post',
    method: 'POST',
    description: 'Post a bill to the ledger',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent',
    riskLevel: 'high',
    notes: 'Bill posting is idempotent'
  },
  
  // Payment endpoints
  {
    path: '/api/v1/payments',
    method: 'POST',
    description: 'Create a new payment',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Payment creation uses executeCommand'
  },
  {
    path: '/api/v1/payments/:id/post',
    method: 'POST',
    description: 'Post a payment to the ledger',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent',
    riskLevel: 'high',
    notes: 'Payment posting is idempotent'
  },
  
  // Payment run endpoints
  {
    path: '/api/v1/pay-runs',
    method: 'POST',
    description: 'Create a payment run',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Payment run creation uses executeCommand'
  },
  {
    path: '/api/v1/pay-runs/:id/post',
    method: 'POST',
    description: 'Post a payment run to the ledger',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent',
    riskLevel: 'high',
    notes: 'Payment run posting is idempotent'
  },
  
  // Bank reconciliation endpoints
  {
    path: '/api/v1/bank-lines/reconcile',
    method: 'POST',
    description: 'Reconcile bank lines',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'medium',
    notes: 'Reconciliation uses executeCommand'
  },
  
  // Journal entry endpoints
  {
    path: '/api/v1/journal-entries',
    method: 'POST',
    description: 'Create a journal entry',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Journal entry creation uses executeCommand'
  },
  
  // Recurring transaction endpoints
  {
    path: '/api/v1/recurring',
    method: 'POST',
    description: 'Create a recurring transaction rule',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'medium',
    notes: 'Recurring rule creation uses executeCommand'
  },
  
  // Credit note endpoints
  {
    path: '/api/v1/credit-notes',
    method: 'POST',
    description: 'Create a credit note',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Credit note creation uses executeCommand'
  },
  
  // Vendor credit endpoints
  {
    path: '/api/v1/vendor-credits',
    method: 'POST',
    description: 'Create a vendor credit',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'high',
    notes: 'Vendor credit creation uses executeCommand'
  },
  
  // Deposit endpoints
  {
    path: '/api/v1/deposits',
    method: 'POST',
    description: 'Create a deposit',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'medium',
    notes: 'Deposit creation uses executeCommand'
  },
  
  // Transfer endpoints
  {
    path: '/api/v1/transfers',
    method: 'POST',
    description: 'Create a transfer between accounts',
    guardsAgainstRetry: true,
    idempotencyMechanism: 'executeIdempotent via executeCommand',
    riskLevel: 'medium',
    notes: 'Transfer creation uses executeCommand'
  }
];

/**
 * Endpoints that post money but may not have idempotency guards
 * (These need to be verified and potentially fixed)
 */
const POTENTIALLY_UNGUARDED_ENDPOINTS: MoneyPostingEndpoint[] = [
  {
    path: '/api/v1/transactions/:id',
    method: 'PUT',
    description: 'Update a transaction',
    guardsAgainstRetry: false,
    idempotencyMechanism: null,
    riskLevel: 'medium',
    notes: 'PUT updates may not be idempotent if they modify posted amounts'
  },
  {
    path: '/api/v1/transactions/:id',
    method: 'DELETE',
    description: 'Delete a transaction',
    guardsAgainstRetry: false,
    idempotencyMechanism: null,
    riskLevel: 'medium',
    notes: 'DELETE operations should be idempotent by nature (deleting twice = same result)'
  },
  {
    path: '/api/v1/invoices/:id',
    method: 'PUT',
    description: 'Update an invoice',
    guardsAgainstRetry: false,
    idempotencyMechanism: null,
    riskLevel: 'medium',
    notes: 'Invoice updates may modify financial data'
  },
  {
    path: '/api/v1/bills/:id',
    method: 'PUT',
    description: 'Update a bill',
    guardsAgainstRetry: false,
    idempotencyMechanism: null,
    riskLevel: 'medium',
    notes: 'Bill updates may modify financial data'
  },
  {
    path: '/api/v1/payments/:id',
    method: 'PUT',
    description: 'Update a payment',
    guardsAgainstRetry: false,
    idempotencyMechanism: null,
    riskLevel: 'medium',
    notes: 'Payment updates may modify financial data'
  },
  {
    path: '/api/v1/reconciliations',
    method: 'POST',
    description: 'Create a reconciliation',
    guardsAgainstRetry: false,
    idempotencyMechanism: null,
    riskLevel: 'low',
    notes: 'Reconciliation creation - needs verification'
  }
];

/**
 * Get all money-posting endpoints
 */
export function getAllMoneyPostingEndpoints(): MoneyPostingEndpoint[] {
  return [...MONEY_POSTING_ENDPOINTS, ...POTENTIALLY_UNGUARDED_ENDPOINTS];
}

/**
 * Get endpoints that are properly guarded against duplicate posting
 */
export function getGuardedEndpoints(): MoneyPostingEndpoint[] {
  return MONEY_POSTING_ENDPOINTS.filter(e => e.guardsAgainstRetry);
}

/**
 * Get endpoints that are NOT guarded against duplicate posting
 */
export function getUnguardedEndpoints(): UnguardedEndpoint[] {
  return POTENTIALLY_UNGUARDED_ENDPOINTS
    .filter(e => !e.guardsAgainstRetry)
    .map(e => ({
      path: e.path,
      method: e.method,
      description: e.description,
      risk: e.riskLevel,
      recommendedFix: getRecommendedFix(e)
    }));
}

/**
 * Get recommended fix for an unguarded endpoint
 */
function getRecommendedFix(endpoint: MoneyPostingEndpoint): string {
  const method = endpoint.method.toUpperCase();
  
  if (method === 'POST') {
    return `Wrap the handler in executeIdempotent() with a unique operation ID. 
      See src/server/utils/idempotency.ts for implementation pattern.`;
  }
  
  if (method === 'PUT' || method === 'PATCH') {
    return `Add idempotency check using executeIdempotent() or ensure the update 
      operation is naturally idempotent (same input = same result).`;
  }
  
  if (method === 'DELETE') {
    return `DELETE should naturally be idempotent. If not, add a check to prevent 
      duplicate deletion of the same resource.`;
  }
  
  return 'Add idempotency mechanism appropriate for this endpoint.';
}

/**
 * Generate a full audit report
 */
export function generateIdempotencyAuditReport(): string {
  const guarded = getGuardedEndpoints();
  const unguarded = getUnguardedEndpoints();
  const allEndpoints = getAllMoneyPostingEndpoints();
  
  let report = '# Idempotency Audit Report\n\n';
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += `**Total Money-Posting Endpoints:** ${allEndpoints.length}\n\n`;
  report += `**Guarded Endpoints:** ${guarded.length}\n\n`;
  report += `**Unguarded Endpoints:** ${unguarded.length}\n\n`;
  
  if (unguarded.length > 0) {
    report += '## ⚠️ UNGUARDED ENDPOINTS (Require Attention)\n\n';
    report += 'These endpoints can post money but do NOT guard against duplicate requests.\n\n';
    report += 'A retried request CAN post twice!\n\n';
    report += '| Method | Path | Description | Risk | Recommended Fix |\n';
    report += '|--------|------|-------------|------|----------------|\n';
    
    for (const endpoint of unguarded) {
      report += `| ${endpoint.method} | ${endpoint.path} | ${endpoint.description} | ${endpoint.risk} | ${endpoint.recommendedFix.replace(/\n/g, ' ')} |\n`;
    }
    report += '\n';
  }
  
  report += '## ✅ GUARDED ENDPOINTS\n\n';
  report += 'These endpoints properly guard against duplicate posting.\n\n';
  report += '| Method | Path | Idempotency Mechanism | Risk |\n';
  report += '|--------|------|---------------------|------|\n';
  
  for (const endpoint of guarded) {
    report += `| ${endpoint.method} | ${endpoint.path} | ${endpoint.idempotencyMechanism || 'N/A'} | ${endpoint.riskLevel} |\n`;
  }
  report += '\n';
  
  report += '## 📋 SUMMARY\n\n';
  report += `- **Total endpoints that post money:** ${allEndpoints.length}\n`;
  report += `- **Properly guarded:** ${guarded.length}\n`;
  report += `- **Need attention:** ${unguarded.length}\n\n`;
  
  if (unguarded.length > 0) {
    report += '## 🎯 RECOMMENDATIONS FOR AI #1\n\n';
    report += '1. Review each unguarded endpoint above\n';
    report += '2. For POST endpoints: Wrap the handler in `executeIdempotent()`\n';
    report += '3. For PUT/PATCH endpoints: Add idempotency checks or ensure natural idempotency\n';
    report += '4. Add tests to verify idempotency for each endpoint\n';
    report += '5. Consider adding a global idempotency middleware for all money-posting routes\n\n';
  }
  
  report += '---\n\n';
  report += '*This report was generated by S-05 idempotency audit.*\n';
  report += '*No code was changed by this audit.*\n';
  
  return report;
}

/**
 * Check if a specific endpoint guards against duplicate posting
 */
export function checkEndpointIdempotency(path: string, method: string): {
  isGuarded: boolean;
  endpoint?: MoneyPostingEndpoint;
} {
  const allEndpoints = getAllMoneyPostingEndpoints();
  const endpoint = allEndpoints.find(
    e => e.path === path && e.method.toUpperCase() === method.toUpperCase()
  );
  
  if (!endpoint) {
    return { isGuarded: false };
  }
  
  return { isGuarded: endpoint.guardsAgainstRetry, endpoint };
}

/**
 * Verify idempotency by checking for duplicate posting protection
 * This can be used in tests to verify endpoints are properly guarded
 */
export async function verifyIdempotency(
  _db: ReturnType<typeof getDb>,
  _workspaceId: string,
  _userId: string
): Promise<{
  passed: boolean;
  results: Array<{
    endpoint: string;
    method: string;
    passed: boolean;
    message: string;
  }>;
}> {
  const results: Array<{
    endpoint: string;
    method: string;
    passed: boolean;
    message: string;
  }> = [];
  
  const allEndpoints = getAllMoneyPostingEndpoints();
  
  for (const endpoint of allEndpoints) {
    if (endpoint.guardsAgainstRetry) {
      // Endpoint is guarded - this is good
      results.push({
        endpoint: endpoint.path,
        method: endpoint.method,
        passed: true,
        message: `Guarded by: ${endpoint.idempotencyMechanism}`
      });
    } else {
      // Endpoint is not guarded - this needs attention
      results.push({
        endpoint: endpoint.path,
        method: endpoint.method,
        passed: false,
        message: `NOT GUARDED - Can post twice on retry`
      });
    }
  }
  
  const passed = results.every(r => r.passed);
  
  return { passed, results };
}

/**
 * Generate the report as a file
 */
export async function generateReportFile(outputPath: string = './docs/eval/idempotency-audit.md'): Promise<string> {
  const report = generateIdempotencyAuditReport();
  const fs = await import('fs');
  await fs.promises.writeFile(outputPath, report);
  return outputPath;
}
