import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { mountJourney, remountJourney } from './support/journeyFixture';
import { expectNoNewAccessibilityIssues } from './support/a11yGate';

/**
 * D-99 · W14 (RELEASE_GATE): roles and access. The same books, four people — owner, accountant,
 * bookkeeper, viewer — each signed in, and what each of them can and cannot do.
 *
 * The allowed roles are not written into this test. They are read from the server's own source
 * (the module a route is registered with), so a role list that changes on the server fails this
 * journey until the screens agree with it:
 *
 *   - closing a period ............ CLOSE_ROLES, src/lib/periodLock.ts (`closePeriod` in
 *                                  src/server/services/periodCloseService.ts refuses others with
 *                                  "Only <roles> can close a period")
 *   - pay runs .................... workspaceRoutes.ts, `/:workspaceId/pay-runs`
 *   - restore a backup ............ workspaceApiRoutes.ts, `/restore`
 *   - chart of accounts template .. workspaceRoutes.ts, `/:workspaceId/apply-template`
 *   - changing the books .......... LEDGER_WRITER_ROLES, src/server/middleware/requireLedgerWriter.ts
 *   - team members ................ workspaceApiRoutes.ts, `/members` (owner only)
 *
 * What this journey asserts in the browser, per role:
 *   1. Team settings: only the roles the server lets manage members can actually invite; everyone
 *      else gets the guarded (inert) control with the reason, and pressing it changes nothing.
 *   2. Month-end close: only the closing roles get close controls; everyone else is told who closes
 *      and is offered the sign-off work they are allowed to do.
 *   3. The reports are readable by every role, including the viewer.
 *   4. The shared role gate explains a blocked action to the viewer and allows it for the owner.
 *
 * The server middleware itself is asserted in the unit suite (`src/tests/server-write-roles.test.ts`,
 * period-close and pay-run tests); this journey checks the screens agree with it.
 */

const WORKSPACE = 'w14-roles';

type Role = 'owner' | 'accountant' | 'bookkeeper' | 'viewer';
const ROLES: Role[] = ['owner', 'accountant', 'bookkeeper', 'viewer'];

// ---------------------------------------------------------------------------------------------
// The server's policy, read from the source that enforces it
//
// Read inside the tests, never at load: a spec that throws while Playwright collects the files stops
// the whole browser run, and a role list this test cannot find must fail these checks with a reason,
// not take every other screen's test down with it.
// ---------------------------------------------------------------------------------------------
function source(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

function rolesFrom(sourceText: string, anchor: string): Role[] {
  const at = sourceText.indexOf(anchor);
  if (at < 0) throw new Error(`the route "${anchor}" is not in the server source any more`);
  const match = /requireWorkspaceRole\(\[([^\]]*)\]\)/.exec(sourceText.slice(at, at + 500));
  if (!match) throw new Error(`"${anchor}" has no requireWorkspaceRole([...]) after it`);
  return match[1].split(',').map(part => part.trim().replace(/['"`]/g, '') as Role).filter(Boolean);
}

interface Policy {
  close: Role[];
  payRun: Role[];
  restore: Role[];
  accountTemplate: Role[];
  members: Role[];
  ledgerWrite: Role[];
}

let cachedPolicy: Policy | null = null;

/** The role lists the server enforces, read from the files that enforce them. */
function serverPolicy(): Policy {
  if (cachedPolicy) return cachedPolicy;
  const workspaceRoutes = source('src/server/routes/workspaceRoutes.ts');
  const workspaceApiRoutes = source('src/server/routes/workspaceApiRoutes.ts');
  const ledgerWriter = source('src/server/middleware/requireLedgerWriter.ts');
  const close = (() => {
    const match = /CLOSE_ROLES[^=]*=\s*\[([^\]]*)\]/.exec(source('src/lib/periodLock.ts'));
    if (!match) throw new Error('CLOSE_ROLES is not in src/lib/periodLock.ts any more');
    return match[1].split(',').map(part => part.trim().replace(/['"`]/g, '') as Role).filter(Boolean);
  })();
  const ledgerWrite = (() => {
    const match = /LEDGER_WRITER_ROLES\s*=\s*\[([^\]]*)\]/.exec(ledgerWriter);
    if (!match) throw new Error('LEDGER_WRITER_ROLES is not in requireLedgerWriter.ts any more');
    return match[1].split(',').map(part => part.trim().replace(/['"`]/g, '') as Role).filter(Boolean);
  })();
  cachedPolicy = {
    close,
    payRun: rolesFrom(workspaceRoutes, "'/:workspaceId/pay-runs'"),
    restore: rolesFrom(workspaceApiRoutes, 'app.post("/api/v1/workspaces/:workspaceId/restore"'),
    accountTemplate: rolesFrom(workspaceRoutes, "'/:workspaceId/apply-template'"),
    members: rolesFrom(workspaceApiRoutes, 'app.post("/api/v1/workspaces/:workspaceId/members"'),
    ledgerWrite,
  };
  return cachedPolicy;
}

/** "owner, accountant" → "Owners and accountants", the words the screen uses for the same rule. */
const roleWords = (roles: Role[]) => roles.map(role => role[0].toUpperCase() + role.slice(1) + 's').join(' and ');

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------
async function signInAs(page: Page, role: Role) {
  return mountJourney(page, {
    workspaceId: WORKSPACE,
    role,
    ownerUid: 'owner-uid',
    ledger: {
      accounts: [
        { id: 'cash', uid: 'owner-uid', workspaceId: WORKSPACE, code: '1000', name: 'Cash', type: 'asset', category: 'Cash', openingBalanceCents: 100000 },
        { id: 'rev', uid: 'owner-uid', workspaceId: WORKSPACE, code: '4000', name: 'Sales', type: 'income', category: 'Revenue', openingBalanceCents: 0 },
      ],
      transactions: [],
      journalEntries: [],
      employees: [],
      payRuns: [],
    },
    mounts: [{ module: '/src/components/platform/settings/TeamSettings.tsx' }],
    api: request => {
      // reports fall back to the ledger the app already has
      if (request.url.includes('/api/v1/reports/')) return { status: 500, json: {} };
      if (request.url.endsWith('/members')) return { json: { status: 'success', members: [], ownerUid: 'owner-uid' } };
      if (request.url.endsWith('/roles')) return { json: { status: 'success', roles: {} } };
      if (request.url.includes('/invites')) return { json: { status: 'success', invites: [] } };
      if (request.url.includes('/audit-logs')) return { json: { status: 'success', logs: [] } };
      if (request.url.includes('/periods/')) return { json: { status: 'success', lockDate: null, softLockDate: null } };
      return null;
    },
  });
}

for (const width of [390, 1280]) {
  test(`W14 roles: owner, accountant, bookkeeper and viewer on the same books at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 900 });
    const POLICY = serverPolicy();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    for (const role of ROLES) {
      const canManageMembers = POLICY.members.includes(role);
      const canClose = POLICY.close.includes(role);

      const { errors } = await signInAs(page, role);
      await expect(page.getByText('Workspace Team & Role Management')).toBeVisible({ timeout: 15000 });

      // ---- 1. team settings: can this role actually invite someone? -------------------------
      // The server allows only POLICY.members; the screen must allow exactly those and explain
      // the refusal to everybody else.
      const guard = page.locator('[title="Only the workspace owner can invite new members"]');
      const editInvite = page.getByRole('textbox', { name: 'Invite team member email' });

      if (canManageMembers) {
        await expect(guard).toHaveCount(0);
        await expect(editInvite).toBeEnabled();
        // and it really works: the invite field opens for typing
        await editInvite.fill('person@example.test');
        await expect(page.getByRole('button', { name: 'Send invite' })).toBeEnabled();
      } else {
        // the guarded control is inert: not clickable, not focusable, not pressable with a key
        await expect(guard, `the invite form is guarded for ${role}`).toHaveCount(1);
        await expect(guard).toHaveAttribute('inert', '');
        await expect(guard).toHaveAttribute('aria-disabled', 'true');
        await expect(guard).toHaveAttribute('title', 'Only the workspace owner can invite new members');
        await expect(page.getByRole('textbox', { name: 'Invite team member email' })).toHaveCount(0);
      }

      // ---- 2. month-end close: who may close? ---------------------------------------------
      await remountJourney(page, [{ module: '/src/components/ledger/MonthEndCloseView.tsx' }]);
      await expect(page.getByRole('heading', { name: /Month-End Close/ }).first()).toBeVisible({ timeout: 15000 });
      const softClose = page.getByRole('button', { name: /Soft close/ });
      const notYours = page.getByText(new RegExp(`${roleWords(POLICY.close)} close and reopen periods`, 'i'));

      if (canClose) {
        await expect(softClose).toBeVisible();
        await expect(notYours).toHaveCount(0);
      } else {
        await expect(softClose, `no close control for ${role}`).toHaveCount(0);
        // the screen names the same roles the server does, instead of just failing on click
        await expect(notYours).toBeVisible();
      }

      // ---- 3. reports are readable by every role, including the viewer ---------------------
      await remountJourney(page, [{ module: '/src/components/ledger/ProfitAndLossView.tsx', props: { startDate: '2026-01-01', endDate: '2026-01-31' } }]);
      await expect(page.getByText('Profit & Loss Statement')).toBeVisible({ timeout: 15000 });

      // ---- 4. the shared gate: blocked for the viewer, open to the owner -------------------
      await page.evaluate(async () => {
        type ProbeWindow = { __gateCalls: number; __gateRoot?: { unmount: () => void; render: (node: unknown) => void } };
        const probe = window as unknown as ProbeWindow;
        probe.__gateRoot?.unmount();
        document.getElementById('role-gate-probe')?.remove();
        const React = (await import('/node_modules/.vite/deps/react.js')).default;
        const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
        const { RequireRole } = await import('/src/components/ui/RequireRole.tsx');
        const host = document.createElement('div');
        host.id = 'role-gate-probe';
        document.body.append(host);
        probe.__gateCalls = 0;
        probe.__gateRoot = createRoot(host);
        probe.__gateRoot.render(
          React.createElement(RequireRole, { role: 'owner' },
            React.createElement('button', { onClick: () => { probe.__gateCalls += 1; } }, 'Owner action')),
        );
      });

      if (role === 'owner') {
        await page.getByRole('button', { name: 'Owner action' }).click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __gateCalls: number }).__gateCalls)).toBe(1);
      } else {
        await expect(page.getByRole('button', { name: 'Owner action' })).toHaveCount(0);
        await expect(page.getByText(/This action requires OWNER privileges\. Your current role is [A-Z]+\./)).toBeVisible();
        await expect(page.getByText(new RegExp(`your current role is ${role}`, 'i'))).toBeVisible();
      }

      expect(errors, `page errors while signed in as ${role}`).toEqual([]);
    }

    // no settleStyles() here: the screen being checked is a live report with running animations, and
    // waiting for every animation to stop would wait forever. Axe does not need them to be finished.
    await expectNoNewAccessibilityIssues(page, `w14:profit-and-loss:${width}`, testInfo, { exclude: '#role-gate-probe' });

    expect(pageErrors, 'page errors').toEqual([]);
  });
}

test('W14 the role lists the screens use are the server’s own lists', () => {
  const POLICY = serverPolicy();
  const ledgerWriter = source('src/server/middleware/requireLedgerWriter.ts');
  // Every list must be non-empty, and the wider "may change the books" list must contain the
  // narrower "may close the books" one — otherwise a bookkeeper could be refused by the close
  // screen for a permission the server does grant.
  for (const [name, roles] of Object.entries(POLICY)) {
    expect(roles.length, `${name} has at least one role`).toBeGreaterThan(0);
  }
  for (const role of POLICY.close) {
    expect(POLICY.ledgerWrite, 'a closing role may change the books').toContain(role);
  }
  for (const role of POLICY.payRun) {
    expect(POLICY.ledgerWrite, 'a payroll role may change the books').toContain(role);
  }
  // the viewer is never allowed to change, close or restore anything
  expect(POLICY.ledgerWrite).not.toContain('viewer');
  expect(POLICY.close).not.toContain('viewer');
  expect(POLICY.restore).not.toContain('viewer');
  // and the refusal the server sends names those same roles
  expect(ledgerWriter).toContain('Forbidden: changing the books requires the owner, accountant or bookkeeper role');
});
