import './helpers/dom';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildStorageAuthHeaders,
  deleteFilesWithPrefix,
  resolveStorageEndpoint,
  storageBucket,
  StorageNotConfiguredError,
} from '../server/storage/supabaseStorage';
import { SYSTEM_GLOSSARY as glossaryLeaf } from '../config/systemGlossary';
import {
  REPORT_TABS_REGISTRY,
  SCREEN_TABS_REGISTRY,
  SETTINGS_TABS_REGISTRY,
  SYSTEM_GLOSSARY as glossaryReexport,
} from '../config/registry';
import {
  REPORT_TAB_IDS,
  SCREEN_TAB_IDS,
  SETTINGS_TAB_IDS,
  buildScreenTabIds,
} from '../config/routeIds';
import { discoverPluginModules, extractPluginRouteIds } from '../config/pluginDiscovery';

describe('Stage 6: Serverless, Bootstrap & Bundle Footprint Invariants', () => {
  test('routeIds and pluginDiscovery stay in exact 1-to-1 parity with registry.tsx', () => {
    assert.deepEqual(SCREEN_TAB_IDS, SCREEN_TABS_REGISTRY.map((tab) => tab.id));
    assert.deepEqual(REPORT_TAB_IDS, REPORT_TABS_REGISTRY.map((report) => report.id));
    assert.deepEqual(SETTINGS_TAB_IDS, SETTINGS_TABS_REGISTRY.map((setting) => setting.id));
    assert.equal(glossaryLeaf, glossaryReexport, 'registry.tsx must re-export SYSTEM_GLOSSARY from systemGlossary.ts');

    assert.deepEqual(discoverPluginModules(), {});
    assert.deepEqual(
      extractPluginRouteIds([
        '../plugins/CustomVatReport.tsx',
        '../plugins/README.tsx',
        '../plugins/README.md',
        '../plugins/BankFeedBridge.tsx',
      ]),
      ['CustomVatReport', 'BankFeedBridge'],
    );
    const withPlugins = buildScreenTabIds([
      '../plugins/CustomVatReport.tsx',
      '../plugins/README.tsx',
    ]);
    assert.ok(withPlugins.includes('dashboard'));
    assert.ok(withPlugins.includes('CustomVatReport'));
    assert.equal(withPlugins.includes('README'), false);
  });

  test('standalone Supabase Storage client handles auth headers, pagination, batch deletes, and missing prefixes', async () => {
    assert.deepEqual(buildStorageAuthHeaders('legacy-jwt-service-role'), {
      apikey: 'legacy-jwt-service-role',
      Authorization: 'Bearer legacy-jwt-service-role',
    });
    assert.deepEqual(buildStorageAuthHeaders('sb_secret_live_12345'), {
      apikey: 'sb_secret_live_12345',
    });
    assert.deepEqual(buildStorageAuthHeaders('sb_publishable_anon_12345'), {
      apikey: 'sb_publishable_anon_12345',
    });
    assert.equal(
      resolveStorageEndpoint('https://project-ref.supabase.co'),
      'https://project-ref.supabase.co/storage/v1',
    );
    assert.equal(
      resolveStorageEndpoint('https://selfhosted.example.com/supabase/'),
      'https://selfhosted.example.com/supabase/storage/v1',
    );

    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevSecret = process.env.SUPABASE_SECRET_KEY;
    const prevUrl = process.env.VITE_SUPABASE_URL;
    const prevBucket = process.env.SUPABASE_STORAGE_BUCKET;

    try {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_SECRET_KEY;
      await assert.rejects(
        () => deleteFilesWithPrefix('workspaces/ws-1/'),
        (err: unknown) => err instanceof StorageNotConfiguredError,
      );

      process.env.VITE_SUPABASE_URL = 'https://unit-test.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_unit_test_key';
      process.env.SUPABASE_STORAGE_BUCKET = 'audit-files';
      assert.equal(storageBucket(), 'audit-files');

      const listRequests: Array<{ prefix: string; limit?: number; offset?: number }> = [];
      const deletedBatches: string[][] = [];
      const seenAuthHeaders: Array<{ apikey: string | null; auth: string | null }> = [];

      const totalFiles = 1_205;
      const allEntries = Array.from({ length: totalFiles }, (_, idx) => ({
        id: `obj-${idx}`,
        name: `receipt-${String(idx).padStart(4, '0')}.pdf`,
      }));

      const mockFetch: typeof fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const headers = new Headers(init?.headers);
        seenAuthHeaders.push({
          apikey: headers.get('apikey'),
          auth: headers.get('Authorization'),
        });
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

        if (url.endsWith('/object/list/audit-files')) {
          const prefix = String(body.prefix ?? '');
          if (prefix === 'missing-ws') {
            return new Response(
              JSON.stringify({ statusCode: '404', error: 'Not Found', message: 'The resource was not found' }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            );
          }
          const limit = Number(body.limit ?? 100);
          const offset = Number(body.offset ?? 0);
          listRequests.push({ prefix, limit, offset });
          const slice = allEntries.slice(offset, offset + limit);
          return new Response(JSON.stringify(slice), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        if (url.endsWith('/object/audit-files') && init?.method === 'DELETE') {
          const prefixes = Array.isArray(body.prefixes) ? (body.prefixes as string[]) : [];
          deletedBatches.push(prefixes);
          return new Response(JSON.stringify(prefixes.map((name) => ({ name }))), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response('Unexpected endpoint: ' + url, { status: 500 });
      };

      const deletedCount = await deleteFilesWithPrefix('workspaces/ws-1/', mockFetch);
      assert.equal(deletedCount, totalFiles);
      assert.equal(listRequests.length, 2, 'Expected two 1,000-item list pages');
      assert.equal(listRequests[0]?.prefix, 'workspaces/ws-1');
      assert.equal(deletedBatches.length, 2, 'Expected two 1,000-item delete batches');
      assert.equal(deletedBatches[0]?.length, 1_000);
      assert.equal(deletedBatches[1]?.length, 205);
      assert.equal(deletedBatches[0]?.[0], 'workspaces/ws-1/receipt-0000.pdf');
      assert.equal(seenAuthHeaders[0]?.apikey, 'sb_secret_unit_test_key');
      assert.equal(seenAuthHeaders[0]?.auth, null, 'sb_secret_ keys must not send Bearer header');

      const missingCount = await deleteFilesWithPrefix('missing-ws/', mockFetch);
      assert.equal(missingCount, 0);
    } finally {
      if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      if (prevSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
      else process.env.SUPABASE_SECRET_KEY = prevSecret;
      if (prevUrl === undefined) delete process.env.VITE_SUPABASE_URL;
      else process.env.VITE_SUPABASE_URL = prevUrl;
      if (prevBucket === undefined) delete process.env.SUPABASE_STORAGE_BUCKET;
      else process.env.SUPABASE_STORAGE_BUCKET = prevBucket;
    }
  });

  test('initial app bootstrap and chart modules stay decoupled from heavy umbrellas', () => {
    for (const chartFile of [
      'src/components/charts/AccountIcicle.tsx',
      'src/components/charts/ChartExploration.tsx',
    ]) {
      const src = fs.readFileSync(path.resolve(chartFile), 'utf8');
      assert.doesNotMatch(src, /from\s+['"]d3['"]/, `${chartFile} must import d3 submodules rather than umbrella d3`);
    }

    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const unusedDep of [
      'd3',
      'vite',
      '@vitejs/plugin-react',
      '@tailwindcss/vite',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ]) {
      assert.equal(
        unusedDep in (pkg.dependencies ?? {}),
        false,
        `Unused/build-only package ${unusedDep} must not live in runtime dependencies`,
      );
    }

    const assetsDir = path.resolve('dist/assets');
    if (process.env.LF_REQUIRE_BUILT_DIST === '1') {
      assert.equal(fs.existsSync(assetsDir), true, 'Expected built dist/assets directory when LF_REQUIRE_BUILT_DIST=1');
    }
    if (fs.existsSync(assetsDir)) {
      const assetFiles = fs.readdirSync(assetsDir);
      const appEntry = assetFiles.find((file) => file.startsWith('app-'));
      assert.ok(appEntry, 'Expected app-[hash].js entry chunk');
      const appBytes = fs.statSync(path.join(assetsDir, appEntry)).size;
      assert.ok(
        appBytes < 260_000,
        `Initial app-[hash].js bootstrap chunk should stay compact (<260 KB), got ${appBytes} B`,
      );
    }
  });
});
