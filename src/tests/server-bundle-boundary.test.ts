import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import esbuild from 'esbuild';

const FORBIDDEN_CLIENT_PATH_PREFIXES = [
  'src/lib/utils.ts',
  'src/stores/',
  'src/components/',
  'src/views/',
  'src/hooks/',
  'src/contexts/',
];

const FORBIDDEN_UI_PACKAGES = new Set([
  'lucide-react',
  'recharts',
  'framer-motion',
  'motion-dom',
  'sonner',
  'tailwind-merge',
  'clsx',
  'react-dom',
]);

describe('Server bundle boundary isolation', () => {
  test('server.ts bundle excludes client stores, UI modules, src/lib/utils.ts, and UI packages', () => {
    const result = esbuild.buildSync({
      entryPoints: ['server.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      write: false,
      metafile: true,
    });

    const inputs = Object.keys(result.metafile.inputs);
    const leakedFiles = inputs.filter((file) =>
      FORBIDDEN_CLIENT_PATH_PREFIXES.some((prefix) =>
        prefix.endsWith('.ts') ? file === prefix : file.startsWith(prefix),
      ),
    );
    assert.deepEqual(
      leakedFiles,
      [],
      `Server bundle must never reach browser/UI modules, found: ${leakedFiles.join(', ')}`,
    );

    const externalPackages = new Set<string>();
    for (const info of Object.values(result.metafile.inputs)) {
      for (const imp of info.imports) {
        if (imp.external) externalPackages.add(imp.path);
      }
    }
    const leakedPackages = [...externalPackages].filter((pkg) => FORBIDDEN_UI_PACKAGES.has(pkg));
    assert.deepEqual(
      leakedPackages,
      [],
      `Server bundle must never import browser UI packages, found: ${leakedPackages.join(', ')}`,
    );

    const outputBytes = result.outputFiles[0]?.contents.byteLength ?? 0;
    assert.ok(outputBytes > 0, 'Expected non-empty server bundle output');
    assert.ok(
      outputBytes < 3_500_000,
      `Expected isolated server bundle under 3.5 MB, got ${(outputBytes / (1024 * 1024)).toFixed(2)} MB`,
    );
  });
});
