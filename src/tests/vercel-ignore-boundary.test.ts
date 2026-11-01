import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import ignore from 'ignore';

const ROOT = process.cwd();

function loadVercelIgnore(): ignore.Ignore {
  const raw = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8');
  return ignore().add(raw);
}

function getTrackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter((file) => Boolean(file) && fs.existsSync(path.join(ROOT, file)));
}

function resolveRelativeTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const cleanSpec = specifier.split('?')[0].split('#')[0];
  const baseAbs = path.resolve(ROOT, path.dirname(fromFile), cleanSpec);
  const candidates = [
    baseAbs,
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    `${baseAbs}.js`,
    `${baseAbs}.mjs`,
    `${baseAbs}.cjs`,
    `${baseAbs}.json`,
    `${baseAbs}.css`,
    path.join(baseAbs, 'index.ts'),
    path.join(baseAbs, 'index.tsx'),
    path.join(baseAbs, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(ROOT, candidate).split(path.sep).join('/');
    }
  }
  return null;
}

describe('.vercelignore deployment context boundary', () => {
  it('retains every required build/runtime entrypoint and vercel.json includeFiles asset', () => {
    const ig = loadVercelIgnore();
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
      functions?: Record<string, { includeFiles?: string }>;
    };

    const requiredFiles = [
      'package.json',
      'package-lock.json',
      '.npmrc',
      'vercel.json',
      'supabase-config.json',
      'index.html',
      'vite.config.ts',
      'tsconfig.json',
      'tsconfig.node.json',
      'server.ts',
      'api/index.mjs',
      'scripts/vercel-csp.ts',
      'src/main.tsx',
      'src/App.tsx',
      'src/index.css',
      'public/apple-touch-icon.png',
      'public/robots.txt',
      'public/pwa-192x192.png',
      'public/pwa-512x512.png',
      'src/server/assets/fonts/DejaVuSans.ttf',
      'src/server/assets/fonts/DejaVuSans-Bold.ttf',
    ];

    for (const relPath of requiredFiles) {
      assert.equal(
        fs.existsSync(path.join(ROOT, relPath)),
        true,
        `Expected required deployment input ${relPath} to exist`,
      );
      assert.equal(
        ig.ignores(relPath),
        false,
        `Required deployment input ${relPath} must NOT be excluded by .vercelignore`,
      );
    }

    const fontGlob = vercelConfig.functions?.['api/index.mjs']?.includeFiles;
    assert.equal(fontGlob, 'src/server/assets/fonts/**');
    for (const fontFile of fs.readdirSync(path.join(ROOT, 'src/server/assets/fonts'))) {
      const rel = `src/server/assets/fonts/${fontFile}`;
      assert.equal(ig.ignores(rel), false, `Bundled PDF font ${rel} must NOT be excluded by .vercelignore`);
    }
  });

  it('never excludes any module reachable from frontend, backend, serverless, or CSP build entrypoints', () => {
    const ig = loadVercelIgnore();
    const entrypoints = [
      'src/main.tsx',
      'server.ts',
      'api/index.mjs',
      'vite.config.ts',
      'scripts/vercel-csp.ts',
    ];

    const visited = new Set<string>();
    const queue = [...entrypoints];
    const specifierPattern =
      /(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      assert.equal(
        ig.ignores(current),
        false,
        `Reachable build/runtime module ${current} is excluded by .vercelignore`,
      );

      if (!/\.(?:[cm]?[jt]sx?)$/.test(current)) continue;
      const source = fs.readFileSync(path.join(ROOT, current), 'utf8');
      for (const match of source.matchAll(specifierPattern)) {
        const spec = match[1] ?? match[2];
        if (!spec) continue;
        // build/api.cjs is generated during `npm run build` rather than committed to git
        if (current === 'api/index.mjs' && spec === '../build/api.cjs') continue;
        const resolved = resolveRelativeTarget(current, spec);
        if (resolved && !visited.has(resolved)) {
          queue.push(resolved);
        }
      }
    }

    assert.ok(visited.size > 1000, `Expected >1000 reachable build modules, found ${visited.size}`);
  });

  it('excludes non-runtime documentation, generated indexes, audits, screenshots, migrations, and tests', () => {
    const ig = loadVercelIgnore();
    const mustIgnore = [
      'docs/CODE_ATLAS.jsonl',
      'docs/CODE_ATLAS_VALIDATION.md',
      'docs/COORDINATION.md',
      'docs/help/overview.md',
      'docs/verification/images/d85/before-dashboard-1280-light.png',
      'audit/BACKEND_FUNCTIONALITY_MAP.csv',
      'audit/EVERY_UI_ACTION_MAP.csv',
      'audit/COMPLETE_FILE_INVENTORY.csv',
      'archive/add_edit_mode.cjs',
      'e2e/smoke.spec.ts',
      'e2e/__screenshots__/dashboard-1280-light-chromium-linux.png',
      'src/tests/server-bundle-boundary.test.ts',
      'src/lib/receiptFixtures.ts',
      'src/lib/decimalRounding.test.ts',
      'src/server/utils/safeFetch.test.ts',
      'supabase/migrations/20260925000000_workspace_fields.sql',
      'supabase/tests/rls.test.sql',
      '.github/workflows/ci.yml',
      '.husky/pre-commit',
      'sdk/index.ts',
      'scripts/code-atlas.mjs',
      'scripts/quality-metrics.ts',
      'tsconfig.node.tsbuildinfo',
      '.env',
      '.env.local',
      '.env.example',
      'AGENTS.md',
      'src/AGENTS.md',
      'CLAUDE.md',
      'CURRENT_WORK.md',
      'eslint.config.js',
      'playwright.config.ts',
      'stryker.config.json',
      'quality-baseline.json',
    ];

    for (const relPath of mustIgnore) {
      assert.equal(
        ig.ignores(relPath),
        true,
        `Non-build/non-runtime artifact ${relPath} should be excluded by .vercelignore`,
      );
    }

    const tracked = getTrackedFiles();
    const kept = ig.filter(tracked);
    const keptBytes = kept.reduce((sum, rel) => sum + fs.statSync(path.join(ROOT, rel)).size, 0);
    assert.ok(
      keptBytes < 20 * 1024 * 1024,
      `Expected filtered Vercel context < 20 MiB, got ${(keptBytes / 1048576).toFixed(2)} MiB`,
    );
  });

  it('keeps TypeScript incremental build caches out of the repository root', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\*\.tsbuildinfo$/m);

    const nodeTsConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.node.json'), 'utf8')) as {
      compilerOptions?: { tsBuildInfoFile?: string; outDir?: string };
    };
    assert.match(nodeTsConfig.compilerOptions?.tsBuildInfoFile ?? '', /^\.\/node_modules\/\.cache\//);
    assert.equal(fs.existsSync(path.join(ROOT, 'tsconfig.node.tsbuildinfo')), false);
  });
});
