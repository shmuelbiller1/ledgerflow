import { expect, type Page } from '@playwright/test';

/**
 * Mounting a screen inside the running dev server, shared by the browser journeys.
 *
 * Every browser journey needs the same preamble: stub the request boundary, serve a bare HTML
 * document for a fixture route (so the real stylesheet and the Vite client load), install the React
 * refresh hook the dev server expects, resolve the stores, sign a fixture user in and render one
 * screen into `#root`. That preamble used to be copied into each journey, which buried the figures
 * the journey is about under boilerplate. The helpers below keep the preamble here and leave a
 * journey with a seed, a screen name and its assertions.
 *
 * A store the mount peeks at; every store is a zustand store, so `setState` is all it needs.
 */
type Store = { setState: (partial: Record<string, unknown>) => void };
/**
 * Everything crossing into the page is plain JSON — no functions and no `eval` — so the mount keeps
 * working under a content security policy that forbids string evaluation.
 */

export type FixtureUser = { uid: string; email: string; displayName: string };

export type MountOptions = {
  /** Bare document title for the fixture route; only affects the browser tab. */
  title: string;
  /** Module that exports the screen, as a Vite path, e.g. '/src/components/sales/Sales.tsx'. */
  screen: string;
  /** Named export to render; defaults to the module's default export. */
  screenExport?: string;
  /** Props for the screen; must be JSON. */
  props?: Record<string, unknown>;
  /** Further Vite modules the screen needs; their exports arrive as `modules` to assertions. */
  modules?: string[];
  /** Workspace the fixture user is signed in to. */
  workspace: { id: string; name: string; currency: string } & Record<string, unknown>;
  /** Ledger collections for the store; the journey's worked figures live here. */
  collections: Record<string, unknown>;
  /** Which data needs the screen should treat as loaded. */
  loaded: Record<string, boolean>;
  /** Answer for one API request; the default is an empty JSON object. */
  api?: (request: { url: string; method: string; body: unknown }) => unknown;
  /** Collect request bodies the screen sends, for journeys that assert the outbound call. */
  requests?: Array<{ url: string; method: string; body: unknown }>;
};

/**
 * The bare document every fixture route serves: no app bundle, so the journey decides what to
 * render, but with the real stylesheet so layout and contrast assertions mean something.
 */
export function fixtureHtml(title: string): string {
  return [
    '<!doctype html><html lang="en" class="light"><head>',
    `<title>LedgerFlow ${title}</title>`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<link rel="stylesheet" href="/src/index.css">',
    '</head><body><div id="root"></div></body></html>',
  ].join('');
}

/** Serve `fixture` as a bare document, navigate to it, and start collecting page errors. */
export async function openFixture(page: Page, fixture: string, title: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`**/${fixture}`, route => route.fulfill({ contentType: 'text/html', body: fixtureHtml(title) }));
  await page.goto(`/${fixture}`);
  return errors;
}

/** Stub the request boundary; the default answers every call with an empty JSON body. */
export async function stubApi(page: Page, options: MountOptions): Promise<void> {
  await page.route('**/rest/v1/**', route => route.fulfill({ json: route.request().method() === 'GET' ? [] : {} }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const body = (() => {
      try {
        return request.postDataJSON();
      } catch {
        return request.postData();
      }
    })();
    options.requests?.push({ url: request.url(), method: request.method(), body });
    return route.fulfill({ json: options.api?.({ url: request.url(), method: request.method(), body }) ?? {} });
  });
}

/**
 * Sign a fixture user in, load the stores the screen reads from and render the screen. Runs inside
 * the page, because the stores are only reachable through the dev server's module graph.
 */
export async function seedAndRender(page: Page, options: MountOptions, user: FixtureUser): Promise<void> {
  await page.evaluate(async ({ workspaceId, user: fixtureUser, collections, loaded, modules: extraModules, screen, screenExport, props, workspace }) => {
    // Vite's React plugin needs its refresh hook installed before any component module loads.
    const refresh = await import('/@react-refresh');
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });

    const stores = ['/src/stores/useAuthStore.ts', '/src/stores/useLedgerStore.ts', '/src/stores/useDataNeedsStore.ts'];
    const paths = ['/node_modules/.vite/deps/react.js', '/node_modules/.vite/deps/react-dom_client.js', ...stores, ...extraModules, screen];
    const resolved = (await Promise.all(paths.map(path => import(path)))) as unknown as [
      { default: { createElement: (type: unknown, props?: unknown) => unknown } },
      { default: { createRoot: (element: HTMLElement) => { render: (node: unknown) => void } } },
      { useAuthStore: Store }, { useLedgerStore: Store }, { useDataNeedsStore: Store },
      ...Record<string, unknown>[],
    ];
    const [react, reactDom, auth, ledger, dataNeeds] = resolved;
    const screenModule = resolved[resolved.length - 1] as Record<string, unknown>;
    const Component = screenExport ? screenModule[screenExport] : screenModule.default;

    const signedIn = { ...fixtureUser, isAnonymous: false, getIdToken: async () => 'browser-fixture-token' };
    auth.useAuthStore.setState({
      user: signedIn,
      isGuest: false,
      currentWorkspaceId: workspaceId,
      // The fixture user owns the workspace, so screens that check roles render their owner actions.
      workspaces: [{ roles: { [fixtureUser.uid]: 'owner' }, ...workspace, id: workspaceId, uid: fixtureUser.uid }],
    });

    ledger.useLedgerStore.setState({ ...collections, truncatedCollections: {}, baseCurrency: workspace.currency } as never);
    dataNeeds.useDataNeedsStore.setState({ loaded, loadedWorkspaceId: workspaceId, failed: {} } as never);

    reactDom.default.createRoot(document.getElementById('root')!).render(react.default.createElement(Component, props ?? {}));
  }, {
    workspaceId: options.workspace.id,
    user,
    collections: options.collections,
    loaded: options.loaded,
    modules: options.modules ?? [],
    screen: options.screen,
    screenExport: options.screenExport,
    props: options.props,
    workspace: options.workspace,
  });
}

/**
 * Mount one screen: open the fixture, stub the boundary, seed the stores and wait for the screen's
 * heading. Returns the page errors collected, for the caller to assert on.
 */
export async function mountScreen(
  page: Page,
  options: MountOptions & { fixture: string; heading: string; user: FixtureUser },
): Promise<string[]> {
  const errors = await openFixture(page, options.fixture, options.title);
  await stubApi(page, options);
  await seedAndRender(page, options, options.user);
  await expect(page.getByRole('heading', { name: options.heading, exact: true })).toBeVisible();
  return errors;
}

/** The width of `selector` and the width of its content, for "nothing is cut off" assertions. */
export async function measure(page: Page, selector: string): Promise<{ width: number; scroll: number }> {
  return page.locator(selector).evaluate(element => ({
    width: (element as HTMLElement).clientWidth,
    scroll: (element as HTMLElement).scrollWidth,
  }));
}
