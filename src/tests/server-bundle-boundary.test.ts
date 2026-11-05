import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import esbuild from 'esbuild';

const FORBIDDEN_CLIENT_PATH_PREFIXES = [
  'src/lib/utils.ts',
  'src/stores/',
  'src/components/',
  'src/views/',
  'src/hooks/',
  'src/contexts/',
];

const FORBIDDEN_RUNTIME_PACKAGES = new Set([
  'vite',
  'rollup',
  'jiti',
  'esbuild',
  'lucide-react',
  'recharts',
  'd3',
  'framer-motion',
  'motion-dom',
  'sonner',
  'tailwind-merge',
  'clsx',
  'react-dom',
  '@supabase/supabase-js',
  '@supabase/auth-js',
  '@supabase/realtime-js',
  '@supabase/postgrest-js',
  'web-streams-polyfill',
  'ws',
]);

/** Collects external package specifiers referenced by an esbuild metafile. */
function collectExternalImports(metafile: esbuild.Metafile): Set<string> {
  const externalPackages = new Set<string>();
  for (const info of Object.values(metafile.inputs)) {
    for (const imp of info.imports) {
      if (imp.external) externalPackages.add(imp.path);
    }
  }
  return externalPackages;
}

describe('Server and serverless bundle boundary isolation', () => {
  test('standalone production server source graph excludes client UI, Vite, and Supabase umbrella packages', () => {
    const result = esbuild.buildSync({
      entryPoints: ['server.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      define: { __PRODUCTION_BUNDLE__: 'true' },
      write: false,
      metafile: true,
    });

    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(
      inputs.includes('src/server/http/serveApp.ts'),
      'Standalone server bundle must retain serveApp.ts for `npm start`',
    );

    const leakedFiles = inputs.filter((file) =>
      FORBIDDEN_CLIENT_PATH_PREFIXES.some((prefix) =>
        prefix.endsWith('.ts') ? file === prefix : file.startsWith(prefix),
      ),
    );
    assert.deepEqual(
      leakedFiles,
      [],
      `Standalone server bundle must never reach browser/UI modules, found: ${leakedFiles.join(', ')}`,
    );

    const leakedPackages = [...collectExternalImports(result.metafile)].filter((pkg) =>
      FORBIDDEN_RUNTIME_PACKAGES.has(pkg),
    );
    assert.deepEqual(
      leakedPackages,
      [],
      `Standalone server bundle must never import dev/UI/umbrella packages, found: ${leakedPackages.join(', ')}`,
    );

    const outputBytes = result.outputFiles[0]?.contents.byteLength ?? 0;
    assert.ok(outputBytes > 0 && outputBytes < 3_500_000, `Unexpected server source bundle size: ${outputBytes} B`);
  });

  test('Vercel serverless API source graph and minified self-contained bundle stay compact and isolated', () => {
    const apiIndexSource = fs.readFileSync('api/index.mjs', 'utf8');
    assert.match(apiIndexSource, /from\s+['"]\.\.\/build\/api\.cjs['"]/);

    const externalGraph = esbuild.buildSync({
      entryPoints: ['server.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      define: {
        __PRODUCTION_BUNDLE__: 'true',
        __SERVERLESS_BUILD__: 'true',
      },
      write: false,
      metafile: true,
    });

    const sourceInputs = Object.keys(externalGraph.metafile.inputs);
    assert.ok(!sourceInputs.includes('src/server/http/serveApp.ts'), 'Serverless bundle must exclude serveApp.ts');
    assert.ok(
      !sourceInputs.includes('src/server/jobs/standaloneScheduler.ts'),
      'Serverless bundle must exclude standaloneScheduler.ts',
    );

    const leakedFiles = sourceInputs.filter((file) =>
      FORBIDDEN_CLIENT_PATH_PREFIXES.some((prefix) =>
        prefix.endsWith('.ts') ? file === prefix : file.startsWith(prefix),
      ),
    );
    assert.deepEqual(leakedFiles, []);

    const leakedPackages = [...collectExternalImports(externalGraph.metafile)].filter((pkg) =>
      FORBIDDEN_RUNTIME_PACKAGES.has(pkg),
    );
    assert.deepEqual(leakedPackages, []);

    // Verify the production minified bundle configuration used by `npm run build`
    const minifiedServerless = esbuild.buildSync({
      entryPoints: ['server.ts'],
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      external: ['pdfkit', 'pg-native'],
      minifySyntax: true,
      minifyWhitespace: true,
      define: {
        __PRODUCTION_BUNDLE__: 'true',
        __SERVERLESS_BUILD__: 'true',
      },
      write: false,
      metafile: true,
    });

    const bundledInputs = Object.keys(minifiedServerless.metafile.inputs);
    for (const forbiddenSubstr of [
      'node_modules/@supabase/supabase-js/',
      'node_modules/@supabase/auth-js/',
      'node_modules/@supabase/realtime-js/',
      'node_modules/@supabase/postgrest-js/',
    ]) {
      assert.equal(
        bundledInputs.some((input) => input.includes(forbiddenSubstr)),
        false,
        `Bundled serverless API must exclude ${forbiddenSubstr}`,
      );
    }

    const outputImports = Object.values(minifiedServerless.metafile.outputs)[0]?.imports ?? [];
    const runtimeInstalledExternals = outputImports
      .filter((imp) => imp.external)
      .map((imp) => imp.path)
      .filter(
        (spec) =>
          !spec.startsWith('node:') &&
          ![
            'assert', 'async_hooks', 'buffer', 'child_process', 'constants', 'crypto', 'diagnostics_channel',
            'dns', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'module', 'net', 'os', 'path',
            'perf_hooks', 'process', 'querystring', 'stream', 'string_decoder', 'tls', 'tty', 'url', 'util',
            'util/types', 'v8', 'vm', 'worker_threads', 'zlib',
            // Optional try/catch native addons that are not installed in node_modules:
            'bufferutil', 'pg-native', 'supports-color', 'utf-8-validate',
          ].includes(spec),
      );
    assert.deepEqual(
      [...new Set(runtimeInstalledExternals)].sort(),
      ['pdfkit'],
      `Only pdfkit should remain as an installed external package in build/api.cjs, got: ${runtimeInstalledExternals.join(', ')}`,
    );

    const bundledBytes = minifiedServerless.outputFiles[0]?.contents.byteLength ?? 0;
    assert.ok(
      bundledBytes > 1_000_000 && bundledBytes < 7_800_000,
      `Bundled minified serverless API should stay compact (<7.8 MB), got ${bundledBytes} B`,
    );
  });
});
