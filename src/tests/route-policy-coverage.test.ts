import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseAppRegistration(line: string): { verb: string; routeExpr: string; middleware: string[] } | null {
  const m = /^app\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|"[^"]*"|'[^']*')\s*,([\s\S]*)$/.exec(line.trim());
  if (!m) return null;
  const middleware: string[] = [];
  for (const part of splitTopLevel(m[3])) {
    const p = part.trim();
    if (/^(async\s*)?\(?\s*(req|_req)\b\s*[:,)]/.test(p) || /^(async\s*)?\(\s*req\b/.test(p)) break;
    const name = /^([A-Za-z_$][\w$]*)/.exec(p)?.[1];
    if (name) middleware.push(name);
    else break;
  }
  return { verb: m[1].toUpperCase(), routeExpr: m[2], middleware };
}

describe('Route Policy Coverage Suite (D-30 / F-02: Per-Registration & Tenant Wall Security)', () => {
  const serverPath = path.join(process.cwd(), 'server.ts');
  const workspaceRoutesPath = path.join(process.cwd(), 'src/server/routes/workspaceRoutes.ts');
  const routesDir = path.join(process.cwd(), 'src/server/routes');

  it('server.ts mounts all /api/v1 data endpoints behind apiAuthenticate or authenticate middleware', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');

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

  it('inspects every individual app.<verb>(...) registration across src/server/routes/ and server.ts (F-02)', () => {
    // Documented public/webhook/telemetry ingest routes registered directly on `app`
    const PUBLIC_APP_ROUTES = new Set([
      'GET "/api/v1/openapi.json"',
      'GET "/api/v1/public/registration-status"',
      "POST '/api/webhook/plaid'",
      "POST '/api/webhook/stripe'",
      'POST "/api/v1/telemetry/errors"',
      'POST CSP_REPORT_PATH',
    ]);

    const filesToCheck = [
      serverPath,
      ...fs
        .readdirSync(routesDir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map(f => path.join(routesDir, f)),
    ];

    let inspectedCount = 0;
    const unguarded: string[] = [];
    const missingAdminGuard: string[] = [];

    for (const filePath of filesToCheck) {
      const rel = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        const reg = parseAppRegistration(line);
        if (!reg) return;
        inspectedCount++;
        const key = `${reg.verb} ${reg.routeExpr}`;
        if (PUBLIC_APP_ROUTES.has(key)) return;

        const hasAuthMiddleware =
          reg.middleware.includes('authenticate') ||
          reg.middleware.includes('apiAuthenticate') ||
          reg.middleware.includes('requireSystemJobOrAdmin');

        if (!hasAuthMiddleware) {
          unguarded.push(`${rel}:${idx + 1}: ${key} [middleware: ${reg.middleware.join(', ') || 'none'}]`);
        }

        if (/\/api\/v1\/admin\//.test(reg.routeExpr)) {
          if (!reg.middleware.includes('authenticate') || !reg.middleware.includes('requireAdmin')) {
            missingAdminGuard.push(`${rel}:${idx + 1}: ${key} [middleware: ${reg.middleware.join(', ') || 'none'}]`);
          }
        }
      });
    }

    assert.ok(inspectedCount >= 45, `Expected at least 45 direct app.<verb> registrations, inspected ${inspectedCount}`);
    assert.deepEqual(
      unguarded,
      [],
      `Direct app.<verb> registrations missing auth middleware:\n${unguarded.join('\n')}`,
    );
    assert.deepEqual(
      missingAdminGuard,
      [],
      `/api/v1/admin/* registrations missing authenticate + requireAdmin:\n${missingAdminGuard.join('\n')}`,
    );
  });

  it('every router file in src/server/routes/ is mounted via a verified guarded router or explicitly allowlisted as public', () => {
    const routeFiles = fs
      .readdirSync(routesDir)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    const wsContent = fs.readFileSync(workspaceRoutesPath, 'utf8');
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    const publicAllowlist = new Set([
      'cspReportRoutes.ts',
      'telemetryRoutes.ts',
      'statusRoutes.ts',
      'registrationStatusRoutes.ts',
      'stripeWebhookRoutes.ts',
      'plaidWebhookRoutes.ts',
      'invitePublicRoutes.ts',
      'customerPortalRoutes.ts',
      'publicInvoiceRoutes.ts',
      'estimateSignRoutes.ts',
      'emailRoutes.ts', // emailWebhookRouter verifies provider token; emailRouter is mounted in workspaceRoutes
      'cronRoutes.ts', // verifies CRON_SECRET on every job invocation
      'aiRoutes.ts', // verifies Bearer token + validateWorkspaceMember internally
      'webhookRoutes.ts',
      'apiStatusRoutes.ts',
    ]);

    const wsMounts = wsContent
      .split('\n')
      .filter(l => l.includes('workspaceRouter.use(') || l.includes('requireWorkspaceRole(') || l.includes('mountTeamRoutes'));

    const serverMounts = serverContent
      .split('\n')
      .filter(l => l.includes('app.use(') || l.includes('register'));

    const nestedGuardedMounts: Record<string, { parentFile: string; mountCheck: string }> = {
      'payrollImportRoutes.ts': {
        parentFile: 'payRunRoutes.ts',
        mountCheck: "payRunRouter.use('/imports', payrollImportRouter)",
      },
      'scheduleRoutes.ts': {
        parentFile: 'statusRoutes.ts',
        mountCheck: "statusRouter.use('/v1/schedule', apiAuthenticate, scheduleRouter)",
      },
      'giveAccessRoutes.ts': {
        parentFile: 'adminRoutes.ts',
        mountCheck: 'registerGiveAccessRoutes(app)',
      },
      'documentPostRoutes.ts': {
        parentFile: 'documentRoutes.ts',
        mountCheck: 'documentRouter.use(documentPostRouter)',
      },
      'operationalReportRoutes.ts': {
        parentFile: 'reportRoutes.ts',
        mountCheck: 'reportRouter.use(operationalReportRouter)',
      },
      'landedCostRoutes.ts': {
        parentFile: 'inventoryRoutes.ts',
        mountCheck: "inventoryRouter.use('/landed-cost', landedCostRouter)",
      },
      'stockClosingRoutes.ts': {
        parentFile: 'inventoryRoutes.ts',
        mountCheck: 'registerStockClosingRoutes(inventoryRouter)',
      },
      'taskRoutes.ts': {
        parentFile: 'workspaceRoutes.ts',
        mountCheck: 'mountTeamRoutes(',
      },
    };

    for (const file of routeFiles) {
      if (publicAllowlist.has(file)) continue;

      const filePath = path.join(routesDir, file);
      const content = fs.readFileSync(filePath, 'utf8');

      const exportedRouters = [...content.matchAll(/export const (\w+Router)\s*=/g)].map(m => m[1]);
      const exportedRegistrars = [...content.matchAll(/export function ((?:register|mount)\w+Routes)\s*\(/g)].map(m => m[1]);

      let isGuarded = false;

      // Direct app registrars are verified registration-by-registration in the F-02 test above
      if (exportedRegistrars.length > 0 && exportedRouters.length === 0) {
        const mountedInServerOrWs = exportedRegistrars.some(
          sym => serverMounts.some(l => l.includes(sym)) || wsMounts.some(l => l.includes(sym)),
        );
        const mountedNested = Boolean(nestedGuardedMounts[file]);
        isGuarded = mountedInServerOrWs || mountedNested;
      }

      for (const symbol of exportedRouters) {
        const inWs = wsMounts.some(
          l => l.includes(symbol) && (l.includes('requireWorkspaceRole') || l.includes('ROLES') || l.includes('mountTeamRoutes')),
        );
        const inServer = serverMounts.some(l => l.includes(symbol) && (l.includes('apiAuthenticate') || l.includes('authenticate')));
        if (inWs || inServer) {
          isGuarded = true;
          break;
        }
      }

      if (!isGuarded && nestedGuardedMounts[file]) {
        const { parentFile, mountCheck } = nestedGuardedMounts[file];
        const parentContent = fs.readFileSync(path.join(routesDir, parentFile), 'utf8');
        isGuarded = parentContent.includes(mountCheck);
      }

      assert.ok(
        isGuarded,
        `Router file ${file} is not mounted with verified auth middleware in workspaceRoutes, server.ts, or a guarded parent router`,
      );
    }
  });

  it('rejects an unguarded app.<verb> registration (negative test fixture)', () => {
    const parsed = parseAppRegistration('app.post("/api/v1/admin/integrity/orphan-scan", authenticate, async (req, res) => {');
    assert.ok(parsed);
    assert.equal(
      parsed.middleware.includes('authenticate') && parsed.middleware.includes('requireAdmin'),
      false,
      'Missing requireAdmin on an /api/v1/admin/* route must be flagged',
    );
  });
});
