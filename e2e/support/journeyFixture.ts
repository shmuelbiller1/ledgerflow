import { expect, type Page, type Request } from '@playwright/test';

/**
 * Shared harness for the W-journey browser tests (F-41…F-45, RELEASE_GATE W2, W3, W4, W6, W9).
 *
 * The real screens are mounted from the app's own source modules inside a fixture page
 * (`/journey-fixture`), against the app's own stores. Nothing talks to a database:
 *  - every `/rest/v1/**` read returns an empty list (the stores are seeded by the test instead);
 *  - every `/api/**` call is answered by the test's handler and recorded, so the request body the
 *    screen sends can be checked against the worked figures;
 *  - the collections are marked as already loaded, so no screen fetches over the stubbed boundary.
 */

export const JOURNEY_USER = { uid: 'journey-user', email: 'owner@example.test', displayName: 'Journey Owner' };

export interface JourneyMount {
  /** source module path, e.g. '/src/components/sales/ReceivePaymentModal.tsx' */
  module: string;
  /** named export; the default export when omitted */
  exportName?: string;
  /** JSON-serialisable props; `onClose` and `onBack` are supplied by the fixture. "__capture:name" makes a callback that records its arguments (see captured()). */
  props?: Record<string, unknown>;
}

export interface JourneyRequest {
  url: string;
  method: string;
  body: unknown;
}

export interface JourneyApiReply {
  status?: number;
  json: unknown;
}

export type JourneyApiHandler = (request: JourneyRequest) => JourneyApiReply | null;

export interface JourneyOptions {
  workspaceId: string;
  /** ledger collections seeded into useLedgerStore (keys are the store field names) */
  ledger: Record<string, unknown[]>;
  mounts: JourneyMount[];
  /** optional: answers /api/** calls; unanswered calls get an empty object */
  api?: JourneyApiHandler;
  /** workspace role for the signed-in test user (defaults to owner) */
  role?: 'owner' | 'accountant' | 'bookkeeper' | 'viewer';
}

export interface JourneyHandle {
  errors: string[];
  requests: JourneyRequest[];
}

const LEDGER_FIELDS = [
  'accounts', 'bankLines', 'transactions', 'invoices', 'bills', 'payments', 'customers', 'vendors',
  'creditNotes', 'vendorCredits', 'journalEntries', 'assets', 'estimates', 'projects', 'inventory',
  'taxRates', 'autoRules', 'budgets', 'payRuns', 'employees', 'reconciliations', 'recurring', 'loans',
] as const;

const LOADED_KEYS = [
  'transactions', 'accounts', 'projects', 'journalEntries', 'taxRates', 'autoRules', 'customers', 'vendors',
  'invoices', 'creditNotes', 'payments', 'estimates', 'bills', 'vendorCredits', 'inventory', 'budgets',
  'payRuns', 'employees', 'bankLines', 'reconciliations', 'recurring', 'assets', 'loans',
];

/** Opens the fixture page, stubs the database and API boundary, and mounts the given screens. */
export async function mountJourney(page: Page, options: JourneyOptions): Promise<JourneyHandle> {
  const errors: string[] = [];
  const requests: JourneyRequest[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));

  await page.route('**/api/**', async route => {
    const request: Request = route.request();
    const url = request.url();
    const body = (() => { try { return request.postDataJSON(); } catch { return request.postData(); } })();
    const record: JourneyRequest = { url, method: request.method(), body };
    if (request.method() !== 'GET') requests.push(record);
    const reply = options.api?.(record);
    if (reply) return route.fulfill({ status: reply.status ?? 200, json: reply.json });
    return route.fulfill({ json: {} });
  });

  await page.route('**/journey-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html lang="en" class="light"><head><title>LedgerFlow journey</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div></body></html>',
  }));
  await page.goto('/journey-fixture');

  const user = JOURNEY_USER;
  const ledger: Record<string, unknown[]> = {};
  for (const field of LEDGER_FIELDS) ledger[field] = options.ledger[field] ?? [];

  await page.evaluate(async ({ workspaceId, user, role, ledger, mounts, loadedKeys, ledgerFields }) => {
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
    const workspace = {
      id: workspaceId, uid: user.uid, name: 'Journey Books', currency: 'USD', fiscalYearStartMonth: 1,
      roles: { [user.uid]: role },
    };
    useAuthStore.setState({ user: signedIn, isGuest: false, currentWorkspaceId: workspaceId, workspaces: [workspace] } as never);

    const ledgerState: Record<string, unknown> = { truncatedCollections: {}, baseCurrency: 'USD' };
    for (const field of ledgerFields) ledgerState[field] = ledger[field] ?? [];
    useLedgerStore.setState(ledgerState as never);

    const loaded: Record<string, boolean> = {};
    for (const key of loadedKeys) loaded[key] = true;
    useDataNeedsStore.setState({ loaded, loadedWorkspaceId: workspaceId, failed: {} } as never);

    const root = createRoot(document.getElementById('root')!);
    const noop = () => {};
    const renderMounts = async (list: Array<{ module: string; exportName?: string; props?: Record<string, unknown> }>) => {
      const children: unknown[] = [];
      for (const mount of list) {
        const mod = await import(mount.module);
        const Component = (mount.exportName ? mod[mount.exportName] : mod.default) as React.ComponentType<Record<string, unknown>>;
        // A prop written as "__capture:name" becomes a function that records its arguments for the test (read with captured()).
        const props: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(mount.props ?? {})) {
          if (typeof value === 'string' && value.startsWith('__capture:')) {
            const name = value.slice('__capture:'.length);
            props[key] = (...args: unknown[]) => {
              const captures = ((window as unknown as { __captures?: Record<string, unknown[]> }).__captures ??= {});
              (captures[name] ??= []).push(JSON.parse(JSON.stringify(args)));
              return true;
            };
          } else if (typeof value === 'string' && value === '__fn:formatCurrency') {
            props[key] = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
          } else if (typeof value === 'string' && value === '__fn:noop') {
            props[key] = () => {};
          } else props[key] = value;
        }
        children.push(React.createElement(Component, { key: mount.module + (mount.exportName ?? ''), onClose: noop, onBack: noop, ...props }));
      }
      root.render(React.createElement(React.Fragment, null, ...children));
    };
    (window as unknown as { __journeyRender: typeof renderMounts }).__journeyRender = renderMounts;
    await renderMounts(mounts);
  }, { workspaceId: options.workspaceId, user, role: options.role ?? 'owner', ledger, mounts: options.mounts, loadedKeys: LOADED_KEYS, ledgerFields: [...LEDGER_FIELDS] });

  return { errors, requests };
}

/** The arguments a "__capture:name" callback received, in call order. */
export async function captured(page: Page, name: string): Promise<unknown[][]> {
  return page.evaluate(name => (window as unknown as { __captures?: Record<string, unknown[][]> }).__captures?.[name] ?? [], name);
}

/** Re-renders the same fixture with a different set of screens (for example, a dialog closed after posting). */
export async function remountJourney(page: Page, mounts: JourneyMount[]): Promise<void> {
  await page.evaluate(async mounts => {
    await (window as unknown as { __journeyRender: (list: unknown[]) => Promise<void> }).__journeyRender(mounts);
  }, mounts);
}

/** Waits until no CSS transition or animation is still running (theme swaps change colours over time). */
export async function settleStyles(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
}

/** The store update the live database subscription would deliver after a server write (a list or a setting such as lockDate). */
export async function setLedgerField(page: Page, field: string, value: unknown): Promise<void> {
  await page.evaluate(async ({ field, value }) => {
    const { useLedgerStore } = await import('/src/stores/useLedgerStore.ts');
    useLedgerStore.setState({ [field]: value } as never);
  }, { field, value });
}
