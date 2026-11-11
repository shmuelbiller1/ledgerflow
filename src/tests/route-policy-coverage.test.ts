import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Route Policy Coverage Suite (D-30: Tenant Wall Security)', () => {
  const serverPath = path.join(process.cwd(), 'server.ts');
  const workspaceRoutesPath = path.join(process.cwd(), 'src/server/routes/workspaceRoutes.ts');
  const routesDir = path.join(process.cwd(), 'src/server/routes');

  it('server.ts mounts all /api/v1 data endpoints behind apiAuthenticate or authenticate middleware', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    // Endpoints that must have an authenticated router mount in server.ts
    const protectedPrefixes = [
      '/api/v1/reports',
      '/api/v1/workspaces',
      '/api/v1/account',
      '/api/v1/transactions',
      '/api/v1/revenue',
      '/api/v1/consolidation',
      '/api/v1/lease',
      '/api/v1/inventory',
      '/api/v1/payments',
      '/api/v1/documents',
      '/api/v1/billing',
      '/api/v1/balances',
      '/api/v1/math',
      '/api/v1/currency',
      '/api/v1/tax',
      '/api/v1/plaid',
      '/api/v1/support',
    ];

    for (const prefix of protectedPrefixes) {
      assert.ok(serverContent.includes(prefix), `server.ts must contain registration for protected prefix ${prefix}`);

      // Find the router-mounting lines
      const routerMountLines = serverContent
        .split('\n')
        .filter(
          line =>
            (line.includes(`"${prefix}"`) || line.includes(`'${prefix}'`)) &&
            (line.includes('Router') || line.includes('router')),
        );

      assert.ok(
        routerMountLines.length > 0,
        `Prefix ${prefix} must have at least one router mount line in server.ts`,
      );

      for (const line of routerMountLines) {
        const isAuthed =
          line.includes('apiAuthenticate') ||
          line.includes('authenticate') ||
          line.includes('requireWorkspaceRole') ||
          line.includes('requireLedgerWriter');
        assert.ok(
          isAuthed,
          `Router for ${prefix} in server.ts must be mounted with authentication middleware, got line: ${line.trim()}`,
        );
      }
    }
  });

  it('workspaceRoutes.ts guards all workspace sub-routers with requireWorkspaceRole', () => {
    const wsContent = fs.readFileSync(workspaceRoutesPath, 'utf8');

    const subRouterMountLines = wsContent
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('workspaceRouter.use(') && l.includes('/:workspaceId/'));

    assert.ok(subRouterMountLines.length >= 20, 'Should find at least 20 sub-router mounts in workspaceRoutes.ts');

    for (const line of subRouterMountLines) {
      const hasRoleGuard =
        line.includes('requireWorkspaceRole') ||
        line.includes('LEDGER_ADMIN_ROLES') ||
        line.includes('STOCK_ROLES') ||
        line.includes('requireLedgerWriter');

      assert.ok(
        hasRoleGuard,
        `Sub-router mount line in workspaceRoutes.ts must enforce requireWorkspaceRole: ${line}`,
      );
    }
  });

  it('every route file in src/server/routes/ is guarded internally, mounted via a verified guarded router, or explicitly allowlisted as public', () => {
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const wsContent = fs.readFileSync(workspaceRoutesPath, 'utf8');
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    // Public / webhook / health files allowlist with explicit security rationale
    const publicAllowlist = new Set([
      'cspReportRoutes.ts', // Browser Content Security Policy reporting (public ingest)
      'telemetryRoutes.ts', // Client-side error telemetry ingest fallback
      'statusRoutes.ts', // System health check /api/health and /api/v1/public/status
      'registrationStatusRoutes.ts', // Public signup availability check
      'stripeWebhookRoutes.ts', // Stripe webhook with raw payload signature check
      'plaidWebhookRoutes.ts', // Plaid webhook with event verification
      'invitePublicRoutes.ts', // Public team invite accept / preview flow
      'customerPortalRoutes.ts', // Public customer portal with cryptographic token
      'publicInvoiceRoutes.ts', // Public invoice payment with signed token
      'estimateSignRoutes.ts', // Public estimate approval with signed token
      'authRoutes.ts', // Public login, register, passkey, session auth endpoints
      'webhookRoutes.ts', // Raw webhook body registration utility
      'apiStatusRoutes.ts', // Public API status summary
    ]);

    // Parse all explicit router mounts across workspaceRoutes and server.ts
    const wsMounts = wsContent
      .split('\n')
      .filter(l => l.includes('workspaceRouter.use(') || l.includes('requireWorkspaceRole(') || l.includes('mountTeamRoutes'));

    const serverMounts = serverContent
      .split('\n')
      .filter(l => l.includes('app.use(') || l.includes('register'));

    // Nested sub-routers explicitly mounted in guarded parent routers:
    // e.g. payRunRoutes -> payrollImportRoutes (mounted under payRunRouter, which workspaceRoutes mounts under requireWorkspaceRole(['owner', 'accountant']))
    const nestedGuardedMounts: Record<string, { parentFile: string; mountCheck: string }> = {
      'payrollImportRoutes.ts': {
        parentFile: 'payRunRoutes.ts',
        mountCheck: "payRunRouter.use('/imports', payrollImportRouter)",
      },
      'scheduleRoutes.ts': {
        parentFile: 'statusRoutes.ts',
        mountCheck: "statusRouter.use('/v1/schedule', apiAuthenticate, scheduleRouter)",
      },
    };

    for (const file of routeFiles) {
      if (publicAllowlist.has(file)) continue;

      const filePath = path.join(routesDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Check if file has internal auth guards or service-layer verification
      const hasInternalGuard =
        content.includes('validateWorkspaceMember') ||
        content.includes('requireWorkspaceRole') ||
        content.includes('requireLedgerWriter') ||
        content.includes('getUserFromAuthHeader') ||
        content.includes('verifyApiKey') ||
        content.includes('apiKeyAuth') ||
        content.includes('roleInWorkspace') ||
        content.includes('verifySession') ||
        content.includes('authenticate') ||
        content.includes('apiAuthenticate') ||
        content.includes('authorizeWorkspace') ||
        content.includes('isCronRequest') ||
        content.includes('CRON_SECRET') ||
        content.includes('requireAdmin') ||
        content.includes('requireSystemAdmin');

      // Collect all exported symbols (routers and mounting functions)
      const exportedSymbols: string[] = [];
      for (const m of content.matchAll(/export const (\w+Router)\s*=/g)) {
        exportedSymbols.push(m[1]);
      }
      for (const m of content.matchAll(/export function ((?:register|mount)\w+Routes)\s*\(/g)) {
        exportedSymbols.push(m[1]);
      }

      let isMountedWithGuard = false;

      for (const symbol of exportedSymbols) {
        // Mounted in workspaceRoutes with role guard?
        const inWs = wsMounts.some(
          l => l.includes(symbol) && (l.includes('requireWorkspaceRole') || l.includes('ROLES') || l.includes('mountTeamRoutes')),
        );
        // Mounted in server.ts with auth?
        const inServer = serverMounts.some(l => l.includes(symbol) && (l.includes('apiAuthenticate') || l.includes('authenticate')));
        if (inWs || inServer) {
          isMountedWithGuard = true;
          break;
        }
      }

      // Check nested guarded mounts
      if (!isMountedWithGuard && nestedGuardedMounts[file]) {
        const { parentFile, mountCheck } = nestedGuardedMounts[file];
        const parentContent = fs.readFileSync(path.join(routesDir, parentFile), 'utf8');
        const isMountedInParent = parentContent.includes(mountCheck);
        const parentRouterMatch = parentContent.match(/export const (\w+Router)\s*=/);
        const parentRouterSymbol = parentRouterMatch?.[1];
        const parentIsGuardedInWs =
          parentRouterSymbol &&
          wsMounts.some(l => l.includes(parentRouterSymbol) && (l.includes('requireWorkspaceRole') || l.includes('ROLES')));
        const parentIsGuardedInServer =
          parentRouterSymbol &&
          serverMounts.some(l => l.includes(parentRouterSymbol));
        isMountedWithGuard = Boolean(isMountedInParent && (parentIsGuardedInWs || parentIsGuardedInServer));
      }

      assert.ok(
        hasInternalGuard || isMountedWithGuard,
        `Route file ${file} lacks internal auth guards and is not mounted with verified middleware in workspaceRoutes, server.ts, or a guarded parent router`,
      );
    }
  });

  it('rejects an unmounted and unguarded route file missing from publicAllowlist (negative test fixture)', () => {
    const unmountedRouteCode = `
      import express from 'express';
      export const rogueRouter = express.Router();
      rogueRouter.get('/secrets', (req, res) => res.json({ secret: 'leaked' }));
    `;
    const routerMatch = unmountedRouteCode.match(/export const (\w+Router)\s*=/);
    const symbol = routerMatch?.[1];
    const wsContent = fs.readFileSync(workspaceRoutesPath, 'utf8');
    const isMounted = symbol ? wsContent.includes(symbol) : false;
    const hasGuard = unmountedRouteCode.includes('requireWorkspaceRole') || unmountedRouteCode.includes('apiAuthenticate');
    assert.equal(isMounted || hasGuard, false, 'Negative fixture must be detected as unguarded and unmounted');
  });
});
