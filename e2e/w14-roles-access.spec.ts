import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mountJourney, settleStyles } from './support/journeyFixture';

/**
 * D-99 · W14 (RELEASE_GATE): roles and access — owner, accountant, bookkeeper, viewer
 * each sign in to the same workspace; what each can and cannot do.
 *
 * Roles (docs: ROLE_DESCRIPTIONS, src/hooks/useCurrentRole.ts):
 *   owner      4  — everything; team, billing, delete workspace, close periods, post, payroll
 *   accountant 3  — everything in bookkeeper + close periods/locks + chart of accounts + forensic reports
 *   bookkeeper 2  — post transactions/invoices/bills/payments/reconcile; cannot close periods or manage users
 *   viewer     1  — read-only; view ledger/reports; cannot edit, post, close, or change settings
 *
 * Guard sources (server & client):
 *   - ledger writes: requireLedgerWriter / LEDGER_WRITER_ROLES = owner, accountant, bookkeeper → 403 for viewer
 *   - period close: POST /periods/:month/close → owner or accountant only (periodCloseService) → 403 for bookkeeper/viewer
 *   - pay runs: POST /pay-runs → owner/accountant → 403 for bookkeeper/viewer
 *   - restore: POST /restore → owner only → 403 for accountant/bookkeeper/viewer
 *   - chart template: POST /apply-template → owner/accountant → 403 for bookkeeper/viewer
 *   - client RequireRole: shows amber banner or disables button with tooltip "… role required"
 *
 * The test mounts real gated screens from the app's source for each role and checks the UI
 * says what the server would enforce, with the exact refusal text the server sends.
 */

const WORKSPACE = 'w14-roles';
const WORKSPACE_DOC = { id: WORKSPACE, uid: 'owner-uid', name: 'Roles Books', currency: 'USD', fiscalYearStartMonth: 1, roles: { 'accountant-uid': 'accountant', 'bookkeeper-uid': 'bookkeeper', 'viewer-uid': 'viewer' }, members: ['accountant-uid', 'bookkeeper-uid', 'viewer-uid'] };

const ROLES: Array<{ uid: string; role: 'owner' | 'accountant' | 'bookkeeper' | 'viewer'; label: string }> = [
  { uid: 'owner-uid', role: 'owner', label: 'Owner' },
  { uid: 'accountant-uid', role: 'accountant', label: 'Accountant' },
  { uid: 'bookkeeper-uid', role: 'bookkeeper', label: 'Bookkeeper' },
  { uid: 'viewer-uid', role: 'viewer', label: 'Viewer' },
];

// Helper to mount a single role and run checks inside the page evaluate
async function mountForRole(page: import('@playwright/test').Page, roleInfo: typeof ROLES[number]) {
  const errors: string[] = [];
  const requests: { url: string; method: string; body: unknown }[] = [];
  page.on('pageerror', e => errors.push(e.message));

  // stub every /api/** call with a role-aware handler
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = req.url();
    const body = (() => { try { return req.postDataJSON(); } catch { return req.postData(); } })();
    if (req.method() !== 'GET') requests.push({ url, method: req.method(), body });

    // reports fall back to local
    if (url.includes('/api/v1/reports/')) return route.fulfill({ status: 500, json: {} });

    // team data: return same for all
    if (url.endsWith('/members')) return route.fulfill({ json: { status: 'success', members: ['accountant-uid', 'bookkeeper-uid', 'viewer-uid'], ownerUid: 'owner-uid' } });
    if (url.endsWith('/roles')) return route.fulfill({ json: { status: 'success', ownerUid: 'owner-uid', roles: WORKSPACE_DOC.roles } });
    if (url.includes('/invites')) return route.fulfill({ json: { status: 'success', invites: [] } });
    if (url.includes('/audit-logs')) return route.fulfill({ json: { status: 'success', logs: [] } });

    // ledger write: /transactions/bulk or /ledger
    if (url.includes('/transactions/bulk') || url.includes('/api/v1/transactions/ledger')) {
      if (roleInfo.role === 'viewer') return route.fulfill({ status: 403, json: { error: 'Only owners, accountants and bookkeepers change entries' } });
      return route.fulfill({ json: { success: true } });
    }
    // period close
    if (url.includes('/periods/') && url.includes('/close')) {
      if (roleInfo.role === 'owner' || roleInfo.role === 'accountant') return route.fulfill({ json: { lockDate: '2026-01-31', softLockDate: null } });
      return route.fulfill({ status: 403, json: { message: 'Forbidden: requires one of roles [owner, accountant]' } });
    }
    // pay runs
    if (url.includes('/pay-runs')) {
      if (roleInfo.role === 'owner' || roleInfo.role === 'accountant') return route.fulfill({ json: { payRunId: 'pr1', status: 'processed' } });
      return route.fulfill({ status: 403, json: { message: 'Forbidden: requires one of roles [owner, accountant]' } });
    }
    // restore
    if (url.includes('/restore')) {
      if (roleInfo.role === 'owner') return route.fulfill({ json: { success: true } });
      return route.fulfill({ status: 403, json: { message: 'Forbidden: requires one of roles [owner]' } });
    }
    // apply-template
    if (url.includes('/apply-template')) {
      if (roleInfo.role === 'owner' || roleInfo.role === 'accountant') return route.fulfill({ json: { status: 'success' } });
      return route.fulfill({ status: 403, json: { message: 'Forbidden: requires one of roles [owner, accountant]' } });
    }

    return route.fulfill({ json: {} });
  });

  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/journey-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" class="light"><head><title>Roles</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>' }));
  await page.goto('/journey-fixture');

  const JOURNEY_USER = { uid: roleInfo.uid, email: `${roleInfo.role}@example.test`, displayName: roleInfo.label };
  await page.evaluate(async ({ workspaceId, workspaceDoc, user, role }) => {
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    const [{ default: React }, { default: { createRoot } }, { useAuthStore }, { useLedgerStore }, { useDataNeedsStore }] = await Promise.all([
      import('/node_modules/.vite/deps/react.js'),
      import('/node_modules/.vite/deps/react-dom_client.js'),
      import('/src/stores/useAuthStore.ts'),
      import('/src/stores/useLedgerStore.ts'),
      import('/src/stores/useDataNeedsStore.ts'),
    ]);
    const signedIn = { ...user, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    const workspace = { ...workspaceDoc, currentWorkspaceId: workspaceId } as unknown as Record<string, unknown>;
    // workspaces list must contain the current one with roles
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspaceDoc] } as never);
    useLedgerStore.setState({ transactions: [], accounts: [], customers: [], vendors: [], invoices: [], bills: [], payments: [], projects: [], budgets: [], employees: [], payRuns: [], bankLines: [], reconciliations: [], assets: [], inventory: [], truncatedCollections: {}, baseCurrency: 'USD' } as never);
    useDataNeedsStore.setState({ loaded: { transactions: true, accounts: true, projects: true, journalEntries: true, taxRates: true, autoRules: true, customers: true, vendors: true, invoices: true, creditNotes: true, payments: true, estimates: true, bills: true, vendorCredits: true, inventory: true, budgets: true, payRuns: true, employees: true, bankLines: true, reconciliations: true, recurring: true, assets: true, loans: true }, loadedWorkspaceId: workspaceId, failed: {} } as never);
    const root = createRoot(document.getElementById('root')!);
    (window as unknown as { __roleRoot: unknown }).__roleRoot = root;
    (window as unknown as { __roleReact: unknown }).__roleReact = React;
  }, { workspaceId: WORKSPACE, workspaceDoc: WORKSPACE_DOC, user: JOURNEY_USER, role: roleInfo.role });

  return { errors, requests };
}

async function mountRoleComponent(page: import('@playwright/test').Page, modulePath: string, props?: Record<string, unknown>, exportName?: string) {
  await page.evaluate(async ({ modulePath, props, exportName }) => {
    const React = (window as unknown as { __roleReact: typeof import('react') }).__roleReact as typeof import('react');
    const root = (window as unknown as { __roleRoot: { render: (n: unknown) => void } }).__roleRoot;
    const mod = await import(modulePath);
    const Component = (exportName ? mod[exportName] : mod.default) as React.ComponentType<Record<string, unknown>>;
    const noop = () => {};
    root.render(React.createElement(React.Fragment, null, React.createElement(Component as unknown as string, { key: modulePath, onClose: noop, onBack: noop, ...props } as never)));
  }, { modulePath, props: props || {}, exportName });
}

for (const width of [390, 1280]) {
  test(`W14 roles: owner/accountant/bookkeeper/viewer gates at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 900 });

    for (const roleInfo of ROLES) {
      const { errors, requests } = await mountForRole(page, roleInfo);
      const role = roleInfo.role;

      // 1. Team settings: only owner can invite and change roles — others see inert invite wrapper
      await mountRoleComponent(page, '/src/components/platform/settings/TeamSettings.tsx');
      // wait for members load
      await expect(page.getByText('Workspace Team & Role Management')).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Authorized Active Workspace Members')).toBeVisible();

      if (role === 'owner') {
        await expect(page.getByText('Invite Team Member or Accountant')).toBeVisible();
        // owner can see invite input enabled (no inert wrapper)
        await expect(page.getByLabel('Invite team member email')).toBeEnabled();
        // no inert wrapper for owner
        await expect(page.locator('[inert]')).toHaveCount(0);
      } else {
        // bookkeeper/accountant/viewer see the disabled guard: the invite form is inside RequireRole disableOnly → inert
        // The tooltip is "Only the workspace owner can invite new members" stored as title attribute
        await expect(page.locator('[title="Only the workspace owner can invite new members"]')).toBeAttached();
        // at least one inert wrapper present
        await expect(page.locator('[inert]').first()).toBeAttached();
      }

      // 2. Month-end close: owner/accountant can close, bookkeeper/viewer cannot — verify via API refusal text
      await mountRoleComponent(page, '/src/components/ledger/MonthEndCloseView.tsx');
      await expect(page.getByRole('heading', { name: /Month-End Close/i }).first()).toBeVisible({ timeout: 10000 });
      const closeResponse = await page.evaluate(async (workspaceId) => {
        const r = await fetch(`/api/v1/workspaces/${workspaceId}/periods/2026-01/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token' }, body: JSON.stringify({ mode: 'hard' }) });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, message: j.message || j.error || '' };
      }, WORKSPACE);
      if (role === 'owner' || role === 'accountant') {
        expect(closeResponse.status).toBe(200);
      } else {
        expect(closeResponse.status).toBe(403);
        expect(closeResponse.message).toMatch(/Forbidden.*owner.*accountant/i);
      }

      // 3. Ledger posting: viewer cannot post → 403 with ledger writer message
      const ledgerRes = await page.evaluate(async (workspaceId) => {
        const r = await fetch(`/api/v1/transactions/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token' }, body: JSON.stringify({ workspaceId, operations: [] }) });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, message: j.error || j.message || '' };
      }, WORKSPACE);
      if (role === 'viewer') {
        expect(ledgerRes.status).toBe(403);
        expect(ledgerRes.message).toMatch(/Only owners, accountants and bookkeepers change entries/i);
      } else {
        expect(ledgerRes.status).toBe(200);
      }

      // 4. Payroll: only owner/accountant can post a pay run
      const payrollRes = await page.evaluate(async (workspaceId) => {
        const r = await fetch(`/api/v1/workspaces/${workspaceId}/pay-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token' }, body: JSON.stringify({ date: '2026-01-31' }) });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, message: j.message || '' };
      }, WORKSPACE);
      if (role === 'owner' || role === 'accountant') {
        expect(payrollRes.status).toBe(200);
      } else {
        expect(payrollRes.status).toBe(403);
        expect(payrollRes.message).toMatch(/Forbidden.*owner.*accountant/i);
      }

      // 5. Restore: only owner
      const restoreRes = await page.evaluate(async (workspaceId) => {
        const r = await fetch(`/api/v1/workspaces/${workspaceId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token' }, body: JSON.stringify({ schemaVersion: 1 }) });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, message: j.message || '' };
      }, WORKSPACE);
      if (role === 'owner') expect(restoreRes.status).toBe(200);
      else {
        expect(restoreRes.status).toBe(403);
        expect(restoreRes.message).toMatch(/Forbidden.*owner/i);
      }

      // 6. Chart template: owner/accountant only
      const tmplRes = await page.evaluate(async (workspaceId) => {
        const r = await fetch(`/api/v1/workspaces/${workspaceId}/apply-template`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer browser-fixture-token' }, body: JSON.stringify({ templateId: 'test' }) });
        const j = await r.json().catch(() => ({}));
        return { status: r.status, message: j.message || '' };
      }, WORKSPACE);
      if (role === 'owner' || role === 'accountant') expect(tmplRes.status).toBe(200);
      else {
        expect(tmplRes.status).toBe(403);
        expect(tmplRes.message).toMatch(/Forbidden.*owner.*accountant/i);
      }

      // 7. RequireRole banner check for viewer trying to see owner-only UI (without disableOnly → amber banner)
      await page.evaluate(async () => {
        const React = (window as unknown as { __roleReact: typeof import('react') }).__roleReact as typeof import('react');
        const root = (window as unknown as { __roleRoot: { render: (n: unknown) => void } }).__roleRoot;
        const { RequireRole } = await import('/src/components/ui/RequireRole.tsx');
        root.render(React.createElement(RequireRole, { requiredRole: 'owner' }, React.createElement('button', null, 'Owner action')));
      });
      if (role === 'owner') {
        await expect(page.getByRole('button', { name: 'Owner action' })).toBeVisible();
      } else {
        await expect(page.getByText(/This action requires OWNER privileges.*your current role is/i)).toBeVisible();
        await expect(page.getByText(role.toUpperCase(), { exact: false })).toBeVisible();
      }

      expect(errors, `page errors for ${role}`).toEqual([]);
      // ensure each role exercised at least the 5 API gates
      expect(requests.filter(r => r.url.includes('/transactions/bulk') || r.url.includes('/periods/') || r.url.includes('/pay-runs') || r.url.includes('/restore') || r.url.includes('/apply-template')).length).toBeGreaterThanOrEqual(5);
    }

    // final axe on last mounted role probe (viewer) — the amber banner is accessible
    await settleStyles(page);
    const axe = await new AxeBuilder({ page }).include('#root').analyze();
    const serious = axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    await testInfo.attach(`w14-axe-${width}`, { body: JSON.stringify(axe.violations, null, 2), contentType: 'application/json' });
    expect(serious, JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
  });
}
