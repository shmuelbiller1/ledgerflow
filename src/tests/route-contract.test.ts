import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

describe('Route Contract Guard Suite (§0c Route Contract)', () => {
  it('every fetch endpoint called in client code should match a server route or allow-listed display string', () => {
    const srcDir = path.join(process.cwd(), 'src');
    const apiEndpoints: Set<string> = new Set();

    function scanFiles(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'server' && entry.name !== 'node_modules') {
            scanFiles(fullPath);
          }
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const matches = content.match(/['"]\/api\/[^'"]+['"]/g);
          if (matches) {
            for (const match of matches) {
              const endpoint = match.slice(1, -1);
              apiEndpoints.add(endpoint);
            }
          }
        }
      }
    }

    scanFiles(srcDir);

    // Allow-list for display strings, documentation examples, or mock paths
    const allowList = new Set([
      '/api/v1/audit/jobs/job_1701234567_abcd', // Display text in ApiHub documentation
      '/api/v1/auth/revoke-sessions', // Auth action endpoint UI placeholder
      '/api/v1/auth/delete-account', // Auth action endpoint UI placeholder
      '/api/v1/keys/provision', // API key UI endpoint
      '/api/v1/admin/global-config', // Admin system config route
      '/api/v1/admin/give-access', // ACC-1 Give access (giveAccessRoutes.ts, registered from adminRoutes.ts)
      '/api/v1/forensics/anomaly-scan', // Forensics route
      '/api/v1/public/registration-status', // Public registration status
      '/api/v1/status', // Developer API workspace status (server.ts), shown in ApiHub
      '/api/v1/telemetry/errors' // Error logging fallback endpoint
    ]);

    // Known server route prefixes
    const knownRoutePrefixes = [
      '/api/ai',
      '/api/v1/ai',
      '/api/health',
      '/api/upload-bank-csv',
      '/api/v1/transactions',
      '/api/v1/billing',
      '/api/v1/workspaces',
      '/api/v1/account',
      '/api/v1/reports',
      '/api/v1/balances',
      '/api/v1/revenue',
      '/api/v1/consolidation',
      '/api/v1/lease',
      '/api/v1/inventory',
      '/api/v1/repost', // EG-1 repost run and queue (server.ts repostRouter)
      '/api/v1/fx',
      '/api/v1/support',
      '/api/v1/payments',
      '/api/v1/documents',
      '/api/v1/open-items', // EG-1 open-item import (server.ts)
      '/api/v1/invoices',
      '/api/v1/email-events',
      '/api/v1/invites',
      '/api/v1/plaid',
      '/api/v1/currency', // rates (server.ts currencyRouter), used by the group summary's translation (Z-17)
      '/api/v1/math',
      '/api/v1/system',
      '/api/v1/public/status',
      '/api/v1/schedule' // Settings → Schedule (BB-06), mounted with the status router
    ];

    const missingRoutes: string[] = [];

    for (const endpoint of apiEndpoints) {
      if (allowList.has(endpoint)) continue;

      const matchesKnown = knownRoutePrefixes.some(prefix => endpoint.startsWith(prefix));
      if (!matchesKnown) {
        missingRoutes.push(endpoint);
      }
    }

    assert.equal(
      missingRoutes.length,
      0,
      `Client code calls unhandled API endpoints without server routes: ${missingRoutes.join(', ')}`
    );
  });
});
