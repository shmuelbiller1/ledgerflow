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
  'framer-motion',
  'motion-dom',
  'sonner',
  'tailwind-merge',
  'clsx',
  'react-dom',
]);

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
  test('standalone production server bundle excludes client UI modules and Vite dev-server toolchain', () => {
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
      `Standalone server bundle must never import dev/UI packages, found: ${leakedPackages.join(', ')}`,
    );

    const outputBytes = result.outputFiles[0]?.contents.byteLength ?? 0;
    assert.ok(outputBytes > 0 && outputBytes < 3_500_000, `Unexpected server bundle size: ${outputBytes} B`);
  });

  test('Vercel serverless API bundle excludes serveApp, standalone scheduler, client UI, and Vite toolchain', () => {
    const apiIndexSource = fs.readFileSync('api/index.mjs', 'utf8');
    assert.match(apiIndexSource, /from\s+['"]\.\.\/build\/api\.cjs['"]/);

    const result = esbuild.buildSync({
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

    const inputs = Object.keys(result.metafile.inputs);
    assert.ok(!inputs.includes('src/server/http/serveApp.ts'), 'Serverless bundle must exclude serveApp.ts');
    assert.ok(
      !inputs.includes('src/server/jobs/standaloneScheduler.ts'),
      'Serverless bundle must exclude standaloneScheduler.ts',
    );

    const leakedFiles = inputs.filter((file) =>
      FORBIDDEN_CLIENT_PATH_PREFIXES.some((prefix) =>
        prefix.endsWith('.ts') ? file === prefix : file.startsWith(prefix),
      ),
    );
    assert.deepEqual(leakedFiles, []);

    const leakedPackages = [...collectExternalImports(result.metafile)].filter((pkg) =>
      FORBIDDEN_RUNTIME_PACKAGES.has(pkg),
    );
    assert.deepEqual(leakedPackages, []);

    const outputBytes = result.outputFiles[0]?.contents.byteLength ?? 0;
    assert.ok(outputBytes > 0 && outputBytes < 3_500_000, `Unexpected API bundle size: ${outputBytes} B`);
  });
});
